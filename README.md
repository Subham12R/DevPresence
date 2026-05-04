# Dev Presence

A developer presence tracking system that broadcasts live coding activity to your portfolio website, personal dashboard, or stream overlay.

## What it does

Dev Presence tracks whether you're actively coding, idle, or offline and displays that status on your personal website or any other surface. It supports multiple editors and platforms.

**Key features:**
- Real-time coding activity tracking (`active` / `idle` / `offline`)
- Multi-editor support (VS Code, Cursor, Zed, and generic file watchers)
- Local SQLite storage with optional remote API forwarding
- Automatic idle detection and session management
- Live portfolio widget with project name, file, and language

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Editor    │────▶│ Local Agent │────▶│   API/DB    │
│ (Extension  │     │  (SQLite)   │     │  (Remote)   │
│  or Watcher)│     │   :7337     │     │   :4000     │
└─────────────┘     └──────┬──────┘     └──────┬──────┘
                           │                     │
                           ▼                     ▼
                    ┌─────────────┐      ┌─────────────┐
                    │  Portfolio  │      │  Dashboard  │
                    │   Widget    │      │   / Overlay │
                    └─────────────┘      └─────────────┘
```

**Components:**

| Component | Description |
|-----------|-------------|
| `dev-presence-extension/` | VS Code/Cursor extension + local agent server |
| `dev-presence-api/` | Remote Node.js API for public status hosting |
| `zed-watcher.js` | Standalone file watcher for Zed and other editors |
| `watchdog.js` | Process monitor that starts/stops watcher when Zed opens/closes |
| `scripts/` | Cross-platform install, uninstall, and status scripts |

## Supported Editors

| Editor | Method | Auto-start |
|--------|--------|------------|
| VS Code | Extension | ✅ Built-in |
| Cursor | Extension | ✅ Built-in |
| Zed | File watcher + watchdog | ✅ OS-level auto-start |
| Any editor | Generic file watcher | ✅ OS-level auto-start |

## How Auto-Start Works

Instead of running everything all the time, we use a **watchdog** pattern:

1. **Agent** — Always runs in the background (stores SQLite, forwards to API)
2. **Watchdog** — Always runs in the background (polls for Zed process every 5s)
3. **Watcher** — Only runs **when Zed is open** (sends file-change events to agent)

This means:
- No wasted CPU when you're not coding
- No manual terminal windows to manage
- Watcher automatically starts when you open Zed and stops when you close it

## Quick Start

### Prerequisites

- **Node.js 22+** (required for the agent)
- **Git**

### 1. Clone and install

```bash
git clone https://github.com/Subham12R/DevPresence.git
cd DevPresence
npm install
```

### 2. Configure the local agent

```bash
# Copy example config
cp dev-presence-extension/agent/.env.example dev-presence-extension/agent/.env
```

**For local-only use** (no public website):
```env
API_URL=
PORT=7337
```

**For portfolio website** (forward to your API):
```env
API_URL=https://your-domain.com/activity
API_KEY=your-secret-token
PORT=7337
```

### 3. Set up OS-level auto-start (choose your OS)

#### Windows

**One-line install** (PowerShell as Admin):
```powershell
.\scripts\install-windows.ps1
```

**Check status anytime:**
```powershell
.\scripts\devpresence.ps1 status
```

**Uninstall:**
```powershell
.\scripts\install-windows.ps1 -Uninstall
```

#### macOS

**One-line install**:
```bash
chmod +x scripts/install-macos.sh
./scripts/install-macos.sh
```

**Check status anytime:**
```bash
chmod +x scripts/devpresence.sh
./scripts/devpresence.sh status
```

**Uninstall:**
```bash
./scripts/install-macos.sh --uninstall
```

#### Linux

**One-line install**:
```bash
chmod +x scripts/install-linux.sh
./scripts/install-linux.sh
```

**Check status anytime:**
```bash
chmod +x scripts/devpresence.sh
./scripts/devpresence.sh status
```

**Uninstall:**
```bash
./scripts/install-linux.sh --uninstall
```

### 4. Verify it's working

```bash
devpresence status
```

Expected output:
```
Dev Presence Status
========================================

