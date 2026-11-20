// Full Groth16 prove with a passing input; dump public signals.
// Plus: amount semantics for HOLD, p2 boundary, p0=16/amt=5.
const snarkjs = require('snarkjs');
const { buildPoseidon } = require('circomlibjs');
async function trial(input) {
  try {
    await snarkjs.wtns.calculate(input, 'circuits/vfy-policy.wasm', '/tmp/p13.wtns');
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
  console.log('--- amount semantics for HOLD ---');
  console.log('p3=1 a=0 amt=5  =>', await trial(mk({ strategyParams: P([10,0,0,1,0,0,0,0]), action: 0, amount: 5 })));
  console.log('p3=1 a=0 amt=10 =>', await trial(mk({ strategyParams: P([10,0,0,1,0,0,0,0]), action: 0, amount: 10 })));
  console.log('p1=200 a=1 amt=5 self=100 =>', await trial(mk({ strategyParams: P([10,200,0,0,0,0,0,0]), action: 1, amount: 5, selfBalance: 100 })));
  console.log('--- p2 boundary (strict > ?) ---');
  console.log('opp=10 p2=10 a=2 =>', await trial(mk({ strategyParams: P([10,0,10,0,0,0,0,0]), action: 2, amount: 10, opponentBalance: 10 })));
  console.log('opp=11 p2=10 a=2 =>', await trial(mk({ strategyParams: P([10,0,10,0,0,0,0,0]), action: 2, amount: 10, opponentBalance: 11 })));
  console.log('--- p0=16 amt=5 (cap vs equality) ---');
  console.log('p0=16 amt=5 =>', await trial(mk({ strategyParams: P([16,0,0,0,0,0,0,0]), action: 2, amount: 5 })));
  console.log('p0=16 amt=10 =>', await trial(mk({ strategyParams: P([16,0,0,0,0,0,0,0]), action: 2, amount: 10 })));
  console.log('--- FULL PROVE + public signals ---');
  const input = mk({ strategyParams: P([10,0,0,0,0,0,0,0]), action: 2, amount: 10 });
  const t0 = Date.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, 'circuits/vfy-policy.wasm', 'circuits/vfy-policy_final.zkey');
  console.log('prove time ms:', Date.now() - t0);
  console.log('publicSignals (9):', JSON.stringify(publicSignals, null, 1));
  const vk = require('./circuits/vk.json');
  console.log('verify:', await snarkjs.groth16.verify(vk, publicSignals, proof));
  // Vary turnNumber + matchId, see which public signals move
  const input2 = mk({ strategyParams: P([10,0,0,0,0,0,0,0]), action: 2, amount: 10, turnNumber: 7, matchId: 99, selfBalance: 80, opponentBalance: 120 });
  const r2 = await snarkjs.groth16.fullProve(input2, 'circuits/vfy-policy.wasm', 'circuits/vfy-policy_final.zkey');
  console.log('publicSignals v2 (turn=7 match=99 self=80 opp=120):', JSON.stringify(r2.publicSignals));
  process.exit(0);
})();
