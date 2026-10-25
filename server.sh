#!/usr/bin/env bash
# Start the UnnaturalLight show server (server/server.js): serves the console
# and stage, holds the show and drives the DMX USB Pro(s).
#
#   ./server.sh                 this machine only, port 8080
#   ./server.sh 9000            another port
#   ./server.sh --lan           also let other machines on the network in (token printed)
#   ./server.sh --fake-dmx      pretend a DMX USB Pro is connected (testing)
#   ./server.sh --no-open       don't open a browser
#
# Art-Net / sACN outputs: server/data/network.json (see README, Network DMX).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "error: node not found (install Node.js 20 or newer: https://nodejs.org)" >&2
  exit 1
fi

if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  echo "==> Installing dependencies…"
  npm install --no-fund --no-audit
  touch node_modules
fi

exec node server/server.js "$@"