✅ Agent    : Running (active | zed | my-project | src/app.ts | typescript)
✅ Watchdog : Running (PID 12345)
✅ Zed      : Running
✅ Watcher  : Running (PID 12346)
```

Or if Zed is closed:
```
✅ Agent    : Running (idle)
✅ Watchdog : Running (PID 12345)
❌ Zed      : Not running
❌ Watcher  : Stopped
```

---

## Manual Setup (Without Auto-Start)

If you prefer not to use OS-level services, you can run everything manually.

### Start the agent

```bash
cd dev-presence-extension
npm run agent
```

The agent runs on `http://127.0.0.1:7337` and stores data in SQLite.

### Editor Setup

#### VS Code / Cursor

1. Open the Extensions view (`Ctrl+Shift+X`)
2. Click `...` → `Install from VSIX...`
3. Select `dev-presence-extension/dev-presence-1.0.1.vsix`

**Settings** (`Ctrl+,`):

| Setting | Value | Description |
|---------|-------|-------------|
| `devPresence.enabled` | `true` | Enable activity tracking |
| `devPresence.agentUrl` | `http://127.0.0.1:7337` | Agent URL |
| `devPresence.idleTimeoutMs` | `300000` | Idle after 5 minutes |
| `devPresence.staleAfterMs` | `600000` | Offline after 10 minutes |

**Commands** (`Ctrl+Shift+P`):
- `Dev Presence: Enable` — Start tracking
- `Dev Presence: Disable` — Stop tracking
- `Dev Presence: Show Status` — View current status

#### Zed

Zed doesn't support activity-tracking extensions natively, so we use a file watcher.

**Start the watcher manually** (while the agent is running):
```bash
cd dev-presence-extension
node zed-watcher.js
```

The watcher:
- Monitors file changes in your project
- Sends `active` status on every change
- Heartbeats every 60 seconds
- Marks `offline` on exit

**Zed tasks** (optional):
A `.zed/tasks.json` is included. In Zed:
- Open Command Palette (`Ctrl+Shift+P`)
- Run `task: spawn`
- Select `dev-presence: start agent` or `dev-presence: start zed watcher`

#### Any Editor

```bash
# Watch current directory
node dev-presence-extension/zed-watcher.js

# Watch a parent directory (detects any project inside it)
DEV_PRESENCE_WATCH_PATH=/home/user/projects node dev-presence-extension/zed-watcher.js
```

---

## How Project Detection Works

When using the file watcher (for Zed or any editor), Dev Presence automatically detects which project you're working on:

```
Watch path: D:\Code
            │
            ├── DevPresence/          ← repo itself
            ├── portfolio-frontend/   ← your website
            ├── Noted/                ← another project
            └── HackMatrix/

You edit: D:\Code\Noted\src\app.tsx
Detected:  project = "Noted"
           file    = "src/app.tsx"
           language = "typescript"
```

**By default**, the auto-start scripts watch the **parent directory of the DevPresence repo**. This means if your repo is at `D:\Code\DevPresence`, it watches `D:\Code` and can detect activity in any sibling folder.

**To change this**, set `DEV_PRESENCE_WATCH_PATH` before running the watcher or in your install script.

> **Note:** File and language detection works best when the file change event clearly points to a file. Directory-level events (like creating a folder) will update the project name but won't report a specific file.

---

## OS-Level Auto-Start Deep Dive

### Windows (Scheduled Tasks)

The install script creates two user-level scheduled tasks that run at login:

| Task | Purpose | Trigger |
|------|---------|---------|
| `DevPresenceAgent` | Local agent server | At logon |
| `DevPresenceWatchdog` | Zed process monitor | At logon |

**Important:** After installing, the tasks won't run until you **log off and back on** (or reboot). To start immediately without rebooting:

```powershell
Start-ScheduledTask -TaskName "DevPresenceAgent"
Start-Sleep -Seconds 2
Start-ScheduledTask -TaskName "DevPresenceWatchdog"
```

**View tasks:**
```powershell
Get-ScheduledTask -TaskName "DevPresence*"
```

**Start/stop manually:**
```powershell
# Start
Start-ScheduledTask -TaskName "DevPresenceAgent"
Start-ScheduledTask -TaskName "DevPresenceWatchdog"

# Stop
Stop-ScheduledTask -TaskName "DevPresenceAgent"
Stop-ScheduledTask -TaskName "DevPresenceWatchdog"
```

