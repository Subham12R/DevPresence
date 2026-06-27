#!/usr/bin/env bash
set -euo pipefail

PID_DIR="/tmp"
WATCHER_PID_FILE="$PID_DIR/devpresence-watcher.pid"
WATCHDOG_PID_FILE="$PID_DIR/devpresence-watchdog.pid"
AGENT_URL="${DEV_PRESENCE_AGENT_URL:-http://127.0.0.1:7337}"

show_help() {
    cat <<EOF
Usage: devpresence [status] [--help]

Commands:
  status    Show health of agent, watchdog, zed, and watcher
  --help    Show this help message
EOF
    exit 0
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    show_help
fi

check_agent() {
    local status
    local body
    status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "$AGENT_URL/status" 2>/dev/null || echo "000")
    if [[ "$status" == "200" ]]; then
        body=$(curl -s --max-time 3 "$AGENT_URL/status" 2>/dev/null || echo "{}")
        echo "HEALTHY|$body"
    else
        echo "UNHEALTHY|Agent returned HTTP $status"
    fi
}

check_pid() {
    local pidfile="$1"
    if [[ -f "$pidfile" ]]; then
        local pid
        pid=$(cat "$pidfile" 2>/dev/null || echo "")
        if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
            echo "RUNNING|$pid"
            return
        fi
    fi
    echo "STOPPED|"
}

check_zed() {
    if pgrep -x zed >/dev/null 2>&1 || pgrep -x zeditor >/dev/null 2>&1; then
        echo "RUNNING"
    else
        echo "STOPPED"
    fi
}

# Gather data
agent_result=$(check_agent)
agent_status=$(echo "$agent_result" | cut -d'|' -f1)
agent_body=$(echo "$agent_result" | cut -d'|' -f2-)

watchdog_result=$(check_pid "$WATCHDOG_PID_FILE")
watchdog_status=$(echo "$watchdog_result" | cut -d'|' -f1)
watchdog_pid=$(echo "$watchdog_result" | cut -d'|' -f2)

zed_status=$(check_zed)

watcher_result=$(check_pid "$WATCHER_PID_FILE")
watcher_status=$(echo "$watcher_result" | cut -d'|' -f1)
watcher_pid=$(echo "$watcher_result" | cut -d'|' -f2)

# Output
echo ""
echo "Dev Presence Status"
echo "========================================"
echo ""

if [[ "$agent_status" == "HEALTHY" ]]; then
    status=$(echo "$agent_body" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','unknown'))" 2>/dev/null || echo "unknown")
    editor=$(echo "$agent_body" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('editor',''))" 2>/dev/null || echo "")
    project=$(echo "$agent_body" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('project',''))" 2>/dev/null || echo "")
    file=$(echo "$agent_body" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('file',''))" 2>/dev/null || echo "")
    lang=$(echo "$agent_body" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('language',''))" 2>/dev/null || echo "")

    printf "✅ Agent    : Running (%s" "$status"
    [[ -n "$editor" ]] && printf " | %s" "$editor"
    [[ -n "$project" ]] && printf " | %s" "$project"
    [[ -n "$file" ]] && printf " | %s" "$file"
    [[ -n "$lang" ]] && printf " | %s" "$lang"
    printf ")\n"
else
    echo "❌ Agent    : Stopped"
fi

if [[ "$watchdog_status" == "RUNNING" ]]; then
    echo "✅ Watchdog : Running (PID $watchdog_pid)"
else
    echo "❌ Watchdog : Stopped"
fi

if [[ "$zed_status" == "RUNNING" ]]; then
    echo "✅ Zed      : Running"
else
    echo "❌ Zed      : Not running"
fi

if [[ "$watcher_status" == "RUNNING" ]]; then
    echo "✅ Watcher  : Running (PID $watcher_pid)"
else
    echo "❌ Watcher  : Stopped"
fi

echo ""

if [[ "$agent_status" != "HEALTHY" ]]; then
    echo "Tip: Start the agent with 'npm run agent' in dev-presence-extension/"
fi
if [[ "$watchdog_status" == "RUNNING" && "$zed_status" == "STOPPED" ]]; then
    echo "Tip: Watcher is stopped because Zed is not running. Open Zed to start tracking."
fi
if [[ "$watchdog_status" == "STOPPED" ]]; then
    echo "Tip: Run the install script to set up auto-start."
fi
