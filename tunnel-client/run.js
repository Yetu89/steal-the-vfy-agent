// Starts a localtunnel (patched for proxy-only egress) for the agent server.
// Prints the public HTTPS URL to stdout and writes it to url.txt.
// Usage: node tunnel-client/run.js [localPort] [subdomain]
// Env: TUNNEL_PROXY_URL (default: HTTPS_PROXY/https_proxy), LT_SUBDOMAIN.
'use strict';

const fs = require('fs');
const path = require('path');
const Tunnel = require('./Tunnel');

const localPort = Number(process.argv[2] || process.env.PORT || 3000);
const subdomain = process.argv[3] || process.env.LT_SUBDOMAIN || undefined;

const tunnel = new Tunnel({ port: localPort, subdomain, host: 'https://localtunnel.me' });

tunnel.on('url', (url) => {
  console.log(`[tunnel] public URL: ${url}`);
  try { fs.writeFileSync(path.join(__dirname, 'url.txt'), `${url}\n`); } catch (e) { /* ignore */ }
});
tunnel.on('error', (err) => {
  console.error(`[tunnel] error: ${err.message}`);
});
tunnel.on('request', (req) => {
  console.log(`[tunnel] ${req.method} ${req.path}`);
});
tunnel.on('close', () => {
  console.error('[tunnel] closed — exiting');
  process.exit(1);
});

// If the relay port never answers, the cluster hangs silently forever.
// Exit so the watchdog restarts us with a fresh allocation (new port).
const urlTimer = setTimeout(() => {
  console.error('[tunnel] no URL within 45s — relay port likely dead, exiting for restart');
  process.exit(1);
}, 45000);
tunnel.on('url', () => clearTimeout(urlTimer));

tunnel.open((err) => {
  if (err) {
    console.error(`[tunnel] failed to open: ${err.message}`);
    process.exit(1);
  }
  console.log('[tunnel] opened, waiting for URL...');
});
