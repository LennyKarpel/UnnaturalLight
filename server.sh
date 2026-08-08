#!/usr/bin/env bash
# Web Serial requires http://localhost (not file://).
# No-cache headers so Cmd+R always picks up HTML/JS/CSS changes.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

PORT="${1:-8080}"
export UNNATURALLIGHT_PORT="$PORT"
export UNNATURALLIGHT_ROOT="$ROOT"

echo "==> UnnaturalLight server"
echo "    directory : ${ROOT}"
echo "    port      : ${PORT}"
echo "    url       : http://localhost:${PORT}/index.html"
echo "    cache     : disabled (no-store)"
echo "    stop      : Ctrl+C"
echo

if ! command -v python3 >/dev/null 2>&1; then
  echo "error: python3 not found" >&2
  exit 1
fi

echo "==> Starting python3 http server…"
exec python3 - <<'PY'
import os
import signal
import sys
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("UNNATURALLIGHT_PORT", "8080"))
ROOT = os.environ.get("UNNATURALLIGHT_ROOT", os.getcwd())
URL = f"http://localhost:{PORT}/index.html"

class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

httpd = ThreadingHTTPServer(("127.0.0.1", PORT), NoCacheHandler)
httpd.daemon_threads = True
httpd.allow_reuse_address = True

print(f"==> Listening on http://127.0.0.1:{PORT}", flush=True)
print(f"==> Serving files from {ROOT}", flush=True)
print(f"==> Opening {URL}", flush=True)
webbrowser.open(URL)
print("==> Ready.", flush=True)

def stop(signum, frame):
    print(f"\n==> Signal {signum} received, shutting down…", flush=True)
    raise KeyboardInterrupt

signal.signal(signal.SIGINT, stop)
signal.signal(signal.SIGTERM, stop)

try:
    httpd.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    print("==> Closing server socket…", flush=True)
    httpd.shutdown()
    httpd.server_close()
    print("==> Stopped.", flush=True)
    sys.exit(0)
PY
