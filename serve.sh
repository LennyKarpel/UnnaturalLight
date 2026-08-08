#!/usr/bin/env bash
# Web Serial requires http://localhost (not file://)
cd "$(dirname "$0")"
PORT="${1:-8080}"
echo "UnnaturalLight → http://localhost:${PORT}"
python3 -m http.server "$PORT"
