const fs = require("fs");
const path = require("path");
const http = require("http");

const AGENT_URL = process.env.DEV_PRESENCE_AGENT_URL || "http://127.0.0.1:7337";
const WATCH_PATH = process.env.DEV_PRESENCE_WATCH_PATH || process.cwd();
const SESSION_ID = `zed-${Date.now()}-${process.pid}`;
const IDLE_TIMEOUT_MS = Number(process.env.IDLE_TIMEOUT_MS || 300_000);
const STALE_AFTER_MS = Number(process.env.STALE_AFTER_MS || 600_000);
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS || 60_000);
const MAX_RETRIES = Number(process.env.MAX_RETRIES || 30);
const RETRY_DELAY_MS = Number(process.env.RETRY_DELAY_MS || 1000);

// Ignore common build/cache/vendor directories and temp files
const IGNORED = /(?:^|[\\/])(node_modules|\.git|\.zed|\.next|\.nuxt|\.turbo|\.cache|\.tmp|out|dist|build|target|coverage|\.vercel|\.netlify|vendor|\.idea|\.vscode)(?:[\\/]|$)|\.(tmp|temp|log|pid|lock)$/i;

// Extension to language mapping
const EXT_TO_LANG = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  scala: "scala",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  c: "c",
  h: "c",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  swift: "swift",
  m: "objective-c",
  mm: "objective-cpp",
  r: "r",
  pl: "perl",
  pm: "perl",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  ps1: "powershell",
  psd1: "powershell",
  psm1: "powershell",
  bat: "batch",
  cmd: "batch",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  styl: "stylus",
  vue: "vue",
  svelte: "svelte",
  astro: "astro",
  sql: "sql",
  md: "markdown",
  mdx: "mdx",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  xml: "xml",
  svg: "svg",
  graphql: "graphql",
  gql: "graphql",
  prisma: "prisma",
  dart: "dart",
  ex: "elixir",
  exs: "elixir",
  elm: "elm",
  hs: "haskell",
  lhs: "haskell",
  clj: "clojure",
  cljs: "clojure",
  edn: "clojure",
  lua: "lua",
  vim: "vim",
  dockerfile: "dockerfile",
  tf: "terraform",
  hcl: "hcl",
  sol: "solidity",
  move: "move",
  cairo: "cairo",
};

let lastActiveAt = Date.now();
let heartbeatTimer;
let isShuttingDown = false;
let isAgentReady = false;
let retryCount = 0;
let debounceTimer = null;
const DEBOUNCE_MS = 500;

// Track the most recently active project and file
let lastProject = null;
let lastFile = null;
let lastLanguage = null;

function getLanguageFromFilename(filename) {
  const ext = path.extname(filename).toLowerCase().replace(/^\./, "");
  if (!ext) return null;

  // Special case: Dockerfile (no extension)
  if (/^dockerfile/i.test(path.basename(filename))) return "dockerfile";

  return EXT_TO_LANG[ext] || ext;
}

function isLikelyFile(filename) {
  // Must have a basename with an extension (contains a dot that's not hidden)
  const base = path.basename(filename);
  if (!base || base.startsWith(".")) return false;

  // Must have a recognized extension or at least a dot
  const ext = path.extname(base).toLowerCase().replace(/^\./, "");
  if (!ext) return false;

  // Reject common directory-only names even if they happen to have dots
  const dirLike = /^(src|lib|app|components|pages|api|routes|utils|hooks|types|styles|assets|public|test|tests|__tests__|e2e|coverage|dist|build|out)$/i;
  if (dirLike.test(base)) return false;

  return true;
}

function parseFileEvent(filename) {
  if (!filename) return { project: null, file: null, language: null };

  // Normalize to forward slashes for consistent parsing
  const normalized = filename.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);

  if (segments.length === 0) {
    return { project: null, file: null, language: null };
  }

  // First segment is the project folder
  const project = segments[0];

  // Rest is the file path within the project
  const filePath = segments.slice(1).join("/");

  // Only treat as a file if it looks like one
  if (isLikelyFile(filePath)) {
    const baseName = path.basename(filePath);
    const language = getLanguageFromFilename(baseName);
    return { project, file: filePath, language };
  }

  // Directory event: return project only, keep previous file
  return { project, file: null, language: null };
}

