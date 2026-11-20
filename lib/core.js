// Shared agent core: HMAC helpers, envelope parsing, turn handling.
// Used by both server.js (local standalone HTTP server) and api/index.js
// (Vercel serverless adapter). server.js is NOT deployed to Vercel
// (see .vercelignore) — Vercel treats a root server.js as the entrypoint,
// which breaks the api/ functions. This module keeps the logic in one
// place so both entry points behave identically.
'use strict';

const crypto = require('crypto');
const { config } = require('../config');
const { decide } = require('../strategy');
const { generatePolicyProof, computeCommitment } = require('../proof');
const { submitToKurier } = require('../kurier');

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

module.exports = {
  MAX_BODY,
  PROOF_TIMEOUT_MS,
  hmacHex,
  timingSafeEqual,
  sendJson,
  withTimeout,
  readEnvelope,
  handleTurn,
};
