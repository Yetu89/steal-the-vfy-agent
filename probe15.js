// Hunt publicSignals[0]: try many Poseidon preimages against v1 target.
const { buildPoseidon } = require('circomlibjs');
(async () => {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const P = (arr) => F.toString(poseidon(arr.map(BigInt)));
  const C = '8575102341873933184712056394397256666093184392580400975306446864745332843799';
  const TARGET = '1243904711429961858774220647610724273798918457991486031567244100767259239747';
  const M='1', T='1', S='100', O='100', A='2', Amt='10', V='1', SALT='0';
  const params = ['10','0','0','0','0','0','0','0'];
  const candidates = {
    'game only [M,T,S,O]': [M,T,S,O],
    '[C,M,T,S,O]': [C,M,T,S,O],
    '[M,T,S,O,C]': [M,T,S,O,C],
    '[M,T,S,O,A,Amt]': [M,T,S,O,A,Amt],
    '[M,T,S,O,A,Amt,V]': [M,T,S,O,A,Amt,V],
    '[SALT,M,T,S,O]': [SALT,M,T,S,O],
    '[M,T,S,O,V]': [M,T,S,O,V],
    '[V,M,T,S,O]': [V,M,T,S,O],
    '[M,T,S,O,C,A,Amt,V]': [M,T,S,O,C,A,Amt,V],
    '[C,M,T,S,O,A,Amt,V] reversed?': [V,Amt,A,O,S,T,M,C],
    '[A,Amt,M,T,S,O]': [A,Amt,M,T,S,O],
    '[M,T,S,O,A,Amt,V,C]': [M,T,S,O,A,Amt,V,C],
    'params+game [p0..p7,M,T,S,O]': [...params,M,T,S,O],
    'params+salt+game': [...params,SALT,M,T,S,O],
    '[M,T,S,O,A,Amt,V,SALT]': [M,T,S,O,A,Amt,V,SALT],
    '[S,O,M,T]': [S,O,M,T],
    '[T,M,S,O]': [T,M,S,O],
    '[M,S,O,T]': [M,S,O,T],
    'all inputs order': [A,Amt,O,S,T,M,C,V,SALT,...params],
    'all inputs v2': [C,M,T,S,O,A,Amt,V,SALT],
    '[C,SALT,M,T,S,O,A,Amt,V]': [C,SALT,M,T,S,O,A,Amt,V],
  };
  let hit = null;
  for (const [name, arr] of Object.entries(candidates)) {
    const h = P(arr);
    const ok = h === TARGET;
    if (ok) hit = name;
    console.log((ok ? '*** MATCH *** ' : '') + name.padEnd(32), '=>', h.slice(0, 16) + '...', ok ? 'MATCH' : '');
  }
  console.log(hit ? 'FOUND: ' + hit : 'no match among candidates');
  process.exit(0);
})();
