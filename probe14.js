// Verify public signal semantics:
// [1] == Poseidon(strategyParams, salt) ?  [0] == Poseidon of public signals [1..8] ?
const { buildPoseidon } = require('circomlibjs');
(async () => {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const P = (arr) => F.toString(poseidon(arr.map(BigInt)));
  const params = [10,0,0,0,0,0,0,0];
  const salt = 0;
  const commitment = P([...params, salt]);
  console.log('computed commitment :', commitment);
  console.log('publicSignals[1]   : 8575102341873933184712056394397256666093184392580400975306446864745332843799');
  console.log('match:', commitment === '8575102341873933184712056394397256666093184392580400975306446864745332843799');
  // public signals v1: [hash, commitment, matchId=1, turn=1, self=100, opp=100, action=2, amount=10, version=1]
  const sig = [commitment, '1', '1', '100', '100', '2', '10', '1'];
  const h1 = P(sig);
  console.log('Poseidon([1..8] in order):', h1);
  console.log('publicSignals[0] v1   : 1243904711429961858774220647610724273798918457991486031567244100767259239747');
  console.log('match:', h1 === '1243904711429961858774220647610724273798918457991486031567244100767259239747');
  // v2: turn=7 match=99 self=80 opp=120
  const sig2 = [commitment, '99', '7', '80', '120', '2', '10', '1'];
  const h2 = P(sig2);
  console.log('Poseidon v2:', h2);
  console.log('publicSignals[0] v2: 8410161454795396365952902494693671134406199604237528142112656430790181183230');
  console.log('match:', h2 === '8410161454795396365952902494693671134406199604237528142112656430790181183230');
  process.exit(0);
})();
