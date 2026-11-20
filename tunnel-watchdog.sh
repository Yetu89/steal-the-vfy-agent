#!/usr/bin/env bash
# Watchdog for the yetu-vfy tunnel: polls the public /health every 30s.
# If it fails 3 times in a row, restarts the tunnel client (same fixed
# subdomain, so the public URL does not change). Logs to watchdog.log.
# Usage: ./tunnel-watchdog.sh [start|stop]   (default: start)
set -u
cd "$(dirname "$0")"
URL_FILE="$PWD/tunnel-client/url.txt"
LOG="$PWD/watchdog.log"

log() { echo "[$(date -Is)] $*" >> "$LOG"; }

tunnel_pid() { pgrep -f "^node tunnel-client/run.js" | head -1; }

do_watch() {
  local fails=0
  while true; do
    sleep 30
    # If the client died (e.g. its 45s no-URL self-exit on a dead relay
    # port), start a fresh one at once so we keep trying new relay ports
    # instead of waiting out the health-failure counter.
    if [ -z "$(tunnel_pid)" ]; then
      log "no tunnel client running — starting one (fresh allocation)"
      (nohup node tunnel-client/run.js 3000 yetu-vfy >> tunnel-lt.log 2>&1 &)
      sleep 20
      continue
    fi
    local url=""
    [ -f "$URL_FILE" ] && url="$(cat "$URL_FILE" | tr -d '[:space:]')"
    local code="000"
    if [ -n "$url" ]; then
      code="$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$url/health" 2>/dev/null || echo 000)"
    fi
    if [ "$code" = "200" ]; then
      fails=0
    else
      fails=$((fails + 1))
      log "health check failed (code=$code) fail#$fails url=$url"
      if [ "$fails" -ge 10 ]; then
        log "restarting tunnel client (10 consecutive failures)"
        local pid
        pid="$(tunnel_pid || true)"
        [ -n "${pid:-}" ] && kill "$pid" 2>/dev/null
        sleep 2
        (nohup node tunnel-client/run.js 3000 yetu-vfy >> tunnel-lt.log 2>&1 &)
        log "tunnel client restarted"
        fails=0
        sleep 60
      fi
    fi
  done
}

case "${1:-start}" in
  stop)
    pid="$(pgrep -f "tunnel-watchdog.sh" | grep -v "$$" | head -1 || true)"
    [ -n "${pid:-}" ] && kill "$pid" 2>/dev/null && echo "watchdog stopped ($pid)"
    ;;
  start)
    if pgrep -f "tunnel-watchdog.sh" | grep -v "$$" | grep -q .; then
      echo "watchdog already running"
    else
      (nohup bash "$0" _run >> "$LOG" 2>&1 &)
      echo "watchdog started"
    fi
    ;;
  _run) do_watch ;;
esac
