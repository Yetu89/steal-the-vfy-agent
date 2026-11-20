// Map strategyParams influence: vary one param at a time (commitment recomputed).
const snarkjs = require('snarkjs');
const { buildPoseidon } = require('circomlibjs');

async function trial(input) {
  try {
    await snarkjs.wtns.calculate(input, 'circuits/vfy-policy.wasm', '/tmp/p8.wtns');
    return 'PASS';
  } catch (e) {
    const m = String(e.message).match(/line: (\d+)/);
    return 'FAIL line ' + (m ? m[1] : '?');
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
  console.log('--- single param variations (action=0) ---');
  for (let i = 0; i < 8; i++) {
    for (const v of [1, 10, 100]) {
      const p = [0,0,0,0,0,0,0,0]; p[i] = v;
      console.log(`params[${i}]=${v}`.padEnd(22), '=>', await trial(mk({ strategyParams: p })));
    }
  }
  console.log('--- salt variations (params zero) ---');
  for (const s of [1, 42, 999, 123456]) {
    console.log(`salt=${s}`.padEnd(22), '=>', await trial(mk({ salt: s })));
  }
  console.log('--- params2 with different actions ---');
  const p2 = [10,5,20,3,15,8,2,7];
  for (const a of [0,1,2]) {
    for (const amt of [0,5,10]) {
      console.log(`p2 action=${a} amt=${amt}`.padEnd(22), '=>', await trial(mk({ strategyParams: p2, salt: 42, action: a, amount: amt })));
    }
  }
  process.exit(0);
})();
