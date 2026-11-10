#!/usr/bin/env bash
# Start the UnnaturalLight show server (server/server.ts): serves the console
# and stage, holds the show and drives the DMX USB Pro(s).
#
#   ./server.sh                 this machine only, port 8080; restarts itself when
#                               a file the server runs changes (development)
#   ./server.sh 9000            another port
#   ./server.sh --lan           also let other machines on the network in (token printed)
#   ./server.sh --fake-dmx      pretend a DMX USB Pro is connected (testing)
#   ./server.sh --no-open       don't open a browser
#   ./server.sh --nowatch       don't restart on file changes (use this for a show)
#
# Art-Net / sACN outputs: server/data/network.json (see README, Network DMX).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "error: node not found (install Node.js 22.13 or newer: https://nodejs.org)" >&2
  exit 1
fi

if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  echo "==> Installing dependencies…"
  npm install --no-fund --no-audit
  touch node_modules
fi

NODE=(node --experimental-strip-types --disable-warning=ExperimentalWarning)

# Watch mode (the default for now; --nowatch turns it off): Node restarts the
# server whenever a .ts file it has loaded changes
# (server/ and whatever it imports from console/ and shared/). Browser-only
# files never need a restart: a page reload picks them up. Each restart re-runs
# the server with the same arguments, so the browser is opened once from here
# (when the server first answers) instead of by every restart.
WATCH=1; OPEN=1; PORT=8080; ARGS=()
for a in "$@"; do
  case "$a" in
    --nowatch|--no-watch) WATCH=0 ;;
    --no-open) OPEN=0 ;;
    *) [[ "$a" =~ ^[0-9]+$ ]] && PORT="$a"; ARGS+=("$a") ;;
  esac
done

if [ "$WATCH" = 0 ]; then
  [ "$OPEN" = 0 ] && ARGS+=(--no-open)
  exec "${NODE[@]}" server/server.ts ${ARGS[@]+"${ARGS[@]}"}
fi

if [ "$OPEN" = 1 ] && [ "$(uname)" = Darwin ]; then
  ( for _ in $(seq 100); do
      curl -fs -o /dev/null "http://localhost:$PORT/index.html" && { open "http://localhost:$PORT/index.html"; exit; }
      sleep 0.2
    done ) &
fi
exec "${NODE[@]}" --watch --watch-preserve-output server/server.ts --no-open ${ARGS[@]+"${ARGS[@]}"}
