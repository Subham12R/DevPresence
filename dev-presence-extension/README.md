# Dev Presence

Dev Presence is a VS Code extension that tracks whether you are actively coding, idle, or offline and sends that state to a small local agent. The agent keeps the latest session in SQLite and can optionally forward a clean status snapshot to your own API for a portfolio, personal dashboard, stream overlay, or any other status surface.

It is designed for personal use first:

- run everything locally if you only want a private activity feed
- forward snapshots to your own backend if you want a public "currently coding" widget
- pause reporting at any time from the Command Palette

## What the extension does

The extension watches normal editor activity such as:

- switching files or tabs
- typing in the active editor
- saving a file
- returning focus to the editor window

From that activity, it reports:

- `active` when you are coding
- `idle` after a period of inactivity
- `offline` when you disable the extension or close the editor

The payload includes metadata such as:

- editor name (`vscode` or `cursor`)
- project name
- active file path relative to the workspace
- language id
- session start time
- last seen time
- total active time

It does not read or send file contents.

## How it works

1. The extension runs inside VS Code.
2. It sends activity updates to a local agent, which defaults to `http://127.0.0.1:7337/activity`.
3. The local agent stores session data in SQLite.
4. The local agent optionally forwards a summarized snapshot to your own API.
5. Your website or dashboard can read that snapshot from your backend.

If you only want local usage, you can stop at step 3 and keep everything on your machine.

## Requirements

- VS Code `1.85.0` or newer
- Node.js `22+` to run the local agent
- `npm install` already run in this project

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Create your local agent config

Copy the example file:

```bash
cp agent/.env.example agent/.env
```

On Windows PowerShell:

```powershell
Copy-Item agent/.env.example agent/.env
```

For personal local-only use, keep this line empty in `agent/.env`:

```env
API_URL=
```

That disables forwarding to any remote API and keeps your status local.

### 3. Start the local agent

```bash
npm run agent
```

The agent starts on port `7337` by default and stores data in SQLite.

### 4. Install the extension

You can install the packaged extension file included in this repo:

- open VS Code
- open the Extensions view
- select `...`
- choose `Install from VSIX...`
- pick `dev-presence-1.0.1.vsix`

If you are developing the extension yourself, you can also open this project in VS Code and launch an Extension Development Host with `F5`.

### 5. Confirm the extension settings

Open Settings and verify these values:

- `devPresence.enabled`: `true`
- `devPresence.agentUrl`: `http://127.0.0.1:7337`

### 6. Verify it is working

Open a project, switch files, or type in the editor, then check:

```bash
curl http://127.0.0.1:7337/status
```

You should see a JSON response with fields such as `status`, `project`, `file`, `language`, and `totalActiveMs`.

## Personal Use Guide

### Option 1: Local-only setup

This is the simplest setup and the best place to start.

Use this when:

- you want a private activity tracker on your own computer
- you want to test the extension before connecting it to a website
- you want to build your own local dashboard later

How to use it:

1. Set `API_URL=` in `agent/.env`.
2. Run `npm run agent`.
3. Install and enable the extension.
4. Read the latest status from `http://127.0.0.1:7337/status`.

Important:

- this works only on your machine
- a public website cannot fetch `127.0.0.1` from a visitor's browser
- if you want your hosted portfolio site to show your status, use Option 2

### Option 2: Connect it to your own website or backend

Use this when you want your personal site to show live coding status.

How it works:

1. The extension reports to the local agent.
2. The local agent forwards a status snapshot to your API endpoint.
3. Your website reads from your API or database.

Set these values in `agent/.env`:

```env
API_URL=https://your-domain.com/activity
API_KEY=your-secret-token
PORT=7337
```

Your API should accept a JSON `POST` request with the forwarded snapshot. A typical payload contains:

```json
{
  "status": "active",
  "effectiveStatus": "active",
  "isActive": true,
  "stale": false,
  "lastSeen": 1710000000000,
  "lastActiveAt": 1710000000000,
  "editor": "vscode",
  "project": "my-site",
  "file": "src/app.ts",
  "language": "typescript",
  "startedAt": 1710000000000,
  "sessionId": "dev-presence-abc123",
  "totalActiveMs": 1800000,
  "totalActiveMsAllSessions": 1800000,
  "currentSessionActiveMs": 1200000,
  "sessionCount": 1,
  "activeSessionCount": 1,
  "idleSessionCount": 0,
  "offlineSessionCount": 0
}
```

### Option 3: Use it with a local dashboard, stream overlay, or script

Because the agent exposes `GET /status`, you can use the extension without building a remote backend at all.

Examples:

- a small Electron or web dashboard running on your machine
- an OBS overlay that polls the local endpoint
- a shell script that writes your current status somewhere else
- a menu bar or tray app

