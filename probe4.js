// Verify: strategyParams size + full 17-input set completeness.
const snarkjs = require('snarkjs');
(async () => {
  for (const n of [7, 8, 9]) {
    try {
      await snarkjs.wtns.calculate({ strategyParams: Array(n).fill(0) }, 'circuits/vfy-policy.wasm', '/tmp/p.wtns');
      console.log('strategyParams len', n, '=> no error (completed?)');
    } catch (e) {
      console.log('strategyParams len', n, '=>', String(e.message).trim().split('\n')[0]);
    }
  }
  // Full set with dummy values
  const full = {
    action: 0, amount: 0, opponentBalance: 100, selfBalance: 100,
    turnNumber: 1, matchId: 1, commitment: 0, circuitVersion: 1, salt: 0,
    strategyParams: [0,0,0,0,0,0,0,0],
  };
  try {
    await snarkjs.wtns.calculate(full, 'circuits/vfy-policy.wasm', '/tmp/full.wtns');
    console.log('FULL SET: witness computed OK (17/17 inputs accepted)');
  } catch (e) {
    console.log('FULL SET FAILED:', String(e.message).trim().split('\n')[0]);
  }
  process.exit(0);
})();
