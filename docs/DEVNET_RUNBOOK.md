# Devnet Runbook

Verified on 2026-03-29.

## Active Devnet IDs
- `GROTH16_VERIFIER_PROGRAM_ID=EVA4sSUJ2V3cXkT9fHpSHWbVnxBfPuUQUtRChxwg36Cn`
- `SOLVUS_PROGRAM_ID=Cik3PiifeUrKrWcAFsHM5R7ckQVkWAc9M9THrXVfanVR`
- `ORACLE_PRICE_FEED_ID=H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG`
- `ZKUSD_MINT_ADDRESS=J7BfSKht4THCuJv4TbZpPhUtX7w8cF6LVGARnjzNyEz9`
- Fee payer / upgrade authority: `5VhvNSyQtpr4HTnXwruFjfUPpSm4hjNs62bpa2VAo551`

## Verified Transactions
- Latest verifier upgrade: `3U9bQqSvhh4CGSrBnCR3nxVmM5Uc6GVaeWW2GfWuZqPyUCmR3Qc91cDDTzgz9ziLAscG9c6PhdFfhdNtZmcUDX2m`
- Latest `solvus` upgrade with role split and protocol pause: `32naiyGExwV2DfEwkFS1fEnaMEC4ai9ahg9VUgdxCkL8hhz4DY8towLiFyF53Sw3FnTSU3GsmFrAnGnZ9Dh5FiDP`
- `update_protocol_config` after role split migration: `6yMV3ezbCGeT32m8AxPcv23CWXHkkDyTwZoHJxNoF8KCf5dVfHD1aXjvhNGFibjSNMc6ExXEx5VF8gFifTNLuKU`
- Institutional suspend action: `5gP5cnJV9wetPhFMua1q9z3k6QKc7VswaSDykUUsbobHhmF3Ug4EJd649U5CY9L1ZqizBuCQieBLZA5ybdMxQx4W`
- Institutional reactivate action: `3vzDcGLPJwdE5CTgpYYTdD3mHdjjcUszduRDAgPHSzU7P7f5u6PfCghYEh5vvqyT1tL3AynnSo3RuEA6Q1EURihf`
- Permit revoke action: `3h8sSHQKczg3ZYbm3TLoiT7qEEVqG4z2mJc5HVTMLNL7kB573C873NDNdYoBqxR5aXPG7Eq2jGDanrw8d4tcTUV3`
- Protocol pause action: `5PYJWuASfFkr1biY7DjxEWhPEECajbpHXcwE63D1xgWxM25bA5MCVuNV1fJuMmZrT8DhGxX4VamP2Go2CQLrgWxr`
- Protocol resume action: `gNXM794dvPcFyfjTkx2hVzx46wwFrsXkzDd71Kmydudhy2jws54p8Utc5eNLkrLRKKjdmoEBx3dk1dF5fHwD9rJ`
- Institutional live mint submit: `2snPKSZgA2VPqQiseS569LHnk8reFUv1TH5Pyx77A6QMYSqGNzKzkJpQvW8D7sZ9wzAeuPpZBJuuNPJpnQjQM5V9`

## Preconditions
- Solana CLI and SBF toolchain installed
- Noir / `nargo` installed
- Sunspot installed
- Devnet wallet funded
- `config/devnet.env` populated with the active IDs above
- `COMPLIANCE_API_KEY` exported for protected devnet mint and compliance endpoints
- `ORACLE_MAX_STALENESS_SECONDS` optional override for `init-protocol-config` if the demo needs a stricter oracle freshness window
- `COLLATERAL_RATIO_BPS` optional override for `init-protocol-config` if the demo needs a non-default collateral requirement
- Redis optional: if unavailable, the prover server falls back to an in-memory cache and reports `cache_backend=memory` in `/health`

## Build Real Verifier
```bash
npm install
npm run groth16:build-verifier
```

