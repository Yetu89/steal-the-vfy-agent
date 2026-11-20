// Differential probing: which input moves the failing assertion line?
const snarkjs = require('snarkjs');
const BASE = {
  action: 0, amount: 0, opponentBalance: 100, selfBalance: 100,
  turnNumber: 1, matchId: 1, commitment: 0, circuitVersion: 1, salt: 0,
  strategyParams: [0,0,0,0,0,0,0,0],
};
async function trial(mut) {
  const input = JSON.parse(JSON.stringify(BASE));
  mut(input);
  try {
    await snarkjs.wtns.calculate(input, 'circuits/vfy-policy.wasm', '/tmp/p5.wtns');
    return 'PASS (witness OK)';
  } catch (e) {
    const m = String(e.message).match(/line: (\d+)/);
    return 'FAIL line ' + (m ? m[1] : '?') + ' :: ' + String(e.message).trim().split('\n')[0].slice(0, 80);
  }
}
(async () => {
  const tests = [
    ['base', () => {}],
    ['circuitVersion=0', i => i.circuitVersion = 0],
    ['circuitVersion=2', i => i.circuitVersion = 2],
    ['circuitVersion=154', i => i.circuitVersion = 154],
    ['circuitVersion=3', i => i.circuitVersion = 3],
    ['action=1', i => i.action = 1],
    ['action=2', i => i.action = 2],
    ['action=3', i => i.action = 3],
    ['amount=10', i => i.amount = 10],
    ['amount=11', i => i.amount = 11],
    ['amount=1', i => i.amount = 1],
    ['matchId=0', i => i.matchId = 0],
    ['matchId=12345', i => i.matchId = 12345],
    ['turnNumber=0', i => i.turnNumber = 0],
    ['turnNumber=20', i => i.turnNumber = 20],
    ['turnNumber=21', i => i.turnNumber = 21],
    ['commitment=1', i => i.commitment = 1],
    ['commitment=123456', i => i.commitment = 123456],
    ['salt=1', i => i.salt = 1],
    ['salt=999', i => i.salt = 999],
    ['selfBalance=0', i => i.selfBalance = 0],
    ['opponentBalance=0', i => i.opponentBalance = 0],
    ['selfBalance=50', i => i.selfBalance = 50],
    ['opponentBalance=50', i => i.opponentBalance = 50],
    ['strategyParams[0]=1', i => i.strategyParams[0] = 1],
    ['strategyParams[1]=1', i => i.strategyParams[1] = 1],
    ['strategyParams[2]=1', i => i.strategyParams[2] = 1],
    ['strategyParams[3]=1', i => i.strategyParams[3] = 1],
    ['strategyParams[4]=1', i => i.strategyParams[4] = 1],
    ['strategyParams[5]=1', i => i.strategyParams[5] = 1],
    ['strategyParams[6]=1', i => i.strategyParams[6] = 1],
    ['strategyParams[7]=1', i => i.strategyParams[7] = 1],
    ['strategyParams all=10', i => i.strategyParams = [10,10,10,10,10,10,10,10]],
    ['strategyParams all=100', i => i.strategyParams = [100,100,100,100,100,100,100,100]],
  ];
  for (const [name, mut] of tests) {
    console.log(name.padEnd(28), '=>', await trial(mut));
  }
  process.exit(0);
})();
