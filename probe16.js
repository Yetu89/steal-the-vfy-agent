// Fallback check: when EXTRACT is blocked by opp<=p2, is HOLD the expected action?
// Also confirm decision-tree edges.
const snarkjs = require('snarkjs');
const { buildPoseidon } = require('circomlibjs');
async function trial(input) {
  try {
    await snarkjs.wtns.calculate(input, 'circuits/vfy-policy.wasm', '/tmp/p16.wtns');
    return 'PASS';
  } catch (e) {
    const m = String(e.message).match(/line: (\d+)/);
    return 'L' + (m ? m[1] : '?');
  }
}
(async () => {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const commit = (params, salt) => F.toString(poseidon([...params.map(BigInt), BigInt(salt)]));
  const mk = (o = {}) => {
    const base = { action: 0, amount: 0, opponentBalance: 100, selfBalance: 100,
      turnNumber: 1, matchId: 1, circuitVersion: 1, salt: 0,
      strategyParams: [0,0,0,0,0,0,0,0] };
    const input = { ...base, ...o };
    input.commitment = commit(input.strategyParams, input.salt);
    return input;
  };
  const P = (a) => a;
  console.log('--- EXTRACT blocked by opp<=p2 (self=100 p1=0 p3=0 opp=5 p2=10) ---');
  console.log('a=0 HOLD    =>', await trial(mk({ strategyParams: P([10,0,10,0,0,0,0,0]), action: 0, opponentBalance: 5 })));
  console.log('a=1 FORTIFY =>', await trial(mk({ strategyParams: P([10,0,10,0,0,0,0,0]), action: 1, opponentBalance: 5 })));
  console.log('a=2 EXTRACT =>', await trial(mk({ strategyParams: P([10,0,10,0,0,0,0,0]), action: 2, amount: 10, opponentBalance: 5 })));
  console.log('--- same but p3=1 ---');
  console.log('a=0 HOLD p3=1 =>', await trial(mk({ strategyParams: P([10,0,10,1,0,0,0,0]), action: 0, opponentBalance: 5 })));
  console.log('--- opp just above p2, p3=0 ---');
  console.log('a=2 opp=11 p2=10 =>', await trial(mk({ strategyParams: P([10,0,10,0,0,0,0,0]), action: 2, amount: 10, opponentBalance: 11 })));
  console.log('--- fortify precedence over extract-block ---');
  console.log('a=1 self=5 p1=10 opp=5 p2=10 =>', await trial(mk({ strategyParams: P([10,10,10,0,0,0,0,0]), action: 1, selfBalance: 5, opponentBalance: 5 })));
  console.log('--- HOLD when p3=1 but opp>p2 (extract available) ---');
  console.log('a=0 p3=1 opp=100 =>', await trial(mk({ strategyParams: P([10,0,0,1,0,0,0,0]), action: 0 })));
  console.log('a=2 p3=1 opp=100 =>', await trial(mk({ strategyParams: P([10,0,0,1,0,0,0,0]), action: 2, amount: 10 })));
  process.exit(0);
})();
