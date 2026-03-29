# Devnet Runbook

Verified on 2026-03-29.

## Active Devnet IDs
- `GROTH16_VERIFIER_PROGRAM_ID=EVA4sSUJ2V3cXkT9fHpSHWbVnxBfPuUQUtRChxwg36Cn`
- `SOLVUS_PROGRAM_ID=Cik3PiifeUrKrWcAFsHM5R7ckQVkWAc9M9THrXVfanVR`
- `ORACLE_PRICE_FEED_ID=H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG`
- `ZKUSD_MINT_ADDRESS=AHmTVtUF66vt3jk64w96g33WYBT2Tpuha8NmGUPAoEJ8`
- Legacy pre-freeze devnet mint: `J7BfSKht4THCuJv4TbZpPhUtX7w8cF6LVGARnjzNyEz9`
- Fee payer / upgrade authority: `5VhvNSyQtpr4HTnXwruFjfUPpSm4hjNs62bpa2VAo551`

## Verified Transactions
- Latest verifier upgrade: `3U9bQqSvhh4CGSrBnCR3nxVmM5Uc6GVaeWW2GfWuZqPyUCmR3Qc91cDDTzgz9ziLAscG9c6PhdFfhdNtZmcUDX2m`
- Latest `solvus` upgrade with role split and protocol pause: `32naiyGExwV2DfEwkFS1fEnaMEC4ai9ahg9VUgdxCkL8hhz4DY8towLiFyF53Sw3FnTSU3GsmFrAnGnZ9Dh5FiDP`
- Latest `solvus` upgrade with holder freeze controls: `53T4PkgUA2PYYT7TPw2y1D8FDGnvsC7yhzwTFhiupxusZBACmPfp7mQBMBoqGd6RSQ69mrL3AbJjZBkpEETRRS28`
- `update_protocol_config` after role split migration: `6yMV3ezbCGeT32m8AxPcv23CWXHkkDyTwZoHJxNoF8KCf5dVfHD1aXjvhNGFibjSNMc6ExXEx5VF8gFifTNLuKU`
- Institutional suspend action: `5gP5cnJV9wetPhFMua1q9z3k6QKc7VswaSDykUUsbobHhmF3Ug4EJd649U5CY9L1ZqizBuCQieBLZA5ybdMxQx4W`
- Institutional reactivate action: `3vzDcGLPJwdE5CTgpYYTdD3mHdjjcUszduRDAgPHSzU7P7f5u6PfCghYEh5vvqyT1tL3AynnSo3RuEA6Q1EURihf`
- Permit revoke action: `3h8sSHQKczg3ZYbm3TLoiT7qEEVqG4z2mJc5HVTMLNL7kB573C873NDNdYoBqxR5aXPG7Eq2jGDanrw8d4tcTUV3`
- Protocol pause action: `5PYJWuASfFkr1biY7DjxEWhPEECajbpHXcwE63D1xgWxM25bA5MCVuNV1fJuMmZrT8DhGxX4VamP2Go2CQLrgWxr`
- Protocol resume action: `gNXM794dvPcFyfjTkx2hVzx46wwFrsXkzDd71Kmydudhy2jws54p8Utc5eNLkrLRKKjdmoEBx3dk1dF5fHwD9rJ`
- Institutional live mint submit: `2snPKSZgA2VPqQiseS569LHnk8reFUv1TH5Pyx77A6QMYSqGNzKzkJpQvW8D7sZ9wzAeuPpZBJuuNPJpnQjQM5V9`
- Freeze-enabled live institution upsert: `7DVq5dTmjApE1G9VD8Zj4Hm2GGjnZZ6qTo1CYZ4waHZc4mPQMFTuPnhFfTX97iwids58PcybB5hhKSSayqyfTo3`
- Freeze-enabled live permit issue: `2EMzpDCdDem3vtHmQ6btMkDsjQPbwmaKFMSQx35uTViY4QpowAztZjmSd8dfUEa6CZyMkKikYH7kwgzaGUyYneCS`
- Freeze-enabled live holder freeze: `3Y6WN9B336Po1DnxkdCM8VxfuN1PUkM5D5cmZEwnVFW5Eb4nYAJWFSj913gL2K9LESLVtVCGFhzyxFzUoLY2gZZ3`
- Freeze-enabled live holder thaw: `3LAucv1g1gm2d81Wu6XpSrn4tqNBGx5795gYqKT7pNXvYDi8BCL8xMH6YgbkfsarXX2kGvhWtQNMzxdX7zEAWjX`
- Freeze-enabled live mint submit: `3FMcbDcb74qainkwRzHgfXMDPRruvtdSAFDd6HN8wacBkUo1ZtUZaPGcs63ZMniZAyC1VE9PawCcMcePAs5jPF7j`

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

Note on holder freeze verification:
- The default devnet mint is now `AHmTVtUF66vt3jk64w96g33WYBT2Tpuha8NmGUPAoEJ8`, initialized with both `mintAuthority` and `freezeAuthority` set to the program PDA `DXL5BKH8RtE5hK5B3xddwccEfwvBERMaxRmiYdSJCmxV`.
- The legacy mint `J7BfSKht4THCuJv4TbZpPhUtX7w8cF6LVGARnjzNyEz9` remains a historical artifact from the pre-freeze provisioning flow and returns `MintFreezeAuthorityNotConfigured` for `set_zkusd_account_freeze`.

The prover server endpoints are:
- `POST /prove`
- `POST /mint-devnet`
- `POST /prepare-devnet-mint`
- `GET /compliance/state`
- `GET /compliance/audit-trail`
- `POST /compliance/warm-oracle`
- `POST /compliance/warm-proof`
- `POST /compliance/institution-status`
- `POST /compliance/revoke-permit`
- `POST /compliance/freeze-holder`
- `POST /compliance/thaw-holder`
- `POST /compliance/record-mint-submission`
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

COMPLIANCE_API_KEY=solvus-devnet-compliance-key \
npm run demo:preflight
```

## StableHacks Dress Rehearsal
The institutional rehearsal now covers three paths:

1. Warm-up rehearsal:
   - warm oracle freshness path
   - warm proof cache
2. Control-plane rehearsal:
   - prepare a pending institutional mint
   - inspect live institution + permit state
   - suspend the institution
   - reactivate the institution
   - revoke the permit
   - freeze and thaw the holder account
   - pause the protocol
   - resume the protocol
3. Live mint rehearsal:
   - prepare a fresh institutional mint for the operator wallet
   - submit the partially signed transaction
   - record the submitted signature in the compliance journal
   - verify `minted_total`, `current_period_minted`, permit `state=used`, and audit export readiness

Run it with:

```bash
# proof/oracle warm-up only
PROVER_SERVER_URL=http://127.0.0.1:3901 \
COMPLIANCE_API_KEY=solvus-devnet-compliance-key \
npm run stablehacks:smoke -- --phase=proof-only

# control-plane only
PROVER_SERVER_URL=http://127.0.0.1:3901 \
COMPLIANCE_API_KEY=solvus-devnet-compliance-key \
npm run stablehacks:smoke -- --phase=controls-only

# full rehearsal
PROVER_SERVER_URL=http://127.0.0.1:3901 npm run stablehacks:smoke
```

## Demo Preflight
Run this 10 minutes before any live recording or judge session:

```bash
COMPLIANCE_API_KEY=solvus-devnet-compliance-key \
PROVER_SERVER_URL=http://127.0.0.1:3901 \
npm run demo:preflight
```

This checks:
- prover `/health`
- devnet reachability
- oracle warm-up path
- proof warm-up path

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