**Logs:** Check Event Viewer → Windows Logs → Application for Node.js errors.

### macOS (LaunchAgents)

The install script creates two LaunchAgents:

| Agent | File | Purpose |
|-------|------|---------|
| Agent | `~/Library/LaunchAgents/com.devpresence.agent.plist` | Local agent |
| Watchdog | `~/Library/LaunchAgents/com.devpresence.watchdog.plist` | Zed monitor |

**View status:**
```bash
launchctl list | grep devpresence
```

**Start/stop manually:**
```bash
launchctl start com.devpresence.agent
launchctl stop com.devpresence.agent
launchctl start com.devpresence.watchdog
launchctl stop com.devpresence.watchdog
```

**Logs:**
```bash
tail -f /tmp/devpresence-agent.out
tail -f /tmp/devpresence-watchdog.out
tail -f /tmp/devpresence-agent.err
tail -f /tmp/devpresence-watchdog.err
```

### Linux (systemd user services)

The install script creates two systemd user services:

| Service | Purpose |
|---------|---------|
| `devpresence-agent` | Local agent |
| `devpresence-watchdog` | Zed monitor |

**View status:**
```bash
systemctl --user status devpresence-agent
systemctl --user status devpresence-watchdog
```

**Start/stop manually:**
```bash
systemctl --user start devpresence-agent
systemctl --user stop devpresence-agent
systemctl --user start devpresence-watchdog
systemctl --user stop devpresence-watchdog
```

**Logs:**
```bash
journalctl --user -u devpresence-agent -f
journalctl --user -u devpresence-watchdog -f
```

---

## Portfolio Integration

### Frontend Component

Your portfolio frontend should:

1. Poll `GET /status` every 15 seconds
2. Connect to Socket.IO for real-time updates
3. Display editor icon, project name, file, and duration

Example React component structure is in `portfolio-frontend/src/components/ui/DevPresence.tsx`.

### Supported Editor Icons

Place these files in `public/icons/`:

| File | Editor |
|------|--------|
| `vscode.jpeg` | VS Code |
| `cursor.webp` | Cursor |
| `zed.png` | Zed |

> **Note:** You need to download the Zed icon separately. The code references `/icons/zed.png` but the file must exist in your portfolio's `public/icons/` directory.

### API Forwarding

When `API_URL` is set, the agent forwards snapshots to your remote API:

```json
{
  "status": "active",
  "editor": "zed",
  "project": "portfolio",
  "file": "src/app.tsx",
  "language": "typescript",
  "totalActiveMs": 3600000,
  "sessionCount": 1,
  "activeSessionCount": 1
}
```

---

## Configuration Reference

### Agent Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `7337` | Agent HTTP port |
| `API_URL` | `http://localhost:4000/activity` | Remote API endpoint (empty to disable) |
| `API_KEY` | none | Bearer token for remote API |
| `DEV_PRESENCE_DB_PATH` | OS default | SQLite database location |
| `DEFAULT_IDLE_TIMEOUT_MS` | `300000` | Idle timeout (5 min) |
| `DEFAULT_STALE_AFTER_MS` | `600000` | Stale timeout (10 min) |
| `RECONCILE_INTERVAL_MS` | `15000` | Reconciliation interval |

### VS Code Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `devPresence.agentUrl` | `http://127.0.0.1:7337` | Agent URL |
| `devPresence.enabled` | `true` | Enable tracking |
| `devPresence.debounceMs` | `2000` | Event debounce |
| `devPresence.idleTimeoutMs` | `300000` | Idle threshold |
| `devPresence.staleAfterMs` | `600000` | Offline threshold |

### Watcher Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DEV_PRESENCE_AGENT_URL` | `http://127.0.0.1:7337` | Agent URL |
| `DEV_PRESENCE_WATCH_PATH` | `process.cwd()` | Directory to watch. Set to a parent directory containing all your projects. |
| `IDLE_TIMEOUT_MS` | `300000` | Idle timeout |
| `STALE_AFTER_MS` | `600000` | Stale timeout |
| `HEARTBEAT_MS` | `60000` | Heartbeat interval |
| `MAX_RETRIES` | `30` | Agent connection retries |
| `RETRY_DELAY_MS` | `1000` | Retry delay |

