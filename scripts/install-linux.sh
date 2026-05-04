#!/usr/bin/env bash
set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPTS_DIR/.." && pwd)"
AGENT_PATH="$REPO_ROOT/dev-presence-extension"
WATCHDOG_PATH="$AGENT_PATH/watchdog.js"

if [[ "${1:-}" == "--uninstall" ]]; then
    echo "Uninstalling Dev Presence systemd services..."

    systemctl --user stop devpresence-agent 2>/dev/null || true
    systemctl --user stop devpresence-watchdog 2>/dev/null || true
    systemctl --user disable devpresence-agent 2>/dev/null || true
    systemctl --user disable devpresence-watchdog 2>/dev/null || true

    rm -f ~/.config/systemd/user/devpresence-agent.service
    rm -f ~/.config/systemd/user/devpresence-watchdog.service

    systemctl --user daemon-reload

    rm -f /tmp/devpresence-watcher.pid
    rm -f /tmp/devpresence-watchdog.pid

    echo "Done. You may also want to stop running node processes manually."
    exit 0
fi

echo "Installing Dev Presence systemd services..."
echo "Repo root: $REPO_ROOT"

if [[ ! -f "$WATCHDOG_PATH" ]]; then
    echo "Error: watchdog.js not found at $WATCHDOG_PATH"
    exit 1
fi

mkdir -p ~/.config/systemd/user

# 1. Agent service
cat > ~/.config/systemd/user/devpresence-agent.service <<EOF
[Unit]
Description=Dev Presence Agent
After=network.target

[Service]
Type=simple
ExecStart=$(which node) $AGENT_PATH/agent/server.js
WorkingDirectory=$AGENT_PATH
Restart=always
RestartSec=10
StandardOutput=append:/tmp/devpresence-agent.log
StandardError=append:/tmp/devpresence-agent.log

[Install]
WantedBy=default.target
EOF

# 2. Watchdog service
cat > ~/.config/systemd/user/devpresence-watchdog.service <<EOF
[Unit]
Description=Dev Presence Watchdog
After=devpresence-agent.service
Requires=devpresence-agent.service

[Service]
Type=simple
ExecStart=$(which node) $WATCHDOG_PATH
WorkingDirectory=$AGENT_PATH
Environment="DEV_PRESENCE_WATCH_PATH=$(dirname "$REPO_ROOT")"
Restart=always
RestartSec=10
StandardOutput=append:/tmp/devpresence-watchdog.log
StandardError=append:/tmp/devpresence-watchdog.log

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable devpresence-agent
systemctl --user enable devpresence-watchdog
systemctl --user start devpresence-agent
sleep 1
systemctl --user start devpresence-watchdog

echo ""
echo "Done! Dev Presence will auto-start on login."
echo "Run 'devpresence status' to check health."
echo "Run this script with --uninstall to remove."