## Settings

The extension contributes these user settings:

| Setting | Default | What it does |
| --- | --- | --- |
| `devPresence.agentUrl` | `http://127.0.0.1:7337` | URL of the local Dev Presence agent |
| `devPresence.enabled` | `true` | Globally enables or disables reporting |
| `devPresence.debounceMs` | `2000` | Wait time before an activity event is reported |
| `devPresence.idleTimeoutMs` | `300000` | Inactivity threshold before the session becomes idle |
| `devPresence.staleAfterMs` | `600000` | Time after the last update before a session is considered offline |

Notes:

- `staleAfterMs` is automatically kept at or above `idleTimeoutMs + debounceMs`
- changing the agent port requires updating both `PORT` and `devPresence.agentUrl`

## Commands

Open the Command Palette and use:

- `Dev Presence: Enable`
- `Dev Presence: Disable`
- `Dev Presence: Show Status`

The status bar also shows the current state:

- `Presence: live`
- `Presence: idle`
- `Presence: offline`
- `Presence: paused`

## Local Agent

The local agent lives in [`agent/server.js`](./agent/server.js) and has two main jobs:

- store presence sessions in SQLite
- expose a stable status snapshot for local tools or your own API

### Agent environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `7337` | Local HTTP port for the agent |
| `API_URL` | `http://localhost:4000/activity` when unset | Remote endpoint for forwarded snapshots. Set it to an empty value to disable forwarding. |
| `API_KEY` | unset | Optional bearer token sent as `Authorization: Bearer ...` |
| `DEV_PRESENCE_DB_PATH` | OS-specific default path | Custom SQLite database location |
| `DEFAULT_IDLE_TIMEOUT_MS` | `300000` | Fallback idle timeout used by the agent |
| `DEFAULT_STALE_AFTER_MS` | `600000` | Fallback stale timeout used by the agent |
| `RECONCILE_INTERVAL_MS` | `15000` | Background interval that reconciles idle/offline status |

### SQLite database location

By default, the agent stores `presence.db` at:

- macOS: `~/Library/Application Support/dev-presence/presence.db`
- Windows: `~/.dev-presence/presence.db`
- Linux: `~/.local/share/dev-presence/presence.db`

## Local API

### `GET /status`

Returns the current aggregated status snapshot across all sessions.

Example:

```bash
curl http://127.0.0.1:7337/status
```

Typical response:

```json
{
  "status": "active",
  "effectiveStatus": "active",
  "isActive": true,
  "stale": false,
  "editor": "vscode",
  "project": "dev-presence-extension",
  "file": "src/extension.ts",
  "language": "typescript",
  "sessionCount": 1,
  "activeSessionCount": 1,
  "idleSessionCount": 0,
  "offlineSessionCount": 0
}
```

### `POST /activity`

This endpoint is primarily for the extension itself. It accepts activity updates from the editor and updates the stored session state.

Most users do not need to call this endpoint manually.

## Privacy and Data Sharing

Dev Presence is intentionally lightweight, but it does send metadata. Before you use it on a public site, make sure you are comfortable sharing:

- project names
- file names and relative paths
- language ids
- session timing information

Tips:

- keep `API_URL=` empty if you want local-only use
- use `Dev Presence: Disable` whenever you want to pause reporting
- avoid forwarding production secrets or internal project names to a public endpoint
- do not commit real API keys in `agent/.env`

## Troubleshooting

### The extension always shows offline

Check:

- `npm run agent` is still running
- `devPresence.agentUrl` matches the agent port
- `curl http://127.0.0.1:7337/status` returns JSON

### The agent starts, but my website never updates

Make sure:

- `API_URL` points to your real backend
- your backend accepts `POST` requests with JSON
- your backend returns a `2xx` response
- your public site reads from your backend, not from `127.0.0.1`

### I only want to use this privately

Set:

```env
API_URL=
```

Then keep your tools pointed at:

```text
http://127.0.0.1:7337/status
```

### My status becomes idle or offline while the editor is still open

That usually means the idle and stale timers are working as designed. You can increase:

- `devPresence.idleTimeoutMs`
- `devPresence.staleAfterMs`

## Packaging

To rebuild the extension:

```bash
npm run compile
```

To create a VSIX package:

```bash
npm run package
```

## Recommended First-Time Setup

If you want the easiest personal-use path, use this checklist:

1. Run `npm install`.
2. Copy `agent/.env.example` to `agent/.env`.
3. Leave `API_URL=` blank.
4. Run `npm run agent`.
5. Install `dev-presence-1.0.1.vsix`.
6. Start coding and verify with `curl http://127.0.0.1:7337/status`.

That gives you a fully local presence tracker with no public exposure.

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE).
