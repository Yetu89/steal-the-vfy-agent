// Policy proof generation for Steal the VFY (Groth16 / BN128, Circom 2.x).
// Uses the OFFICIAL vfy-policy circuit artifacts from agentgames.zkverify.io.
//
// Circuit interface (reverse-engineered by probing the .wasm/.zkey):
//   inputs (17 total):
//     action, amount, opponentBalance, selfBalance, turnNumber, matchId,
//     commitment, circuitVersion, salt, strategyParams[8]
//   public signals (9, output-then-public order):
//     [0] publicInputsHash (computed by the circuit from the game state)
//     [1] commitment            = Poseidon(strategyParams, salt)
//     [2] matchId  [3] turnNumber  [4] selfBalance  [5] opponentBalance
//     [6] action   [7] amount      [8] circuitVersion
//   action enum: HOLD = 0, FORTIFY = 1, EXTRACT = 2
//   amount must be 0 for HOLD/FORTIFY and == params[0] for EXTRACT.
//   commitment = Poseidon(strategyParams[0..7], salt)  (circomlib Poseidon).
'use strict';

const path = require('path');
const snarkjs = require('snarkjs');
const { buildPoseidon } = require('circomlibjs');

const ACTION_CODE = { HOLD: 0, FORTIFY: 1, EXTRACT: 2 };

let poseidonPromise = null;
function getPoseidon() {
  if (!poseidonPromise) poseidonPromise = buildPoseidon();
  return poseidonPromise;
}

async function computeCommitment(strategyParams, salt) {
  const poseidon = await getPoseidon();
  const F = poseidon.F;
  const preimage = [...strategyParams.map((v) => BigInt(v)), BigInt(salt)];
  return F.toString(poseidon(preimage));
}

function toFieldInt(value, fieldName) {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${fieldName} must be a non-negative number`);
    return String(Math.trunc(value));
  }
  if (typeof value === 'string') {
    if (/^\d+$/.test(value)) return value.replace(/^0+(?=\d)/, '') || '0';
    // Non-numeric string (e.g. UUID matchId): deterministic field element.
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(value, 'utf8').digest('hex');
    const BN128_PRIME = BigInt('2188824287183927522224640577328157833864562104468795807747329225334473528894486');
    return (BigInt('0x' + hash) % BN128_PRIME).toString();
  }
  throw new Error(`${fieldName} has unsupported type ${typeof value}`);
}

async function generatePolicyProof(opts) {
  const {
    action, amount, selfBalance, opponentBalance, turnNumber, matchId,
    commitment, circuitVersion, salt, strategyParams, circuitDir,
  } = opts;
  const wasmPath = path.join(circuitDir, 'vfy-policy.wasm');
  const zkeyPath = path.join(circuitDir, 'vfy-policy_final.zkey');
  const input = {
    action: ACTION_CODE[action],
    amount: Number(amount || 0),
    opponentBalance: Number(opponentBalance),
    selfBalance: Number(selfBalance),
    turnNumber: Number(turnNumber),
    matchId: toFieldInt(matchId, 'matchId'),
    commitment: toFieldInt(commitment, 'commitment'),
    circuitVersion: Number(circuitVersion),
    salt: toFieldInt(salt, 'salt'),
    strategyParams: strategyParams.map(Number),
  };
  if (input.action === undefined) throw new Error(`unknown action ${action}`);
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasmPath, zkeyPath);
  return {
    circuitVersion: String(circuitVersion),
    proof,
    publicSignals,
    publicInputsHash: publicSignals[0],
  };
}

async function verifyProofLocally(publicSignals, proof, vkJson) {
  return snarkjs.groth16.verify(vkJson, publicSignals, proof);
}

module.exports = { ACTION_CODE, computeCommitment, generatePolicyProof, verifyProofLocally, toFieldInt };
