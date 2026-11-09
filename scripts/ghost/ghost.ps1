<#
.SYNOPSIS
    Ghost — a real Chromium that renders on a desktop nobody is looking at.

.DESCRIPTION
    Headless Chrome is not a browser that is hidden; it is a different browser. It reports
    HeadlessChrome in the UA, draws through SwiftShader instead of the GPU, has no window
    geometry, no profile history and no session, and those are the tells a risk engine reads.

    Ghost inverts that. It launches a normal, headful Chromium — real GPU, real fonts, real
    window, no automation flags — onto a private Win32 desktop inside the interactive window
    station. The process renders and composites exactly like it would on the visible desktop;
    there is simply no monitor attached to that desktop, so nothing appears, nothing takes focus
    and nothing lands in the taskbar. Because it shares the window station, it keeps the user's
    display, locale, codecs and GPU adapter.

    Drive it over CDP (`--remote-debugging-port`) or attach Playwright/Electron with
    `chromium.connectOverCDP`. Input dispatched over CDP is trusted at the renderer level, which
    is the other half of looking like a person.

.PARAMETER Command
    install   download Chrome for Testing into %LOCALAPPDATA%\Oliviacode\ghost\chrome
    launch    start a browser and print its CDP endpoint as JSON
    status    report whether a project's endpoint answers
    kill      stop every browser started against a profile
    list      list running ghost browsers

.PARAMETER Name
    Profile name. One name is one persistent identity: cookies, history, localStorage, cache.
    Use a different name per account; reuse the name to keep that account signed in.

.PARAMETER Port
    Remote debugging port. One per running profile.

.PARAMETER Url
    Page to open at launch.

.PARAMETER Browser
    auto | chrome | edge | brave | ghost (the installed Chrome for Testing)

.PARAMETER Headless
    Control mode: launch the same browser with --headless=new for A/B fingerprint comparison.

.PARAMETER Visible
    Put the window on the current desktop, for a human to sign in by hand. Same profile.

.EXAMPLE
    .\ghost.ps1 -Command install
    .\ghost.ps1 -Command launch -Name reddit-a -Port 9333 -Url https://www.reddit.com/login
    .\ghost.ps1 -Command launch -Name control -Port 9444 -Headless
    .\ghost.ps1 -Command kill -Name reddit-a
#>

[CmdletBinding()]
param(
    [ValidateSet('install', 'launch', 'status', 'kill', 'list')]
    [string]$Command = 'launch',

    [string]$Name = 'default',

    [int]$Port = 9333,

    [string]$Url = 'about:blank',

    [ValidateSet('auto', 'chrome', 'edge', 'brave', 'ghost')]
    [string]$Browser = 'auto',

    [switch]$Headless,

    [switch]$Visible
)

$ErrorActionPreference = 'Stop'

$Root = Join-Path $env:LOCALAPPDATA 'Oliviacode\ghost'
$Profiles = Join-Path $Root 'profiles'
$InstalledChrome = Join-Path $Root 'chrome\chrome-win64\chrome.exe'
$DesktopPrefix = 'OliviacodeGhost-'

