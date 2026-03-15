# Dev Presence API

Dev Presence API is a small Node.js service that accepts developer-presence updates over HTTP and republishes the latest state over both HTTP and Socket.IO.

It is a good fit when you have one trusted publisher, such as a local editor extension, CLI, or background agent, and one or more read-only consumers, such as dashboards, widgets, overlays, or personal status pages.

## What this service does

- Accepts authenticated activity updates via `POST /activity`
- Serves the latest effective presence state via `GET /status`
- Broadcasts presence changes to connected Socket.IO clients with the `activity` event
- Automatically marks stale data as offline after a configurable timeout
- Stores all state in memory only

## Important behavior

- `POST /activity` is protected by a bearer token in `DEV_PRESENCE_SECRET`
- `GET /status` is public
- Socket.IO subscriptions are public
- CORS is open to all origins (`*`)
- Data is not persisted; restarting the process resets the state
- Stale fallback only overrides `status`, `effectiveStatus`, `isActive`, `stale`, and `ageMs`

## Requirements

- Node.js
- A value for `DEV_PRESENCE_SECRET` if you want writes to succeed

Install dependencies:

```bash
npm ci
```

Recommended local Node.js version:

```bash
nvm use
```

## Configuration

The service is controlled entirely by environment variables.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `PORT` | No | `4000` | TCP port the HTTP and Socket.IO server listens on. |
| `DEV_PRESENCE_SECRET` | Yes for writes | none | Bearer token required for `POST /activity`. If not set, the server still starts but all writes return `401 Unauthorized`. |
| `REMOTE_STALE_AFTER_MS` | No | `120000` | Time in milliseconds after which the last received presence update is treated as stale and forced offline. |

## Local development

Create a local env file from the example:

```bash
cp .env.example .env
```

Then update `DEV_PRESENCE_SECRET` in `.env`.

Start the API locally:

```bash
npm run dev
```

The server listens on `http://localhost:4000` unless `PORT` is overridden.

Quick smoke test:

```bash
curl -sS http://localhost:4000/status
```

Publish an update:

```bash
curl -sS -X POST http://localhost:4000/activity \
  -H "Authorization: Bearer replace-me-with-a-strong-secret" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "coding",
    "effectiveStatus": "coding",
    "isActive": true,
    "stale": false,
    "editor": "Cursor",
    "project": "dev-presence-api",
    "file": "server.js",
    "language": "javascript",
    "reportedStatus": "coding",
    "lastSeen": 1742094000000
  }'
```

## API reference

### `GET /status`

Returns the latest effective presence object after stale fallback has been applied.

- Method: `GET`
- Auth: none
- Content type: `application/json`
- Success status: `200 OK`

Example request:

```bash
curl -sS http://localhost:4000/status
```

Example response before any update has ever been received:

```json
{
  "status": "offline",
  "effectiveStatus": "offline",
  "isActive": false,
  "stale": true,
  "ageMs": null,
  "lastSeen": null,
  "lastActiveAt": null,
  "editor": null,
  "project": null,
  "file": null,
  "language": null,
  "startedAt": null,
  "sessionId": null,
  "reportedStatus": "offline",
  "totalActiveMs": 0,
  "totalActiveMsAllSessions": 0,
  "currentSessionActiveMs": 0,
  "sessionCount": 0,
  "activeSessionCount": 0,
  "idleSessionCount": 0,
  "offlineSessionCount": 0,
  "receivedAt": 0
}
```

### `POST /activity`

Accepts a partial or complete activity payload, merges it into the current in-memory state, timestamps the receipt, and broadcasts the resulting state to all Socket.IO clients.

- Method: `POST`
- Auth: required
- Content type: `application/json`
- Success status: `200 OK`
- Failure status: `401 Unauthorized`

Required headers:

- `Authorization: Bearer <DEV_PRESENCE_SECRET>`
- `Content-Type: application/json`

Example request:

```bash
curl -sS -X POST http://localhost:4000/activity \
  -H "Authorization: Bearer replace-me-with-a-strong-secret" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "coding",
    "effectiveStatus": "coding",
    "isActive": true,
    "stale": false,
    "ageMs": 1500,
    "lastSeen": 1742094000000,
    "lastActiveAt": 1742093990000,
    "editor": "Cursor",
    "project": "dev-presence-api",
    "file": "server.js",
    "language": "javascript",
    "startedAt": 1742093000000,
    "sessionId": "session-1",
    "reportedStatus": "coding",
    "totalActiveMs": 7200000,
    "totalActiveMsAllSessions": 14400000,
    "currentSessionActiveMs": 1800000,
    "sessionCount": 3,
    "activeSessionCount": 1,
    "idleSessionCount": 1,
    "offlineSessionCount": 1
  }'
```

Success response:

```json
{"ok":true}
```

Unauthorized response:

```json
{"error":"Unauthorized"}
```

### Activity payload fields

The server accepts any JSON object, but the current implementation initializes and serves the following fields:

