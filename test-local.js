// Local self-test for the yetu-vfy agent (no network, no secrets needed
// except a dummy HMAC secret + the build-time salt in .env).
// Tests: /health, bad HMAC -> 401, good HMAC turn -> signed response with a
// REAL Groth16 proof (verified locally against circuits/vk.json), decision
// tree cases, preflight ack, and timing (< 60s deadline).
'use strict';

const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PORT = 3101;
const SECRET = 'test-secret-please-ignore';
// Salt must match AGENT_COMMITMENT from .env (server verifies the pair).
// Read it from process.env, else from the local .env file, else fall back to '1'
// (in which case the server also gets no AGENT_COMMITMENT and just logs it).
const fs = require('fs');
function envFileVal(key) {
  try {
    const m = fs.readFileSync(`${__dirname}/.env`, 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'));
    return m ? m[1].trim() : '';
  } catch { return ''; }
}
const SALT = process.env.AGENT_STRATEGY_SALT || envFileVal('AGENT_STRATEGY_SALT') || '1';

function hmac(secret, raw) {
  return crypto.createHmac('sha256', secret).update(raw).digest('hex');
}

function req(method, pathName, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const raw = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;
    const r = http.request({
      hostname: '127.0.0.1', port: PORT, path: pathName, method,
      headers: { 'content-type': 'application/json', ...(raw ? { 'content-length': raw.length } : {}), ...headers },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    if (raw) r.write(raw);
    r.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const env = {
    ...process.env,
    PORT: String(PORT),
    AGENT_GAMES_HMAC_SECRET: SECRET,
    AGENT_STRATEGY_SALT: SALT,
    AGENT_STRATEGY_PARAMS: '[10,30,0,0,0,0,0,0]',
    AGENT_CIRCUIT_VERSION: '1',
  };
  const child = spawn('node', ['server.js'], { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  // Wait for the server to be ready (Poseidon init at startup takes a few seconds).
  let ready = false;
  for (let i = 0; i < 30 && !ready; i++) {
    await sleep(500);
    try {
      const h = await req('GET', '/health');
      if (h.status === 200) ready = true;
    } catch { /* not up yet */ }
  }
  if (!ready) {
    console.log('FAIL  server did not come up. Server log:');
    console.log(out);
    child.kill();
    process.exit(1);
  }

  let pass = 0;
  let fail = 0;
  const check = (name, ok, extra = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`);
    if (ok) pass++; else fail++;
  };

  // 1. /health
  const health = await req('GET', '/health');
  check('GET /health 200', health.status === 200);
  const hBody = JSON.parse(health.body);
  check('health reports protocol v1', hBody.protocol === 'v1');
  check('health hmacConfigured', hBody.hmacConfigured === true);

  // 2. Bad HMAC -> 401
  const bad = await req('POST', '/agent', { matchId: 1, turn: 1 }, { 'x-agent-games-signature': 'deadbeef' });
  check('bad HMAC -> 401', bad.status === 401);

  // 3. Missing signature -> 401
  const nosig = await req('POST', '/agent', { matchId: 1, turn: 1 });
  check('missing signature -> 401', nosig.status === 401);

  // 4. Preflight (no matchId/turn) -> signed protocol-v1 ack
  const pre = await req('POST', '/agent', { type: 'preflight' }, { 'x-agent-games-signature': hmac(SECRET, JSON.stringify({ type: 'preflight' })) });
  const preBody = JSON.parse(pre.body);
  check('preflight 200 signed', pre.status === 200 && pre.headers['x-agent-games-signature'] === hmac(SECRET, Buffer.from(pre.body, 'utf8')));
  check('preflight protocol v1', preBody.protocol === 'v1');

  // 5. Real turn: EXTRACT (self 100, opp 100) -> proof verifies locally
  const turn = { matchId: 1, turn: 1, gameState: { myBalance: 100, opponentBalance: 100 } };
  const rawTurn = JSON.stringify(turn);
  const t0 = Date.now();
  const resp = await req('POST', '/agent', turn, { 'x-agent-games-signature': hmac(SECRET, rawTurn) });
  const ms = Date.now() - t0;
  check('turn 200', resp.status === 200, `(${ms}ms)`);
  check('turn response signed', resp.headers['x-agent-games-signature'] === hmac(SECRET, Buffer.from(resp.body, 'utf8')));
  const rBody = JSON.parse(resp.body);
  check('turn echoes matchId/turn', rBody.matchId === 1 && rBody.turn === 1);
  check('decision EXTRACT 10', rBody.action === 'EXTRACT' && rBody.amount === 10);
  check('policyProof present', Boolean(rBody.policyProof && rBody.policyProof.proof && rBody.policyProof.public_signals));
  check('policyProof has circuitVersion', rBody.policyProof && rBody.policyProof.circuitVersion === '1');
  check('publicInputsHash present', typeof rBody.publicInputsHash === 'string');
  check('idempotencyKey = matchId:turn', rBody.idempotencyKey === '1:1');
  if (rBody.policyProof) {
    const snarkjs = require('snarkjs');
    const vk = require('./circuits/vk.json');
    const ok = await snarkjs.groth16.verify(vk, rBody.policyProof.public_signals, rBody.policyProof.proof);
    check('Groth16 proof verifies locally', ok === true);
    check('publicSignals[6] action=2', rBody.policyProof.public_signals[6] === '2');
    check('publicSignals[7] amount=10', rBody.policyProof.public_signals[7] === '10');
  }
  check('turn answered < 60s', ms < 60000, `(${ms}ms)`);

  // 6. FORTIFY case (self 20 < 30)
  const turnF = { matchId: 2, turn: 5, gameState: { myBalance: 20, opponentBalance: 100 } };
  const rawF = JSON.stringify(turnF);
  const respF = await req('POST', '/agent', turnF, { 'x-agent-games-signature': hmac(SECRET, rawF) });
  const rF = JSON.parse(respF.body);
  check('fortify case -> FORTIFY, no amount field', rF.action === 'FORTIFY' && !('amount' in rF));
  check('fortify proof verifies', rF.policyProof ? await require('snarkjs').groth16.verify(require('./circuits/vk.json'), rF.policyProof.public_signals, rF.policyProof.proof) : false);

  // 7. HOLD case (opp 0 -> extract blocked)
  const turnH = { matchId: 3, turn: 9, gameState: { myBalance: 100, opponentBalance: 0 } };
  const rawH = JSON.stringify(turnH);
  const respH = await req('POST', '/agent', turnH, { 'x-agent-games-signature': hmac(SECRET, rawH) });
  const rH = JSON.parse(respH.body);
  check('hold case -> HOLD, no amount field', rH.action === 'HOLD' && !('amount' in rH));
  check('hold proof verifies', rH.policyProof ? await require('snarkjs').groth16.verify(require('./circuits/vk.json'), rH.policyProof.public_signals, rH.policyProof.proof) : false);

  child.kill();
  console.log(`\n${pass} passed, ${fail} failed`);
  console.log('--- server log ---');
  console.log(out);
  process.exit(fail ? 1 : 0);
})();
