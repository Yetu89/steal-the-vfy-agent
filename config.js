// Config for the YetuPad... no — for the yetu891 Steal the VFY agent.
// Reads env vars; never commit real secrets. See .env.example.
'use strict';

const fs = require('fs');
const path = require('path');

function loadDotEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[m[1]] = v;
    }
  }
}
loadDotEnv();

function parseParams(raw, fallback) {
  if (!raw) return fallback;
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr.map(Number);
  } catch { /* fall through */ }
  return raw.split(',').map((s) => Number(s.trim()));
}

// Strategy params, committed on-chain as Poseidon(params, salt).
// Meaning (reverse-engineered from the official vfy-policy circuit, see README):
//   params[0] = extract amount (1..10, must equal the EXTRACT amount)
//   params[1] = fortify threshold: FORTIFY when selfBalance < params[1]
//   params[2] = extract threshold: EXTRACT only when opponentBalance > params[2]
//   params[3] = mode: 0 = prefer EXTRACT, 1 = prefer HOLD (when not fortifying)
//   params[4..7] = reserved, must be 0
const STRATEGY_PARAMS = parseParams(process.env.AGENT_STRATEGY_PARAMS, [10, 30, 0, 0, 0, 0, 0, 0]);

const config = {
  port: Number(process.env.PORT || 3000),
  // HMAC secret issued once at agent registration (dashboard -> Rotate Secret).
  // Prefer AGENT_GAMES_HMAC_SECRET; AGENT_HMAC_SECRET accepted as alias.
  hmacSecret: process.env.AGENT_GAMES_HMAC_SECRET || process.env.AGENT_HMAC_SECRET || '',
  strategyParams: STRATEGY_PARAMS,
  strategySalt: process.env.AGENT_STRATEGY_SALT || '',
  // Circuit version echoed in policyProof; must match the registered commitment.
  circuitVersion: String(process.env.AGENT_CIRCUIT_VERSION || '1'),
  // Optional: expected commitment hash; verified at startup when set.
  expectedCommitment: process.env.AGENT_COMMITMENT || '',
  circuitDir: process.env.CIRCUIT_DIR || path.join(__dirname, 'circuits'),
  vkHash: '0x6c56509f1c56fd1fd4e9737f906d2220f4b95f1d507f1adf6899085bd74be047',
  // Optional Kurier (on-chain verification). Disabled unless both are set.
  kurierApiKey: process.env.KURIER_API_KEY || '',
  kurierApiUrl: process.env.KURIER_API_URL || '',
  kurierChainId: process.env.KURIER_CHAIN_ID || '',
  agentName: 'yetu-vfy',
  track: 'steal-the-vfy',
};

function validateParams(params) {
  const errors = [];
  if (!Array.isArray(params) || params.length !== 8) errors.push('strategy params must be 8 numbers');
  if (params[0] < 1 || params[0] > 10) errors.push('params[0] (extract amount) must be 1..10');
  if (params[1] < 0) errors.push('params[1] (fortify threshold) must be >= 0');
  if (params[2] < 0) errors.push('params[2] (extract threshold) must be >= 0');
  if (params[3] !== 0 && params[3] !== 1) errors.push('params[3] (mode) must be 0 or 1');
  for (let i = 4; i < 8; i++) if (params[i] !== 0) errors.push(`params[${i}] (reserved) must be 0`);
  return errors;
}

module.exports = { config, validateParams };
