# Publishes the built Windows installer and repository metadata to GitHub.
#
#   $env:GH_TOKEN = "github_pat_..."      # repo + workflow scope, or fine-grained equivalents
#   pwsh -File scripts/publish-release.ps1 -Version 2.2.7
#
# The token is passed to git as a one-shot HTTP header. It is never written to .git/config,
# the remote URL, or the shell history.
[CmdletBinding()]
param(
  [string]$Version = "2.2.7",
  [string]$Token = $env:GH_TOKEN,
  [string]$Repo = "9562295450/Oliviacode",
  [switch]$SkipPush,
  [switch]$SkipRelease
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# User-facing error copy gets its own gate: two 2.2.14 releases shipped raw provider payloads and
# unnamed connections to the retry card, and neither was caught by typecheck or the build.
& (Join-Path $PSScriptRoot "check-error-copy.ps1")
if ($LASTEXITCODE -ne 0) { throw "Error copy gate failed. Fix the copy before publishing." }

$installer = Join-Path $root "dist/desktop/Oliviacode-Setup-$Version.exe"
if (-not (Test-Path $installer)) {
  throw "Missing $installer. Run: bun run pack; `$env:OPENCODE_DESKTOP_APP='dist/desktop/app'; bun run pack"
}

$tag = "v$Version"
$assetName = Split-Path -Leaf $installer
$hash = (Get-FileHash $installer -Algorithm SHA256).Hash.ToLowerInvariant()
$sums = Join-Path $root "dist/desktop/SHA256SUMS.txt"

# electron-updater reads latest.yml before downloading; a release without it leaves every installed
# copy on its current version with no error, so a missing feed is a hard stop.
$feed = Join-Path $root "dist/desktop/latest.yml"
if (-not (Test-Path $feed)) {
  throw "Missing $feed. Re-run: `$env:OPENCODE_DESKTOP_APP='dist/desktop/app'; bun run pack"
}
$feedVersion = (Select-String -Path $feed -Pattern '^version: (.+)$').Matches[0].Groups[1].Value
if ($feedVersion -ne $Version) { throw "latest.yml says $feedVersion, expected $Version" }

$blockmap = "$installer.blockmap"
if (-not (Test-Path $blockmap)) {
  throw "Missing $blockmap. Re-run: `$env:OPENCODE_DESKTOP_APP='dist/desktop/app'; bun run pack"
}

# The checksums page quotes all three files, so the release asset carries all three.
@(
  "$hash  $assetName"
  "$((Get-FileHash $blockmap -Algorithm SHA256).Hash.ToLowerInvariant())  $assetName.blockmap"
  "$((Get-FileHash $feed -Algorithm SHA256).Hash.ToLowerInvariant())  latest.yml"
) | Set-Content -Path $sums -Encoding ascii
Write-Host "artifact  $assetName"
Write-Host "sha256    $hash"
Write-Host "size      $([math]::Round((Get-Item $installer).Length / 1MB, 1)) MB"

if (-not $Token) {
  throw @"
No token. Create a fine-grained PAT at https://github.com/settings/tokens?type=beta
  Repository access : 9562295450/Oliviacode
  Permissions       : Contents = Read and write, Administration = Read and write
Then, in this shell:
  `$env:GH_TOKEN = "github_pat_..."
  pwsh -File scripts/publish-release.ps1 -Version $Version
"@
}

$headers = @{
  Authorization          = "Bearer $Token"
  Accept                 = "application/vnd.github+json"
  "X-GitHub-Api-Version" = "2022-11-28"
  "User-Agent"           = "oliviacode-release"
}

# 1. Commit and push the tree. The tag is created by the release API below: pushing it here would
# start the publish workflow before the Windows installer is attached, and the workflow would then
# rebuild and replace the binary that was just verified on this machine.
if (-not $SkipPush) {
  git add -A
  $pending = git status --porcelain
  if ($pending) {
    git commit --no-verify -m "Release $Version" | Out-Host
  }
  git tag -f $tag | Out-Host
  $basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("x-access-token:$Token"))
  git -c "http.extraheader=AUTHORIZATION: basic $basic" push --no-verify origin "HEAD:refs/heads/main" | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "git push main failed ($LASTEXITCODE)" }

  # A second publish of a version that is already out moves the tag. The release workflow builds
  # macOS and Linux from the tagged commit, so a tag left on the previous commit would attach
  # binaries that do not contain the changes these notes describe.
  $head = (git rev-parse HEAD).Trim()
  $remoteTag = @(git ls-remote --tags origin "refs/tags/$tag" 2>$null) |
    ForEach-Object { ($_ -split "`t")[0] } |
    Select-Object -First 1

  if ($remoteTag -and $remoteTag -ne $head) {
    git -c "http.extraheader=AUTHORIZATION: basic $basic" push --no-verify --force origin "refs/tags/$tag" | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "git push tag failed ($LASTEXITCODE)" }
    # The tag push is the event publish.yml listens for, so dispatching as well would queue a
    # second full build of the same commit.
    $tagMoved = $true
    Write-Host "tag       moved $tag -> $($head.Substring(0,8))"
  }
}

# 2. About box: description, homepage, topics.
$description = "A privacy-focused desktop AI client. Bring your own provider: nothing is preconfigured, no endpoint is bundled, and provider add-ons are community data you choose to load. Multi-lane egress, session isolation, MIT licensed."
$topics = @(
  "ai-client", "desktop-app", "electron", "privacy", "byok", "bring-your-own-key",
  "multi-provider", "egress", "tor", "wireguard", "typescript", "solidjs", "mit-license"
)
$body = @{
  description = $description
  homepage    = "https://github.com/$Repo"
} | ConvertTo-Json
Invoke-RestMethod -Method Patch -Uri "https://api.github.com/repos/$Repo" -Headers $headers -Body $body | Out-Null
$topicBody = @{ names = $topics } | ConvertTo-Json
Invoke-RestMethod -Method Put -Uri "https://api.github.com/repos/$Repo/topics" -Headers $headers -Body $topicBody | Out-Null
Write-Host "about     updated"

