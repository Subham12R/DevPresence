#!/usr/bin/env bash
set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPTS_DIR/.." && pwd)"
AGENT_PATH="$REPO_ROOT/dev-presence-extension"
WATCHDOG_PATH="$AGENT_PATH/watchdog.js"

if [[ "${1:-}" == "--uninstall" ]]; then
    echo "Uninstalling Dev Presence LaunchAgents..."

    launchctl unload ~/Library/LaunchAgents/com.devpresence.agent.plist 2>/dev/null || true
    launchctl unload ~/Library/LaunchAgents/com.devpresence.watchdog.plist 2>/dev/null || true

    rm -f ~/Library/LaunchAgents/com.devpresence.agent.plist
    rm -f ~/Library/LaunchAgents/com.devpresence.watchdog.plist

    rm -f /tmp/devpresence-watcher.pid
    rm -f /tmp/devpresence-watchdog.pid

    echo "Done. You may also want to stop running node processes manually."
    exit 0
fi

echo "Installing Dev Presence LaunchAgents..."
echo "Repo root: $REPO_ROOT"

if [[ ! -f "$WATCHDOG_PATH" ]]; then
    echo "Error: watchdog.js not found at $WATCHDOG_PATH"
    exit 1
fi

mkdir -p ~/Library/LaunchAgents

# 1. Agent LaunchAgent
cat > ~/Library/LaunchAgents/com.devpresence.agent.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.devpresence.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>$(which node)</string>
        <string>$AGENT_PATH/agent/server.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$AGENT_PATH</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>StandardOutPath</key>
    <string>/tmp/devpresence-agent.out</string>
    <key>StandardErrorPath</key>
    <string>/tmp/devpresence-agent.err</string>
</dict>
</plist>
EOF

# 2. Watchdog LaunchAgent
cat > ~/Library/LaunchAgents/com.devpresence.watchdog.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.devpresence.watchdog</string>
    <key>ProgramArguments</key>
    <array>
        <string>$(which node)</string>
        <string>$WATCHDOG_PATH</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$AGENT_PATH</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>DEV_PRESENCE_WATCH_PATH</key>
        <string>$(dirname "$REPO_ROOT")</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>StandardOutPath</key>
    <string>/tmp/devpresence-watchdog.out</string>
    <key>StandardErrorPath</key>
    <string>/tmp/devpresence-watchdog.err</string>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/com.devpresence.agent.plist
launchctl load ~/Library/LaunchAgents/com.devpresence.watchdog.plist

echo ""
echo "Done! Dev Presence will auto-start on login."
echo "Run 'devpresence status' to check health."
echo "Run this script with --uninstall to remove."
