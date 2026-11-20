// Hypothesis: commitment == Poseidon(strategyParams..., salt) (circomlib Poseidon).
// Try several preimage layouts; if one passes line 72 (or moves the failure), found it.
const snarkjs = require('snarkjs');
const { buildPoseidon } = require('circomlibjs');

const BASE = {
  action: 0, amount: 0, opponentBalance: 100, selfBalance: 100,
  turnNumber: 1, matchId: 1, commitment: 0, circuitVersion: 1, salt: 0,
  strategyParams: [0,0,0,0,0,0,0,0],
};

async function trial(input) {
  try {
    await snarkjs.wtns.calculate(input, 'circuits/vfy-policy.wasm', '/tmp/p6.wtns');
    return 'PASS';
  } catch (e) {
    const m = String(e.message).match(/line: (\d+)/);
    return 'FAIL line ' + (m ? m[1] : '?');
  }
}

(async () => {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const P = (arr) => F.toString(poseidon(arr.map(BigInt)));
  const params = BASE.strategyParams.map(BigInt);
  const salt = 0n;
  const layouts = {
    'Poseidon(params[8])': P(params),
    'Poseidon(params[8], salt)': P([...params, salt]),
    'Poseidon(salt, params[8])': P([salt, ...params]),
    'Poseidon(params[8], salt, action?)': P([...params, salt, 0n]),
  };
  for (const [name, h] of Object.entries(layouts)) {
    const input = JSON.parse(JSON.stringify(BASE));
    input.commitment = h;
    console.log(name.padEnd(34), 'commitment=', h.slice(0, 20) + '...', '=>', await trial(input));
  }
  // Also try non-zero params with matching Poseidon(params, salt)
  const params2 = [10,5,20,3,15,8,2,7].map(BigInt);
  const input2 = JSON.parse(JSON.stringify(BASE));
  input2.strategyParams = [10,5,20,3,15,8,2,7];
  input2.salt = 42;
  input2.commitment = P([...params2, 42n]);
  console.log('Poseidon(params2, salt=42)'.padEnd(34), '=>', await trial(input2));
  const input3 = JSON.parse(JSON.stringify(BASE));
  input3.strategyParams = [10,5,20,3,15,8,2,7];
  input3.salt = 42;
  input3.commitment = P(params2);
  console.log('Poseidon(params2) salt=42'.padEnd(34), '=>', await trial(input3));
  process.exit(0);
})();
