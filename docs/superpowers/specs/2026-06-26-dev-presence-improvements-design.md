# Dev Presence — Improvements Design

Date: 2026-06-26
Scope: `dev-presence-extension`

## Goals

1. **Lively status bar** — replace the static `Presence: live/idle/offline` text with an
   activity-derived phrase plus a live "Active for …" counter, with animated trailing dots.
2. **Silent agent auto-start** — the extension launches the local agent itself, with no Node.js
   console window appearing on Windows. The user no longer runs `npm run agent` in a terminal.

Both changes live in `src/extension.ts` plus packaging files. The agent (`agent/server.js`),
the payload schema, the SQLite logic, and the `dev-presence-api` project are unchanged.

---

## Feature 1 — Lively status bar

### Display format

A single status bar item (the existing one) showing:

```
‹icon› ‹phrase›‹animated-dots› · Active for ‹time›
```

Examples:
- `$(radio-tower) Writing Code··· · Active for 3h 24m`
- `$(book) Reading Code·· · Active for 24m`
- `$(save) Saving· · Active for 45s`
- `$(clock) Idle · Active for 1h 02m`   (idle: no animated dots)
- `$(circle-slash) Offline`             (no time)
- `$(debug-pause) Paused`               (no time)

### Activity kinds → phrase + icon

The phrase is derived from which editor event fired (a new internal "activity kind"). The payload
sent to the agent is **unchanged** — still `active` / `idle` / `offline`. Activity kind only drives
the label.

| Activity kind | Trigger event | Icon | Phrase | Animated dots |
| --- | --- | --- | --- | --- |
| writing | `onDidChangeTextDocument` (typing in active doc) | `$(radio-tower)` | `Writing Code` | yes |
| reading | `onDidChangeActiveTextEditor` (switch/open file), window focus regained | `$(book)` | `Reading Code` | yes |
| saving  | `onDidSaveTextDocument` | `$(save)` | `Saving` | yes |
| idle    | idle timeout fires | `$(clock)` | `Idle` | no |
| offline | disable / deactivate | `$(circle-slash)` | `Offline` | no |
| paused  | `Dev Presence: Disable` command | `$(debug-pause)` | `Paused` | no |

`saving` is transient: after a save we show `Saving…` briefly, then the next activity event
returns the bar to `writing` / `reading`. Saving still reports `active` to the agent.

### Active time

Reuses the existing local accumulator `getTotalActiveMs(now)` — already tracked in
`src/extension.ts`, and it already pauses while idle. No agent polling is needed.

Formatting (`formatActiveTime(ms)`):
- `< 60s` → `45s`
- `< 60m` → `24m`
- otherwise → `3h 24m` (minutes zero-padded to two digits)

Shown only for `writing` / `reading` / `saving` / `idle`. Omitted for `offline` / `paused`.

### Render timer (animation + live time)

A single `setInterval` (~600 ms) drives a render tick that:
- advances the dot animation frame (`` → `·` → `··` → `···` → ``) for animated kinds, and
- recomputes the `Active for …` text so the counter stays live without editor events.

The timer is created in `activate()` and disposed in `deactivate()` (and pushed to
`context.subscriptions`). For non-animated kinds (`idle`/`offline`/`paused`) the dots are blank and
only the time refreshes. The current activity kind is held in a module-level variable so the render
tick knows what to draw.

### Interaction with existing logic

- `updateStatusBar(item, status)` is replaced by a `setActivityKind(kind)` that records the current
  kind; the render tick is the single place that writes `item.text`.
- `reportActivity` distinguishes the triggering event so it can set the kind. The three listeners
  (`onDidChangeTextDocument`, `onDidChangeActiveTextEditor`, `onDidSaveTextDocument`) pass their kind
  through. Window-focus regained maps to `reading`.
- The agent payload, debounce, and idle timers are unchanged.

---

## Feature 2 — Silent agent auto-start

### Behavior on `activate()`

1. **Health check** — `GET {agentUrl}/status` with a short timeout (~800 ms). If it responds, an
   agent is already running (manual start, or another editor window already spawned it) → **do not
   spawn**. This is what prevents duplicate agents instead of a setting.
2. **Spawn (if not reachable)** — launch:
   ```
   node --env-file-if-exists=<extPath>/agent/.env <extPath>/agent/server.js
   ```
   with options `{ cwd: <extPath>/agent, detached: true, stdio: "ignore", windowsHide: true }`,
   then `child.unref()`. `windowsHide: true` suppresses the console window on Windows;
   `detached` + `unref` let the agent keep running independently of the editor window.
3. **Spawn failure** (`error` event, typically `ENOENT` when Node is not on `PATH`) → show a
   one-time warning: "Dev Presence: Node.js 22+ is required to run the local agent. Install it or
   start the agent manually." The extension keeps working if the user starts the agent themselves.

The agent self-reports offline via the existing stale-timeout reconciliation when the editor stops
sending activity, so we do **not** kill the shared agent on `deactivate()` (other windows may use
it). The existing best-effort offline ping on `deactivate()` stays.

### `agentUrl` parsing

The spawn path is taken only when `agentUrl` points at loopback (`127.0.0.1` / `localhost`). If the
user pointed `agentUrl` at a remote host, the extension assumes that agent is managed elsewhere and
skips auto-start (it still health-checks but never spawns a local process for a remote URL).

---

## Packaging changes

The agent is **not** currently shipped in the VSIX (`.vscodeignore` ignores `agent/**`). To make
auto-start work against the installed extension:

- **`.vscodeignore`**: remove `agent/**`. Add explicit ignores for `agent/.env` (user secrets) so it
  is never packaged; `agent/server.js` and `agent/.env.example` ship.
- **`package.json` `package` script**: drop `--no-dependencies` so `express` and `cors` (and their
  transitive deps) are bundled into the VSIX `node_modules`. The agent `require()`s them and resolves
  them from the extension root at runtime. The extension code itself remains dependency-free.
- **Version**: bump `1.0.1` → `1.1.0`.

---

## Out of scope

- No changes to `agent/server.js`, the SQLite schema, or the payload format.
- No changes to `dev-presence-api`.
- No new user settings (duplicate-spawn handled by the health check).
- No changes to existing settings or commands.

## Success criteria

1. Status bar shows the activity-derived phrase with animated dots and a live `Active for …`
   counter that updates without requiring editor events, and freezes while idle.
2. Installing the packaged VSIX and opening an editor starts the agent automatically with **no
   console window** on Windows; `curl http://127.0.0.1:7337/status` returns JSON without the user
   running `npm run agent`.
3. Opening a second editor window does not spawn a second agent.
4. With Node.js absent from `PATH`, the extension shows a single clear warning and otherwise does not
   crash or spam.
