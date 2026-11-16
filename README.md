# yetu-vfy — Steal the VFY agent for zkVerify Agent Games

Agent for the **Steal the VFY** head-to-head track (20 turns, 100 VFY each,
7 Swiss rounds, prize track 100,000 VFY). Account: **@yetu891**.

What it does: receives a signed turn envelope, verifies the HMAC on the raw
body **before** parsing, decides a move with a deterministic strategy, and
generates a **real Groth16 policy proof** with the official `vfy-policy`
circuit (snarkjs, Circom 2.x, BN128) — then returns a signed response.
Fail closed everywhere: no proof → HOLD, no proof object is ever faked.

## Strategy (committed)

Params `[10, 30, 0, 0, 0, 0, 0, 0]`, salt + commitment in `.env` (never
committed) and below. Decision tree — **this is exactly what the circuit
enforces**, so the proof always matches the decision:

| Condition | Action |
|---|---|
| `selfBalance < 30` | FORTIFY (protect when clearly behind) |
| `opponentBalance > 0` (mode 0) | EXTRACT **10** (max, free) |
| otherwise | HOLD (extract blocked because opponent is at 0) |

Rationale: EXTRACT is free and capped at 10, so taking the max whenever
the opponent has anything exposed dominates HOLD (which gains nothing).
FORTIFY costs 2 VFY, so it is reserved for when clearly behind.
`params[2] = 0` means "extract whenever the opponent balance is above 0".

- `params[0]` = extract amount (1..10, must equal the EXTRACT amount)
- `params[1]` = fortify threshold: FORTIFY when `selfBalance < params[1]`
- `params[2]` = extract threshold: EXTRACT only when `opponentBalance > params[2]`
- `params[3]` = mode: `0` = prefer EXTRACT, `1` = prefer HOLD
- `params[4..7]` = reserved, must be 0

**Committed values (build time):**

- Strategy params: `[10, 30, 0, 0, 0, 0, 0, 0]`
- Commitment (`Poseidon(params, salt)`): `21155568335055614702656391551987104887493940434888594399204107638455350886594`
- Salt: in `.env` on the host (`AGENT_STRATEGY_SALT`) — never in this repo.
- Circuit: `vfy-policy`, vkHash
  `0x6c56509f1c56fd1fd4e9737f906d2220f4b95f1d507f1adf6899085bd74be047`
  (registered on zkVerify mainnet by the platform).

## How the circuit was understood (no docs needed)

The official guide does not publish the circuit source or the input list, so
the interface was recovered from the artifacts themselves
(`circuits/vfy-policy.wasm` + `vfy-policy_final.zkey`):

- `snarkjs zkey export verificationkey` → Groth16/BN128, **9 public signals**.
- Witness-calculator oracle (FNV hash of candidate names) → 17 inputs:
  `action, amount, opponentBalance, selfBalance, turnNumber, matchId,
  commitment, circuitVersion, salt, strategyParams[8]`.
- Differential probing of the assertion lines → the decision tree above,
  including strict comparisons (`self < params[1]`, `opp > params[2]`),
  `amount == params[0]` for EXTRACT, `amount == 0` for HOLD/FORTIFY,
  `params[0]` in 1..10 (range check to 16, amount cap 10),
  `params[3]` in {0,1}, `params[4..7] == 0`.
- `commitment == Poseidon(strategyParams, salt)` (circomlib Poseidon) —
  verified: the commitment in public signal [1] equals the Poseidon hash.
- Public signals (output-then-public order):
  `[0] publicInputsHash, [1] commitment, [2] matchId, [3] turnNumber,
  [4] selfBalance, [5] opponentBalance, [6] action, [7] amount,
  [8] circuitVersion`. Action enum: HOLD=0, FORTIFY=1, EXTRACT=2.
- Full proof generation takes ~1.2s locally and verifies with
  `snarkjs groth16 verify` against `circuits/vk.json`.

## Run locally

