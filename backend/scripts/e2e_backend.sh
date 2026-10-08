#!/usr/bin/env bash
# Starts an ISOLATED backend for end-to-end tests: same database server as DATABASE_URL (or SQLite when that is unset) but its
# own schema, its own throw-away admin and no production data. Test credentials below are for this isolated run only.
#   scripts/e2e_backend.sh start | stop | restart | drop | bootstrap
# 'bootstrap' runs the real providers once (weather, terrain, river, rainfall history, Sentinel-1) into the isolated schema.
set -euo pipefail
cd "$(dirname "$0")/.."
PIDFILE=/tmp/riskn_e2e_backend.pid
export DB_SCHEMA="${E2E_SCHEMA:-e2e}"
export ADMIN_EMAIL="e2e-admin@test.local"
export ADMIN_PASSWORD="E2e-admin-pass-1"
export ADMIN_NAME="E2E Admin"
export AUTH_RATE_LIMIT_PER_MINUTE=500 RATE_LIMIT_PER_MINUTE=2000
export WEATHER_MONITOR_ENABLED="${WEATHER_MONITOR_ENABLED:-1}" INTEL_ENABLED=0
stop() {
  if [ -f "$PIDFILE" ]; then
    local pid; pid="$(cat "$PIDFILE")"
    kill "$pid" 2>/dev/null || true
    for i in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done   # wait for a graceful exit (the port is freed then)
    kill -9 "$pid" 2>/dev/null || true
    rm -f "$PIDFILE"
  fi
}
start() {
  stop
  local port="${E2E_PORT:-8000}"
  if curl -sf "http://127.0.0.1:${port}/health" >/dev/null 2>&1; then
    echo "port ${port} is already in use (is your normal backend running? stop it first, or set E2E_PORT)." >&2; exit 1
  fi
  python3 -m uvicorn main:app --host 127.0.0.1 --port "$port" > /tmp/riskn_e2e_backend.log 2>&1 &
  local pid=$!
  echo $pid > "$PIDFILE"
  for i in $(seq 1 60); do
    kill -0 "$pid" 2>/dev/null || { echo "e2e backend exited during start; see /tmp/riskn_e2e_backend.log" >&2; exit 1; }
    curl -sf "http://127.0.0.1:${port}/health" >/dev/null && { echo "e2e backend up (pid $pid, schema $DB_SCHEMA)"; return; }
    sleep 1
  done
  echo "e2e backend did not become healthy; see /tmp/riskn_e2e_backend.log" >&2; exit 1
}
case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  bootstrap) python3 scripts/refresh_intelligence.py 2>&1 | grep -vE "^INFO|httpx" ;;
  drop) stop; python3 - <<'PY'
import db
if db.BACKEND == "postgres":
    db.drop_schema(db._PG_SCHEMA); print("dropped schema", db._PG_SCHEMA)
PY
  ;;
esac
