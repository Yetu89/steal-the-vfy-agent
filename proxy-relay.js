// Local CONNECT relay: adds Proxy-Authorization and forwards to the sandbox
// egress proxy. Some clients (e.g. cloudflared) do not forward the credentials
// from the HTTPS_PROXY URL, so the egress proxy answers 407 (plain HTTP) and
// the client's TLS handshake fails with "first record does not look like a
// TLS handshake". This relay accepts unauthenticated CONNECTs on localhost
// and re-issues them upstream with the credentials from the environment
// (HTTPS_PROXY / https_proxy). No secret is stored in this file.
// Usage: node proxy-relay.js [listenPort]   (default 18080)
'use strict';

const http = require('http');
const net = require('net');

const LISTEN_PORT = Number(process.argv[2] || 18080);
const UPSTREAM = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || '';
if (!UPSTREAM) {
  console.error('[fatal] no HTTPS_PROXY in environment — nothing to relay to');
  process.exit(1);
}
const u = new URL(UPSTREAM);
const upstreamHost = u.hostname;
const upstreamPort = Number(u.port || 3128);
const upstreamAuth = u.username ? `Basic ${Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password || '')}`).toString('base64')}` : '';

const server = http.createServer();
server.on('connect', (req, clientSocket, head) => {
  const [targetHost, targetPort] = req.url.split(':');
  const port = Number(targetPort || 443);
  const upstream = net.connect(upstreamPort, upstreamHost, () => {
    const headers = [`CONNECT ${targetHost}:${port} HTTP/1.1`, `Host: ${targetHost}:${port}`];
    if (upstreamAuth) headers.push(`Proxy-Authorization: ${upstreamAuth}`);
    headers.push('', '');
    upstream.write(headers.join('\r\n'));
  });
  let established = false;
  let buf = Buffer.alloc(0);
  const onUpstreamData = (chunk) => {
    if (established) { clientSocket.write(chunk); return; }
    buf = Buffer.concat([buf, chunk]);
    const end = buf.indexOf('\r\n\r\n');
    if (end === -1) return;
    const headLine = buf.slice(0, end).toString('utf8');
    const status = Number((headLine.split(' ')[1] || '0'));
    if (status !== 200) {
      console.error(`[relay] upstream CONNECT ${targetHost}:${port} -> HTTP ${status}`);
      clientSocket.end(`HTTP/1.1 ${status} Proxy Error\r\n\r\n`);
      upstream.destroy();
      return;
    }
    established = true;
    // Stop intercepting: hand the raw stream to the pipes (dup writes corrupt TLS).
    upstream.removeListener('data', onUpstreamData);
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    const rest = buf.slice(end + 4);
    if (head.length) upstream.write(head);
    if (rest.length) clientSocket.write(rest);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  };
  upstream.on('data', onUpstreamData);
  upstream.on('error', (err) => {
    console.error(`[relay] upstream error ${targetHost}:${port}: ${err.message}`);
    if (!clientSocket.destroyed) clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
  });
  clientSocket.on('error', () => upstream.destroy());
});
server.on('clientError', (err, socket) => { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); });
server.listen(LISTEN_PORT, '127.0.0.1', () => {
  console.log(`[relay] listening on 127.0.0.1:${LISTEN_PORT} -> ${upstreamHost}:${upstreamPort} (auth ${upstreamAuth ? 'yes' : 'no'})`);
});
