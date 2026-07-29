const express = require("express");
const cors = require("cors");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const VALID_STATUSES = new Set(["active", "idle", "offline"]);
const DEFAULT_IDLE_TIMEOUT_MS = Number(process.env.DEFAULT_IDLE_TIMEOUT_MS || 300_000);
const DEFAULT_STALE_AFTER_MS = Number(process.env.DEFAULT_STALE_AFTER_MS || 600_000);
const RECONCILE_INTERVAL_MS = Number(process.env.RECONCILE_INTERVAL_MS || 15_000);
const PORT = Number(process.env.PORT || 7337);
const API_URL =
  process.env.API_URL === undefined
    ? "http://localhost:4000/activity"
    : process.env.API_URL;
const API_KEY = process.env.API_KEY;
const DB_PATH =
  process.env.DEV_PRESENCE_DB_PATH || getDefaultDbPath();

const app = express();
app.use(cors());
app.use(express.json());

const db = openDatabase(DB_PATH);
const stmts = prepareStatements(db);
let lastForwardFingerprint = "";

function getDefaultDbPath() {
  const home = os.homedir();

  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "dev-presence", "presence.db");
  }

  if (process.platform === "win32") {
    return path.join(home, ".dev-presence", "presence.db");
  }

  return path.join(home, ".local", "share", "dev-presence", "presence.db");
}

function openDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const database = new DatabaseSync(dbPath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      editor TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      last_active_at INTEGER,
      idle_deadline_at INTEGER NOT NULL,
      stale_after_ms INTEGER NOT NULL,
      reported_status TEXT NOT NULL,
      project TEXT,
      file TEXT,
      language TEXT,
      total_active_ms INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activity_intervals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      editor TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      close_reason TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_last_seen
      ON sessions(last_seen DESC);

    CREATE INDEX IF NOT EXISTS idx_intervals_session_open
      ON activity_intervals(session_id, ended_at);

    CREATE INDEX IF NOT EXISTS idx_intervals_started_at
      ON activity_intervals(started_at);
  `);

  return database;
}

function prepareStatements(database) {
  return {
    getSessionById: database.prepare(`
      SELECT *
      FROM sessions
      WHERE session_id = $sessionId
    `),
    upsertSession: database.prepare(`
      INSERT INTO sessions (
        session_id,
        editor,
        started_at,
        last_seen,
        last_active_at,
        idle_deadline_at,
        stale_after_ms,
        reported_status,
        project,
        file,
        language,
        total_active_ms,
        updated_at
      ) VALUES (
        $sessionId,
        $editor,
        $startedAt,
        $lastSeen,
        $lastActiveAt,
        $idleDeadlineAt,
        $staleAfterMs,
        $reportedStatus,
        $project,
        $file,
        $language,
        $totalActiveMs,
        $updatedAt
      )
      ON CONFLICT(session_id) DO UPDATE SET
        editor = excluded.editor,
        started_at = excluded.started_at,
        last_seen = excluded.last_seen,
        last_active_at = excluded.last_active_at,
        idle_deadline_at = excluded.idle_deadline_at,
        stale_after_ms = excluded.stale_after_ms,
        reported_status = excluded.reported_status,
        project = excluded.project,
        file = excluded.file,
        language = excluded.language,
        total_active_ms = excluded.total_active_ms,
        updated_at = excluded.updated_at
    `),
    selectSessions: database.prepare(`
      SELECT *
      FROM sessions
      ORDER BY last_seen DESC
    `),
    selectOpenIntervals: database.prepare(`
      SELECT
        i.id,
        i.session_id,
        i.started_at,
        s.reported_status,
        s.last_seen,
        s.idle_deadline_at
      FROM activity_intervals i
      JOIN sessions s
        ON s.session_id = i.session_id
      WHERE i.ended_at IS NULL
    `),
    getOpenIntervalBySession: database.prepare(`
      SELECT *
      FROM activity_intervals
      WHERE session_id = $sessionId
        AND ended_at IS NULL
      ORDER BY started_at DESC
      LIMIT 1
    `),
    insertInterval: database.prepare(`
      INSERT INTO activity_intervals (
        session_id,
        editor,
        started_at,
        ended_at,
        close_reason,
        created_at,
        updated_at
      ) VALUES (
        $sessionId,
        $editor,
        $startedAt,
        NULL,
        NULL,
        $createdAt,
        $updatedAt
      )
    `),
    closeIntervalById: database.prepare(`
      UPDATE activity_intervals
      SET ended_at = $endedAt,
          close_reason = $closeReason,
          updated_at = $updatedAt
      WHERE id = $id
        AND ended_at IS NULL
    `),
    selectIntervalsForTotals: database.prepare(`
      SELECT
        i.started_at,
        COALESCE(i.ended_at, $now) AS ended_at
      FROM activity_intervals i
      ORDER BY i.started_at ASC, ended_at ASC
    `),
  };
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeText(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeActivity(body, now) {
  if (!body || typeof body !== "object") {
    return { error: "JSON body required" };
  }

  const reportedStatus = VALID_STATUSES.has(body.status) ? body.status : null;
  if (!reportedStatus) {
    return { error: "status must be one of: active, idle, offline" };
  }

  const sessionId = normalizeText(body.sessionId);
  if (!sessionId) {
    return { error: "sessionId is required" };
  }

  const editor = normalizeText(body.editor) || "unknown";
  const lastSeen = isFiniteNumber(body.lastSeen) ? body.lastSeen : now;
  const idleDeadlineAt = isFiniteNumber(body.idleDeadlineAt)
    ? body.idleDeadlineAt
    : lastSeen + DEFAULT_IDLE_TIMEOUT_MS;
  const staleAfterMs = Math.max(
    isFiniteNumber(body.staleAfterMs) ? body.staleAfterMs : DEFAULT_STALE_AFTER_MS,
    Math.max(0, idleDeadlineAt - lastSeen),
  );

  return {
    value: {
      sessionId,
      editor,
      startedAt: isFiniteNumber(body.startedAt) ? body.startedAt : lastSeen,
      lastSeen,
      lastActiveAt: isFiniteNumber(body.lastActiveAt)
        ? body.lastActiveAt
        : (reportedStatus === "active" ? lastSeen : null),
      idleDeadlineAt,
      staleAfterMs,
      reportedStatus,
      project: normalizeText(body.project),
      file: normalizeText(body.file),
      language: normalizeText(body.language),
      totalActiveMs:
        isFiniteNumber(body.totalActiveMs) && body.totalActiveMs >= 0
          ? body.totalActiveMs
          : 0,
    },
  };
}

function withTransaction(fn) {
  db.exec("BEGIN IMMEDIATE");

  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function clampEndTime(startedAt, endedAt) {
  return Math.max(startedAt, endedAt);
}

function closeInterval(intervalId, startedAt, endedAt, closeReason, now) {
  stmts.closeIntervalById.run({
    $id: intervalId,
    $endedAt: clampEndTime(startedAt, endedAt),
    $closeReason: closeReason,
    $updatedAt: now,
  });
}

function reconcileOpenIntervals(now = Date.now()) {
  let changed = false;
  const openIntervals = stmts.selectOpenIntervals.all();

  for (const row of openIntervals) {
    if (row.reported_status === "active" && now < row.idle_deadline_at) {
      continue;
    }

    const closeReason =
      row.reported_status === "offline"
        ? "offline-event"
        : (row.reported_status === "idle" ? "idle-event" : "idle-timeout");
    const endedAt =
      row.reported_status === "active"
        ? row.idle_deadline_at
        : row.last_seen;

    closeInterval(row.id, row.started_at, endedAt, closeReason, now);
    changed = true;
  }

  return changed;
}

function getEffectiveStatus(session, now) {
  if (session.reported_status === "offline") {
    return "offline";
  }

  if (now >= session.last_seen + session.stale_after_ms) {
    return "offline";
  }

  if (session.reported_status === "active" && now < session.idle_deadline_at) {
    return "active";
  }

  return "idle";
}

function getSessions(now = Date.now()) {
  const rows = stmts.selectSessions.all();

  return rows.map((row) => {
    const effectiveStatus = getEffectiveStatus(row, now);

    return {
      sessionId: row.session_id,
      editor: row.editor,
      project: row.project,
      file: row.file,
      language: row.language,
      startedAt: row.started_at,
      lastSeen: row.last_seen,
      lastActiveAt: row.last_active_at,
      idleDeadlineAt: row.idle_deadline_at,
      staleAfterMs: row.stale_after_ms,
      reportedStatus: row.reported_status,
      totalActiveMs: row.total_active_ms,
      updatedAt: row.updated_at,
      effectiveStatus,
      stale: effectiveStatus === "offline" && row.reported_status !== "offline",
      ageMs: Math.max(0, now - row.last_seen),
    };
  });
}

function computeTotalActiveMsAllSessions(now = Date.now()) {
  const intervals = stmts.selectIntervalsForTotals.all({ $now: now });
  if (intervals.length === 0) {
    return 0;
  }

  let mergedStart = null;
  let mergedEnd = null;
  let total = 0;

  for (const interval of intervals) {
    const start = interval.started_at;
    const end = clampEndTime(start, interval.ended_at);

    if (mergedStart === null) {
      mergedStart = start;
      mergedEnd = end;
      continue;
    }

    if (start <= mergedEnd) {
      mergedEnd = Math.max(mergedEnd, end);
      continue;
    }

    total += Math.max(0, mergedEnd - mergedStart);
    mergedStart = start;
    mergedEnd = end;
  }

  if (mergedStart !== null && mergedEnd !== null) {
    total += Math.max(0, mergedEnd - mergedStart);
  }

  return total;
}

function getFeaturedSession(sessions) {
  if (sessions.length === 0) {
    return null;
  }

  const priority = { active: 3, idle: 2, offline: 1 };

  return [...sessions].sort((left, right) => {
    if (priority[right.effectiveStatus] !== priority[left.effectiveStatus]) {
      return priority[right.effectiveStatus] - priority[left.effectiveStatus];
    }

    if ((right.lastActiveAt || 0) !== (left.lastActiveAt || 0)) {
      return (right.lastActiveAt || 0) - (left.lastActiveAt || 0);
    }

    return right.lastSeen - left.lastSeen;
  })[0];
}

function buildStatusSnapshot(now = Date.now()) {
  const sessions = getSessions(now);
  const featured = getFeaturedSession(sessions);
  const activeSessionCount = sessions.filter((session) => session.effectiveStatus === "active").length;
  const idleSessionCount = sessions.filter((session) => session.effectiveStatus === "idle").length;
  const offlineSessionCount = sessions.length - activeSessionCount - idleSessionCount;

  const status =
    activeSessionCount > 0
      ? "active"
      : (idleSessionCount > 0 ? "idle" : "offline");
  const lastSeen = sessions.reduce(
    (max, session) => Math.max(max, session.lastSeen || 0),
    0,
  );
  const lastActiveAt = sessions.reduce(
    (max, session) => Math.max(max, session.lastActiveAt || 0),
    0,
  );
  const totalActiveMsAllSessions = computeTotalActiveMsAllSessions(now);

  return {
    status,
    effectiveStatus: status,
    isActive: status === "active",
    stale: Boolean(featured?.stale),
    ageMs: featured ? featured.ageMs : null,
    lastSeen: lastSeen || null,
    lastActiveAt: lastActiveAt || null,
    editor: featured?.editor || null,
    project: featured?.project || null,
    file: featured?.file || null,
    language: featured?.language || null,
    startedAt: featured?.startedAt || null,
    sessionId: featured?.sessionId || null,
    reportedStatus: featured?.reportedStatus || "offline",
    totalActiveMs: totalActiveMsAllSessions,
    totalActiveMsAllSessions,
    currentSessionActiveMs: featured?.totalActiveMs || 0,
    sessionCount: sessions.length,
    activeSessionCount,
    idleSessionCount,
    offlineSessionCount,
  };
}

function buildForwardFingerprint(snapshot) {
  return JSON.stringify({
    status: snapshot.status,
    stale: snapshot.stale,
    lastSeen: snapshot.lastSeen,
    lastActiveAt: snapshot.lastActiveAt,
    editor: snapshot.editor,
    project: snapshot.project,
    file: snapshot.file,
    language: snapshot.language,
    sessionId: snapshot.sessionId,
    totalActiveMsAllSessions: snapshot.totalActiveMsAllSessions,
    currentSessionActiveMs: snapshot.currentSessionActiveMs,
    sessionCount: snapshot.sessionCount,
    activeSessionCount: snapshot.activeSessionCount,
    idleSessionCount: snapshot.idleSessionCount,
    offlineSessionCount: snapshot.offlineSessionCount,
  });
}

async function forwardSnapshot(snapshot) {
  if (!API_URL) {
    return;
  }

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(API_KEY && { Authorization: `Bearer ${API_KEY}` }),
      },
      body: JSON.stringify(snapshot),
    });

    if (!response.ok) {
      const responseBody = await response.text();
      console.log(
        "API forward failed:",
        response.status,
        responseBody || "(empty response)",
      );
    }
  } catch (error) {
    console.log("API forward failed:", error.message);
  }
}

async function maybeForwardSnapshot(snapshot, force = false) {
  const fingerprint = buildForwardFingerprint(snapshot);

  if (!force && fingerprint === lastForwardFingerprint) {
    return;
  }

  lastForwardFingerprint = fingerprint;
  await forwardSnapshot(snapshot);
}

function recordActivity(body) {
  const now = Date.now();
  const parsed = normalizeActivity(body, now);

  if (parsed.error) {
    return parsed;
  }

  withTransaction(() => {
    reconcileOpenIntervals(now);

    const incoming = parsed.value;
    const existing = stmts.getSessionById.get({ $sessionId: incoming.sessionId });
    const totalActiveMs = Math.max(
      existing?.total_active_ms || 0,
      incoming.totalActiveMs,
    );
    const lastActiveAt = incoming.lastActiveAt || existing?.last_active_at || null;

    stmts.upsertSession.run({
      $sessionId: incoming.sessionId,
      $editor: incoming.editor,
      $startedAt: existing?.started_at || incoming.startedAt,
      $lastSeen: incoming.lastSeen,
      $lastActiveAt: lastActiveAt,
      $idleDeadlineAt: incoming.idleDeadlineAt,
      $staleAfterMs: incoming.staleAfterMs,
      $reportedStatus: incoming.reportedStatus,
      $project: incoming.project,
      $file: incoming.file,
      $language: incoming.language,
      $totalActiveMs: totalActiveMs,
      $updatedAt: now,
    });

    const openInterval = stmts.getOpenIntervalBySession.get({
      $sessionId: incoming.sessionId,
    });

    if (incoming.reportedStatus === "active") {
      if (!openInterval) {
        stmts.insertInterval.run({
          $sessionId: incoming.sessionId,
          $editor: incoming.editor,
          $startedAt: incoming.lastSeen,
          $createdAt: now,
          $updatedAt: now,
        });
      }
      return;
    }

    if (openInterval) {
      closeInterval(
        openInterval.id,
        openInterval.started_at,
        incoming.lastSeen,
        incoming.reportedStatus === "idle" ? "idle-event" : "offline-event",
        now,
      );
    }
  });

  return { value: buildStatusSnapshot(now) };
}

function getStatusSnapshot() {
  const now = Date.now();

  withTransaction(() => {
    reconcileOpenIntervals(now);
  });

  return buildStatusSnapshot(now);
}

app.post("/activity", async (req, res) => {
  try {
    const result = recordActivity(req.body);

    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    const snapshot = result.value;
    console.log("Activity:", snapshot);
    await maybeForwardSnapshot(snapshot);

    return res.json({ ok: true, status: snapshot });
  } catch (error) {
    console.error("Failed to record activity:", error);
    return res.status(500).json({ error: "Failed to record activity" });
  }
});

app.get("/status", (req, res) => {
  try {
    res.json(getStatusSnapshot());
  } catch (error) {
    console.error("Failed to read status:", error);
    res.status(500).json({ error: "Failed to read status" });
  }
});

withTransaction(() => {
  reconcileOpenIntervals(Date.now());
});

const reconcileTimer = setInterval(async () => {
  try {
    const snapshot = getStatusSnapshot();
    await maybeForwardSnapshot(snapshot);
  } catch (error) {
    console.error("Failed to reconcile presence:", error);
  }
}, RECONCILE_INTERVAL_MS);

reconcileTimer.unref();

app.listen(PORT, () => {
  console.log(`Dev Presence Agent running on port ${PORT}`);
  console.log(`SQLite database: ${DB_PATH}`);
});