function Get-BrowserPath {
    param([string]$Choice)

    $candidates = @{
        ghost  = @($InstalledChrome)
        chrome = @(
            (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
            (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
            (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
        )
        edge   = @(
            (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
            (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
        )
        brave  = @(
            (Join-Path $env:ProgramFiles 'BraveSoftware\Brave-Browser\Application\brave.exe'),
            (Join-Path $env:LOCALAPPDATA 'BraveSoftware\Brave-Browser\Application\brave.exe')
        )
    }

    $order = if ($Choice -eq 'auto') { @('ghost', 'chrome', 'edge', 'brave') } else { @($Choice) }

    foreach ($key in $order) {
        foreach ($path in $candidates[$key]) {
            if ($path -and (Test-Path -LiteralPath $path)) {
                return [pscustomobject]@{ Path = $path; Family = $key }
            }
        }
    }

    return $null
}

function Install-GhostChrome {
    New-Item -ItemType Directory -Force -Path $Root | Out-Null

    Write-Host 'resolving Chrome for Testing (stable, win64)...'
    $meta = Invoke-RestMethod -Uri 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json' -UseBasicParsing
    $channel = $meta.channels.Stable
    $download = $channel.downloads.chrome | Where-Object { $_.platform -eq 'win64' } | Select-Object -First 1

    if (-not $download) { throw 'Chrome for Testing metadata had no win64 chrome build.' }

    $zip = Join-Path $Root 'chrome-win64.zip'
    if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }

    Write-Host "downloading $($channel.version) from $($download.url)"
    $previous = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'
    try {
        Invoke-WebRequest -Uri $download.url -OutFile $zip -UseBasicParsing
    } finally {
        $ProgressPreference = $previous
    }

    $extract = Join-Path $Root 'chrome'
    if (Test-Path -LiteralPath $extract) { Remove-Item -LiteralPath $extract -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $extract | Out-Null

    Write-Host 'extracting...'
    Expand-Archive -LiteralPath $zip -DestinationPath $extract -Force
    Remove-Item -LiteralPath $zip -Force

    if (-not (Test-Path -LiteralPath $InstalledChrome)) { throw "Extract finished without $InstalledChrome" }

    [pscustomobject]@{
        ok = $true
        command = 'install'
        version = $channel.version
        path = $InstalledChrome
    } | ConvertTo-Json -Compress
}

function Initialize-GhostType {
    if ('GhostDesktop.Launcher' -as [type]) { return }

    Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

namespace GhostDesktop
{
    public static class Launcher
    {
        public const uint DESKTOP_ALL_ACCESS = 0x000F01FF;

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern IntPtr CreateDesktop(string lpszDesktop, IntPtr lpszDevice, IntPtr pDevmode, int dwFlags, uint dwDesiredAccess, IntPtr lpsa);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SetThreadDesktop(IntPtr hDesktop);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool CloseDesktop(IntPtr hDesktop);

        /// <summary>
        /// Starts a process on a private desktop of the current window station.
        ///
        /// A process inherits the desktop of the thread that creates it, so the work happens on a
        /// thread with no windows and no hooks of its own: create the desktop, claim it with
        /// SetThreadDesktop, start the browser, let the thread die. The desktop handle is closed
        /// once the child holds its own reference.
        /// </summary>
        public static int Launch(string executable, string arguments, string desktopName)
        {
            IntPtr desktop = CreateDesktop(desktopName, IntPtr.Zero, IntPtr.Zero, 0, DESKTOP_ALL_ACCESS, IntPtr.Zero);
            if (desktop == IntPtr.Zero)
                throw new InvalidOperationException("CreateDesktop('" + desktopName + "') failed with Win32 error " + Marshal.GetLastWin32Error() + ".");

            int pid = 0;
            Exception failure = null;

            Thread thread = new Thread(delegate()
            {
                try
                {
                    if (!SetThreadDesktop(desktop))
                        throw new InvalidOperationException("SetThreadDesktop failed with Win32 error " + Marshal.GetLastWin32Error() + ".");

                    ProcessStartInfo info = new ProcessStartInfo(executable, arguments);
                    info.UseShellExecute = false;
                    info.CreateNoWindow = true;
                    info.WorkingDirectory = AppDomain.CurrentDomain.BaseDirectory;

                    Process process = Process.Start(info);
                    pid = process.Id;
                }
                catch (Exception error)
                {
                    failure = error;
                }
            });

            thread.IsBackground = false;
            thread.Start();
            thread.Join();
            CloseDesktop(desktop);

            if (failure != null) throw new InvalidOperationException(failure.Message, failure);
            if (pid == 0) throw new InvalidOperationException("Process.Start returned no process id.");

            return pid;
        }
    }
}
'@
}

function Start-GhostBrowser {
    param([string]$Executable, [string]$Arguments, [string]$DesktopName)

    Initialize-GhostType
    return [GhostDesktop.Launcher]::Launch($Executable, $Arguments, $DesktopName)
}

function Wait-DevTools {
    param([int]$TargetPort, [int]$Seconds = 40)

    $deadline = (Get-Date).AddSeconds($Seconds)

    while ((Get-Date) -lt $deadline) {
        try {
            $version = Invoke-RestMethod -Uri "http://127.0.0.1:$TargetPort/json/version" -TimeoutSec 2 -UseBasicParsing
            if ($version.webSocketDebuggerUrl) { return $version }
        } catch {
            Start-Sleep -Milliseconds 400
        }
    }

    return $null
}

function Get-GhostProcesses {
    param([string]$ProfilePath)

    Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe' OR Name = 'msedge.exe' OR Name = 'brave.exe'" |
        Where-Object { $_.CommandLine -and $_.CommandLine.Contains($ProfilePath) }
}

switch ($Command) {
    'install' {
        Install-GhostChrome
        break
    }

    'launch' {
        $resolved = Get-BrowserPath -Choice $Browser
        if (-not $resolved) { throw "No browser found for '$Browser'. Run: ghost.ps1 -Command install" }

        $profile = Join-Path $Profiles $Name
        New-Item -ItemType Directory -Force -Path $profile | Out-Null

        $arguments = @(
            "--user-data-dir=`"$profile`"",
            "--remote-debugging-port=$Port",
            '--remote-allow-origins=*',
            '--window-size=1280,900',
            '--window-position=0,0',
            '--lang=en-US',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-search-engine-choice-screen',
            '--disable-features=Translate,MediaRouter,OptimizationHints',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            "$Url"
        ) -join ' '

        $desktopName = $DesktopPrefix + $Name
        $mode = 'hidden-desktop'

        if ($Headless) {
            $arguments = "--headless=new $arguments"
            $processId = Start-Process -FilePath $resolved.Path -ArgumentList $arguments -PassThru -WindowStyle Hidden | Select-Object -ExpandProperty Id
            $mode = 'headless'
        } elseif ($Visible) {
            $processId = (Start-Process -FilePath $resolved.Path -ArgumentList $arguments -PassThru).Id
            $mode = 'visible'
        } else {
            try {
                $processId = Start-GhostBrowser -Executable $resolved.Path -Arguments $arguments -DesktopName $desktopName
            } catch {
                # A machine policy can forbid a second desktop. A browser parked off the visible
                # area is still headful, which is the part that decides the fingerprint.
                Write-Host "hidden desktop failed ($($_.Exception.Message)); parking window off-screen"
                $offScreen = $arguments -replace '--window-position=0,0', '--window-position=-32000,-32000'
                $processId = (Start-Process -FilePath $resolved.Path -ArgumentList $offScreen -PassThru).Id
                $mode = 'offscreen-window'
            }
        }

        $version = Wait-DevTools -TargetPort $Port
        if (-not $version) { throw "Browser started (pid $processId) but http://127.0.0.1:$Port/json/version never answered." }

        [pscustomobject]@{
            ok = $true
            mode = $mode
            family = $resolved.Family
            browser = $resolved.Path
            pid = $processId
            port = $Port
            profile = $profile
            desktop = if ($mode -eq 'hidden-desktop') { $desktopName } else { $null }
            browserVersion = $version.Browser
            webSocketDebuggerUrl = $version.webSocketDebuggerUrl
        } | ConvertTo-Json -Compress

        break
    }

    'status' {
        $profile = Join-Path $Profiles $Name
        $version = $null
        try { $version = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 2 -UseBasicParsing } catch { }

        [pscustomobject]@{
            ok = [bool]$version
            name = $Name
            port = $Port
            profile = $profile
            running = [bool](Get-GhostProcesses -ProfilePath $profile)
            browserVersion = if ($version) { $version.Browser } else { $null }
        } | ConvertTo-Json -Compress

        break
    }

    'kill' {
        $profile = Join-Path $Profiles $Name
        $victims = @(Get-GhostProcesses -ProfilePath $profile)

        foreach ($victim in $victims) {
            try { Stop-Process -Id $victim.ProcessId -Force -ErrorAction Stop } catch { }
        }

        [pscustomobject]@{
            ok = $true
            name = $Name
            stopped = $victims.Count
        } | ConvertTo-Json -Compress

        break
    }

    'list' {
        $running = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe' OR Name = 'msedge.exe' OR Name = 'brave.exe'" |
            Where-Object { $_.CommandLine -and $_.CommandLine.Contains('remote-debugging-port') -and $_.CommandLine.Contains('Oliviacode\ghost') } |
            ForEach-Object {
                $port = if ($_.CommandLine -match 'remote-debugging-port=(\d+)') { [int]$Matches[1] } else { 0 }
                [pscustomobject]@{ pid = $_.ProcessId; port = $port; created = $_.CreationDate }
            }

        [pscustomobject]@{ ok = $true; running = @($running) } | ConvertTo-Json -Depth 4 -Compress

        break
    }
}

