# Dev Presence Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Dev Presence status bar an activity-derived phrase with animated dots and a live "Active for …" counter, and make the extension start its local agent silently (no Node console window on Windows).

**Architecture:** Pure presentation/logic helpers move into a new `vscode`-free module (`src/presence.ts`) so they are unit-testable with Node's built-in test runner. `src/extension.ts` consumes those helpers to drive the status bar via a single render timer, and on activation health-checks then silently spawns the bundled agent if it is not already running. Packaging is updated so the agent and its deps ship in the VSIX.

**Tech Stack:** TypeScript, VS Code extension API, Node 22 (`node:test`, `child_process.spawn`, `node:sqlite` in the agent), `@vscode/vsce` for packaging.

## Global Constraints

- All paths below are relative to `dev-presence-extension/` unless noted otherwise.
- The agent payload schema, `agent/server.js`, the SQLite logic, and the `dev-presence-api` project MUST NOT change.
- No new user-facing settings. No new runtime dependencies for the extension code (the agent keeps using `express`/`cors`).
- `src/presence.ts` MUST NOT import `vscode` (so it runs under plain Node for tests).
- The spawned agent MUST show no console window on Windows (`windowsHide: true`).
- Target editor: VS Code `^1.85.0`. Node 22+ required to run the agent.
- Version bump: `1.0.1` → `1.1.0`.

---

### Task 1: Pure presence helpers + unit tests

**Files:**
- Create: `src/presence.ts`
- Create: `src/test/presence.test.ts`
- Modify: `package.json` (add `test` script)

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `type ActivityKind = "writing" | "reading" | "saving" | "idle" | "offline" | "paused"`
  - `const ACTIVITY: Record<ActivityKind, { icon: string; phrase: string; animated: boolean; showTime: boolean }>`
  - `const DOT_FRAMES: string[]`
  - `function dotFrame(tick: number): string`
  - `function formatActiveTime(ms: number): string`
  - `function renderStatusText(kind: ActivityKind, tick: number, activeMs: number): string`
  - `function isLoopbackAgentUrl(agentUrl: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `src/test/presence.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dotFrame,
  formatActiveTime,
  renderStatusText,
  isLoopbackAgentUrl,
} from "../presence";

test("formatActiveTime: seconds under a minute", () => {
  assert.equal(formatActiveTime(0), "0s");
  assert.equal(formatActiveTime(45_000), "45s");
  assert.equal(formatActiveTime(59_999), "59s");
});

test("formatActiveTime: whole minutes under an hour", () => {
  assert.equal(formatActiveTime(60_000), "1m");
  assert.equal(formatActiveTime(24 * 60_000), "24m");
  assert.equal(formatActiveTime(59 * 60_000), "59m");
});

test("formatActiveTime: hours and zero-padded minutes", () => {
  assert.equal(formatActiveTime((3 * 60 + 24) * 60_000), "3h 24m");
  assert.equal(formatActiveTime((1 * 60 + 2) * 60_000), "1h 02m");
  assert.equal(formatActiveTime(60 * 60_000), "1h 00m");
});

test("dotFrame: cycles through 4 frames and wraps", () => {
  assert.equal(dotFrame(0), "");
  assert.equal(dotFrame(1), "·");
  assert.equal(dotFrame(2), "··");
  assert.equal(dotFrame(3), "···");
  assert.equal(dotFrame(4), "");
});

test("renderStatusText: animated active kind shows icon, phrase, dots, time", () => {
  const text = renderStatusText("writing", 2, (3 * 60 + 24) * 60_000);
  assert.equal(text, "$(radio-tower) Writing Code·· · Active for 3h 24m");
});

test("renderStatusText: idle shows time but no animated dots", () => {
  const text = renderStatusText("idle", 3, (1 * 60 + 2) * 60_000);
  assert.equal(text, "$(clock) Idle · Active for 1h 02m");
});

test("renderStatusText: offline shows neither dots nor time", () => {
  assert.equal(renderStatusText("offline", 1, 99_000), "$(circle-slash) Offline");
});

