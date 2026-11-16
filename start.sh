#!/usr/bin/env bash
# Start/stop the yetu-vfy agent server + public tunnel + watchdog.
# Usage: ./start.sh [start|stop|restart|status]   (default: start)
# Public URL (fixed subdomain): https://yetu-vfy.loca.lt
# NOTE: this VM's egress is proxy-only, so the tunnel is localtunnel
# (patched client in tunnel-client/) — its data channel uses a random high
# port, which the egress proxy handles slowly/unreliably. The tunnel works
# (verified end-to-end) but can drop; the watchdog restarts it, and the
# fixed subdomain keeps the public URL stable. For a rock-solid endpoint,
# run this same repo on a host with direct internet (VPS / user PC) — there
# cloudflared works too (see DEPLOY.md).
set -u
cd "$(dirname "$0")"
PORT="${PORT:-3000}"
SUBDOMAIN="${LT_SUBDOMAIN:-yetu-vfy}"

server_pid() { pgrep -f "node server.js" | head -1; }
server_loop_pid() { pgrep -f "while true; do node server.js" | head -1; }
tunnel_pid() { pgrep -f "node tunnel-client/run.js" | head -1; }
tunnel_loop_pid() { pgrep -f "while true; do node tunnel-client/run.js" | head -1; }
watchdog_pid() { pgrep -f "tunnel-watchdog.sh _run" | head -1; }

do_stop() {
  local p
  for p in "$(server_loop_pid || true)" "$(server_pid || true)" "$(tunnel_loop_pid || true)" "$(tunnel_pid || true)" "$(watchdog_pid || true)"; do
    [ -n "${p:-}" ] && kill "$p" 2>/dev/null && echo "stopped $p"
  done
  sleep 1
}

case "${1:-start}" in
  stop) do_stop ;;
  restart) do_stop; sleep 1; exec "$0" start ;;
  status)
    echo "server:  $(server_pid || echo down)  (loop $(server_loop_pid || echo down))"
    echo "tunnel:  $(tunnel_pid || echo down)  (loop $(tunnel_loop_pid || echo down))"
    echo "watchdog: $(watchdog_pid || echo down)"
    echo "public URL: $(cat tunnel-client/url.txt 2>/dev/null || echo '(none yet)')"
    curl -s --max-time 10 http://127.0.0.1:${PORT}/health 2>/dev/null | head -c 200; echo
    ;;
  start)
    if [ -n "$(server_loop_pid || true)" ]; then echo "server loop already running"; else
      nohup bash -c 'while true; do node server.js >> server.log 2>&1; echo "[$(date -Is)] server exited, restarting in 2s" >> server.log; sleep 2; done' >/dev/null 2>&1 &
      echo "server loop started"
    fi
    if [ -n "$(tunnel_loop_pid || true)" ]; then echo "tunnel loop already running"; else
      nohup bash -c "while true; do node tunnel-client/run.js ${PORT} ${SUBDOMAIN} >> tunnel-lt.log 2>&1; echo \"[\$(date -Is)] tunnel exited, restarting in 3s\" >> tunnel-lt.log; sleep 3; done" >/dev/null 2>&1 &
      echo "tunnel loop started (subdomain ${SUBDOMAIN})"
    fi
    if [ -n "$(watchdog_pid || true)" ]; then echo "watchdog already running"; else
      ./tunnel-watchdog.sh start
    fi
    echo "public URL (after ~30-60s): https://${SUBDOMAIN}.loca.lt"
    ;;
esac