if ($SkipRelease) { return }

# 3. Release. Reuse the release when re-running against the same tag.
$notes = Join-Path $root ".github/RELEASE_NOTES.md"
$release = $null
try {
  $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/tags/$tag" -Headers $headers
} catch {
  if ($_.Exception.Response.StatusCode.value__ -ne 404) { throw }
}

# The notes carry typographic quotes and dashes. Windows PowerShell serialises a string body as
# ISO-8859-1 unless it is handed the bytes, which mangles them into an invalid JSON payload that
# GitHub rejects with "Problems parsing JSON". Always send explicit UTF-8.
function Send-Json([string]$Method, [string]$Uri, $Payload) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes(($Payload | ConvertTo-Json -Compress))
  Invoke-RestMethod -Method $Method -Uri $Uri -Headers $headers `
    -ContentType "application/json; charset=utf-8" -Body $bytes
}

$notesBody = [System.IO.File]::ReadAllText($notes, [System.Text.Encoding]::UTF8)

if (-not $release) {
  $release = Send-Json Post "https://api.github.com/repos/$Repo/releases" @{
    tag_name         = $tag
    target_commitish = "main"
    name             = "Oliviacode $Version"
    body             = $notesBody
    draft            = $false
    prerelease       = $false
  }
  Write-Host "release   created $($release.html_url)"
} else {
  # Re-publishing an existing tag replaces assets, so the body has to be replaced too: the
  # release body is what documents the bytes that were just uploaded.
  $release = Send-Json Patch "https://api.github.com/repos/$Repo/releases/$($release.id)" @{
    name = "Oliviacode $Version"
    body = $notesBody
  }
  Write-Host "release   updated $($release.html_url)"
}

# 4. Assets. Delete a same-named asset first so a re-run replaces it.
function Publish-Asset([string]$Path) {
  $name = Split-Path -Leaf $Path
  $existing = $release.assets | Where-Object { $_.name -eq $name }
  if ($existing) {
    Invoke-RestMethod -Method Delete -Uri "https://api.github.com/repos/$Repo/releases/assets/$($existing.id)" -Headers $headers | Out-Null
    Write-Host "asset     replaced $name"
  }
  $upload = "https://uploads.github.com/repos/$Repo/releases/$($release.id)/assets?name=$([uri]::EscapeDataString($name))"
  Invoke-RestMethod -Method Post -Uri $upload -Headers $headers -ContentType "application/octet-stream" -InFile $Path | Out-Null
  Write-Host "asset     uploaded $name"
}

Publish-Asset $installer
Publish-Asset $feed
Publish-Asset $blockmap
Publish-Asset $sums

# 4b. The sums file lists every asset on the release, not just the Windows three. On a re-publish
# the macOS and Linux artifacts are already attached, so fold them in before the file is final.
# GitHub's digest is the hash of the stored upload, which is what a downloader actually receives.
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/tags/$tag" -Headers $headers
$assetLines = @($release.assets |
  Where-Object { $_.name -ne "SHA256SUMS.txt" -and $_.state -eq "uploaded" -and $_.digest } |
  Sort-Object name |
  ForEach-Object { "$($_.digest -replace '^sha256:', '')  $($_.name)" })
if ($assetLines.Count -gt 3) {
  [System.IO.File]::WriteAllText($sums, (($assetLines -join "`n") + "`n"), (New-Object System.Text.UTF8Encoding($false)))
  $previous = $release.assets | Where-Object { $_.name -eq "SHA256SUMS.txt" }
  if ($previous) {
    Invoke-RestMethod -Method Delete -Uri "https://api.github.com/repos/$Repo/releases/assets/$($previous.id)" -Headers $headers | Out-Null
  }
  $upload = "https://uploads.github.com/repos/$Repo/releases/$($release.id)/assets?name=SHA256SUMS.txt"
  Invoke-RestMethod -Method Post -Uri $upload -Headers $headers -ContentType "application/octet-stream" -InFile $sums | Out-Null
  Write-Host "asset     uploaded SHA256SUMS.txt ($($assetLines.Count) entries)"
}

# 5. Build the other platforms. A first publish has to dispatch the workflow because the release
# API created the tag server-side and that raises no push event. A re-publish already raised one by
# moving the tag, so dispatching here would queue the same build twice.
if ($tagMoved) {
  Write-Host "workflow  publish.yml queued by the tag push @ $tag"
}
if (-not $SkipPush -and -not $tagMoved) {
  $dispatch = @{ ref = $tag; inputs = @{ version = $Version } } | ConvertTo-Json
  $queued = $false
  foreach ($attempt in 1..5) {
    try {
      Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$Repo/actions/workflows/publish.yml/dispatches" -Headers $headers -Body $dispatch | Out-Null
      $queued = $true
      break
    } catch {
      # GitHub indexes a workflow file a few seconds after the push that added it.
      if ($attempt -eq 5) { Write-Warning "Could not dispatch publish.yml: $($_.Exception.Message)" }
      else { Start-Sleep -Seconds 5 }
    }
  }
  if ($queued) { Write-Host "workflow  queued publish.yml @ $tag" }
  else { Write-Warning "Run it manually: Actions -> publish -> Run workflow, version $Version" }
}

Write-Host "done      https://github.com/$Repo/releases/tag/$tag"