This uses `scripts/build-real-verifier.sh`, patches the generated verifier workspace for the Solana toolchain in this repo, and deploy-builds the real Groth16 verifier from `circuits/target/solvus.vk`.

## Deploy to Devnet
```bash
npm run solana:deploy:devnet
```

This deploys:
- `circuits/target/solvus.so` to `EVA4sSUJ2V3cXkT9fHpSHWbVnxBfPuUQUtRChxwg36Cn`
- `solana/target/deploy/solvus.so` to `Cik3PiifeUrKrWcAFsHM5R7ckQVkWAc9M9THrXVfanVR`

Dry-run:
```bash
npm run solana:deploy:devnet -- --dry-run
```

## Sync Protocol Config
After every verifier redeploy or program-id change, update the on-chain config:

```bash
npm run solana:init:protocol-config
```

The script auto-selects `initialize_protocol_config` or `update_protocol_config` based on whether the PDA already exists.

## Smoke Test
Known-good runtime characteristics from the verified mint:
- Proof length: `388 bytes`
- Canonical verifier public witness length: `2220 bytes`
- Example successful nullifier: `0x1de7cdac7601fee2ddbab63f4d2750f698a3e902d46df3f4c3c6003442971248`

The prover server endpoints are:
- `POST /prove`
- `POST /mint-devnet`
- `POST /prepare-devnet-mint`
- `GET /compliance/state`
- `POST /compliance/institution-status`
- `POST /compliance/revoke-permit`
- `POST /protocol/pause`

For local bring-up:
```bash
COMPLIANCE_API_KEY=solvus-devnet-compliance-key \
PROVER_PORT=3901 \
npm run server
```

If port `3001` is already occupied by another local project, point the frontend and smoke script at the dedicated port:

```bash
VITE_PROVER_SERVER_URL=http://127.0.0.1:3901 \
VITE_COMPLIANCE_API_KEY=solvus-devnet-compliance-key \
npm run dev --workspace=@solvus/frontend

PROVER_SERVER_URL=http://127.0.0.1:3901 \
COMPLIANCE_API_KEY=solvus-devnet-compliance-key \
npm run stablehacks:smoke
```

## StableHacks Dress Rehearsal
The institutional rehearsal now covers two paths:

1. Control-plane rehearsal:
   - prepare a pending institutional mint
   - inspect live institution + permit state
   - suspend the institution
   - reactivate the institution
   - revoke the permit
   - pause the protocol
   - resume the protocol
2. Live mint rehearsal:
   - prepare a fresh institutional mint for the operator wallet
   - submit the partially signed transaction
   - verify `minted_total`, `current_period_minted`, and permit `state=used`

Run it with:

```bash
PROVER_SERVER_URL=http://127.0.0.1:3901 npm run stablehacks:smoke
```

## Operational Note: Compute Budget
Real verifier CPI is materially more expensive than the old scaffold path. A default Solana transaction budget of `200_000` CUs is not enough for `mint_zkusd`, and `400_000` CUs was also insufficient during verification on 2026-03-21.

The mint transaction must request a higher budget before the `mint_zkusd` instruction. The current repo uses `1_400_000` CUs in `packages/prover-server/devnet_mint.ts`.

If a client bypasses that path and builds the instruction manually, it must prepend:
- `ComputeBudgetProgram.setComputeUnitLimit({ units: 800_000 })`

Otherwise the expected failure mode is:
- `Program ... failed: Computational budget exceeded`

## Sanity Checks
Useful commands after deploy:

```bash
solana balance --keypair ~/.config/solana/id.json --url https://api.devnet.solana.com
solana program show Cik3PiifeUrKrWcAFsHM5R7ckQVkWAc9M9THrXVfanVR --url https://api.devnet.solana.com
solana program show EVA4sSUJ2V3cXkT9fHpSHWbVnxBfPuUQUtRChxwg36Cn --url https://api.devnet.solana.com
```
