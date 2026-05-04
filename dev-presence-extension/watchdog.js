const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, execSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const EXTENSION_PATH = path.join(REPO_ROOT, "dev-presence-extension");
const WATCHER_PATH = path.join(EXTENSION_PATH, "zed-watcher.js");
const PID_DIR = os.tmpdir();
const WATCHDOG_PID_FILE = path.join(PID_DIR, "devpresence-watchdog.pid");
const WATCHER_PID_FILE = path.join(PID_DIR, "devpresence-watcher.pid");
const AGENT_URL = process.env.DEV_PRESENCE_AGENT_URL || "http://127.0.0.1:7337";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 5000);
const WATCH_PATH = process.env.DEV_PRESENCE_WATCH_PATH || path.dirname(REPO_ROOT);

let isShuttingDown = false;
let pollTimer = null;
let watcherProcess = null;

function log(label, message) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log(`[${ts}] [${label}] ${message}`);
}

function writePidFile(file, pid) {
  try {
    fs.writeFileSync(file, String(pid), { encoding: "utf8" });
  } catch (err) {
    log("pidfile", `Failed to write ${file}: ${err.message}`);
  }
}

function readPidFile(file) {
  try {
    const pid = Number(fs.readFileSync(file, "utf8").trim());
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function removePidFile(file) {
  try {
    fs.unlinkSync(file);
  } catch {}
}

function isProcessRunning(pid) {
  try {
    if (process.platform === "win32") {
      execSync(`tasklist /FI "PID eq ${pid}" /NH`, { stdio: "pipe" });
      return true;
    } else {
      process.kill(pid, 0);
      return true;
    }
  } catch {
    return false;
  }
}

function isZedRunning() {
  try {
    if (process.platform === "win32") {
      try {
        const out = execSync('tasklist /FI "IMAGENAME eq zed.exe" /NH', {
          encoding: "utf8",
          stdio: "pipe",
        });
        if (/zed\.exe/i.test(out)) return true;
      } catch {}
      try {
        const out = execSync('tasklist /FI "IMAGENAME eq zeditor.exe" /NH', {
          encoding: "utf8",
          stdio: "pipe",
        });
        if (/zeditor\.exe/i.test(out)) return true;
      } catch {}
      return false;
    } else {
      try {
        execSync("pgrep -x zed", { stdio: "pipe" });
        return true;
      } catch {}
      try {
        execSync("pgrep -x zeditor", { stdio: "pipe" });
        return true;
      } catch {}
      return false;
    }
  } catch {
    return false;
  }
}

function isAgentRunning() {
  return new Promise((resolve) => {
    const url = new URL(`${AGENT_URL}/status`);
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: "GET",
      timeout: 3000,
    };
    const req = require("http").request(options, (res) => {
      resolve(res.statusCode >= 200 && res.statusCode < 300);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

function startAgent() {
  const existing = getAgentPid();
  if (existing && isProcessRunning(existing)) {
    log("watchdog", "Agent already running");
    return;
  }

  log("watchdog", "Starting agent...");
  const child = spawn("node", ["--env-file-if-exists=agent/.env", "agent/server.js"], {
    cwd: EXTENSION_PATH,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  log("watchdog", `Agent started (PID ${child.pid})`);
}

function getAgentPid() {
  try {
    if (process.platform === "win32") {
      const out = execSync('wmic process where "CommandLine like \'%agent/server.js%\'" get ProcessId /value', {
        encoding: "utf8",
        stdio: "pipe",
      });
      const match = out.match(/ProcessId=(\d+)/);
      return match ? Number(match[1]) : null;
    }
    const out = execSync("pgrep -f 'agent/server.js'", { encoding: "utf8", stdio: "pipe" });
    return Number(out.trim().split("\n")[0]);
  } catch {
    return null;
  }
}

function sendOfflineToAgent() {
  return new Promise((resolve) => {
    const now = Date.now();
    const payload = {
      sessionId: "watchdog-offline",
      editor: "zed",
      status: "offline",
      lastSeen: now,
      lastActiveAt: now,
      idleDeadlineAt: now,
      staleAfterMs: 600000,
      project: null,
      file: null,
      language: null,
      startedAt: now,
      totalActiveMs: 0,
    };

    const body = JSON.stringify(payload);
    const url = new URL(`${AGENT_URL}/activity`);
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: 5000,
    };

    const req = require("http").request(options, (res) => {
      log("watchdog", `Offline sent (HTTP ${res.statusCode})`);
      resolve();
    });
    req.on("error", (err) => {
      log("watchdog", `Offline send failed: ${err.message}`);
      resolve();
    });
    req.on("timeout", () => {
      req.destroy();
      resolve();
    });
    req.write(body);
    req.end();
  });
}

function startWatcher() {
  const existingPid = readPidFile(WATCHER_PID_FILE);
  if (existingPid && isProcessRunning(existingPid)) {
    log("watchdog", "Watcher already running");
    return;
  }

  log("watchdog", "Starting watcher...");

  const env = { ...process.env, DEV_PRESENCE_WATCH_PATH: WATCH_PATH };
  const child = spawn("node", [WATCHER_PATH], {
    cwd: EXTENSION_PATH,
    detached: true,
    stdio: "ignore",
    env,
    windowsHide: true,
  });

  child.unref();
  watcherProcess = child;
  writePidFile(WATCHER_PID_FILE, child.pid);
  log("watchdog", `Watcher started (PID ${child.pid})`);
}

async function stopWatcher() {
  const pid = readPidFile(WATCHER_PID_FILE);
  if (!pid) return;

  log("watchdog", "Stopping watcher (graceful)...");

  // 1. Send offline to agent first
  await sendOfflineToAgent();

  // 2. Graceful shutdown: SIGTERM (Unix) or taskkill without /F (Windows)
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /PID ${pid} /T`, { stdio: "pipe", timeout: 3000 });
    } else {
      process.kill(pid, "SIGTERM");
    }
  } catch {
    // Process may already be gone, that's fine
  }

  // 3. Wait up to 2s for graceful exit
  let waited = 0;
  while (waited < 2000) {
    if (!isProcessRunning(pid)) break;
    await new Promise((r) => setTimeout(r, 200));
    waited += 200;
  }

  // 4. Force kill if still alive
  if (isProcessRunning(pid)) {
    log("watchdog", "Watcher didn't exit gracefully, forcing...");
    try {
      if (process.platform === "win32") {
        execSync(`taskkill /PID ${pid} /T /F`, { stdio: "pipe" });
      } else {
        process.kill(pid, "SIGKILL");
      }
    } catch (err) {
      log("watchdog", `Force kill failed: ${err.message}`);
    }
  }

  removePidFile(WATCHER_PID_FILE);
  watcherProcess = null;
  log("watchdog", "Watcher stopped");
}

async function tick() {
  if (isShuttingDown) return;

  const zedOk = isZedRunning();

  if (zedOk) {
    // Ensure agent is running before starting watcher
    const agentOk = await isAgentRunning();
    if (!agentOk) {
      startAgent();
      // Wait for agent to come up
      let retries = 0;
      while (retries < 10) {
        await new Promise((r) => setTimeout(r, 500));
        if (await isAgentRunning()) break;
        retries++;
      }
    }
    startWatcher();
  } else {
    await stopWatcher();
  }
}

function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  log("watchdog", "Shutting down...");
  if (pollTimer) clearInterval(pollTimer);
  stopWatcher().then(() => {
    removePidFile(WATCHDOG_PID_FILE);
    setTimeout(() => process.exit(0), 500);
  });
}

async function main() {
  // Deduplication: exit if another watchdog is already running
  const existingPid = readPidFile(WATCHDOG_PID_FILE);
  if (existingPid && existingPid !== process.pid && isProcessRunning(existingPid)) {
    log("watchdog", `Another watchdog already running (PID ${existingPid}). Exiting.`);
    process.exit(0);
  }

  writePidFile(WATCHDOG_PID_FILE, process.pid);

  log("watchdog", `Repo root: ${REPO_ROOT}`);
  log("watchdog", `Watch path: ${WATCH_PATH}`);
  log("watchdog", `Agent URL: ${AGENT_URL}`);
  log("watchdog", "Starting poll loop...");

  await tick();
  pollTimer = setInterval(tick, POLL_INTERVAL_MS);

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  if (process.platform === "win32") {
    process.on("SIGINT", () => process.emit("SIGINT"));
  }
}

main().catch((err) => {
  console.error("Watchdog failed:", err);
  process.exit(1);
});
