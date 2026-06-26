import * as vscode from "vscode";
import * as http from "http";
import * as https from "https";
import * as path from "path";
import * as url from "url";
import { spawn } from "child_process";
import { ActivityKind, renderStatusText, isLoopbackAgentUrl } from "./presence";

// ─── Types ────────────────────────────────────────────────────────────────────

type EditorName = "vscode" | "cursor";
type PresenceStatus = "active" | "idle" | "offline";

interface ActivityPayload {
  status: PresenceStatus;
  isActive: boolean;
  editor: EditorName;
  project?: string;
  file?: string;
  language?: string;
  startedAt: number;
  lastSeen: number;
  idleDeadlineAt: number;
  staleAfterMs: number;
  sessionId: string;
  totalActiveMs: number;
  // Keep a legacy timestamp for backward compatibility with existing consumers.
  timestamp: number;
}

interface Config {
  agentUrl: string;
  apiUrl: string;
  apiKey: string;
  enabled: boolean;
  debounceMs: number;
  idleTimeoutMs: number;
  staleAfterMs: number;
}

// ─── Editor Detection ─────────────────────────────────────────────────────────
// Cursor ships a fork of VS Code — detect it by executable path or appName.

function detectEditor(): EditorName {
  const execPath = process.execPath.toLowerCase();
  const appName = vscode.env.appName.toLowerCase();
  if (execPath.includes("cursor") || appName.includes("cursor")) {
    return "cursor";
  }
  return "vscode";
}

// ─── Config ───────────────────────────────────────────────────────────────────

function getConfig(): Config {
  const cfg = vscode.workspace.getConfiguration("devPresence");
  const debounceMs = cfg.get<number>("debounceMs", 2000);
  const idleTimeoutMs = cfg.get<number>("idleTimeoutMs", 300_000);
  const staleAfterMs = Math.max(
    cfg.get<number>("staleAfterMs", 600_000),
    idleTimeoutMs + debounceMs,
  );

  return {
    agentUrl: cfg.get<string>("agentUrl", "http://127.0.0.1:7337"),
    apiUrl: cfg.get<string>("apiUrl", "").trim(),
    apiKey: cfg.get<string>("apiKey", "").trim(),
    enabled: cfg.get<boolean>("enabled", true),
    debounceMs,
    idleTimeoutMs,
    staleAfterMs,
  };
}

// ─── HTTP poster (zero external deps) ────────────────────────────────────────
// Uses Node's built-in http/https — no node_modules needed.

