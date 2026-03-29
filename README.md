# Solvus Protocol
Permissioned BTC-backed zkUSD issuance vaults on Solana for regulated institutions.

Solvus combines BTC-collateralized minting, zero-knowledge collateral proofs, and an institutional control plane with KYB / KYT / Travel Rule-bound mint permits. The current repo is optimized for the StableHacks `Institutional Permissioned DeFi Vaults` track.

## Architecture
```text
Institution / operator wallet
  -> policy inputs (KYB, Travel Rule, caps, TTL)
Compliance gateway
  -> institution registry + short-lived permit
Relayer + Noir + prover
  -> BTC state + collateral proof + nullifier
Solana Anchor
  -> verify proof, consume permit, update caps, mint / burn zkUSD
```

## Repo Layout
- `packages/core`: source-of-truth TypeScript contracts, relayer flow, asset-bound nullifier logic, and deterministic dev fixtures.
- `packages/prover-server`: `/health`, proof APIs, compliance state APIs, and devnet mint orchestration.
- `packages/frontend`: institutional issuance desk plus compliance audit dashboard.
- `circuits`: Noir circuit and prover input fixtures.
- `solana`: Anchor workspace for `solvus` and `liquidation` programs.
- `docs`: ADRs, blueprint, and contracts that define the intended behavior.

## Current Status
- Legacy execution paths have been removed from the executable repo.
- Core schema, Noir inputs, frontend, and Anchor programs are aligned to the Solana design.
- Groth16 is the active proving path: the prover server materializes the current Noir witness contract into canonical verifier bytes, and `solvus` forwards `proof + public_inputs` over CPI.
- `solvus` now enforces institutional permissioning with `InstitutionAccount`, `CompliancePermit`, operator gating, mint caps, suspend / reactivate controls, and permit revoke.
- Devnet bring-up has been verified with the real Sunspot/Groth16 runtime, including `program deploy`, `update_protocol_config`, institutional control actions, and a successful end-to-end institutional mint rehearsal.

## StableHacks Thesis
Solvus is not positioned as a generic stablecoin. It is positioned as:

> A permissioned issuance vault where approved institutions mint zkUSD from BTC collateral on Solana, while compliance admins can inspect, suspend, revoke, and audit the mint path before settlement.

Supporting hackathon materials:
- Strategy and scope: [`docs/STABLEHACKS_INSTITUTIONAL_VAULT_STRATEGY.md`](docs/STABLEHACKS_INSTITUTIONAL_VAULT_STRATEGY.md)
- Submission copy: [`docs/STABLEHACKS_SUBMISSION_COPY.md`](docs/STABLEHACKS_SUBMISSION_COPY.md)
- 2-minute demo script: [`docs/STABLEHACKS_2MIN_VIDEO_SCRIPT.md`](docs/STABLEHACKS_2MIN_VIDEO_SCRIPT.md)

## Devnet Runbook
The current devnet procedure, known-good program IDs, verified transaction signatures, and the compute-budget requirement for `mint_zkusd` are documented in [`docs/DEVNET_RUNBOOK.md`](docs/DEVNET_RUNBOOK.md).

## Setup
```bash
npm install

# Run prover server on a dedicated port if 3001 is occupied
PROVER_PORT=3901 npm run server

# Run frontend against that prover server
VITE_PROVER_SERVER_URL=http://127.0.0.1:3901 npm run dev --workspace=@solvus/frontend

# Check TypeScript + Solana workspace
npm run typecheck
npm run solana:check

# Build the real Groth16 verifier from Sunspot artifacts
npm run groth16:build-verifier

# Deploy verifier + solvus to devnet
npm run solana:deploy:devnet

# Sync ProtocolConfig with the deployed verifier program id
npm run solana:init:protocol-config

# Generate deterministic sample inputs
npm run sample:prover-inputs

# Run the StableHacks institutional smoke rehearsal
PROVER_SERVER_URL=http://127.0.0.1:3901 npm run stablehacks:smoke
```
