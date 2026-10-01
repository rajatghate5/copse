#!/usr/bin/env bash
# Run Copse locally: the server (API + WebSocket on :4040) and the Vite web client
# together. The web client proxies /api and /ws to the server, so everything is
# same-origin and the session cookie just works.
#
# Usage:
#   ./dev.sh                        # uses the default dev secret below
#   COPSE_BOOTSTRAP=mysecret ./dev.sh
#
# Then open the URL Vite prints and visit it with ?bootstrap=<secret> once to
# create the first room and become its admin. Ctrl+C stops both.

set -euo pipefail
cd "$(dirname "$0")"

export COPSE_BOOTSTRAP="${COPSE_BOOTSTRAP:-dev-secret}"

echo "──────────────────────────────────────────────"
echo " Copse dev"
echo " bootstrap secret : $COPSE_BOOTSTRAP"
echo " server           : http://localhost:4040"
echo " first room       : open the Vite URL with  ?bootstrap=$COPSE_BOOTSTRAP"
echo "──────────────────────────────────────────────"

# Start the server in the background and make sure it dies with this script.
bun run serve &
SERVER_PID=$!
trap 'echo; echo "stopping Copse..."; kill "$SERVER_PID" 2>/dev/null || true' EXIT INT TERM

# Give it a moment to bind the port, then run the web client in the foreground.
sleep 1
bun run dev
