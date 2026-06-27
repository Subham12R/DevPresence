#Requires -Version 5.1
param(
    [string]$ProjectPath = ".",
    [switch]$NoZed
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$agentPath = Join-Path $repoRoot "dev-presence-extension"
$watcherPath = Join-Path $agentPath "zed-watcher.js"

function Start-BackgroundProcess {
    param(
        [string]$Name,
        [string]$FilePath,
        [string[]]$ArgumentList,
        [string]$WorkingDirectory
    )

    $existing = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
        $_.CommandLine -and ($_.CommandLine -like "*$Name*")
    }

    if ($existing) {
        Write-Host "[$Name] Already running (PID $($existing.ProcessId))" -ForegroundColor Yellow
        return
    }

    Write-Host "[$Name] Starting..." -ForegroundColor Cyan
    Start-Process -FilePath $FilePath `
        -ArgumentList $ArgumentList `
        -WorkingDirectory $WorkingDirectory `
        -WindowStyle Hidden

    Write-Host "[$Name] Started in background" -ForegroundColor Green
}

# Start agent
Start-BackgroundProcess `
    -Name "agent" `
    -FilePath "node" `
    -ArgumentList @("--env-file-if-exists=agent/.env", "agent/server.js") `
    -WorkingDirectory $agentPath

Start-Sleep -Milliseconds 500

# Start zed watcher
Start-BackgroundProcess `
    -Name "zed-watcher" `
    -FilePath "node" `
    -ArgumentList @($watcherPath) `
    -WorkingDirectory $agentPath

if (-not $NoZed) {
    $zedCmd = Get-Command zed -ErrorAction SilentlyContinue
    if (-not $zedCmd) {
        $zedCmd = Get-Command zeditor -ErrorAction SilentlyContinue
    }

    if ($zedCmd) {
        Write-Host "[Zed] Opening project..." -ForegroundColor Cyan
        & $zedCmd $ProjectPath
    } else {
        Write-Host "[Zed] 'zed' or 'zeditor' command not found. Please open Zed manually." -ForegroundColor Red
    }
}
