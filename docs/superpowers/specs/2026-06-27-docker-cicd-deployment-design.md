# Design: Docker + GitHub Actions Deployment for dev-presence-api

**Date:** 2026-06-27
**Author:** Subham Karmakar
**Status:** Approved

---

## Goal

Deploy `dev-presence-api` to `devpresence.monostack.in` using Docker containers, GitHub Container Registry, and GitHub Actions CI/CD. Replace the existing Digital Ocean App Platform deployment.

---

## Context

- `dev-presence-api` is a Node.js 22 / Express 5 / Socket.IO service. No database, no build step.
- The VPS already runs Docker and hosts `portfolio-api` (port 5000) and `portfolio-postgres`.
- The domain `monostack.in` is managed by Cloudflare (DNS + SSL proxy). Subdomain `devpresence.monostack.in` DNS A record already exists and Cloudflare proxy is active (confirmed: returns HTTP/2 502 from CF origin — DNS is done, service not running yet).
- Existing Nginx is installed on the VPS host and serves `subham12r.me` / `api.subham12r.me`.
- GitHub Container Registry is already in use at `ghcr.io/subham12r/`.

---

## Architecture

```
Browser (HTTPS)
      ↓
Cloudflare  ← SSL termination, free, automatic
      ↓  plain HTTP on port 80
VPS host — Nginx
      ├── subham12r.me / api.subham12r.me  →  portfolio (existing, unchanged)
      └── devpresence.monostack.in         →  localhost:4000  (new server block)
                                                    ↓
                                           Docker container: dev-presence-api
                                           (port 4000, localhost-only)
```

Cloudflare SSL mode: **Flexible** (Cloudflare → VPS uses plain HTTP, no cert needed on server).

---

## Files Added to Repo

```
dev-presence-api/
├── Dockerfile              ← builds the container image
├── .dockerignore           ← excludes node_modules, .env, .git
├── docker-compose.yml      ← single `api` service with restart policy
└── .github/
    └── workflows/
        ├── ci.yml          ← unchanged (runs on every PR and push)
        └── deploy.yml      ← NEW: build → push → SSH → compose up
```

### Dockerfile

- Base: `node:22-alpine` (small, secure)
- Copies `package.json` + `package-lock.json` first (layer cache)
- Runs `npm ci --omit=dev`
- Copies source files
- Sets `NODE_ENV=production`
- Exposes port 4000
- CMD: `node server.js`

### docker-compose.yml

- Single service: `api`
- Image: `ghcr.io/subham12r/dev-presence-api:latest`
- Port binding: `127.0.0.1:4000:4000` (localhost-only, Nginx proxies to it)
- Restart policy: `unless-stopped`
- Environment: loaded from `.env` file on the server (not in repo)
- Network: default bridge

### .dockerignore

Excludes: `node_modules`, `.env`, `.git`, `*.md`, `docs/`

### deploy.yml (GitHub Actions)

Triggers on push to `main` branch only.

Steps:
1. Checkout code
2. Log in to `ghcr.io` using `GITHUB_TOKEN`
3. Build and push image tagged `latest` + commit SHA
4. SSH into VPS
5. On VPS: `docker compose pull && docker compose up -d`

Secrets required in GitHub repo settings:
- `SSH_PRIVATE_KEY` — private key whose public half is in `~/.ssh/authorized_keys` on VPS
- `SERVER_HOST` — VPS IP or hostname
- `SERVER_USER` — SSH user (e.g. `root` or `ubuntu`)
- `DEV_PRESENCE_SECRET` — written to `.env` on server manually on first deploy

---

## VPS Setup (one-time manual steps)

1. **DNS:** Already done — `devpresence.monostack.in` A record exists in Cloudflare with proxy enabled.

2. **Nginx server block:** Create `/etc/nginx/sites-available/devpresence` with:
   - `server_name devpresence.monostack.in`
   - Listen on port 80
   - `proxy_pass http://127.0.0.1:4000`
   - WebSocket headers: `Upgrade`, `Connection`, `Host`, `X-Real-IP`
   - Symlink to `sites-enabled`, reload Nginx

3. **`.env` file on server:** Place at `~/dev-presence-api/.env` with `DEV_PRESENCE_SECRET` and optionally `PORT=4000`, `REMOTE_STALE_AFTER_MS`.

4. **GitHub Secrets:** Add `SSH_PRIVATE_KEY`, `SERVER_HOST`, `SERVER_USER` in repo Settings → Secrets and variables → Actions.

---

## WebSocket Support

Socket.IO requires WebSocket proxy support in Nginx. The server block must include:

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

Without these headers, Socket.IO falls back to HTTP long-polling (functional but slower).

---

## Deploy Flow (automated, every push to main)

```
git push origin main
        ↓
GitHub Actions: deploy.yml
  1. docker build -t ghcr.io/subham12r/dev-presence-api:latest .
  2. docker push ghcr.io/subham12r/dev-presence-api:latest
  3. SSH to VPS
  4. cd ~/dev-presence-api && docker compose pull && docker compose up -d
        ↓
New container running — Compose recreates from new image, removes old
```

---

## Production Concerns

| Concern | Decision |
|---|---|
| SSL | Cloudflare handles it — no Certbot needed |
| Secrets | `.env` file on server, not in repo |
| Restart on crash | `restart: unless-stopped` in compose |
| State loss on redeploy | Accepted — service is stateless (in-memory only) |
| Port isolation | Bound to `127.0.0.1:4000` — not exposed to internet |
| Zero-downtime | `docker compose up -d` recreates without manual stop/rm |
| WebSockets | Nginx configured with Upgrade headers |

---

## Out of Scope

- `portfolio-api` production upgrade (separate task, same pattern applies)
- HTTPS between Cloudflare and VPS (Flexible mode is sufficient)
- Rate limiting, request validation, authenticated reads
- Multi-instance / shared state

---

## Success Criteria

- [ ] Push to `main` triggers automatic build + deploy
- [ ] `https://devpresence.monostack.in/status` returns JSON
- [ ] Socket.IO clients can connect to `wss://devpresence.monostack.in`
- [ ] VS Code extension can POST to `https://devpresence.monostack.in/activity`
- [ ] Container restarts automatically if it crashes
