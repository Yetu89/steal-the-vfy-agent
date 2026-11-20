// Vercel serverless adapter for the yetu-vfy "Steal the VFY" agent.
// Reuses the exact logic from server.js — HMAC-SHA256 verify on the RAW body
// first, signed preflight ack, turn via strategy.js + Groth16 proof via
// proof.js, signed response — without changing strategy/proof/HMAC logic.
// Differences vs server.js (serverless only, no logic change):
//   - No http.createServer / listen; Vercel invokes this handler per request.
//   - Routing is by HTTP method only (GET = health, POST = turn). Vercel
//     rewrites /health, /agent and / to this function (see vercel.json), and
//     the rewritten req.url is not reliable, so the path is not matched.
//   - No start() / startup commitment check (serverless has no startup
//     phase). Env correctness is visible in GET /health (it echoes
//     commitment + strategyParams) and in the signed preflight response.
//   - PROOF_TIMEOUT_MS stays 30s like server.js; on Vercel Hobby the
//     function maxDuration is capped at 10s, so a turn that needs a fresh
//     Groth16 proof may hit the platform timeout. Health + preflight need
//     no proof and are unaffected.
'use strict';

const crypto = require('crypto');
const { config } = require('../config');
const { readEnvelope, handleTurn } = require('../server');

const MAX_BODY = 1024 * 1024; // 1 MB

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

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (c) => {
      if (failed) return;
      size += c.length;
      if (size > MAX_BODY) {
        failed = true;
        reject(Object.assign(new Error('body_too_large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!failed) resolve(Buffer.concat(chunks));
    });
    req.on('error', (err) => {
      if (!failed) reject(err);
    });
  });
}

module.exports = async (req, res) => {
  // Health: GET (any path — see note above). Signed, like server.js.
  if (req.method === 'GET') {
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

  if (req.method !== 'POST') {
    sendJson(res, 404, { error: 'not_found' }, false);
    return;
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    if (err && err.status === 413) {
      sendJson(res, 413, { error: 'body_too_large' }, false);
      return;
    }
    sendJson(res, 400, { error: 'bad_body' }, false);
    return;
  }

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
    sendJson(res, 200, { ok: true, protocolVersion: 'v1' }, true);
    return;
  }

  // 2-3. Turn: decide + prove, fail closed (same as server.js handleTurn).
  try {
    const { response } = await handleTurn(envelope);
    sendJson(res, 200, response, true);
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
};
