// Proxy helpers for the tunnel client (proxy-only egress).
// The sandbox egress only allows outbound traffic via an HTTP CONNECT proxy
// (HTTPS_PROXY env, with auth). curl and this code work; the https-proxy-agent
// library does not (it hangs / drops the CONNECT). So we do CONNECT ourselves.
// No secret is stored here — credentials come from the environment.
'use strict';

const net = require('net');
const tls = require('tls');

const PROXY_URL = process.env.TUNNEL_PROXY_URL
  || process.env.HTTPS_PROXY || process.env.https_proxy
  || process.env.HTTP_PROXY || process.env.http_proxy || '';

function proxyParts() {
  if (!PROXY_URL) return null;
  const u = new URL(PROXY_URL);
  return {
    host: u.hostname,
    port: Number(u.port || 3128),
    auth: u.username
      ? `Basic ${Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password || '')}`).toString('base64')}`
      : '',
  };
}

// Raw TCP socket to targetHost:targetPort, via CONNECT through the proxy.
// Resolves with a connected socket (any bytes after the CONNECT response
// headers are pushed back with unshift so they are not lost).
function connectViaProxy(targetHost, targetPort) {
  return new Promise((resolve, reject) => {
    const proxy = proxyParts();
    if (!proxy) return resolve(net.connect({ host: targetHost, port: targetPort }));
    const sock = net.connect(proxy.port, proxy.host);
    let settled = false;
    let buf = Buffer.alloc(0);
    const fail = (err) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      reject(err);
    };
    sock.on('error', fail);
    sock.on('connect', () => {
      const headers = [`CONNECT ${targetHost}:${targetPort} HTTP/1.1`, `Host: ${targetHost}:${targetPort}`];
      if (proxy.auth) headers.push(`Proxy-Authorization: ${proxy.auth}`);
      headers.push('', '');
      sock.write(headers.join('\r\n'));
    });
    sock.on('data', (chunk) => {
      if (settled) return;
      buf = Buffer.concat([buf, chunk]);
      const end = buf.indexOf('\r\n\r\n');
      if (end === -1) return;
      const status = Number((buf.slice(0, end).toString('utf8').split(' ')[1] || '0'));
      if (status !== 200) return fail(new Error(`proxy CONNECT ${targetHost}:${targetPort} -> HTTP ${status}`));
      settled = true;
      sock.removeAllListeners('data');
      const rest = buf.slice(end + 4);
      if (rest.length) sock.unshift(rest);
      resolve(sock);
    });
  });
}

// HTTPS GET returning parsed JSON, via CONNECT + TLS through the proxy.
function getJsonViaProxy(urlString, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlString);
    const targetHost = u.hostname;
    const targetPort = Number(u.port || 443);
    const path = `${u.pathname}${u.search}`;
    const timer = setTimeout(() => reject(new Error(`GET ${urlString} timed out after ${timeoutMs}ms`)), timeoutMs);
    const done = (err, value) => {
      clearTimeout(timer);
      if (err) reject(err); else resolve(value);
    };
    connectViaProxy(targetHost, targetPort).then((sock) => {
      const secure = tls.connect({
        socket: sock,
        servername: targetHost,
        rejectUnauthorized: true,
      });
      secure.on('error', (e) => done(e));
      secure.on('secureConnect', () => {
        secure.write(
          `GET ${path} HTTP/1.1\r\nHost: ${targetHost}\r\nAccept: application/json\r\nConnection: close\r\n\r\n`
        );
      });
      let raw = Buffer.alloc(0);
      secure.on('data', (c) => { raw = Buffer.concat([raw, c]); });
      secure.on('end', () => {
        try {
          const text = raw.toString('utf8');
          const sep = text.indexOf('\r\n\r\n');
          const head = text.slice(0, sep);
          const status = Number((head.split(' ')[1] || '0'));
          const body = text.slice(sep + 4);
          if (status !== 200) return done(new Error(`GET ${urlString} -> HTTP ${status}: ${body.slice(0, 200)}`));
          done(null, JSON.parse(body));
        } catch (e) { done(e); }
      });
    }).catch(done);
  });
}

module.exports = { connectViaProxy, getJsonViaProxy, proxyParts };
