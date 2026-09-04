#!/usr/bin/env bash
# Starts both services and stops both on Ctrl-C.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cleanup() { echo; echo "stopping..."; kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "parser -> http://127.0.0.1:8000"
( cd "$ROOT/frontend/api" && python -m uvicorn _boe.main:app --host 127.0.0.1 --port 8000 ) &

sleep 2

echo "portal -> http://localhost:3000"
( cd "$ROOT/frontend" && npm run dev ) &

wait
