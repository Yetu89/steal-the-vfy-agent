// Steal the VFY agent endpoint — Node stdlib only (no framework).
// Flow (official Builder Field Guide, agentgames.zkverify.io/build):
//   1. Accept a JSON POST at the registered endpoint (/agent or /).
//   2. Verify HMAC-SHA256 in `x-agent-games-signature` against the RAW body
//      BEFORE parsing or doing any work. Bad signature -> 401, no work.
//   3. Decide via strategy.js (mirrors the vfy-policy circuit exactly),
//      generate a real Groth16 policy proof with snarkjs (proof.js).
//   4. Sign the raw response body with the same HMAC secret
//      (`x-agent-games-signature` over the response).
//   5. Fail closed: proof failure -> retry once as HOLD -> else HOLD, no proof.
//      (A missing proof costs -2 and resolves as HOLD; a timeout is -1.
//       Never fake a proof, never crash the turn.)
//
// Env (see .env.example):
//   PORT, AGENT_GAMES_HMAC_SECRET (or AGENT_HMAC_SECRET), AGENT_STRATEGY_PARAMS,
//   AGENT_STRATEGY_SALT, AGENT_CIRCUIT_VERSION, AGENT_COMMITMENT (optional check),
//   KURIER_API_KEY / KURIER_API_URL (optional, non-blocking).
'use strict';

const http = require('http');
const { config, validateParams } = require('./config');
const { computeCommitment } = require('./proof');
const {
  MAX_BODY,
  hmacHex,
  timingSafeEqual,
  sendJson,
  readEnvelope,
  handleTurn,
} = require('./lib/core');

const server = http.createServer((req, res) => {
  // Health: signed (the field guide: every response is signed with
  // x-agent-games-signature over the raw response body).
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
    sendJson(res, 200, {
      protocol: 'v1',
      status: 'ok',
      agent: config.agentName,
      track: config.track,
      circuitVersion: config.circuitVersion,
      commitment: config.expectedCommitment || undefined,
      hmacConfigured: Boolean(config.hmacSecret),
      strategyParams: config.strategyParams,
      uptimeSec: Math.floor(process.uptime()),
    }, true);
    return;
  }

  if (req.method !== 'POST' || (req.url !== '/agent' && req.url !== '/')) {
    sendJson(res, 404, { error: 'not_found' }, false);
    return;
  }

  const chunks = [];
  let tooLarge = false;
  req.on('data', (c) => {
    if (tooLarge) return;
    chunks.push(c);
    if (Buffer.concat(chunks).length > MAX_BODY) {
      tooLarge = true;
      sendJson(res, 413, { error: 'body_too_large' }, false);
      req.destroy();
    }
  });
  req.on('end', async () => {
    if (tooLarge) return;
    const rawBody = Buffer.concat(chunks);

    // 1. HMAC first, before parsing anything.
    if (!config.hmacSecret) {
      sendJson(res, 500, { error: 'hmac_secret_not_configured' }, false);
      return;
    }
    const sig = req.headers['x-agent-games-signature'] || '';
    const presented = String(sig).replace(/^sha256=/, '');
    if (!timingSafeEqual(presented, hmacHex(config.hmacSecret, rawBody))) {
      sendJson(res, 401, { error: 'bad_signature' }, false);
      return;
    }

    let envelope;
    try {
      envelope = JSON.parse(rawBody.toString('utf8'));
    } catch {
      sendJson(res, 400, { error: 'bad_json' }, true);
      return;
    }

    // Preflight / probe (no matchId+turn): signed protocol-v1 ack.
    const hasTurn = envelope && envelope.matchId !== undefined && envelope.matchId !== null
      && (envelope.turn !== undefined && envelope.turn !== null);
    if (!hasTurn) {
      console.log('[preflight] signed probe received');
      // The platform's preflight expects exactly {"ok":true,"protocolVersion":"v1"},
      // signed with x-agent-games-signature over the raw response body
      // (dashboard error, 18 Nov 2026: the old {"protocol":"v1","status":"ok",...}
      // body failed preflight).
      sendJson(res, 200, { ok: true, protocolVersion: 'v1' }, true);
      return;
    }

    // 2-3. Turn: decide + prove, fail closed.
    try {
      const { response } = await handleTurn(envelope);
      sendJson(res, 200, response, true);
      console.log(`[turn] ${envelope.matchId}:${envelope.turn} -> ${response.action}${response.amount ? ' ' + response.amount : ''} proof=${Boolean(response.policyProof)}`);
    } catch (err) {
      console.error(`[error] turn handler failed: ${err.message}`);
      // Last-resort fail closed: HOLD, no proof, still signed.
      sendJson(res, 200, {
        matchId: envelope.matchId ?? null,
        turn: envelope.turn ?? null,
        action: 'HOLD',
        idempotencyKey: `${envelope.matchId}:${envelope.turn}`,
        reason: 'handler_error_fallback',
      }, true);
    }
  });
});

async function start() {
  const paramErrors = validateParams(config.strategyParams);
  if (paramErrors.length) {
    console.error('[fatal] invalid strategy params:', paramErrors.join('; '));
    process.exit(1);
  }
  if (!config.strategySalt) {
    console.error('[fatal] AGENT_STRATEGY_SALT is not set — the proof needs the salt that matches the registered commitment.');
    process.exit(1);
  }
  if (config.expectedCommitment) {
    const actual = await computeCommitment(config.strategyParams, config.strategySalt);
    if (actual !== config.expectedCommitment) {
      console.error(`[fatal] commitment mismatch: Poseidon(params,salt)=${actual} but AGENT_COMMITMENT=${config.expectedCommitment}`);
      process.exit(1);
    }
    console.log(`[ok] commitment verified: ${actual}`);
  } else {
    const actual = await computeCommitment(config.strategyParams, config.strategySalt);
    console.log(`[info] commitment (register this on the dashboard): ${actual}`);
  }
  if (!config.hmacSecret) console.warn('[warn] AGENT_GAMES_HMAC_SECRET not set — turns will return 500 until it is set.');
  server.listen(config.port, () => {
    console.log(`yetu-vfy agent listening on :${config.port} (track ${config.track}, params ${JSON.stringify(config.strategyParams)})`);
  });
}

if (require.main === module) start();
module.exports = { server, start, readEnvelope, handleTurn };
