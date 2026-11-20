// Verify decision-tree hypothesis:
//   selfBalance <= params[1] -> FORTIFY(1)
//   else params[3]==0 -> EXTRACT(2) amount=params[0]
//   else -> HOLD(0)
// And probe params[2] role + params[0] exact bound.
const snarkjs = require('snarkjs');
const { buildPoseidon } = require('circomlibjs');
async function trial(input) {
  try {
    await snarkjs.wtns.calculate(input, 'circuits/vfy-policy.wasm', '/tmp/p12.wtns');
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
  console.log('--- fortify branch (p1 threshold) ---');
  console.log('a=1 self=100 p1=200 p3=0 =>', await trial(mk({ strategyParams: P([10,200,0,0,0,0,0,0]), action: 1, selfBalance: 100 })));
  console.log('a=1 self=5   p1=10  p3=0 =>', await trial(mk({ strategyParams: P([10,10,0,0,0,0,0,0]), action: 1, selfBalance: 5 })));
  console.log('a=1 self=5   p1=10  p3=1 =>', await trial(mk({ strategyParams: P([10,10,0,1,0,0,0,0]), action: 1, selfBalance: 5 })));
  console.log('a=2 self=5   p1=10  p3=0 =>', await trial(mk({ strategyParams: P([10,10,0,0,0,0,0,0]), action: 2, amount: 10, selfBalance: 5 })));
  console.log('a=0 self=5   p1=10  p3=0 =>', await trial(mk({ strategyParams: P([10,10,0,0,0,0,0,0]), action: 0, selfBalance: 5 })));
  console.log('a=1 self=0   p1=0   p3=0 =>', await trial(mk({ strategyParams: P([10,0,0,0,0,0,0,0]), action: 1, selfBalance: 0 })));
  console.log('a=2 self=100 p1=100 p3=0 =>', await trial(mk({ strategyParams: P([10,100,0,0,0,0,0,0]), action: 2, amount: 10, selfBalance: 100 })));
  console.log('a=1 self=100 p1=100 p3=0 =>', await trial(mk({ strategyParams: P([10,100,0,0,0,0,0,0]), action: 1, selfBalance: 100 })));
  console.log('--- params[2] role ---');
  console.log('a=2 opp=5  p2=10 =>', await trial(mk({ strategyParams: P([10,0,10,0,0,0,0,0]), action: 2, amount: 10, opponentBalance: 5 })));
  console.log('a=2 opp=5  p2=1  =>', await trial(mk({ strategyParams: P([10,0,1,0,0,0,0,0]), action: 2, amount: 10, opponentBalance: 5 })));
  console.log('a=2 opp=100 p2=200 =>', await trial(mk({ strategyParams: P([10,0,200,0,0,0,0,0]), action: 2, amount: 10 })));
  console.log('a=2 opp=100 p2=1000 =>', await trial(mk({ strategyParams: P([10,0,1000,0,0,0,0,0]), action: 2, amount: 10 })));
  console.log('--- (p2,p3) grid, a=1 ---');
  console.log('p2=1 p3=1 a=1 =>', await trial(mk({ strategyParams: P([10,0,1,1,0,0,0,0]), action: 1 })));
  console.log('p2=1 p3=1 a=0 =>', await trial(mk({ strategyParams: P([10,0,1,1,0,0,0,0]), action: 0 })));
  console.log('p2=1 p3=1 a=2 =>', await trial(mk({ strategyParams: P([10,0,1,1,0,0,0,0]), action: 2, amount: 10 })));
  console.log('--- params[0] exact bound ---');
  for (const v of [16, 17, 18]) console.log(`p0=${v} amt=${v} =>`, await trial(mk({ strategyParams: P([v,0,0,0,0,0,0,0]), action: 2, amount: v })));
  process.exit(0);
})();
