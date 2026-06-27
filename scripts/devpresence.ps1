#Requires -Version 5.1
param(
    [switch]$Help
)

if ($Help) {
    @"
Usage: devpresence [status] [--help]

Commands:
  status    Show health of agent, watchdog, zed, and watcher
  --help    Show this help message
"@ | Write-Host
    exit 0
}

$PID_DIR = $env:TEMP
$WATCHER_PID_FILE = Join-Path $PID_DIR "devpresence-watcher.pid"
$WATCHDOG_PID_FILE = Join-Path $PID_DIR "devpresence-watchdog.pid"
$AGENT_URL = if ($env:DEV_PRESENCE_AGENT_URL) { $env:DEV_PRESENCE_AGENT_URL } else { "http://127.0.0.1:7337" }

function Test-AgentHealth {
    try {
        $response = Invoke-WebRequest -Uri "$AGENT_URL/status" -Method GET -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
        $data = $response.Content | ConvertFrom-Json
        return @{ Healthy = $true; Data = $data }
    } catch {
        return @{ Healthy = $false; Error = $_.Exception.Message }
    }
}

function Get-ProcessStatus {
    param(
        [string]$Name,
        [int]$ProcessId,
        [scriptblock]$FallbackCheck
    )
    $running = $false
    $foundPid = $null

    if ($ProcessId -gt 0) {
        $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
        if ($proc) {
            $running = $true
            $foundPid = $ProcessId
        }
    }

    if (-not $running -and $FallbackCheck) {
        $fallbackResult = & $FallbackCheck
        if ($fallbackResult) {
            $running = $true
            $foundPid = $fallbackResult
        }
    }

    return @{ Running = $running; Pid = $foundPid }
}

function Test-IsZedRunning {
    try {
        $out = & tasklist /FI "IMAGENAME eq zed.exe" /NH 2>$null
        if ($out -match "zed\.exe") { return $true }
        $out = & tasklist /FI "IMAGENAME eq zeditor.exe" /NH 2>$null
        if ($out -match "zeditor\.exe") { return $true }
    } catch {}
    return $false
}

# Check agent
$agentHealth = Test-AgentHealth
$agentStatus = if ($agentHealth.Healthy) { "Running" } else { "Stopped" }
$agentEmoji = if ($agentHealth.Healthy) { "✅" } else { "❌" }

# Check watchdog
$watchdogPid = $null
try {
    $watchdogPid = [int](Get-Content $WATCHDOG_PID_FILE -ErrorAction SilentlyContinue).Trim()
} catch {}
$watchdogResult = Get-ProcessStatus -Name "watchdog" -ProcessId $watchdogPid -FallbackCheck {
    $proc = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
        $_.CommandLine -like "*watchdog.js*"
    } | Select-Object -First 1
    if ($proc) { return $proc.ProcessId }
    return $null
}

# Check zed
$zedRunning = Test-IsZedRunning
$zedEmoji = if ($zedRunning) { "✅" } else { "❌" }

# Check watcher
$watcherPid = $null
try {
    $watcherPid = [int](Get-Content $WATCHER_PID_FILE -ErrorAction SilentlyContinue).Trim()
} catch {}
$watcherResult = Get-ProcessStatus -Name "watcher" -ProcessId $watcherPid -FallbackCheck {
    $proc = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
        $_.CommandLine -like "*zed-watcher.js*"
    } | Select-Object -First 1
    if ($proc) { return $proc.ProcessId }
    return $null
}

# Output
Write-Host ""
Write-Host "Dev Presence Status" -ForegroundColor Cyan
Write-Host ("=" * 40)
Write-Host ""
Write-Host "$agentEmoji Agent    : $agentStatus" -NoNewline
if ($agentHealth.Healthy) {
    $data = $agentHealth.Data
    $status = $data.status
    $editor = $data.editor
    $project = $data.project
    $file = $data.file
    $lang = $data.language
    Write-Host " ($status" -NoNewline
    if ($editor) { Write-Host " | $editor" -NoNewline }
    if ($project) { Write-Host " | $project" -NoNewline }
    if ($file) { Write-Host " | $file" -NoNewline }
    if ($lang) { Write-Host " | $lang" -NoNewline }
    Write-Host ")"
} else {
    Write-Host ""
}

$wdEmoji = if ($watchdogResult.Running) { "✅" } else { "❌" }
Write-Host "$wdEmoji Watchdog : $(if ($watchdogResult.Running) { "Running" } else { "Stopped" })$(if ($watchdogResult.Pid) { " (PID $($watchdogResult.Pid))" })"

Write-Host "$zedEmoji Zed      : $(if ($zedRunning) { "Running" } else { "Not running" })"

$wEmoji = if ($watcherResult.Running) { "✅" } else { "❌" }
Write-Host "$wEmoji Watcher  : $(if ($watcherResult.Running) { "Running" } else { "Stopped" })$(if ($watcherResult.Pid) { " (PID $($watcherResult.Pid))" })"

Write-Host ""

if (-not $agentHealth.Healthy) {
    Write-Host "Tip: Start the agent with 'npm run agent' in dev-presence-extension/" -ForegroundColor Yellow
}
if ($watchdogResult.Running -and -not $zedRunning) {
    Write-Host "Tip: Watcher is stopped because Zed is not running. Open Zed to start tracking." -ForegroundColor DarkGray
}
if (-not $watchdogResult.Running) {
    Write-Host "Tip: Run the install script to set up auto-start." -ForegroundColor Yellow
}
