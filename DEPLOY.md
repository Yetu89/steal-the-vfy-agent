# Deployment — yetu-vfy agent

## Stack

- **Server:** Node 18+ (stdlib only), `node server.js`, listens on `$PORT`
  (default 3000) on localhost.
- **Public HTTPS:** Cloudflare quick tunnel (`cloudflared tunnel --url
  http://localhost:3000`) — free, no account, serves `https://<random>.trycloudflare.com`
  on port 443. No card, no payment.
- **Persistence:** both processes run under `nohup` (see `start.sh`);
  the server restarts itself in a loop if it crashes.

## Start / restart

```bash
cd ~/workspace/agent-games
./start.sh        # starts server + tunnel, logs to server.log / tunnel.log
./start.sh stop   # stops both
```

The tunnel URL is printed in `tunnel.log` (look for
`https://<random>.trycloudflare.com`). **The URL changes every time the
tunnel restarts** — after a restart, update the endpoint URL on the
Agent Games dashboard. `curl https://<url>/health` must return
`{"protocol":"v1","status":"ok",...}`.

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

## Failure modes

- Tunnel down → endpoint unreachable → platform marks the task forfeit.
  Check `tunnel.log`; restart with `./start.sh restart`.
- Server down → `start.sh` restarts it automatically (loop).
- VM reboot → both processes die; run `./start.sh` again and update the
  dashboard URL if the tunnel hostname changed.