function postActivity(agentUrl: string, payload: ActivityPayload): void {
  try {
    const parsed = new url.URL("/activity", agentUrl);
    const body   = JSON.stringify(payload);

    const opts: http.RequestOptions = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path:     parsed.pathname,
      method:   "POST",
      headers: {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(opts, (res) => res.resume()); // drain & discard

    req.on("error", () => { /* agent may not be running — ignore silently */ });
    req.setTimeout(3000, () => req.destroy());
    req.write(body);
    req.end();
  } catch {
    // Malformed agentUrl or other setup error — do not crash the editor
  }
}

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

  // Forwarding config comes from VS Code settings so the bundled agent can
  // reach a remote API without a `.env` file (which is excluded from the VSIX).
  const env = { ...process.env };
  if (cfg.apiUrl) env.API_URL = cfg.apiUrl;
  if (cfg.apiKey) env.API_KEY = cfg.apiKey;

  try {
    const child = spawn(
      "node",
      [`--env-file-if-exists=${envPath}`, serverPath],
      { cwd: agentDir, detached: true, stdio: "ignore", windowsHide: true, env },
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

// ─── Session helpers ──────────────────────────────────────────────────────────

function getActiveFileInfo(): { project?: string; file?: string; language?: string } {
  const activeEditor = vscode.window.activeTextEditor;
  if (!activeEditor) return {};

  const doc = activeEditor.document;

  // Prefer workspace folder name; fall back to parent directory name
  const wsFolder = vscode.workspace.getWorkspaceFolder(doc.uri);
  const project  = wsFolder
    ? wsFolder.name
    : path.basename(path.dirname(doc.uri.fsPath));

  // Show path relative to workspace root, or just the filename
  const file = wsFolder
    ? path.relative(wsFolder.uri.fsPath, doc.uri.fsPath)
    : path.basename(doc.uri.fsPath);

  return { project, file, language: doc.languageId };
}

// ─── Extension state ──────────────────────────────────────────────────────────

let debounceTimer:  ReturnType<typeof setTimeout> | null = null;
let idleTimer:      ReturnType<typeof setTimeout> | null = null;
let manuallyPaused  = false;
let currentKind: ActivityKind = "offline";
let renderTick = 0;
let renderTimer: ReturnType<typeof setInterval> | null = null;

const EDITOR = detectEditor();
let sessionId = createSessionId();
let sessionStartedAt = Date.now();
let activeStartedAt: number | null = null;
let accumulatedActiveMs = 0;
let lastKnownInfo: { project?: string; file?: string; language?: string } = {};

function createSessionId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `dev-presence-${Date.now().toString(36)}-${random}`;
}

function finalizeActiveWindow(now: number): void {
  if (activeStartedAt === null) return;
  accumulatedActiveMs += Math.max(0, now - activeStartedAt);
  activeStartedAt = null;
}

function getTotalActiveMs(now: number): number {
  if (activeStartedAt === null) return accumulatedActiveMs;
  return accumulatedActiveMs + Math.max(0, now - activeStartedAt);
}

function buildPayload(
  cfg: Config,
  status: PresenceStatus,
  fileInfo?: { project?: string; file?: string; language?: string },
): ActivityPayload {
  const now = Date.now();

  if (fileInfo && (fileInfo.project || fileInfo.file || fileInfo.language)) {
    lastKnownInfo = { ...lastKnownInfo, ...fileInfo };
  }

  if (status === "active") {
    if (activeStartedAt === null) activeStartedAt = now;
  } else {
    finalizeActiveWindow(now);
  }

  return {
    status,
    isActive: status === "active",
    editor: EDITOR,
    project: lastKnownInfo.project,
    file: lastKnownInfo.file,
    language: lastKnownInfo.language,
    startedAt: sessionStartedAt,
    lastSeen: now,
    idleDeadlineAt: now + cfg.idleTimeoutMs,
    staleAfterMs: cfg.staleAfterMs,
    sessionId,
    totalActiveMs: getTotalActiveMs(now),
    timestamp: now,
  };
}

// ─── Core logic ───────────────────────────────────────────────────────────────

function reportActivity(statusBar: vscode.StatusBarItem, kind: ActivityKind = "writing"): void {
  const cfg = getConfig();
  if (!cfg.enabled || manuallyPaused) return;

  // Clear any pending debounce + idle timer
  if (debounceTimer) clearTimeout(debounceTimer);
  if (idleTimer)     clearTimeout(idleTimer);

  debounceTimer = setTimeout(() => {
    const { project, file, language } = getActiveFileInfo();

    const payload = buildPayload(cfg, "active", { project, file, language });

    postActivity(cfg.agentUrl, payload);
    setActivityKind(statusBar, kind);

    // Schedule idle after inactivity window
    idleTimer = setTimeout(() => {
      reportIdle(cfg.agentUrl, statusBar);
    }, cfg.idleTimeoutMs);

  }, cfg.debounceMs);
}

function reportIdle(agentUrl: string, statusBar: vscode.StatusBarItem): void {
  const payload = buildPayload(getConfig(), "idle");
  postActivity(agentUrl, payload);
  setActivityKind(statusBar, "idle");
}

function reportOffline(agentUrl: string, statusBar: vscode.StatusBarItem): void {
  const payload = buildPayload(getConfig(), "offline");
  postActivity(agentUrl, payload);
  setActivityKind(statusBar, "offline");
}

// ─── Status bar ───────────────────────────────────────────────────────────────

function renderStatusBar(item: vscode.StatusBarItem): void {
  item.text = renderStatusText(currentKind, renderTick, getTotalActiveMs(Date.now()));
  item.tooltip = "Dev Presence — click for status";
}

function setActivityKind(item: vscode.StatusBarItem, kind: ActivityKind): void {
  currentKind = kind;
  renderStatusBar(item);
}

// ─── Activate ────────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {

  // Status bar
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusBar.command = "devPresence.showStatus";
  setActivityKind(statusBar, "offline");
  statusBar.show();
  context.subscriptions.push(statusBar);

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

  // ── Event listeners ─────────────────────────────────────────────────────

  context.subscriptions.push(
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

    // Config changed at runtime
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("devPresence")) {
        const cfg = getConfig();
        setActivityKind(statusBar, cfg.enabled && !manuallyPaused ? currentKind : "paused");
      }
    }),
  );

  // ── Commands ─────────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand("devPresence.enable", () => {
      if (manuallyPaused) {
        // Start a fresh session on manual resume so session metadata is clear.
        sessionId = createSessionId();
        sessionStartedAt = Date.now();
        activeStartedAt = null;
        accumulatedActiveMs = 0;
      }
      manuallyPaused = false;
      vscode.window.showInformationMessage("Dev Presence enabled ✓");
      reportActivity(statusBar);
    }),

    vscode.commands.registerCommand("devPresence.disable", () => {
      manuallyPaused = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      if (idleTimer)     clearTimeout(idleTimer);
      const cfg = getConfig();
      reportOffline(cfg.agentUrl, statusBar);
      setActivityKind(statusBar, "paused");
      vscode.window.showInformationMessage("Dev Presence paused");
    }),

    vscode.commands.registerCommand("devPresence.showStatus", () => {
      const cfg   = getConfig();
      const state = manuallyPaused ? "paused" : (cfg.enabled ? "active" : "disabled");
      const { project, file, language } = getActiveFileInfo();

      vscode.window.showInformationMessage(
        [
          `Dev Presence — ${state}`,
          `Editor:   ${EDITOR}`,
          project  ? `Project:  ${project}`  : null,
          file     ? `File:     ${file}`     : null,
          language ? `Language: ${language}` : null,
          `Session:  ${sessionId}`,
          `Active:   ${Math.floor(getTotalActiveMs(Date.now()) / 1000)}s`,
          `Agent:    ${cfg.agentUrl}`,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }),
  );

  // Start the local agent silently if it isn't already running, then announce ourselves.
  void ensureAgentRunning(context, getConfig());

  // Fire once on startup so the agent knows we're alive
  reportActivity(statusBar);

  console.log(`[dev-presence] activated — editor detected as "${EDITOR}"`);
}

// ─── Deactivate ───────────────────────────────────────────────────────────────

export function deactivate(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  if (idleTimer)     clearTimeout(idleTimer);
  if (renderTimer) { clearInterval(renderTimer); renderTimer = null; }

  // Best-effort offline ping on shutdown
  const cfg = getConfig();
  const payload = buildPayload(cfg, "offline");
  postActivity(cfg.agentUrl, payload);

  console.log("[dev-presence] deactivated");
}
