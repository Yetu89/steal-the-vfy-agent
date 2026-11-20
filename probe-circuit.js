// Probe v2: correct oracle reading.
// - "Not all inputs have been set" => name EXISTS, size 1 (scalar accepted)
// - "Not enough values" => name EXISTS, array size > 1
// - "Too many values" => size 0 => ABSENT (this wasm returns 0, not -1, for missing)
// - "Signal not found" => ABSENT
const snarkjs = require('snarkjs');
const CANDIDATES = [
  'action', 'actionType', 'move', 'decision', 'actionCode',
  'amount', 'extractAmount', 'value', 'extract', 'stealAmount',
  'myBalance', 'opponentBalance', 'my_balance', 'opponent_balance',
  'balance', 'balances', 'myExposed', 'oppExposed', 'exposedBalance',
  'myExposedBalance', 'opponentExposedBalance', 'fortifiedBalance',
  'turn', 'turnNumber', 'turn_number', 'round', 'matchTurn',
  'matchId', 'match_id', 'matchHash', 'gameId', 'gameState',
  'commitment', 'commitmentHash', 'commitment_hash',
  'strategyCommitment', 'strategyHash', 'policyHash', 'policy',
  'strategy', 'myCommitmentHash', 'commitment_hash_vfy',
  'publicInputsHash', 'stateHash', 'gameStateHash', 'inputsHash',
  'hash', 'publicHash', 'state_hash',
  'deadline', 'nonce', 'timestamp', 'version', 'circuitVersion',
  'fortify', 'fortified', 'isFortified', 'opponentFortified',
  'myFortified', 'salt', 'secret', 'threshold', 'cap', 'maxExtract',
  'minBalance', 'player', 'opponent', 'me', 'actor', 'side',
  'turnsLeft', 'remainingTurns', 'epoch', 'match', 'id',
  'a', 'b', 'c', 'in', 'out', 'input', 'output', 'x', 'y',
  'myAction', 'oppAction', 'prevAction', 'lastAction',
  'myBalanceAfter', 'oppBalanceAfter', 'isValid', 'valid',
  'turnHash', 'matchStateHash', 'commit', 'policyCommitment',
];
(async () => {
  const found = [];
  for (const name of CANDIDATES) {
    try {
      await snarkjs.wtns.calculate({ [name]: 0 }, 'circuits/vfy-policy.wasm', '/tmp/probe.wtns');
      found.push([name, 'EXISTS?? (completed with single input)']);
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (msg.includes('Not all inputs')) {
        const m = msg.match(/Only (\d+) out of (\d+)/);
        found.push([name, 'EXISTS size=1 total=' + (m ? m[2] : '?')]);
      } else if (msg.includes('Not enough values')) {
        found.push([name, 'EXISTS array: ' + msg.trim().split('\n')[0]]);
      }
    }
  }
  console.log('=== REAL INPUT SIGNALS ===');
  for (const [n, m] of found) console.log(n, '=>', m);
  console.log('=== count:', found.length, '===');
  process.exit(0);
})();
