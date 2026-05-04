#Requires -Version 5.1
param(
    [switch]$Force,
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

# Auto-detect repo path from this script's location
$scriptsDir = Split-Path -Parent $PSScriptRoot
$repoRoot = Resolve-Path $scriptsDir
$agentPath = Join-Path $repoRoot "dev-presence-extension"
$watchdogPath = Join-Path $agentPath "watchdog.js"

if (-not (Test-Path $watchdogPath)) {
    Write-Error "Could not find watchdog.js at $watchdogPath. Are you running this from the repo?"
    exit 1
}

$startupDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
$agentShortcut = Join-Path $startupDir "DevPresenceAgent.lnk"
$watchdogShortcut = Join-Path $startupDir "DevPresenceWatchdog.lnk"

function Test-IsAdmin {
    $currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    return $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Remove-StartupShortcuts {
    if (Test-Path $agentShortcut) {
        Remove-Item $agentShortcut -Force
        Write-Host "[Startup] Agent shortcut removed" -ForegroundColor Green
    }
    if (Test-Path $watchdogShortcut) {
        Remove-Item $watchdogShortcut -Force
        Write-Host "[Startup] Watchdog shortcut removed" -ForegroundColor Green
    }
}

function Remove-DevPresenceTask {
    param([string]$Name)
    $task = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    if ($task) {
        try {
            Unregister-ScheduledTask -TaskName $Name -Confirm:$false
            Write-Host "[$Name] Removed" -ForegroundColor Green
        } catch {
            Write-Host "[$Name] Cannot remove (requires Admin). Run this script as Administrator or uninstall manually." -ForegroundColor Red
        }
    }
}

function New-StartupShortcut {
    param(
        [string]$Path,
        [string]$Target,
        [string]$Arguments,
        [string]$WorkingDir,
        [string]$Description
    )
    $WshShell = New-Object -ComObject WScript.Shell
    $shortcut = $WshShell.CreateShortcut($Path)
    $shortcut.TargetPath = $Target
    $shortcut.Arguments = $Arguments
    $shortcut.WorkingDirectory = $WorkingDir
    $shortcut.Description = $Description
    $shortcut.WindowStyle = 7  # Minimized
    $shortcut.Save()
}

if ($Uninstall) {
    Write-Host "Uninstalling Dev Presence auto-start..." -ForegroundColor Cyan
    Remove-DevPresenceTask "DevPresenceAgent"
    Remove-DevPresenceTask "DevPresenceWatcher"
    Remove-DevPresenceTask "DevPresenceWatchdog"
    Remove-StartupShortcuts

    $watcherPidFile = Join-Path $env:TEMP "devpresence-watcher.pid"
    $watchdogPidFile = Join-Path $env:TEMP "devpresence-watchdog.pid"
    if (Test-Path $watcherPidFile) { Remove-Item $watcherPidFile -Force }
    if (Test-Path $watchdogPidFile) { Remove-Item $watchdogPidFile -Force }

    Write-Host "Done. You may also want to stop running node processes manually." -ForegroundColor Green
    exit 0
}

Write-Host "Installing Dev Presence auto-start..." -ForegroundColor Cyan
Write-Host "Repo root: $repoRoot" -ForegroundColor Gray

$useStartup = $false

# Try Scheduled Tasks first (preferred)
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable `
    -MultipleInstances IgnoreNew

$trigger = New-ScheduledTaskTrigger -AtLogOn

# 1. Agent task
$agentAction = New-ScheduledTaskAction `
    -Execute "node" `
    -Argument "--env-file-if-exists=agent/.env agent/server.js" `
    -WorkingDirectory $agentPath

$existingAgent = Get-ScheduledTask -TaskName "DevPresenceAgent" -ErrorAction SilentlyContinue
if ($existingAgent -and -not $Force) {
    Write-Host "[DevPresenceAgent] Already exists (use -Force to overwrite)" -ForegroundColor Yellow
} else {
    if ($existingAgent) {
        try { Unregister-ScheduledTask -TaskName "DevPresenceAgent" -Confirm:$false } catch {}
    }
    try {
        Register-ScheduledTask `
            -TaskName "DevPresenceAgent" `
            -Action $agentAction `
            -Trigger $trigger `
            -Settings $settings `
            -Description "Dev Presence local agent (always-on)" -ErrorAction Stop | Out-Null
        Write-Host "[DevPresenceAgent] Scheduled task installed" -ForegroundColor Green
    } catch {
        Write-Host "[DevPresenceAgent] Scheduled task failed (needs Admin). Falling back to Startup folder..." -ForegroundColor Yellow
        $useStartup = $true
    }
}

# 2. Watchdog task
$watchdogAction = New-ScheduledTaskAction `
    -Execute "node" `
    -Argument "watchdog.js" `
    -WorkingDirectory $agentPath

$existingWatchdog = Get-ScheduledTask -TaskName "DevPresenceWatchdog" -ErrorAction SilentlyContinue
if ($existingWatchdog -and -not $Force) {
    Write-Host "[DevPresenceWatchdog] Already exists (use -Force to overwrite)" -ForegroundColor Yellow
} else {
    if ($existingWatchdog) {
        try { Unregister-ScheduledTask -TaskName "DevPresenceWatchdog" -Confirm:$false } catch {}
    }
    try {
        Register-ScheduledTask `
            -TaskName "DevPresenceWatchdog" `
            -Action $watchdogAction `
            -Trigger $trigger `
            -Settings $settings `
            -Description "Dev Presence watchdog (starts watcher when Zed opens)" -ErrorAction Stop | Out-Null
        Write-Host "[DevPresenceWatchdog] Scheduled task installed" -ForegroundColor Green
    } catch {
        Write-Host "[DevPresenceWatchdog] Scheduled task failed (needs Admin). Falling back to Startup folder..." -ForegroundColor Yellow
        $useStartup = $true
    }
}

# Fallback: Startup folder shortcuts (no admin required)
if ($useStartup) {
    Write-Host ""
    Write-Host "Using Startup folder (no admin required)..." -ForegroundColor Cyan

    # Remove any old scheduled tasks we might have created
    Remove-DevPresenceTask "DevPresenceAgent"
    Remove-DevPresenceTask "DevPresenceWatchdog"

    New-StartupShortcut `
        -Path $agentShortcut `
        -Target "node" `
        -Arguments "--env-file-if-exists=agent/.env agent/server.js" `
        -WorkingDir $agentPath `
        -Description "Dev Presence Agent"
    Write-Host "[DevPresenceAgent] Startup shortcut installed" -ForegroundColor Green

    New-StartupShortcut `
        -Path $watchdogShortcut `
        -Target "node" `
        -Arguments "watchdog.js" `
        -WorkingDir $agentPath `
        -Description "Dev Presence Watchdog"
    Write-Host "[DevPresenceWatchdog] Startup shortcut installed" -ForegroundColor Green
}

# Start immediately
Write-Host ""
Write-Host "Starting services now..." -ForegroundColor Cyan

if ($useStartup) {
    # Start via hidden windows
    Start-Process -FilePath "node" -ArgumentList "--env-file-if-exists=agent/.env agent/server.js" -WorkingDirectory $agentPath -WindowStyle Hidden
    Start-Sleep -Milliseconds 800
    Start-Process -FilePath "node" -ArgumentList "watchdog.js" -WorkingDirectory $agentPath -WindowStyle Hidden
} else {
    # Start scheduled tasks and wait for them to actually spawn processes
    try {
        Start-ScheduledTask -TaskName "DevPresenceAgent" -ErrorAction Stop
        Write-Host "[DevPresenceAgent] Task triggered" -ForegroundColor Green
    } catch {
        Write-Host "[DevPresenceAgent] Failed to start task. Starting manually..." -ForegroundColor Yellow
        Start-Process -FilePath "node" -ArgumentList "--env-file-if-exists=agent/.env agent/server.js" -WorkingDirectory $agentPath -WindowStyle Hidden
    }

    Start-Sleep -Milliseconds 1500

    try {
        Start-ScheduledTask -TaskName "DevPresenceWatchdog" -ErrorAction Stop
        Write-Host "[DevPresenceWatchdog] Task triggered" -ForegroundColor Green
    } catch {
        Write-Host "[DevPresenceWatchdog] Failed to start task. Starting manually..." -ForegroundColor Yellow
        Start-Process -FilePath "node" -ArgumentList "watchdog.js" -WorkingDirectory $agentPath -WindowStyle Hidden
    }
}

Write-Host ""
Write-Host "Done! Dev Presence will auto-start on login." -ForegroundColor Green
Write-Host "Run '.\scripts\devpresence.ps1' to check health." -ForegroundColor Green
Write-Host "Run this script with -Uninstall to remove." -ForegroundColor Gray
if ($useStartup) {
    Write-Host "Note: Using Startup folder fallback (Scheduled Tasks require Administrator)." -ForegroundColor DarkGray
}
Write-Host ""
Write-Host "Manual control commands:" -ForegroundColor Cyan
Write-Host "  Start agent:   Start-ScheduledTask -TaskName 'DevPresenceAgent'" -ForegroundColor Gray
Write-Host "  Stop agent:    Stop-ScheduledTask -TaskName 'DevPresenceAgent'" -ForegroundColor Gray
Write-Host "  Start watchdog: Start-ScheduledTask -TaskName 'DevPresenceWatchdog'" -ForegroundColor Gray
Write-Host "  Stop watchdog:  Stop-ScheduledTask -TaskName 'DevPresenceWatchdog'" -ForegroundColor Gray
