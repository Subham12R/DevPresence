const express = require("express");
const cors = require("cors");
const http = require("http");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

const PORT = process.env.PORT || 4000;
const SECRET = process.env.DEV_PRESENCE_SECRET;
const REMOTE_STALE_AFTER_MS = Number(process.env.REMOTE_STALE_AFTER_MS || 120000);

let currentStatus = {
  status: "offline",
  effectiveStatus: "offline",
  isActive: false,
  stale: true,
  ageMs: null,
  lastSeen: null,
  lastActiveAt: null,
  editor: null,
  project: null,
  file: null,
  language: null,
  startedAt: null,
  sessionId: null,
  reportedStatus: "offline",
  totalActiveMs: 0,
  totalActiveMsAllSessions: 0,
  currentSessionActiveMs: 0,
  sessionCount: 0,
  activeSessionCount: 0,
  idleSessionCount: 0,
  offlineSessionCount: 0,
  receivedAt: 0,
};

function isAuthorized(authHeader = "") {
  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token || !SECRET) return false;

  const a = Buffer.from(token);
  const b = Buffer.from(SECRET);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function withRemoteStaleFallback(status) {
  if (!status.receivedAt) {
    return {
      ...status,
      status: "offline",
      effectiveStatus: "offline",
      isActive: false,
      stale: true,
    };
  }

  if (Date.now() - status.receivedAt <= REMOTE_STALE_AFTER_MS) {
    return status;
  }

  return {
    ...status,
    status: "offline",
    effectiveStatus: "offline",
    isActive: false,
    stale: true,
    ageMs: typeof status.lastSeen === "number" ? Date.now() - status.lastSeen : null,
  };
}

app.post("/activity", (req, res) => {
  if (!isAuthorized(req.headers.authorization)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const incoming = req.body ?? {};

  currentStatus = {
    ...currentStatus,
    ...incoming,
    lastSeen:
      typeof incoming.lastSeen === "number"
        ? incoming.lastSeen
        : currentStatus.lastSeen,
    lastActiveAt:
      typeof incoming.lastActiveAt === "number"
        ? incoming.lastActiveAt
        : currentStatus.lastActiveAt,
    totalActiveMs:
      typeof incoming.totalActiveMs === "number"
        ? incoming.totalActiveMs
        : currentStatus.totalActiveMs,
    totalActiveMsAllSessions:
      typeof incoming.totalActiveMsAllSessions === "number"
        ? incoming.totalActiveMsAllSessions
        : currentStatus.totalActiveMsAllSessions,
    receivedAt: Date.now(),
  };

  const payload = withRemoteStaleFallback(currentStatus);
  io.emit("activity", payload);

  return res.json({ ok: true });
});

app.get("/status", (_req, res) => {
  res.json(withRemoteStaleFallback(currentStatus));
});

io.on("connection", (socket) => {
  socket.emit("activity", withRemoteStaleFallback(currentStatus));
});

server.listen(PORT, () => {
  console.log(`Dev Presence API running on port ${PORT}`);
});
