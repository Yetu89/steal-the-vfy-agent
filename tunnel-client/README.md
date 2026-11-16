# tunnel-client — patched localtunnel client (proxy-only egress)

Derived from **localtunnel 2.0.2 (MIT)** — `Tunnel.js`, `TunnelCluster.js`,
`HeaderHostTransformer.js`, `localtunnel.js` — plus our own
`proxy-https.js` and `run.js`.

## Why a patched client

The sandbox VM's egress is proxy-only (HTTP CONNECT, `HTTPS_PROXY` env).
The stock localtunnel client:

- does the allocation `GET https://localtunnel.me/?new` with axios, which
  bypasses the proxy → the request hangs on the gateway;
- opens the data channel with a raw `net.connect()` to the tunnel server's
  IP:port, which also bypasses the proxy → hangs.

`cloudflared` was tried first and is worse here: it ignores the proxy env
vars entirely (its TLS handshake to `api.trycloudflare.com` fails).

## What changed

- `proxy-https.js` (new): `connectViaProxy(host, port)` — opens a TCP
  socket to the egress proxy, sends `CONNECT host:port` with
  `Proxy-Authorization` from the env, returns the tunneled socket.
  `getJsonViaProxy(url)` — CONNECT + TLS + HTTPS GET, returns parsed JSON.
  No secret is stored; credentials come from `TUNNEL_PROXY_URL` /
  `HTTPS_PROXY` / `https_proxy` env.
- `Tunnel.js`: allocation uses `getJsonViaProxy` instead of axios
  (axios and `https-proxy-agent` were removed — the latter hangs/drops the
  CONNECT against this proxy).
- `TunnelCluster.js`: the data channel uses `connectViaProxy`; `open()` is
  now promise-based; remote sockets get a 10s TCP keepalive so a
  silently-dropped connection (proxy kills idle TCP without FIN/RST) is
  detected and replaced instead of draining the 2-connection pool.
- `run.js` (new): `node tunnel-client/run.js [port] [subdomain]` — starts
  the tunnel, prints the public URL, writes it to `url.txt`.

## Usage

```bash
node tunnel-client/run.js 3000 yetu-vfy
# → https://yetu-vfy.loca.lt
```

The fixed subdomain keeps the URL stable across restarts. If the subdomain
is taken, the server assigns a random one and prints it instead.