| Field | Type | Description |
| --- | --- | --- |
| `status` | `string` | Current visible status. Forced to `"offline"` when stale fallback applies. |
| `effectiveStatus` | `string` | Derived status for consumers. Also forced to `"offline"` when stale. |
| `isActive` | `boolean` | Whether the user is currently active. Forced to `false` when stale. |
| `stale` | `boolean` | Staleness flag. Forced to `true` when stale fallback applies. |
| `ageMs` | `number \| null` | Age of the last activity in milliseconds. When stale fallback applies and `lastSeen` is numeric, this becomes `Date.now() - lastSeen`. |
| `lastSeen` | `number \| null` | Unix timestamp in milliseconds for the last observed presence update from the publisher. |
| `lastActiveAt` | `number \| null` | Unix timestamp in milliseconds for the last active moment reported by the publisher. |
| `editor` | `string \| null` | Editor or source application name. |
| `project` | `string \| null` | Current project name. |
| `file` | `string \| null` | Current file path or file name. |
| `language` | `string \| null` | Current programming language or file language. |
| `startedAt` | `number \| null` | Unix timestamp in milliseconds for when the current session began. |
| `sessionId` | `string \| null` | Opaque session identifier from the publisher. |
| `reportedStatus` | `string` | Raw status reported by the publisher. This is not automatically changed by stale fallback. |
| `totalActiveMs` | `number` | Total active time for the current logical scope as reported by the publisher. |
| `totalActiveMsAllSessions` | `number` | Total active time across all sessions as reported by the publisher. |
| `currentSessionActiveMs` | `number` | Active time in the current session. |
| `sessionCount` | `number` | Total number of sessions represented by the publisher state. |
| `activeSessionCount` | `number` | Number of active sessions. |
| `idleSessionCount` | `number` | Number of idle sessions. |
| `offlineSessionCount` | `number` | Number of offline sessions. |
| `receivedAt` | `number` | Unix timestamp in milliseconds added by the API when it accepts the update. |

### Merge semantics

`POST /activity` merges the incoming JSON object into the previous in-memory state instead of replacing it entirely.

That means:

- Omitted fields keep their previous values
- Most fields can be explicitly cleared by sending `null`
- `lastSeen`, `lastActiveAt`, `totalActiveMs`, and `totalActiveMsAllSessions` only update when the incoming value is a number
- `receivedAt` is always overwritten by the server with the current time

## Socket.IO behavior

Socket.IO is served from the same host and port as the HTTP API, using the default Socket.IO path.

The server emits a single event:

- Event name: `activity`
- When it is emitted:
  - immediately after a client connects
  - every time an authenticated `POST /activity` is accepted
- Payload: the same presence object shape returned by `GET /status`, including stale fallback if applicable

Example consumer:

```js
import { io } from "socket.io-client";

const socket = io("http://localhost:4000");

socket.on("connect", () => {
  console.log("connected", socket.id);
});

socket.on("activity", (payload) => {
  console.log("presence update", payload);
});
```

## Staleness and offline fallback

The service tracks when it last received a write using `receivedAt`.

If the current time is greater than `receivedAt + REMOTE_STALE_AFTER_MS`, the API treats the state as stale and returns a fallback payload with these forced values:

- `status: "offline"`
- `effectiveStatus: "offline"`
- `isActive: false`
- `stale: true`
- `ageMs: Date.now() - lastSeen` when `lastSeen` is numeric, otherwise `null`

All other fields remain whatever the last accepted payload stored in memory.

This is important for consumers:

- `status` may read `"offline"` while `project`, `editor`, or `reportedStatus` still reflect the most recently published session
- Stale fallback affects `GET /status` and Socket.IO payloads
- A process restart clears the in-memory state entirely

## Deployment

This service is simple to deploy because it has no database, build step, or background worker. Any platform that can run a long-lived Node.js HTTP server will work.

### Deployment checklist

1. Install dependencies with `npm ci --omit=dev`
2. Set `DEV_PRESENCE_SECRET` to a strong random value
3. Set `PORT` if your platform does not inject it automatically
4. Optionally set `REMOTE_STALE_AFTER_MS`
5. Start the service with `npm start`
6. Confirm your platform supports WebSocket connections for Socket.IO clients

### Example generic deployment flow

```bash
npm ci --omit=dev
cp .env.example .env
npm start
```

Edit `.env` with your real secret and any environment-specific values before starting the service.

If you prefer not to use a `.env` file in production, inject the same variables through your hosting platform's secret and environment settings instead.

### Recommended production settings

- Run a single instance unless you add shared state or a pub/sub layer; the current implementation keeps presence only in process memory
- Put the API behind HTTPS before sending bearer tokens over the internet
- Treat `GET /status` and Socket.IO as publicly readable unless you add auth in code
- Keep `DEV_PRESENCE_SECRET` in your host's secret manager, not in source control
- Make sure reverse proxies and load balancers allow WebSocket upgrades
- Use a process manager or platform restart policy so the service comes back up automatically after crashes or machine restarts

### Platform notes

- Render, Railway, Fly.io, VPS hosts, and container platforms can all run this app as a standard Node.js web service
- If your platform expects a start command, use `npm start`
- If your platform injects a dynamic port, leave `PORT` unset and let the host provide it
- If you scale to multiple instances without shared state, different clients may observe different presence values

## Operational caveats

- This API is designed for trusted publishers and public or semi-public readers
- CORS is currently unrestricted
- There is no rate limiting
- There is no payload validation beyond the bearer token and a few numeric field checks
- State is lost on restart or redeploy

If you want stronger production guarantees, the next logical improvements are request validation, authenticated reads, configurable CORS, and shared persistence or pub/sub for multi-instance deployments.

## Repository files

The repo now includes a small baseline set of maintenance files:

- `.env.example` for local and deployment configuration reference
- `.gitignore` for local-only files and generated output
- `.editorconfig` for consistent formatting defaults
- `.nvmrc` for a shared Node.js version target
- `.github/workflows/ci.yml` for basic install and syntax verification on GitHub Actions
- `.vscodeignore` for excluding repo-only files if this project is ever packaged through VS Code tooling
- `LICENSE` matching the package metadata