function send(status, onSuccess, onError) {
  const now = Date.now();
  const payload = {
    sessionId: SESSION_ID,
    editor: "zed",
    status,
    lastSeen: now,
    lastActiveAt: status === "active" ? now : lastActiveAt,
    idleDeadlineAt: now + IDLE_TIMEOUT_MS,
    staleAfterMs: STALE_AFTER_MS,
    project: lastProject || path.basename(WATCH_PATH),
    file: lastFile,
    language: lastLanguage,
    startedAt: lastActiveAt,
    totalActiveMs: 0,
  };

  const body = JSON.stringify(payload);
  const url = new URL(`${AGENT_URL}/activity`);

  const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === "https:" ? 443 : 80),
    path: url.pathname,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
  };

  const req = http.request(options, (res) => {
    let responseBody = "";
    res.on("data", (chunk) => (responseBody += chunk));
    res.on("end", () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        if (onSuccess) onSuccess();
      } else {
        const err = new Error(`Agent responded ${res.statusCode}: ${responseBody}`);
        if (onError) onError(err);
        else console.error(err.message);
      }
    });
  });

  req.on("error", (err) => {
    if (onError) onError(err);
    else console.error("Agent unreachable:", err.message);
  });

  req.write(body);
  req.end();
}

function reportActive() {
  if (isShuttingDown) return;
  lastActiveAt = Date.now();
  send("active");
  clearTimeout(heartbeatTimer);
  heartbeatTimer = setTimeout(() => send("active"), HEARTBEAT_MS);
}

function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  clearTimeout(heartbeatTimer);
  send("offline");
  setTimeout(() => process.exit(0), 500);
}

function waitForAgent(callback) {
  if (isAgentReady) {
    callback();
    return;
  }

  if (retryCount >= MAX_RETRIES) {
    console.error(`Agent not available after ${MAX_RETRIES} retries. Exiting.`);
    process.exit(1);
  }

  retryCount++;
  const delay = Math.min(RETRY_DELAY_MS * retryCount, 10000);

  send(
    "active",
    () => {
      isAgentReady = true;
      console.log(`Agent connected after ${retryCount} attempt(s)`);
      callback();
    },
    (err) => {
      if (err.message.includes("ECONNREFUSED")) {
        console.log(`Agent not ready yet (attempt ${retryCount}/${MAX_RETRIES}), retrying in ${delay}ms...`);
      } else {
        console.error("Unexpected error:", err.message);
      }
      setTimeout(() => waitForAgent(callback), delay);
    }
  );
}

function startWatching() {
  try {
    const watcher = fs.watch(WATCH_PATH, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      if (IGNORED.test(filename)) return;

      const parsed = parseFileEvent(filename);
      if (parsed.project) {
        lastProject = parsed.project;
        // Only overwrite file/language when we have a clear file event
        if (parsed.file) {
          lastFile = parsed.file;
          lastLanguage = parsed.language;
        }
      }

      // Debounce: coalesce rapid events and send once
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        reportActive();
      }, DEBOUNCE_MS);
    });

    console.log(`Watching: ${WATCH_PATH}`);
    console.log(`Agent:    ${AGENT_URL}`);
    console.log(`Session:  ${SESSION_ID}`);

    reportActive();

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    // Also handle Windows Ctrl+C gracefully
    if (process.platform === "win32") {
      process.on("SIGINT", () => process.emit("SIGINT"));
    }
  } catch (err) {
    console.error("Failed to start watcher:", err.message);
    process.exit(1);
  }
}

function start() {
  console.log("Waiting for agent...");
  waitForAgent(startWatching);
}

start();