### Watchdog Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DEV_PRESENCE_AGENT_URL` | `http://127.0.0.1:7337` | Agent URL |
| `DEV_PRESENCE_WATCH_PATH` | Parent of repo root | Directory to watch. Defaults to the folder containing the DevPresence repo, so sibling projects are automatically detected. |
| `POLL_INTERVAL_MS` | `5000` | How often to check for Zed process |

---

## Troubleshooting

### Agent unreachable

**Error:** `Agent unreachable: connect ECONNREFUSED 127.0.0.1:7337`

**Solution:** The watcher started before the agent. It will retry automatically. Check:
```bash
devpresence status
```

If agent is stopped:
```bash
cd dev-presence-extension
npm run agent
```

### Extension shows offline

Check:
1. Agent is running: `curl http://127.0.0.1:7337/status`
2. Extension is enabled in VS Code settings
3. `devPresence.agentUrl` matches the agent port

### Zed icon not showing

The code references `/icons/zed.png` but the file doesn't exist. Download the Zed icon and place it in your portfolio's `public/icons/zed.png`.

### Status not updating on website

1. Check `API_URL` is set correctly in `agent/.env`
2. Verify your API accepts POST requests with JSON
3. Check API key if `API_KEY` is set
4. Ensure your website reads from the API, not `127.0.0.1`

### Multiple editors showing

The agent tracks multiple sessions. The portfolio widget shows the "featured" session (most recently active). To see all sessions:
```bash
curl http://127.0.0.1:7337/status
```

### Agent/watchdog not running after install

If `devpresence status` shows everything stopped even after installing:

**Cause:** Auto-start tasks/agents only trigger at logon. If you installed while already logged in, they won't start until you reboot.

**Fix:** Either reboot, or start manually:

```powershell
# Windows
Start-ScheduledTask -TaskName "DevPresenceAgent"
Start-ScheduledTask -TaskName "DevPresenceWatchdog"

# macOS
launchctl start com.devpresence.agent
launchctl start com.devpresence.watchdog

# Linux
systemctl --user start devpresence-agent
systemctl --user start devpresence-watchdog
```

### Wrong project name shown (Zed / file watcher)

If your portfolio shows the wrong project (e.g., "DevPresence" when you're working on "Noted"):

**Cause:** The watcher is watching the wrong directory. By default it watches the parent of the DevPresence repo.

**Fix:** Set `DEV_PRESENCE_WATCH_PATH` to the parent directory containing all your projects:

```bash
# Windows
$env:DEV_PRESENCE_WATCH_PATH="D:\Code"
node dev-presence-extension/zed-watcher.js

# macOS/Linux
DEV_PRESENCE_WATCH_PATH=/home/user/projects node dev-presence-extension/zed-watcher.js
```

Or update your auto-start install script to use the correct path.

### Windows: "Execution Policy" error

If PowerShell refuses to run scripts:
```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

---

## Project Structure

```
DevPresence/
├── dev-presence-extension/     # VS Code/Cursor extension + agent
│   ├── agent/
│   │   ├── server.js            # Local agent (SQLite + forwarding)
│   │   └── .env.example         # Agent config template
│   ├── src/                     # Extension source
│   ├── zed-watcher.js           # Standalone file watcher
│   ├── watchdog.js              # Zed process monitor
│   └── dev-presence-1.0.1.vsix # Packaged extension
├── dev-presence-api/            # Remote API (optional)
│   ├── server.js                # Express + Socket.IO API
│   └── .env.example             # API config template
├── scripts/                     # Cross-platform scripts
│   ├── install-windows.ps1      # Windows auto-start installer
│   ├── install-macos.sh         # macOS auto-start installer
│   ├── install-linux.sh         # Linux auto-start installer
│   ├── devpresence.ps1          # Windows status command
│   └── devpresence.sh           # macOS/Linux status command
├── zed-ext/                     # Zed extension scaffold (WIP)
│   ├── extension.toml
│   ├── Cargo.toml
│   └── src/lib.rs
├── .zed/
│   └── tasks.json               # Zed editor tasks
└── README.md                    # This file
```

---

## License

MIT
