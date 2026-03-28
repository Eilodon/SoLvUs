# Solvus Protocol
Bitcoin-collateralized zkUSD on Solana, driven from the specs in `docs/ADR.md`, `docs/BLUEPRINT.md`, and `docs/CONTRACTS.md`.

## Architecture
```text
Xverse / BTC wallet
  -> user signature -> nullifier secret
Relayer
  -> BTC data + signed commitment
Noir circuit
  -> threshold proof + nullifier hash
Prover Server
  -> idempotent /prove API
Solana Anchor
  -> verify proof, init PDA, mint / burn zkUSD
```

## Repo Layout
- `packages/core`: source-of-truth TypeScript contracts, relayer flow, nonce/nullifier logic, and deterministic dev fixtures.
- `packages/prover-server`: `/health` and `/prove` API with idempotency cache.
- `packages/frontend`: Solana-oriented runtime shell for proof requests.
- `circuits`: Noir circuit and prover input fixtures.
- `solana`: Anchor workspace for `solvus` and `liquidation` programs.
- `docs`: ADRs, blueprint, and contracts that define the intended behavior.

## Current Status
- Legacy execution paths have been removed from the executable repo.
- Core schema, Noir inputs, frontend, and Anchor scaffold are aligned to the Solana design.
- Groth16 is the active proving path: Noir exposes only `nullifier_hash` as a public input, the prover server returns real `proof + public_inputs`, and `solvus` forwards the canonical verifier payload over CPI.
- Devnet bring-up has been verified with the real Sunspot/Groth16 runtime, including `program deploy`, `update_protocol_config`, and a successful `mint_zkusd` smoke test.

## Devnet Runbook
The current devnet procedure, known-good program IDs, verified transaction signatures, and the compute-budget requirement for `mint_zkusd` are documented in [`docs/DEVNET_RUNBOOK.md`](docs/DEVNET_RUNBOOK.md).

## Setup
```bash
npm install

# Run prover server
npm run server

# Run frontend
npm run dev --workspace=@solvus/frontend

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
```
