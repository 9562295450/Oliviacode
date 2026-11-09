# Installs the built installer silently, proves the desktop shortcut exists and points at the
# installed executable, then uninstalls and proves the shortcut is gone. Run on a disposable
# Windows profile or a VM; it writes to the current user's Desktop and Start Menu.
#
#   pwsh -File scripts/verify-installer.ps1 -Version 2.2.7
[CmdletBinding()]
param(
  [string]$Version = "2.2.7",
  [string]$Installer = "",
  [switch]$KeepInstalled
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not $Installer) { $Installer = Join-Path $root "dist/desktop/Oliviacode-Setup-$Version.exe" }
if (-not (Test-Path $Installer)) { throw "Missing $Installer" }

$desktop = [Environment]::GetFolderPath("Desktop")
$shortcut = Join-Path $desktop "Oliviacode.lnk"
$startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Oliviacode.lnk"

Write-Host "installer   $Installer"
Write-Host "sha256      $((Get-FileHash $Installer -Algorithm SHA256).Hash.ToLowerInvariant())"

if (Test-Path $shortcut) { Remove-Item $shortcut -Force }
Write-Host "installing silently..."
Start-Process -FilePath $Installer -ArgumentList "/S" -Wait

if (-not (Test-Path $shortcut)) { throw "no desktop shortcut at $shortcut" }
$target = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut).TargetPath
if (-not (Test-Path $target)) { throw "shortcut target missing: $target" }
if (-not (Test-Path $startMenu)) { throw "no Start Menu shortcut at $startMenu" }
$installDir = Split-Path -Parent $target
Write-Host "shortcut    $shortcut -> $target"
Write-Host "installdir  $installDir"

if ($KeepInstalled) { Write-Host "kept installed"; return }

$uninstaller = Get-ChildItem $installDir -Filter "Uninstall*.exe" -ErrorAction Stop | Select-Object -First 1
Write-Host "uninstalling $($uninstaller.FullName)..."
Start-Process -FilePath $uninstaller.FullName -ArgumentList "/S" -Wait

$deadline = (Get-Date).AddSeconds(30)
while ((Test-Path $installDir) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
if (Test-Path $installDir) { throw "install directory still present: $installDir" }
if (Test-Path $shortcut) { throw "desktop shortcut survived uninstall: $shortcut" }
Write-Host "clean       install dir and shortcuts removed"
