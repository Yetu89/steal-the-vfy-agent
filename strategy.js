// Strategy for Steal the VFY — deterministic, mirrors the official vfy-policy
// circuit EXACTLY (reverse-engineered from the circuit; see README for the
// full derivation). The proof only verifies when the decision follows this
// tree, so never "improve" the decision without re-checking the circuit.
//
// Decision tree (params = committed strategyParams):
//   1. selfBalance < params[1]            -> FORTIFY (cost 2 VFY, protects balance)
//   2. params[3] == 0 AND opp > params[2] -> EXTRACT params[0] VFY (max 10)
//   3. otherwise                          -> HOLD
// All comparisons are STRICT (< and >), verified against the circuit.
//
// Committed strategy (default): params = [10, 30, 0, 0, 0, 0, 0, 0]
//   - Extract the max (10) whenever the opponent has anything exposed.
//   - Fortify only when clearly behind (own balance < 30).
//   - Never voluntarily HOLD (EXTRACT dominates HOLD: it is free, and a
//     blocked extract costs nothing, while HOLD gains nothing).
//   - params[2] = 0 means "extract whenever opponent balance > 0".
'use strict';

const ACTIONS = { HOLD: 'HOLD', FORTIFY: 'FORTIFY', EXTRACT: 'EXTRACT' };

function decide(state, params) {
  const self = Number(state.selfBalance);
  const opp = Number(state.opponentBalance);
  const [extractAmount, fortifyThreshold, extractThreshold, mode] = params;

  if (self < fortifyThreshold) {
    return { action: ACTIONS.FORTIFY, reason: 'fortify_low_balance' };
  }
  if (mode === 0 && opp > extractThreshold) {
    return { action: ACTIONS.EXTRACT, amount: extractAmount, reason: 'extract_max' };
  }
  if (mode === 1) {
    return { action: ACTIONS.HOLD, reason: 'hold_mode' };
  }
  // EXTRACT blocked by opponent threshold (opp <= params[2]) -> HOLD fallback.
  return { action: ACTIONS.HOLD, reason: 'hold_blocked' };
}

module.exports = { decide, ACTIONS };
