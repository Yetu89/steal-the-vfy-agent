// Probe v3: hunt the remaining 9 input elements (17 total, 8 known).
// Classifies: "Not all inputs" => EXISTS size 1; "Not enough values" => EXISTS array.
const snarkjs = require('snarkjs');
const CANDIDATES = [
  // array-style candidates
  'params', 'strategyParams', 'policyParams', 'thresholds', 'config',
  'inputs', 'values', 'data', 'balances', 'state', 'publicInputs',
  'strategyConfig', 'policyConfig', 'rules', 'ruleParams',
  // my balance variants
  'myBal', 'selfBalance', 'playerBalance', 'balanceA', 'balanceB',
  'balA', 'balB', 'aBalance', 'bBalance', 'balanceMe', 'balanceOpp',
  'oppBalance', 'theirBalance', 'myBalAfter', 'balanceAfter',
  // strategy params
  'extractThreshold', 'fortifyThreshold', 'aggression', 'risk',
  'leadThreshold', 'behindThreshold', 'defendThreshold', 'attackThreshold',
  'turnThreshold', 'lateTurn', 'earlyTurn', 'finalTurns', 'turnsRemaining',
  'minExtract', 'fortifyCost', 'extractCap', 'capAmount', 'extractLimit',
  'extractWhenBehind', 'fortifyWhenAhead', 'holdWhenEven',
  // history / opponent action
  'prevAction', 'prevTurn', 'lastAction', 'history', 'opponentAction',
  'oppAction', 'myAction', 'lastOpponentAction', 'oppPrevAction',
  // round / seed
  'roundNumber', 'swissRound', 'matchNumber', 'seed', 'random', 'rand',
  // commitment variants
  'opponentCommitment', 'oppCommitment', 'theirCommitment',
  'actionHash', 'decisionHash', 'moveHash', 'stateCommitment',
  'policyCommitment', 'commitmentSalt', 'commitHash',
  // pot / misc
  'vfy', 'pot', 'potBalance', 'pool', 'isExtract', 'isFortify', 'isHold',
  'expectedAction', 'allowedAction', 'validAction', 'turnIndex', 'index',
  'in1', 'in2', 'in3', 'in4', 'in5', 'in6', 'in7', 'in8', 'in9',
  's0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8',
  'x1', 'x2', 'y1', 'y2', 'h1', 'h2', 'h3',
  'salt2', 'salt3', 'commitment2', 'action2', 'amount2',
  'mySalt', 'playerSalt', 'strategySalt', 'commitSalt',
];
(async () => {
  const found = [];
  for (const name of CANDIDATES) {
    try {
      await snarkjs.wtns.calculate({ [name]: 0 }, 'circuits/vfy-policy.wasm', '/tmp/probe.wtns');
      found.push([name, 'EXISTS?? completed']);
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (msg.includes('Not all inputs')) found.push([name, 'EXISTS size=1']);
      else if (msg.includes('Not enough values')) found.push([name, 'EXISTS array: ' + msg.trim().split('\n')[0]]);
    }
  }
  console.log('=== BATCH3 FOUND ===');
  for (const [n, m] of found) console.log(n, '=>', m);
  console.log('=== count:', found.length, '===');
  process.exit(0);
})();
