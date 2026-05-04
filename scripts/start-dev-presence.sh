#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
AGENT_PATH="$REPO_ROOT/dev-presence-extension"
WATCHER_PATH="$AGENT_PATH/zed-watcher.js"
PROJECT_PATH="${1:-.}"
NO_ZED="${2:-}"

start_bg() {
    local name="$1"
    local cmd="$2"
    local cwd="$3"

    if pgrep -f "$name" > /dev/null 2>&1; then
        echo "[$name] Already running"
        return
    fi

    echo "[$name] Starting..."
    (
        cd "$cwd"
        nohup bash -c "$cmd" > /dev/null 2>&1 &
    )
    echo "[$name] Started in background"
}

# Start agent
start_bg "agent/server.js" "npm run agent" "$AGENT_PATH"

sleep 0.5

# Start zed watcher
start_bg "zed-watcher.js" "node zed-watcher.js" "$AGENT_PATH"

# Open Zed
if [ "$NO_ZED" != "--no-zed" ]; then
    if command -v zed >/dev/null 2>&1; then
        echo "[Zed] Opening project..."
        zed "$PROJECT_PATH"
    elif command -v zeditor >/dev/null 2>&1; then
        echo "[Zed] Opening project..."
        zeditor "$PROJECT_PATH"
    else
        echo "[Zed] 'zed' or 'zeditor' command not found. Please open Zed manually."
    fi
fi
