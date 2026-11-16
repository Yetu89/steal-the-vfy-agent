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
const crypto = require('crypto');
const { config, validateParams } = require('./config');
const { decide } = require('./strategy');
const { generatePolicyProof, computeCommitment } = require('./proof');
const { submitToKurier } = require('./kurier');

const MAX_BODY = 1024 * 1024; // 1 MB
const PROOF_TIMEOUT_MS = 30000;

function hmacHex(secret, rawBody) {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

function timingSafeEqual(a, b) {
  const ba = Buffer.from(a || '', 'utf8');
  const bb = Buffer.from(b || '', 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function sendJson(res, status, obj, sign) {
  const raw = Buffer.from(JSON.stringify(obj), 'utf8');
  const headers = { 'content-type': 'application/json' };
  if (sign && config.hmacSecret) headers['x-agent-games-signature'] = hmacHex(config.hmacSecret, raw);
  res.writeHead(status, headers);
  res.end(raw);
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms)),
  ]);
}

// The platform's turn envelope: { matchId, turn, gameState|state, commitment*, deadline* }.
// Field names are read defensively; the exact schema is confirmed by the
// first practice task (see README). Balances default to 100 (game start).
function readEnvelope(envelope) {
  const state = envelope.gameState || envelope.state || envelope;
  const matchId = envelope.matchId ?? envelope.match_id ?? envelope.gameId ?? null;
  const turn = envelope.turn ?? envelope.turnNumber ?? envelope.turn_number ?? null;
  const selfBalance = state.myBalance ?? state.selfBalance ?? state.my_balance ?? 100;
  const opponentBalance = state.opponentBalance ?? state.opponent_balance ?? 100;
  const commitment = envelope.commitment ?? envelope.commitmentHash ?? envelope.myCommitmentHash
    ?? state.commitment ?? state.commitmentHash ?? config.expectedCommitment ?? null;
  const deadline = envelope.deadline ?? envelope.expiresAt ?? null;
  return { matchId, turn, selfBalance, opponentBalance, commitment, deadline };
}

async function handleTurn(envelope) {
  const { matchId, turn, selfBalance, opponentBalance, commitment, deadline } = readEnvelope(envelope);
  const params = config.strategyParams;
  const decision = decide({ selfBalance, opponentBalance }, params);
  const idempotencyKey = `${matchId}:${turn}`;
  const base = { matchId, turn, action: decision.action, idempotencyKey, reason: decision.reason };

  if (deadline) {
    const dl = typeof deadline === 'number' ? deadline : Date.parse(deadline);
    if (Number.isFinite(dl) && Date.now() > dl) console.warn(`[warn] turn ${matchId}:${turn} past deadline, answering anyway (fail closed)`);
  }

  const proofInput = {
    action: decision.action,
    amount: decision.action === 'EXTRACT' ? decision.amount : 0,
    selfBalance: Number(selfBalance),
    opponentBalance: Number(opponentBalance),
    turnNumber: Number(turn),
    matchId,
    commitment: commitment || config.expectedCommitment,
    circuitVersion: config.circuitVersion,
    salt: config.strategySalt,
    strategyParams: params,
    circuitDir: config.circuitDir,
  };

  let proof = null;
  let proofError = null;
  try {
    proof = await withTimeout(generatePolicyProof(proofInput), PROOF_TIMEOUT_MS, 'proof');
  } catch (err) {
    proofError = err;
    console.error(`[warn] proof failed for ${decision.action}: ${err.message} — retrying as HOLD`);
    try {
      proof = await withTimeout(generatePolicyProof({ ...proofInput, action: 'HOLD', amount: 0 }), PROOF_TIMEOUT_MS, 'proof-hold');
      base.action = 'HOLD';
      base.reason = 'fallback_hold_proof_failed';
      delete base.amount;
    } catch (err2) {
      console.error(`[warn] HOLD proof also failed: ${err2.message} — answering HOLD with no proof`);
      proof = null;
    }
  }

  if (decision.action === 'EXTRACT' && base.action === 'EXTRACT') base.amount = decision.amount;

  const response = { ...base };
  if (proof) {
    response.policyProof = {
      circuitVersion: proof.circuitVersion,
      proof: proof.proof,
      public_signals: proof.publicSignals,
    };
    response.publicInputsHash = proof.publicInputsHash;
  } else {
    response.reason = 'no_proof_available';
  }

  // Optional Kurier submission, non-blocking (proofReference is optional).
  if (proof && config.kurierApiKey && config.kurierApiUrl) {
    submitToKurier({
      proof: proof.proof,
      publicSignals: proof.publicSignals,
      vkHash: config.vkHash,
      apiKey: config.kurierApiKey,
      apiUrl: config.kurierApiUrl,
      chainId: config.kurierChainId,
    }).then((jobId) => {
      if (jobId) console.log(`[kurier] job ${jobId} for ${idempotencyKey}`);
    }).catch((err) => console.error(`[kurier] submit failed (non-fatal): ${err.message}`));
  }

  return { response, proofError };
}

const server = http.createServer((req, res) => {
  // Health: unsigned, always available.
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
    }, false);
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
      sendJson(res, 200, {
        protocol: 'v1',
        status: 'ok',
        agent: config.agentName,
        track: config.track,
        circuitVersion: config.circuitVersion,
        commitment: config.expectedCommitment || undefined,
        hmacConfigured: true,
      }, true);
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
