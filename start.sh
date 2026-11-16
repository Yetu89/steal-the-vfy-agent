#!/usr/bin/env bash
# Start/stop the yetu-vfy agent server + Cloudflare quick tunnel.
# Usage: ./start.sh [start|stop|restart]   (default: start)
set -u
cd "$(dirname "$0")"
CLOUDFLARED="${CLOUDFLARED:-$HOME/workspace/bin/cloudflared}"
PORT="${PORT:-3000}"

server_pid() { pgrep -f "node server.js" | head -1; }
tunnel_pid() { pgrep -f "cloudflared tunnel --url http://localhost:${PORT}" | head -1; }

do_stop() {
  local sp tp
  sp="$(server_pid || true)"; tp="$(tunnel_pid || true)"
  [ -n "${sp:-}" ] && kill "$sp" 2>/dev/null && echo "server stopped ($sp)"
  [ -n "${tp:-}" ] && kill "$tp" 2>/dev/null && echo "tunnel stopped ($tp)"
  sleep 1
}

case "${1:-start}" in
  stop) do_stop ;;
  restart) do_stop; sleep 1; exec "$0" start ;;
  start)
    if [ -n "$(server_pid || true)" ]; then echo "server already running ($(server_pid))"; else
      # Restart loop: if the server crashes, bring it back after 2s.
      nohup bash -c 'while true; do node server.js >> server.log 2>&1; echo "[$(date -Is)] server exited, restarting in 2s" >> server.log; sleep 2; done' >/dev/null 2>&1 &
      echo "server started"
    fi
    if [ -n "$(tunnel_pid || true)" ]; then echo "tunnel already running ($(tunnel_pid))"; else
      if [ ! -x "$CLOUDFLARED" ]; then echo "cloudflared not found at $CLOUDFLARED"; exit 1; fi
      nohup "$CLOUDFLARED" tunnel --url "http://localhost:${PORT}" >> tunnel.log 2>&1 &
      echo "tunnel started — wait ~10s then check tunnel.log for the https://*.trycloudflare.com URL"
    fi
    ;;
esac
