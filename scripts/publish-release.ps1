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

$installer = Join-Path $root "dist/desktop/Oliviacode-Setup-$Version.exe"
if (-not (Test-Path $installer)) {
  throw "Missing $installer. Run: bun run pack; `$env:OPENCODE_DESKTOP_APP='dist/desktop/app'; bun run pack"
}

$tag = "v$Version"
$assetName = Split-Path -Leaf $installer
$hash = (Get-FileHash $installer -Algorithm SHA256).Hash.ToLowerInvariant()
$sums = Join-Path $root "dist/desktop/SHA256SUMS.txt"
"$hash  $assetName" | Set-Content -Path $sums -Encoding ascii

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

if (-not $release) {
  $payload = @{
    tag_name         = $tag
    target_commitish = "main"
    name             = "Oliviacode $Version"
    body             = [System.IO.File]::ReadAllText($notes)
    draft            = $false
    prerelease       = $false
  } | ConvertTo-Json
  $release = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$Repo/releases" -Headers $headers -Body $payload
  Write-Host "release   created $($release.html_url)"
} else {
  Write-Host "release   exists  $($release.html_url)"
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
Publish-Asset $sums
Publish-Asset $feed
Publish-Asset $blockmap

# 5. Build the other platforms. The release API created the tag pointing at the commit just pushed;
# a git tag push would be a no-op and would raise no workflow event, so dispatch the workflow
# explicitly. Its Windows job sees the installer above and skips; Linux and macOS build and attach.
if (-not $SkipPush) {
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