```bash
cp .env.example .env   # fill AGENT_GAMES_HMAC_SECRET + AGENT_STRATEGY_SALT
npm ci --ignore-scripts
npm test               # self-test: HMAC, decisions, REAL proofs, timing
npm start              # listens on $PORT (default 3000)
```

`GET /health` returns protocol/status (unsigned).
`POST /agent` (or `/`) expects a signed JSON turn envelope and returns a
signed JSON response. A signed request without `matchId`+`turn` (preflight)
gets a signed `protocol: "v1"` ack.

## Response shape

```json
{
  "matchId": 1, "turn": 1,
  "action": "EXTRACT", "amount": 10,
  "idempotencyKey": "1:1",
  "reason": "extract_max",
  "policyProof": {
    "circuitVersion": "1",
    "proof": { "pi_a": ["..",".."], "pi_b": [["..",".."],["..",".."]], "pi_c": ["..",".."] },
    "public_signals": ["..", "..", "..", "..", "..", "..", "..", "..", ".."]
  },
  "publicInputsHash": "<publicSignals[0]>"
}
```

`amount` is omitted entirely for HOLD/FORTIFY (the schema rejects it even
as 0). Every response is signed with `x-agent-games-signature` (HMAC-SHA256
over the raw response body, same secret as inbound). `idempotencyKey` is
deterministic per turn (`matchId:turn`) so platform retries are idempotent.
`proofReference` (Kurier job) is optional per the guide and omitted unless
Kurier is configured — the platform re-verifies the proof itself.

## Dashboard steps (owner, via browser)

1. Register the agent: repo URL `https://github.com/Yetu89/steal-the-vfy-agent`,
   endpoint URL = the deployed public HTTPS URL (see below).
2. Copy the HMAC secret shown **once** at registration → set
   `AGENT_GAMES_HMAC_SECRET` in the host `.env` and restart the server.
3. Commit the strategy: register commitment
   `21155568335055614702656391551987104887493940434888594399204107638455350886594`
   (Poseidon of `[10,30,0,0,0,0,0,0]` + the salt in `.env`) with
   circuit version `1` — **before Swiss Round 1 / the next round pairing**.
4. Run the health check, the signed preflight, and at least 1 practice task.
   Practice tasks do not affect the leaderboard (max 10 dispatches/agent/hour).
5. Prize eligibility (dashboard, not code): connect GitHub + a wallet.

## Deployment

The endpoint must be public HTTPS on the standard port (no localhost,
private IP, or custom port) and stay up — offline = forfeit that task.
Current deployment: Node server on the build host + Cloudflare quick tunnel
(`trycloudflare.com`) for public HTTPS. If the tunnel restarts, its URL
changes and the dashboard endpoint must be updated. See `DEPLOY.md`.

## Security notes

- HMAC is verified on the **raw body before parsing**; bad signature → 401.
- The HMAC secret and the strategy salt live **only** in `.env` (git-ignored),
  never in the repo or in any AI tool.
- No private keys, no seed phrases, no wallet signing, no payments anywhere
  in this codebase. Kurier submission is optional and disabled by default
  (needs `KURIER_API_KEY` + `KURIER_API_URL`); zkVerifyJS is not used
  (it needs a funded seed phrase).
- The server never trusts its own decision alone: the proof is generated
  from the same inputs it returns, and `npm test` verifies a proof locally
  before every deploy.

## Known unknowns (verify on the first practice task)

- The exact turn-envelope field names (`gameState.myBalance` /
  `opponentBalance` / `commitment` are read defensively with fallbacks).
- `matchId` format: numeric is used as-is; a non-numeric string is mapped
  deterministically to a field element (SHA-256 mod the BN128 prime).
- `circuitVersion` value expected by the platform (default `"1"`; the
  dashboard shows the version to register — keep it in sync).
- **Track lock risk:** two other participants reported Steal the VFY entries
  locking once Swiss pairing started (13 Nov); the event page says
  mid-tournament registration joins "from the next Swiss round, until the
  final round is paired". Register + commit as early as possible; if the
  track is locked, this same repo also documents the build for the
  Creator Track / Wildcard (open until 21 Nov).
