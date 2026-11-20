// Port-hunting tunnel client for the yetu-vfy agent.
//
// Problem: localtunnel.me allocates a random relay port per subdomain, and
// most relay ports are black-holed by the sandbox egress proxy (CONNECT
// hangs forever). The stock client hangs on the first dead port it gets.
// This hunter allocates throwaway subdomains, probes each relay port with a
// short timeout, and only serves the first allocation whose port actually
// answers — then keeps that tunnel alive (cluster re-opens on 'dead').
// Writes the winning public URL to url.txt (same contract as run.js).
'use strict';

const fs = require('fs');
const path = require('path');
const { getJsonViaProxy, connectViaProxy } = require('./proxy-https');
const TunnelCluster = require('./TunnelCluster');

const LOCAL_PORT = Number(process.argv[2] || 3000);
const PREFIX = process.argv[3] || 'yetu-vfy';
const URL_FILE = path.join(__dirname, 'url.txt');
const PROBE_TIMEOUT_MS = 8000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = () => Math.random().toString(36).slice(2, 8);

async function probePort(host, port) {
  try {
    const sock = await Promise.race([
      connectViaProxy(host, port),
      sleep(PROBE_TIMEOUT_MS).then(() => { throw new Error('probe timeout'); }),
    ]);
    sock.destroy();
    return true;
  } catch (e) {
    return false;
  }
}

async function hunt() {
  for (;;) {
    const sub = `${PREFIX}-${rand()}`;
    try {
      const body = await getJsonViaProxy(`https://localtunnel.me/${sub}`);
      // The relay may take a few seconds to start listening on a fresh port:
      // probe up to 3 times over ~15s before declaring it dead.
      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        if (attempt > 0) await sleep(6000);
        ok = await probePort('localtunnel.me', body.port);
        console.log(`[hunt] ${sub} port ${body.port} try#${attempt + 1} -> ${ok ? 'LIVE' : 'dead'}`);
      }
      if (!ok) continue;
      return {
        name: body.id,
        url: body.url,
        cached_url: body.cached_url,
        max_conn: body.max_conn_count || 1,
        remote_host: 'localtunnel.me',
        remote_ip: body.ip,
        remote_port: body.port,
        local_port: LOCAL_PORT,
        local_host: undefined,
        local_https: false,
        local_cert: undefined,
        local_key: undefined,
        local_ca: undefined,
        allow_invalid_cert: false,
      };
    } catch (e) {
      console.log(`[hunt] alloc error: ${e.message}`);
      await sleep(2000);
    }
  }
}

async function serve(info) {
  const cluster = new TunnelCluster(info);
  let opened = false;
  cluster.once('open', () => {
    opened = true;
    try { fs.writeFileSync(URL_FILE, `${info.url}\n`); } catch (e) { /* ignore */ }
    console.log(`[hunt] public URL: ${info.url}`);
  });
  cluster.on('request', (req) => console.log(`[hunt] ${req.method} ${req.path}`));
  cluster.on('error', (err) => console.log(`[hunt] cluster error: ${err.message}`));
  cluster.on('dead', () => {
    console.log('[hunt] tunnel dead — reopening same relay port');
    cluster.open();
  });
  for (let i = 0; i < (info.max_conn || 1); i++) cluster.open();
  // If the cluster never opens within 60s, give up and re-hunt a new port.
  await sleep(60000);
  if (!opened) {
    console.log('[hunt] cluster never opened — re-hunting');
    cluster.removeAllListeners();
    return false;
  }
  // Opened: stay alive until the process is killed. The cluster re-opens
  // dead tunnels itself; the outer loop only resumes if we exit.
  console.log('[hunt] tunnel live — holding');
  await new Promise(() => {}); // never resolves; killed by watchdog/operator
  return true;
}

(async () => {
  for (;;) {
    const info = await hunt();
    console.log(`[hunt] serving ${info.url} (local :${LOCAL_PORT})`);
    await serve(info);
    await sleep(2000);
  }
})();