test("isLoopbackAgentUrl: loopback hosts are true, remote and garbage are false", () => {
  assert.equal(isLoopbackAgentUrl("http://127.0.0.1:7337"), true);
  assert.equal(isLoopbackAgentUrl("http://localhost:7337"), true);
  assert.equal(isLoopbackAgentUrl("https://example.com/activity"), false);
  assert.equal(isLoopbackAgentUrl("not a url"), false);
});
```

- [ ] **Step 2: Add the `test` script to `package.json`**

In the `"scripts"` block of `package.json`, add a `test` entry (leave existing scripts intact):

```json
    "test": "tsc -p ./ && node --test out/test/",
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test`
Expected: TypeScript compile fails (or tests fail) because `src/presence.ts` does not exist yet — error like `Cannot find module '../presence'`.

- [ ] **Step 4: Write the minimal implementation**

Create `src/presence.ts`:

```ts
// Pure, vscode-free presentation/logic helpers for Dev Presence.
// Kept free of the `vscode` import so it runs under plain Node for unit tests.

export type ActivityKind =
  | "writing"
  | "reading"
  | "saving"
  | "idle"
  | "offline"
  | "paused";

interface ActivityMeta {
  icon: string;
  phrase: string;
  animated: boolean; // trailing dots animate
  showTime: boolean; // append "· Active for …"
}

export const ACTIVITY: Record<ActivityKind, ActivityMeta> = {
  writing: { icon: "$(radio-tower)",  phrase: "Writing Code", animated: true,  showTime: true },
  reading: { icon: "$(book)",         phrase: "Reading Code", animated: true,  showTime: true },
  saving:  { icon: "$(save)",         phrase: "Saving",       animated: true,  showTime: true },
  idle:    { icon: "$(clock)",        phrase: "Idle",         animated: false, showTime: true },
  offline: { icon: "$(circle-slash)", phrase: "Offline",      animated: false, showTime: false },
  paused:  { icon: "$(debug-pause)",  phrase: "Paused",       animated: false, showTime: false },
};

// Dot animation frames cycle: "" -> "·" -> "··" -> "···" -> ""
export const DOT_FRAMES = ["", "·", "··", "···"];

export function dotFrame(tick: number): string {
  const frames = DOT_FRAMES.length;
  const index = ((tick % frames) + frames) % frames;
  return DOT_FRAMES[index];
}

export function formatActiveTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

export function renderStatusText(kind: ActivityKind, tick: number, activeMs: number): string {
  const meta = ACTIVITY[kind];
  const dots = meta.animated ? dotFrame(tick) : "";
  let text = `${meta.icon} ${meta.phrase}${dots}`;
  if (meta.showTime) {
    text += ` · Active for ${formatActiveTime(activeMs)}`;
  }
  return text;
}

