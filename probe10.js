// Isolate params[1..3] roles + HOLD/FORTIFY possibility + params[0] upper bound.
const snarkjs = require('snarkjs');
const { buildPoseidon } = require('circomlibjs');
async function trial(input) {
  try {
    await snarkjs.wtns.calculate(input, 'circuits/vfy-policy.wasm', '/tmp/p10.wtns');
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
  const P = (arr) => arr;
  console.log('--- isolate p2/p3 (a=2 amt=10, p0=10) ---');
  console.log('p2=10 p3=0  =>', await trial(mk({ strategyParams: P([10,0,10,0,0,0,0,0]), action: 2, amount: 10 })));
  console.log('p2=0  p3=10 =>', await trial(mk({ strategyParams: P([10,0,0,10,0,0,0,0]), action: 2, amount: 10 })));
  console.log('p2=1  p3=0  =>', await trial(mk({ strategyParams: P([10,0,1,0,0,0,0,0]), action: 2, amount: 10 })));
  console.log('p2=0  p3=1  =>', await trial(mk({ strategyParams: P([10,0,0,1,0,0,0,0]), action: 2, amount: 10 })));
  console.log('--- p1 role (p0=10) ---');
  for (const p1 of [1, 2, 3]) {
    for (const a of [0, 1, 2]) {
      console.log(`p1=${p1} a=${a} amt=${a === 2 ? 10 : 0} =>`, await trial(mk({ strategyParams: P([10,p1,0,0,0,0,0,0]), action: a, amount: a === 2 ? 10 : 0 })));
    }
  }
  console.log('--- HOLD/FORTIFY vs turn/balance (p0=10) ---');
  for (const t of [1, 5, 10, 20]) {
    console.log(`a=0 turn=${t} =>`, await trial(mk({ strategyParams: P([10,0,0,0,0,0,0,0]), action: 0, turnNumber: t })));
    console.log(`a=1 turn=${t} =>`, await trial(mk({ strategyParams: P([10,0,0,0,0,0,0,0]), action: 1, turnNumber: t })));
  }
  console.log('a=0 opp=5  =>', await trial(mk({ strategyParams: P([10,0,0,0,0,0,0,0]), action: 0, opponentBalance: 5 })));
  console.log('a=1 self=5 =>', await trial(mk({ strategyParams: P([10,0,0,0,0,0,0,0]), action: 1, selfBalance: 5 })));
  console.log('--- params[0] upper bound (a=2 amt=p0) ---');
  for (const v of [20, 32, 50, 64, 99]) {
    console.log(`p0=${v} amt=${v} =>`, await trial(mk({ strategyParams: P([v,0,0,0,0,0,0,0]), action: 2, amount: v })));
  }
  process.exit(0);
})();
