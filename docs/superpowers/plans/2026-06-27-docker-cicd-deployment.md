# Docker + GitHub Actions Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy `dev-presence-api` to `https://devpresence.monostack.in` with every push to `main` triggering an automatic build and zero-downtime deploy.

**Architecture:** Dockerfile packages the Node.js app into an Alpine image pushed to `ghcr.io`. Docker Compose on the VPS runs a single `api` container bound to `127.0.0.1:4000`. Host Nginx reverse-proxies `devpresence.monostack.in` to that port with WebSocket headers; Certbot manages the TLS cert. GitHub Actions runs CI then builds, pushes, and deploys on every push to `main`.

**Tech Stack:** Docker (node:22-alpine), Docker Compose, GitHub Actions, GitHub Container Registry (ghcr.io/subham12r/), Nginx (host), Certbot (Let's Encrypt), Node.js 22

## Global Constraints

- Node.js version: 22 (from `.nvmrc`)
- Docker base image: `node:22-alpine`
- Registry image name: `ghcr.io/subham12r/dev-presence-api`
- VPS app directory: `~/dev-presence-api/`
- VPS SSH user: `subham`
- Container port binding: `127.0.0.1:4000:4000` (localhost-only)
- Domain: `devpresence.monostack.in` — DNS A record and Cloudflare proxy already active
- Cloudflare SSL mode: **Full** (VPS has a real Let's Encrypt cert)
- All repo paths below are relative to `dev-presence-api/` (the root of the `github.com/subham12r/dev-presence-api` GitHub repo)

---

### Task 1: Dockerfile and .dockerignore

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

**Interfaces:**
- Produces: a Docker image that starts `node server.js` on port 4000 with `NODE_ENV=production`

- [ ] **Step 1: Create `.dockerignore`**

  Create file `.dockerignore` with this exact content:
  ```
  node_modules
  .env
  .git
  .github
  .nvmrc
  .vscodeignore
  .gitignore
  *.md
  LICENSE
  docs/
  ```

  Why each exclusion matters:
  - `node_modules` — Docker installs these fresh with `npm ci`; copying them in wastes space and breaks native modules compiled for the wrong OS
  - `.env` — secrets must never be baked into an image
  - `.git` / `.github` — no version history needed in the image
  - `*.md` / `LICENSE` / `docs/` — documentation only

- [ ] **Step 2: Create `Dockerfile`**

  Create file `Dockerfile` with this exact content:
  ```dockerfile
  FROM node:22-alpine

  WORKDIR /app

  COPY package.json package-lock.json ./
  RUN npm ci --omit=dev

  COPY server.js ./

  ENV NODE_ENV=production
  EXPOSE 4000

  CMD ["node", "server.js"]
  ```

  Why this structure:
  - `COPY package*.json` first, then `RUN npm ci` — Docker caches each layer. If only `server.js` changes, the `npm ci` layer is reused (fast rebuilds).
  - `--omit=dev` — skips dev-only packages, keeps the image small.
  - Only `server.js` is copied because that's the only source file (confirmed from repo structure).

- [ ] **Step 3: Build the image locally**

  ```bash
  cd dev-presence-api
  docker build -t dev-presence-api:test .
  ```

  Expected final line:
  ```
  => => naming to docker.io/library/dev-presence-api:test
  ```
  (No errors. Build completes in ~30 seconds on first run, faster after.)

- [ ] **Step 4: Run the container and verify it responds**

  ```bash
  docker run -d --name dp-test \
    -e DEV_PRESENCE_SECRET=test-secret \
    -p 4000:4000 \
    dev-presence-api:test

  curl -s http://localhost:4000/status
  ```

  Expected response (presence starts offline):
  ```json
  {"status":"offline","effectiveStatus":"offline","isActive":false,"stale":true,"ageMs":null,"lastSeen":null,"lastActiveAt":null,"editor":null,"project":null,"file":null,"language":null,"startedAt":null,"sessionId":null,"reportedStatus":"offline","totalActiveMs":0,"totalActiveMsAllSessions":0,"currentSessionActiveMs":0,"sessionCount":0,"activeSessionCount":0,"idleSessionCount":0,"offlineSessionCount":0,"receivedAt":0}
  ```

- [ ] **Step 5: Clean up the test container**

  ```bash
  docker stop dp-test && docker rm dp-test
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add Dockerfile .dockerignore
  git commit -m "build: add Dockerfile and .dockerignore"
  ```

---

### Task 2: docker-compose.yml

**Files:**
- Create: `docker-compose.yml`

**Interfaces:**
- Consumes: image `ghcr.io/subham12r/dev-presence-api:latest` (pushed in Task 3 on every deploy)
- Consumes: `.env` file on the VPS server (created in Task 5)
- Produces: compose service definition used by the deploy workflow (`docker compose pull && docker compose up -d`)

- [ ] **Step 1: Create `docker-compose.yml`**

  Create file `docker-compose.yml` with this exact content:
  ```yaml
  services:
    api:
      image: ghcr.io/subham12r/dev-presence-api:latest
      restart: unless-stopped
      ports:
        - "127.0.0.1:4000:4000"
      env_file:
        - .env
  ```

  Why each line matters:
  - `image:` — pulls from registry on every deploy (no local build on the VPS needed)
  - `restart: unless-stopped` — container comes back after crashes or VPS reboots; stops only if you manually `docker compose stop`
  - `"127.0.0.1:4000:4000"` — binds to localhost only; the port is not reachable from the internet directly, only through Nginx
  - `env_file: .env` — reads `PORT`, `DEV_PRESENCE_SECRET`, `REMOTE_STALE_AFTER_MS` from `.env` on the server; the `.env` file is never committed to the repo

- [ ] **Step 2: Validate the compose file syntax**

  ```bash
  docker compose config
  ```

  Expected: prints the resolved config (no errors). The `image:` field should show `ghcr.io/subham12r/dev-presence-api:latest`.

- [ ] **Step 3: Commit**

  ```bash
  git add docker-compose.yml
  git commit -m "build: add docker-compose.yml with restart policy"
  ```

---

### Task 3: GitHub Actions deploy.yml

**Files:**
- Create: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: `Dockerfile` (Task 1), `docker-compose.yml` (Task 2)
- Consumes: GitHub Secrets `SSH_PRIVATE_KEY`, `SERVER_HOST`, `SERVER_USER` (added in Task 5)
- Produces: automated pipeline — on every push to `main`: runs checks → builds image → pushes to ghcr.io → deploys to VPS

- [ ] **Step 1: Create `.github/workflows/deploy.yml`**

  Create file `.github/workflows/deploy.yml` with this exact content:
  ```yaml
  name: Deploy

  on:
    push:
      branches: [main]

  jobs:
    deploy:
      runs-on: ubuntu-latest
      permissions:
        contents: read
        packages: write

      steps:
        - name: Check out repository
          uses: actions/checkout@v4

        - name: Set up Node.js
          uses: actions/setup-node@v4
          with:
            node-version-file: .nvmrc
            cache: npm

        - name: Install dependencies
          run: npm ci

        - name: Run checks
          run: npm test

        - name: Log in to GitHub Container Registry
          uses: docker/login-action@v3
          with:
            registry: ghcr.io
            username: ${{ github.actor }}
            password: ${{ secrets.GITHUB_TOKEN }}

        - name: Build and push Docker image
          uses: docker/build-push-action@v6
          with:
            context: .
            push: true
            tags: |
              ghcr.io/subham12r/dev-presence-api:latest
              ghcr.io/subham12r/dev-presence-api:${{ github.sha }}

        - name: Copy compose file to VPS
          uses: appleboy/scp-action@v0.1.7
          with:
            host: ${{ secrets.SERVER_HOST }}
            username: ${{ secrets.SERVER_USER }}
            key: ${{ secrets.SSH_PRIVATE_KEY }}
            source: docker-compose.yml
            target: ~/dev-presence-api/

        - name: Pull image and restart container
          uses: appleboy/ssh-action@v1.0.3
          with:
            host: ${{ secrets.SERVER_HOST }}
            username: ${{ secrets.SERVER_USER }}
            key: ${{ secrets.SSH_PRIVATE_KEY }}
            script: |
              cd ~/dev-presence-api
              docker compose pull
              docker compose up -d
              docker image prune -f
  ```

- [ ] **Step 2: Understand what each section does**

  | Section | What it does |
  |---|---|
  | `on: push: branches: [main]` | Only fires on push to `main`. PRs and other branches skip deploy entirely. |
  | `permissions: packages: write` | Allows `GITHUB_TOKEN` to push images to ghcr.io. Without this, the push step gets a 403. |
  | `npm ci + npm test` | Runs syntax check before building. If `node --check server.js` fails, the workflow exits here and never deploys a broken image. |
  | `docker/login-action` | Authenticates the Actions runner to `ghcr.io` using the built-in `GITHUB_TOKEN`. No extra secret needed for pushing. |
  | `docker/build-push-action` | Builds the image from `Dockerfile` at repo root, pushes two tags: `latest` (for compose pull) and the commit SHA (for rollback traceability). |
  | `appleboy/scp-action` | Copies `docker-compose.yml` from the runner to `~/dev-presence-api/` on the VPS. This ensures compose changes in the repo are always deployed. |
  | `appleboy/ssh-action` | SSHes into VPS. `docker compose pull` fetches the new `latest` image. `docker compose up -d` recreates the container from it. `docker image prune -f` removes old untagged images. |

- [ ] **Step 3: Make the ghcr.io package public (after first push)**

  After the first workflow run creates the package on ghcr.io, the VPS needs to be able to pull it without authentication. The easiest way is making the package public:

  1. Go to `https://github.com/subham12r?tab=packages`
  2. Click `dev-presence-api`
  3. Click **Package settings** (bottom right)
  4. Scroll to **Danger Zone** → **Change visibility** → **Public** → confirm

  If you need the image private, you can authenticate on the VPS instead. Create a GitHub PAT with `read:packages` scope, save it as `GHCR_TOKEN` in GitHub Secrets, then add this to the SSH `script` before `docker compose pull`:
  ```bash
  echo "$GHCR_TOKEN" | docker login ghcr.io -u subham12r --password-stdin
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add .github/workflows/deploy.yml
  git commit -m "ci: add GitHub Actions deploy workflow"
  ```

---

### Task 4: VPS — Nginx server block + Certbot SSL (one-time manual)

**Files (on VPS, not in repo):**
- Create: `/etc/nginx/sites-available/devpresence`
- Create: `/etc/nginx/sites-enabled/devpresence` (symlink)
- Certbot auto-modifies: `/etc/nginx/sites-available/devpresence` (adds port 443 + cert paths)

**Interfaces:**
- Consumes: Docker container on `127.0.0.1:4000` (running after Task 6)
- Produces: `https://devpresence.monostack.in` → container, with TLS and WebSocket support

SSH into the VPS for all steps in this task:
```bash
ssh subham@<YOUR_VPS_IP>
```

- [ ] **Step 1: Create the Nginx server block**

  ```bash
  sudo nano /etc/nginx/sites-available/devpresence
  ```

  Paste this content exactly:
  ```nginx
  server {
      listen 80;
      server_name devpresence.monostack.in;

      location / {
          proxy_pass http://127.0.0.1:4000;
          proxy_http_version 1.1;
          proxy_set_header Upgrade $http_upgrade;
          proxy_set_header Connection "upgrade";
          proxy_set_header Host $host;
          proxy_set_header X-Real-IP $remote_addr;
          proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
          proxy_set_header X-Forwarded-Proto $scheme;
      }
  }
  ```

  The `Upgrade` and `Connection` headers are required for Socket.IO WebSocket connections. Without them, Socket.IO falls back to HTTP long-polling.

- [ ] **Step 2: Enable the site**

  ```bash
  sudo ln -s /etc/nginx/sites-available/devpresence /etc/nginx/sites-enabled/
  ```

- [ ] **Step 3: Validate and reload Nginx**

  ```bash
  sudo nginx -t
  ```

  Expected output:
  ```
  nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
  nginx: configuration file /etc/nginx/nginx.conf test is successful
  ```

  If you get an error, check for typos in the config file. Then:
  ```bash
  sudo systemctl reload nginx
  ```

- [ ] **Step 4: Issue the SSL certificate**

  ```bash
  sudo certbot --nginx -d devpresence.monostack.in
  ```

  Certbot will:
  1. Verify domain ownership via Cloudflare DNS / HTTP challenge
  2. Issue a Let's Encrypt certificate
  3. Automatically modify `/etc/nginx/sites-available/devpresence` to add the HTTPS server block and HTTP→HTTPS redirect
  4. Set up automatic renewal via systemd timer or cron

  Expected final line:
  ```
  Successfully deployed certificate for devpresence.monostack.in to /etc/nginx/sites-enabled/devpresence
  ```

- [ ] **Step 5: Verify Nginx is still valid after Certbot rewrote the config**

  ```bash
  sudo nginx -t && sudo systemctl reload nginx
  ```

  Expected: same success output as Step 3.

- [ ] **Step 6: Set Cloudflare SSL to Full**

  In Cloudflare dashboard for `monostack.in`:
  1. **SSL/TLS** → **Overview**
  2. Set encryption mode to **Full** (not Flexible, not Full Strict)

  Full = Cloudflare validates the VPS cert is a real cert (Let's Encrypt qualifies). Traffic is encrypted end-to-end.

---

### Task 5: GitHub Secrets + `.env` file on VPS (one-time setup)

**These steps must be done before any deploy workflow can succeed.**

- [ ] **Step 1: Generate an SSH key pair for GitHub Actions (if you don't have one dedicated)**

  On your local machine (or VPS), create a key pair specifically for CI:
  ```bash
  ssh-keygen -t ed25519 -f ~/.ssh/github_actions_deploy -C "github-actions-deploy" -N ""
  ```

  This creates:
  - `~/.ssh/github_actions_deploy` — private key (goes into GitHub Secret)
  - `~/.ssh/github_actions_deploy.pub` — public key (goes onto VPS)

  If you already use an existing key that has VPS access, skip this step and use that key instead.

- [ ] **Step 2: Add the public key to the VPS**

  SSH to VPS and append the public key:
  ```bash
  ssh subham@<YOUR_VPS_IP>
  echo "ssh-ed25519 AAAA...your-public-key-here... github-actions-deploy" >> ~/.ssh/authorized_keys
  chmod 600 ~/.ssh/authorized_keys
  ```

  Replace `ssh-ed25519 AAAA...` with the actual contents of `~/.ssh/github_actions_deploy.pub`.

- [ ] **Step 3: Add GitHub Secrets**

  Go to: `https://github.com/subham12r/dev-presence-api/settings/secrets/actions`

  Add three secrets (click **New repository secret** for each):

  | Secret name | Value |
  |---|---|
  | `SSH_PRIVATE_KEY` | Full contents of `~/.ssh/github_actions_deploy` (copy with `cat ~/.ssh/github_actions_deploy`) |
  | `SERVER_HOST` | Your VPS IP address (e.g. `123.45.67.89`) |
  | `SERVER_USER` | `subham` |

- [ ] **Step 4: Create the app directory and `.env` file on VPS**

  SSH to VPS:
  ```bash
  ssh subham@<YOUR_VPS_IP>
  mkdir -p ~/dev-presence-api
  ```

  Generate a strong secret:
  ```bash
  openssl rand -hex 32
  ```

  Copy the output. Then create `.env`:
  ```bash
  cat > ~/dev-presence-api/.env << 'EOF'
  PORT=4000
  DEV_PRESENCE_SECRET=<paste-the-openssl-output-here>
  REMOTE_STALE_AFTER_MS=120000
  EOF
  ```

  Verify it looks right:
  ```bash
  cat ~/dev-presence-api/.env
  ```

  Expected — three lines, no placeholder text:
  ```
  PORT=4000
  DEV_PRESENCE_SECRET=a3f8c2...64 hex chars
  REMOTE_STALE_AFTER_MS=120000
  ```

---

### Task 6: First deploy and smoke test

**This task verifies the full pipeline works end-to-end.**

- [ ] **Step 1: Push the branch and open a PR to main (or push directly)**

  If your repo has branch protection on `main`, merge via PR. Otherwise:
  ```bash
  git checkout main
  git merge feat/dev-presence-improvements --no-ff
  git push origin main
  ```

- [ ] **Step 2: Watch the Actions run**

  Go to: `https://github.com/subham12r/dev-presence-api/actions`

  The `Deploy` workflow appears. Each step should go green. Total time: ~2-3 minutes.

  If a step fails:
  - **`Run checks` fails** → syntax error in `server.js`; fix and push again
  - **`Build and push` fails with 403** → `permissions: packages: write` missing or package not yet created; check Task 3 Step 1
  - **`Copy compose file` or `Pull and restart` fails** → SSH key problem; verify the public key is in `~/.ssh/authorized_keys` on VPS and the private key in `SSH_PRIVATE_KEY` secret matches

- [ ] **Step 3: Verify the API responds**

  ```bash
  curl -s https://devpresence.monostack.in/status
  ```

  Expected:
  ```json
  {"status":"offline","effectiveStatus":"offline","isActive":false,"stale":true,...,"receivedAt":0}
  ```

- [ ] **Step 4: Test that POST /activity works**

  Replace `<your-secret>` with the value you set for `DEV_PRESENCE_SECRET` in `.env`:
  ```bash
  curl -s -X POST https://devpresence.monostack.in/activity \
    -H "Authorization: Bearer <your-secret>" \
    -H "Content-Type: application/json" \
    -d '{"status":"coding","isActive":true,"editor":"Cursor","project":"dev-presence-api"}'
  ```

  Expected: `{"ok":true}`

  Then confirm status updated:
  ```bash
  curl -s https://devpresence.monostack.in/status | grep -o '"status":"[^"]*"'
  ```

  Expected: `"status":"coding"`

- [ ] **Step 5: Verify WebSocket upgrade works**

  ```bash
  curl -s -I --http1.1 \
    -H "Connection: Upgrade" \
    -H "Upgrade: websocket" \
    -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
    -H "Sec-WebSocket-Version: 13" \
    "https://devpresence.monostack.in/socket.io/?EIO=4&transport=websocket"
  ```

  Expected first line: `HTTP/1.1 101 Switching Protocols`

  If you see `200 OK` instead, the WebSocket upgrade is not working — check the `Upgrade` and `Connection` headers in the Nginx config (Task 4 Step 1).

- [ ] **Step 6: Verify restart policy on VPS**

  SSH to VPS:
  ```bash
  docker inspect dev-presence-api-api-1 --format='{{.HostConfig.RestartPolicy.Name}}'
  ```

  Expected: `unless-stopped`

  If the container name differs, find it with `docker ps`.

- [ ] **Step 7: Update the VS Code extension API URL**

  In the extension settings, update the remote API URL to:
  ```
  https://devpresence.monostack.in
  ```

  The extension's `POST /activity` calls will now hit your self-hosted VPS instead of Digital Ocean.
