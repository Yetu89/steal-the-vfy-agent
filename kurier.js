// Optional Kurier submission (on-chain verification via zkVerify).
// The platform re-verifies the policy proof itself, so this is NOT required
// for scoring — proofReference is optional per the Builder Field Guide.
// It is DISABLED unless KURIER_API_KEY and KURIER_API_URL are both set.
// Endpoints follow the official zkVerify quickstart:
//   POST {API_URL}/submit-proof/{API_KEY}
//   GET  {API_URL}/job-status/{API_KEY}/{jobId}
// The vk for vfy-policy is already registered on zkVerify mainnet by the
// platform (vkHash 0x6c56...be047), so no register-vk step is needed here.
'use strict';

async function submitToKurier({ proof, publicSignals, vkHash, apiKey, apiUrl, chainId }) {
  if (!apiKey || !apiUrl) return null;
  const body = {
    proofType: 'groth16',
    vkRegistered: true,
    proofData: {
      proof,
      publicSignals,
      vk: vkHash,
    },
  };
  if (chainId !== '' && chainId !== undefined && chainId !== null) body.chainId = Number(chainId);
  const res = await fetch(`${apiUrl.replace(/\/$/, '')}/submit-proof/${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`kurier submit failed: ${res.status}`);
  const data = await res.json();
  return data.jobId || data.job_id || null;
}

module.exports = { submitToKurier };
