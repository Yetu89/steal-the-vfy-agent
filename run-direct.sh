#!/usr/bin/env bash
# Jalankan/matikan server + cloudflared quick tunnel di host langsung.
# Usage: ./run-direct.sh [start|stop|restart|status]   (default: start)
# URL publik tersimpan di url.txt (berubah tiap tunnel restart — quick tunnel).
# Loop supervisor: tiap loop hanya nyalakan prosesnya kalau belum jalan,
# jadi start aman diulang kapan saja tanpa duplikat.
set -u
cd "$(dirname "$0")"
PORT="${PORT:-3000}"

# Pola pgrep ANCHORED (^...$) supaya tidak match shell loop / shell pemanggil.
server_proc() { pgrep -f '^node server\.js$' | head -1; }
tunnel_proc() { pgrep -f '^cloudflared tunnel --protocol http2 --url' | head -1; }
server_loop() { pgrep -f 'yetu-vfy-server-loop' | head -1; }
tunnel_loop() { pgrep -f 'yetu-vfy-tunnel-loop' | head -1; }

do_stop() {
  local p
  for p in "$(tunnel_loop || true)" "$(tunnel_proc || true)" "$(server_loop || true)" "$(server_proc || true)"; do
    if [ -n "${p:-}" ]; then kill "$p" 2>/dev/null && echo "stopped $p"; fi
  done
  sleep 1
}

start_loop() {
  local kind="$1"
  if [ "$kind" = server ]; then
    if [ -n "$(server_loop || true)" ]; then echo "server loop already running"; return; fi
    nohup bash -c 'while true; do if ! pgrep -f "^node server\.js$" >/dev/null; then node server.js >> server.log 2>&1; fi; sleep 5; done # yetu-vfy-server-loop' >/dev/null 2>&1 &
    echo "server loop started"
  else
    if [ -n "$(tunnel_loop || true)" ]; then echo "tunnel loop already running"; return; fi
    nohup bash -c 'while true; do if ! pgrep -f "^cloudflared tunnel --protocol http2 --url" >/dev/null; then cloudflared tunnel --protocol http2 --url http://localhost:3000 >> cloudflared.log 2>&1; fi; sleep 5; done # yetu-vfy-tunnel-loop' >/dev/null 2>&1 &
    echo "tunnel loop started"
  fi
}

case "${1:-start}" in
  stop) do_stop ;;
  restart) do_stop; sleep 1; start_loop server; start_loop tunnel; echo "URL publik muncul di cloudflared.log / url.txt setelah ~20 detik" ;;
  status)
    echo "server proc: $(server_proc || echo down) | loop: $(server_loop || echo down)"
    echo "tunnel proc: $(tunnel_proc || echo down) | loop: $(tunnel_loop || echo down)"
    echo "public URL: $(cat url.txt 2>/dev/null || echo '(none yet)')"
    curl -s --max-time 10 "http://127.0.0.1:${PORT}/health" 2>/dev/null | head -c 200; echo
    ;;
  start)
    start_loop server
    start_loop tunnel
    echo "URL publik muncul di cloudflared.log / url.txt setelah ~20 detik"
    ;;
esac
