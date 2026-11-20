// Find a PASSING witness: sweep action/amount/balances with params[0] in {1,10},
// and params[1] variations. Commitment always recomputed.
const snarkjs = require('snarkjs');
const { buildPoseidon } = require('circomlibjs');

async function trial(input) {
  try {
    await snarkjs.wtns.calculate(input, 'circuits/vfy-policy.wasm', '/tmp/p9.wtns');
    return 'PASS';
  } catch (e) {
    const m = String(e.message).match(/line: (\d+)/);
    return 'L' + (m ? m[1] : '?');
  }
}

(async () => {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const commit = (params, salt) =>
    F.toString(poseidon([...params.map(BigInt), BigInt(salt)]));
  const mk = (o = {}) => {
    const base = {
      action: 0, amount: 0, opponentBalance: 100, selfBalance: 100,
      turnNumber: 1, matchId: 1, circuitVersion: 1, salt: 0,
      strategyParams: [0,0,0,0,0,0,0,0],
    };
    const input = { ...base, ...o };
    input.commitment = commit(input.strategyParams, input.salt);
    return input;
  };
  const results = {};
  const record = (label, r) => { results[r] = (results[r] || []); results[r].push(label); };
  // Sweep 1: params[0]=10, params[1..3]=0
  for (const action of [0,1,2]) {
    for (const amount of [0,1,5,10]) {
      for (const [s,o] of [[100,100],[50,100],[100,50],[150,50],[50,150]]) {
        const r = await trial(mk({ strategyParams: [10,0,0,0,0,0,0,0], action, amount, selfBalance: s, opponentBalance: o }));
        record(`p0=10 a=${action} amt=${amount} s=${s} o=${o}`, r);
      }
    }
  }
  // Sweep 2: params[0]=1
  for (const action of [0,1,2]) {
    for (const amount of [0,1,5,10]) {
      const r = await trial(mk({ strategyParams: [1,0,0,0,0,0,0,0], action, amount }));
      record(`p0=1 a=${action} amt=${amount} s=100 o=100`, r);
    }
  }
  // Sweep 3: params[1]=10 (extract amount?) with action=2
  for (const action of [0,1,2]) {
    for (const amount of [0,5,10]) {
      const r = await trial(mk({ strategyParams: [10,10,0,0,0,0,0,0], action, amount }));
      record(`p0=10 p1=10 a=${action} amt=${amount}`, r);
    }
  }
  // Sweep 4: params[0]=10, params[2]=10, params[3]=10
  for (const action of [0,1,2]) {
    const r = await trial(mk({ strategyParams: [10,0,10,10,0,0,0,0], action, amount: 0 }));
    record(`p0=10 p2=10 p3=10 a=${action} amt=0`, r);
  }
  console.log(JSON.stringify(results, null, 1));
  process.exit(0);
})();
