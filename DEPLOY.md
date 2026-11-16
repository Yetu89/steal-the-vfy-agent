# Deployment — yetu-vfy agent

## Stack

- **Server:** Node 18+ (stdlib only), `node server.js`, listens on `$PORT`
  (default 3000) on localhost. Restart loop in `start.sh`.
- **Public HTTPS:** localtunnel, fixed subdomain **`yetu-vfy`** →
  **https://yetu-vfy.loca.lt** (free, no account, standard 443).
  The client is a patched localtunnel 2.0.2 in `tunnel-client/` (see
  `tunnel-client/README.md`): it does its own HTTP CONNECT through the
  sandbox egress proxy, because the stock client bypasses the proxy and
  hangs. Restart loop in `start.sh`; health watchdog in
  `tunnel-watchdog.sh` (polls the public `/health` every 30s, restarts the
  tunnel after 3 consecutive failures — the fixed subdomain keeps the URL
  stable across restarts).
- **Persistence:** `./start.sh` starts server loop + tunnel loop +
  watchdog. Check status with `./start.sh status`.

## Start / restart

```bash
cd ~/workspace/agent-games
./start.sh          # starts everything
./start.sh status   # server/tunnel/watchdog PIDs + local /health
./start.sh stop     # stops everything
./start.sh restart  # stop + start
```

The tunnel needs ~30-60s after (re)start before the public URL answers
(the data channel connects slowly through the proxy). Verify with:
`curl https://yetu-vfy.loca.lt/health` → `{"protocol":"v1",...}`.

## HMAC secret (after dashboard registration)

The platform shows the secret **once** at registration. Set it and restart:

```bash
# in ~/workspace/agent-games/.env
AGENT_GAMES_HMAC_SECRET=<secret from dashboard>
./start.sh restart
```

Until the secret is set, `GET /health` still works (so the platform health
check passes), but signed turns and the preflight return 500. The strategy
salt + commitment are already in `.env` on the host — do NOT copy them
into the repo.

## Reliability caveat (read this)

This VM's egress is **proxy-only** (HTTP CONNECT). Two consequences:

1. **cloudflared does NOT work here** — it ignores the proxy env vars and
   its TLS handshake to `api.trycloudflare.com` fails
   ("first record does not look like a TLS handshake"). Tried and confirmed.
2. **localtunnel works but is flaky here** — the allocation (port 443) is
   fast, but the data channel connects to a random high port, which the
   egress proxy handles very slowly (6-25s to connect, sometimes hangs for
   minutes) and can silently drop. End-to-end it IS verified working
   (signed POST → signed response → Groth16 proof verifies, 1.4s when the
   tunnel is up), but under bursts it can return 408 (only 2 concurrent
   tunnel connections) and idle connections can die silently. The watchdog
   + restart loop + fixed subdomain mitigate this, but they cannot make it
   rock-solid.

**Recommendation for the matches:** run this same repo on a host with
direct internet (user VPS / PC). There, `cloudflared tunnel --protocol http2
--url http://localhost:3000` (or the stock localtunnel client) gives a
stable public HTTPS endpoint with no proxy in the way. The code, the
strategy, the commitment and the HMAC handling are identical — only the
tunnel command changes. If ngrok is available, it is also a good fit
(443 data channel + proxy-aware client) but needs a free account/authtoken.

## Failure modes

- Tunnel down → endpoint returns 502/503/408 → platform marks the task
  forfeit. The watchdog restarts the tunnel; check `tunnel-lt.log` and
  `watchdog.log`. If the tunnel stays down for minutes, the egress proxy
  is likely throttling the data-channel port — wait and retry, or move the
  deployment to a direct-internet host (above).
- Server down → `start.sh` restart loop brings it back automatically.
- VM reboot → run `./start.sh` again; the public URL is unchanged
  (fixed subdomain `yetu-vfy`).
