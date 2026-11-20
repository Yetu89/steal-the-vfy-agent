// Test hypotheses: p1=extract threshold (opp>=p1), p2=fortify threshold (self<=p2),
// p3=turn condition, p0 bound, and whether p1/p2/p3 select HOLD/FORTIFY.
const snarkjs = require('snarkjs');
const { buildPoseidon } = require('circomlibjs');
async function trial(input) {
  try {
    await snarkjs.wtns.calculate(input, 'circuits/vfy-policy.wasm', '/tmp/p11.wtns');
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
  console.log('--- A: p3 values, a=2 amt=10 turn=1 ---');
  for (const p3 of [2, 5, 9]) console.log(`p3=${p3} =>`, await trial(mk({ strategyParams: P([10,0,0,p3,0,0,0,0]), action: 2, amount: 10 })));
  console.log('--- B: p3=1, a=0/1 ---');
  console.log('p3=1 a=0 =>', await trial(mk({ strategyParams: P([10,0,0,1,0,0,0,0]), action: 0 })));
  console.log('p3=1 a=1 =>', await trial(mk({ strategyParams: P([10,0,0,1,0,0,0,0]), action: 1 })));
  console.log('--- C: p2=1/2, a=0/1 (self=100) ---');
  for (const p2 of [1, 2]) {
    console.log(`p2=${p2} a=0 =>`, await trial(mk({ strategyParams: P([10,0,p2,0,0,0,0,0]), action: 0 })));
    console.log(`p2=${p2} a=1 =>`, await trial(mk({ strategyParams: P([10,0,p2,0,0,0,0,0]), action: 1 })));
  }
  console.log('--- D: fortify threshold? a=1, vary self & p2 ---');
  console.log('a=1 self=5  p2=10 =>', await trial(mk({ strategyParams: P([10,0,10,0,0,0,0,0]), action: 1, selfBalance: 5 })));
  console.log('a=1 self=5  p2=5  =>', await trial(mk({ strategyParams: P([10,0,5,0,0,0,0,0]), action: 1, selfBalance: 5 })));
  console.log('a=1 self=50 p2=10 =>', await trial(mk({ strategyParams: P([10,0,10,0,0,0,0,0]), action: 1, selfBalance: 50 })));
  console.log('a=1 self=5  p2=0  =>', await trial(mk({ strategyParams: P([10,0,0,0,0,0,0,0]), action: 1, selfBalance: 5 })));
  console.log('--- E: extract threshold? a=2 amt=10, vary opp & p1 ---');
  console.log('a=2 opp=5  p1=10 =>', await trial(mk({ strategyParams: P([10,10,0,0,0,0,0,0]), action: 2, amount: 10, opponentBalance: 5 })));
  console.log('a=2 opp=5  p1=1  =>', await trial(mk({ strategyParams: P([10,1,0,0,0,0,0,0]), action: 2, amount: 10, opponentBalance: 5 })));
  console.log('a=2 opp=100 p1=200 =>', await trial(mk({ strategyParams: P([10,200,0,0,0,0,0,0]), action: 2, amount: 10 })));
  console.log('a=2 opp=15 p1=10 =>', await trial(mk({ strategyParams: P([10,10,0,0,0,0,0,0]), action: 2, amount: 10, opponentBalance: 15 })));
  console.log('--- F: p0 bound ---');
  for (const v of [11, 15, 19]) console.log(`p0=${v} amt=${v} =>`, await trial(mk({ strategyParams: P([v,0,0,0,0,0,0,0]), action: 2, amount: v })));
  process.exit(0);
})();