export function isLoopbackAgentUrl(agentUrl: string): boolean {
  try {
    const { hostname } = new URL(agentUrl);
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: TypeScript compiles and all `node:test` cases PASS (8 tests, 0 failures).

- [ ] **Step 6: Commit**

```bash
git add dev-presence-extension/src/presence.ts dev-presence-extension/src/test/presence.test.ts dev-presence-extension/package.json
git commit -m "feat(extension): add pure presence helpers with unit tests"
```

---

### Task 2: Drive the status bar from activity kinds + render timer

**Files:**
- Modify: `src/extension.ts`

**Interfaces:**
- Consumes from Task 1: `ActivityKind`, `renderStatusText` (and transitively `ACTIVITY`).
- Produces: status bar wiring only — no exports relied on by other tasks.

This task replaces the static `updateStatusBar` with a kind-driven renderer plus a ~600ms render
timer that animates dots and refreshes the live "Active for …" time. The agent payload and the
debounce/idle timers are unchanged.

- [ ] **Step 1: Add the import**

At the top of `src/extension.ts`, after the existing `import * as url from "url";` line, add:

```ts
import { spawn } from "child_process";
import { ActivityKind, renderStatusText, isLoopbackAgentUrl } from "./presence";
```

(`spawn`/`isLoopbackAgentUrl` are used in Task 3; importing them now keeps the import block in one edit.)

- [ ] **Step 2: Add render state next to the other module-level state**

In the "Extension state" block, immediately after the line `let manuallyPaused  = false;`, add:

```ts
let currentKind: ActivityKind = "offline";
let renderTick = 0;
let renderTimer: ReturnType<typeof setInterval> | null = null;
```

- [ ] **Step 3: Replace `updateStatusBar` with the kind-driven renderer**

Replace the entire existing function (the `function updateStatusBar(item, status) { … }` block under the `// ─── Status bar ───` header) with:

```ts
function renderStatusBar(item: vscode.StatusBarItem): void {
  item.text = renderStatusText(currentKind, renderTick, getTotalActiveMs(Date.now()));
  item.tooltip = "Dev Presence — click for status";
}

function setActivityKind(item: vscode.StatusBarItem, kind: ActivityKind): void {
  currentKind = kind;
  renderStatusBar(item);
}
```

- [ ] **Step 4: Update `reportActivity` to carry an activity kind**

Replace the `reportActivity` function signature and the single `updateStatusBar` call inside it.
Change the signature line:

```ts
function reportActivity(statusBar: vscode.StatusBarItem): void {
```

to:

```ts
function reportActivity(statusBar: vscode.StatusBarItem, kind: ActivityKind = "writing"): void {
```

and inside the debounce callback, change the line `updateStatusBar(statusBar, "active");` to:

```ts
    setActivityKind(statusBar, kind);
```

- [ ] **Step 5: Update `reportIdle` and `reportOffline`**

In `reportIdle`, change `updateStatusBar(statusBar, "idle");` to:

```ts
  setActivityKind(statusBar, "idle");
```

In `reportOffline`, change `updateStatusBar(statusBar, "offline");` to:

```ts
  setActivityKind(statusBar, "offline");
```

- [ ] **Step 6: Update the event listeners to pass kinds**

In `activate()`, in the event-listener `context.subscriptions.push( … )` block, update the four callbacks:

```ts
    // Switching tabs / opening files
    vscode.window.onDidChangeActiveTextEditor(() => {
      reportActivity(statusBar, "reading");
    }),

    // Typing in a document
    vscode.workspace.onDidChangeTextDocument((e) => {
      const active = vscode.window.activeTextEditor;
      if (active && e.document === active.document) {
        reportActivity(statusBar, "writing");
      }
    }),

    // Saving a file
    vscode.workspace.onDidSaveTextDocument(() => {
      reportActivity(statusBar, "saving");
    }),

    // VS Code window focus regained
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) reportActivity(statusBar, "reading");
    }),
```

In the same block, update the config-change handler body to:

```ts
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("devPresence")) {
        const cfg = getConfig();
        setActivityKind(statusBar, cfg.enabled && !manuallyPaused ? currentKind : "paused");
      }
    }),
```

- [ ] **Step 7: Update the initial status bar setup and the disable command**

In `activate()`, replace the initial `updateStatusBar(statusBar, "offline");` (just before `statusBar.show();`) with:

```ts
  setActivityKind(statusBar, "offline");
```

In the `devPresence.disable` command callback, replace `updateStatusBar(statusBar, "paused");` with:

```ts
      setActivityKind(statusBar, "paused");
```

- [ ] **Step 8: Start the render timer in `activate()`**

In `activate()`, immediately after `context.subscriptions.push(statusBar);`, add:

```ts
  // Live render loop: animates the trailing dots and refreshes the "Active for …" counter.
  renderTimer = setInterval(() => {
    renderTick++;
    renderStatusBar(statusBar);
  }, 600);
  context.subscriptions.push({
    dispose: () => {
      if (renderTimer) clearInterval(renderTimer);
      renderTimer = null;
    },
  });
```

- [ ] **Step 9: Stop the render timer in `deactivate()`**

In `deactivate()`, after the existing `if (idleTimer) clearTimeout(idleTimer);` line, add:

```ts
  if (renderTimer) { clearInterval(renderTimer); renderTimer = null; }
```

- [ ] **Step 10: Compile to verify there are no type/reference errors**

Run: `npm run compile`
Expected: `tsc` exits 0 with no errors. (No `updateStatusBar` references remain; `spawn`/`isLoopbackAgentUrl` are imported but unused until Task 3 — `tsc` with the current `tsconfig.json` does not error on unused imports.)

- [ ] **Step 11: Manual verification in the Extension Development Host**

Press `F5` in VS Code to launch the Extension Development Host. In the launched window, open a file and:
- type → status bar shows `$(radio-tower) Writing Code` with dots cycling `· ·· ···` and `· Active for …` time advancing.
- switch files → shows `Reading Code…`.
- save → briefly shows `Saving…`.
- stop interacting past the idle timeout → shows `Idle` (no animated dots), time frozen.
Confirm the time text increments roughly once per minute while active.

- [ ] **Step 12: Commit**

```bash
git add dev-presence-extension/src/extension.ts
git commit -m "feat(extension): activity-derived status bar with animated dots and live active time"
```

---

### Task 3: Silent agent auto-start

**Files:**
- Modify: `src/extension.ts`

**Interfaces:**
- Consumes from Task 1: `isLoopbackAgentUrl` (imported in Task 2); from Task 2: nothing new.
- Consumes Node built-ins already imported: `http`, `https`, `url`, `path`, `child_process.spawn`.
- Produces: `ensureAgentRunning(context, cfg)` — internal, called once from `activate()`.

The extension health-checks the configured agent; if nothing is listening (and the URL is loopback)
it spawns the bundled `agent/server.js` with no console window and detaches.

- [ ] **Step 1: Add the reachability check and spawn helper**

In `src/extension.ts`, immediately after the `postActivity` function (before the `// ─── Session helpers ───` header), add:

```ts
// ─── Agent auto-start ──────────────────────────────────────────────────────────

let agentWarningShown = false;

function agentIsReachable(agentUrl: string, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const parsed = new url.URL("/status", agentUrl);
      const opts: http.RequestOptions = {
        hostname: parsed.hostname,
        port:     parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path:     parsed.pathname,
        method:   "GET",
      };
      const lib = parsed.protocol === "https:" ? https : http;
      const req = lib.request(opts, (res) => {
        res.resume();
        const code = res.statusCode || 0;
        resolve(code >= 200 && code < 500); // something is listening
      });
      req.on("error", () => resolve(false));
      req.setTimeout(timeoutMs, () => { req.destroy(); resolve(false); });
      req.end();
    } catch {
      resolve(false);
    }
  });
}

async function ensureAgentRunning(
  context: vscode.ExtensionContext,
  cfg: Config,
): Promise<void> {
  // Only manage a loopback agent. A remote agentUrl is assumed to be hosted elsewhere.
  if (!isLoopbackAgentUrl(cfg.agentUrl)) return;
  if (await agentIsReachable(cfg.agentUrl)) return; // already running (manual start / another window)

  const agentDir   = path.join(context.extensionPath, "agent");
  const serverPath = path.join(agentDir, "server.js");
  const envPath    = path.join(agentDir, ".env");

  try {
    const child = spawn(
      "node",
      [`--env-file-if-exists=${envPath}`, serverPath],
      { cwd: agentDir, detached: true, stdio: "ignore", windowsHide: true },
    );
    child.on("error", () => {
      if (agentWarningShown) return;
      agentWarningShown = true;
      vscode.window.showWarningMessage(
        "Dev Presence: could not start the local agent. Install Node.js 22+ and ensure it is on " +
        "your PATH, or start the agent manually with `npm run agent`.",
      );
    });
    child.unref(); // let the agent outlive this editor window
  } catch {
    // Spawn setup failed — extension still works if the user starts the agent manually.
  }
}
```

- [ ] **Step 2: Call `ensureAgentRunning` on activation**

In `activate()`, replace the startup comment+call:

```ts
  // Fire once on startup so the agent knows we're alive
  reportActivity(statusBar);
```

with:

```ts
  // Start the local agent silently if it isn't already running, then announce ourselves.
  void ensureAgentRunning(context, getConfig());

  // Fire once on startup so the agent knows we're alive
  reportActivity(statusBar);
```

- [ ] **Step 3: Compile to verify**

Run: `npm run compile`
Expected: `tsc` exits 0 with no errors. All of `spawn`, `isLoopbackAgentUrl`, `http`, `https`, `url`, `path` are now used.

- [ ] **Step 4: Manual verification — silent start**

First ensure no agent is running (close any `npm run agent` terminal; confirm `curl http://127.0.0.1:7337/status` fails). Press `F5` to launch the Extension Development Host. Then:
- Run `curl http://127.0.0.1:7337/status` → expect JSON (agent auto-started).
- Confirm **no** Node.js console window appeared on the Windows taskbar.
- Check Task Manager → a `node.exe` process is running.

- [ ] **Step 5: Manual verification — no duplicate agent**

With the agent already running from Step 4, open a second VS Code window with this project and press `F5` again (or open another folder in the Extension Development Host). Confirm Task Manager still shows a single `dev-presence` `node.exe` agent (the health check prevented a second spawn).

- [ ] **Step 6: Commit**

```bash
git add dev-presence-extension/src/extension.ts
git commit -m "feat(extension): silently auto-start the local agent with no console window"
```

---

### Task 4: Ship the agent in the VSIX

**Files:**
- Modify: `.vscodeignore`
- Modify: `package.json` (version, `package` script)

**Interfaces:**
- Consumes: the agent spawned by Task 3 must exist at `<extensionPath>/agent/server.js` with `express`/`cors` resolvable from `<extensionPath>/node_modules`.
- Produces: a `dev-presence-1.1.0.vsix` that contains the agent and its deps.

- [ ] **Step 1: Update `.vscodeignore`**

Replace the entire contents of `.vscodeignore` with:

```
agent/.env
out/test/**
dist/**
src/**
package-lock.json
tsconfig.json
*.vsix
**/*.map
```

(Removes the blanket `agent/**` ignore so `agent/server.js` and `agent/.env.example` ship; keeps the
user's secret `agent/.env` and the compiled tests out of the package.)

- [ ] **Step 2: Bump the version and fix the `package` script in `package.json`**

Change the version field:

```json
  "version": "1.1.0",
```

Change the `package` script (remove `--no-dependencies` so `express`/`cors` are bundled):

```json
    "package": "vsce package --allow-missing-repository --skip-license",
```

- [ ] **Step 3: Build the package**

Run: `npm run package`
Expected: `vsce` produces `dev-presence-1.1.0.vsix` with no fatal errors. (A warning about activation/`repository` is acceptable.)

- [ ] **Step 4: Verify the VSIX contents**

Run:

```bash
cd dev-presence-extension && unzip -l dev-presence-1.1.0.vsix | grep -E "agent/|node_modules/express/package.json|node_modules/cors/package.json|out/extension.js"
```

Expected output includes:
- `extension/agent/server.js`
- `extension/agent/.env.example`
- `extension/node_modules/express/package.json`
- `extension/node_modules/cors/package.json`
- `extension/out/extension.js`

And confirm the secret env file is absent:

```bash
unzip -l dev-presence-1.1.0.vsix | grep "agent/.env$" || echo "OK: agent/.env not packaged"
```

Expected: `OK: agent/.env not packaged`.

- [ ] **Step 5: End-to-end install test**

In VS Code: Extensions view → `...` → `Install from VSIX…` → pick `dev-presence-1.1.0.vsix`. Reload.
With no `npm run agent` running, open a project and run `curl http://127.0.0.1:7337/status` → expect JSON, and confirm no console window appeared. Confirm the status bar shows the animated phrase + `Active for …`.

- [ ] **Step 6: Commit**

```bash
git add dev-presence-extension/.vscodeignore dev-presence-extension/package.json
git commit -m "build(extension): bundle agent in VSIX and bump to 1.1.0"
```

---

## Self-Review

**Spec coverage:**
- Activity-derived phrase (Writing/Reading/Saving/Idle/Offline/Paused) → Task 1 (`ACTIVITY`), Task 2 (listener wiring).
- Animated dots → Task 1 (`dotFrame`/`renderStatusText`), Task 2 (render timer).
- "Active for …" live counter that freezes when idle → Task 1 (`formatActiveTime`), Task 2 (render timer + reuse of `getTotalActiveMs`).
- Silent auto-start with health check + `windowsHide` + no duplicate → Task 3.
- Loopback-only spawn / remote skip → Task 1 (`isLoopbackAgentUrl`), Task 3.
- Node-missing one-time warning → Task 3.
- Packaging: ship agent, keep `.env` out, bundle express/cors, version bump → Task 4.
- Unchanged payload/agent/api → respected (no edits to `agent/server.js` or `dev-presence-api`).

**Placeholder scan:** none — every code step shows complete code; verification steps give exact commands and expected output.

**Type consistency:** `ActivityKind`, `renderStatusText`, `isLoopbackAgentUrl`, `setActivityKind`, `renderStatusBar`, `ensureAgentRunning`, `agentIsReachable` are named identically across tasks. `reportActivity(statusBar, kind)` signature matches all call sites updated in Task 2.
