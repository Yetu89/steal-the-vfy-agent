// Commitment scheme found: commitment = Poseidon(strategyParams[8], salt).
// Now map the remaining assertions with correct commitment, varying action/amount/etc.
const snarkjs = require('snarkjs');
const { buildPoseidon } = require('circomlibjs');

async function trial(input) {
  try {
    await snarkjs.wtns.calculate(input, 'circuits/vfy-policy.wasm', '/tmp/p7.wtns');
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
  console.log('--- action x amount grid (params zero) ---');
  for (const action of [0, 1, 2, 3]) {
    for (const amount of [0, 1, 5, 10, 11]) {
      console.log(`action=${action} amount=${amount}`.padEnd(26), '=>', await trial(mk({ action, amount })));
    }
  }
  console.log('--- circuitVersion sweep (action 0) ---');
  for (const v of [0, 1, 2, 3, 154]) {
    console.log(`circuitVersion=${v}`.padEnd(26), '=>', await trial(mk({ circuitVersion: v })));
  }
  console.log('--- turn/matchId sweep (action 0) ---');
  for (const t of [0, 1, 10, 20, 21]) {
    console.log(`turnNumber=${t}`.padEnd(26), '=>', await trial(mk({ turnNumber: t })));
  }
  for (const m of [0, 2, 12345]) {
    console.log(`matchId=${m}`.padEnd(26), '=>', await trial(mk({ matchId: m })));
  }
  console.log('--- balance sweep (action 0) ---');
  for (const [s, o] of [[100,100],[0,100],[100,0],[0,0],[50,150],[200,50],[1000,1000]]) {
    console.log(`self=${s} opp=${o}`.padEnd(26), '=>', await trial(mk({ selfBalance: s, opponentBalance: o })));
  }
  process.exit(0);
})();
