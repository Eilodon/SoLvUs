# Railway Runbook

Verified for the current repo shape on 2026-03-30.

## Goal

Run the public web service on Railway while keeping operator secrets and proving artifacts out of git.

The Railway runtime now supports materializing these secrets at boot:

- `COMPLIANCE_API_KEY`
- `SOLANA_WALLET_JSON` or `SOLANA_WALLET_B64`
- `SOLVUS_CIRCUIT_JSON_B64`
- `SOLVUS_GROTH16_CCS_B64`
- `SOLVUS_GROTH16_PK_B64`
- `SOLVUS_GROTH16_VK_B64`
- `NARGO_BIN_B64` optional
- `SUNSPOT_BIN_B64` optional

Bootstrap behavior:

- `SOLANA_WALLET_JSON` or `SOLANA_WALLET_B64` is written to `/app/.runtime-secrets/solana-wallet.json`
- Groth16 artifact variables are written into `/app/circuits/target`
- `NARGO_BIN_B64` and `SUNSPOT_BIN_B64` are written into `/app/.runtime-secrets/bin` and marked executable
- The bootstrap process exports `SOLANA_WALLET`, `NARGO_BIN`, and `SUNSPOT_BIN` before starting the prover server

## Required Railway Variables

Minimum for web + protected ops:

- `COMPLIANCE_API_KEY`
- `REDIS_URL=${{ Redis.REDIS_URL }}`
- `SOLVUS_ENV=devnet`
- active devnet IDs already used by the repo:
  - `SOLVUS_PROGRAM_ID`
  - `GROTH16_VERIFIER_PROGRAM_ID`
  - `ORACLE_PRICE_FEED_ID`
  - `ZKUSD_MINT_ADDRESS`
  - `ZKUSD_MINT_DECIMALS`
  - `SOLANA_CLUSTER_URL`
  - `COLLATERAL_RATIO_BPS`
  - `ORACLE_MAX_STALENESS_SECONDS`

Minimum for full proof + mint path:

- one of:
  - `SOLANA_WALLET_JSON`
  - `SOLANA_WALLET_B64`
- all of:
  - `SOLVUS_CIRCUIT_JSON_B64`
  - `SOLVUS_GROTH16_CCS_B64`
  - `SOLVUS_GROTH16_PK_B64`
  - `SOLVUS_GROTH16_VK_B64`
- and one of:
  - `NARGO_BIN` plus `SUNSPOT_BIN` already available in the image
  - `NARGO_BIN_B64` plus `SUNSPOT_BIN_B64`

## Local Encoding Examples

Wallet JSON as raw string:

```bash
export SOLANA_WALLET_JSON="$(cat ~/.config/solana/id.json)"
```

Wallet JSON as base64:

```bash
base64 -w0 ~/.config/solana/id.json
```

Groth16 artifacts:

```bash
base64 -w0 circuits/target/solvus.json
base64 -w0 circuits/target/solvus.ccs
base64 -w0 circuits/target/solvus.pk
base64 -w0 circuits/target/solvus.vk
```

Linux binaries:

```bash
base64 -w0 /path/to/nargo
base64 -w0 /path/to/sunspot
```

On macOS, replace `base64 -w0` with `base64 | tr -d '\n'`.

## Health Expectations

After a correct setup:

- `/health` should report `cache_backend: "redis"`
- `/health` should report `devnet_mint.wallet_configured: true`
- `POST /compliance/warm-oracle` should stop failing with `Missing Solana wallet`
- `POST /compliance/warm-proof` should stop failing with `Missing Groth16 artifact`

## Security Notes

- Do not store `COMPLIANCE_API_KEY` in `config/*.env`
- Do not use `VITE_COMPLIANCE_API_KEY`
- Rotate `COMPLIANCE_API_KEY` whenever a demo key was exposed in logs, docs, chat, or recordings
- Keep Railway project or account tokens out of repo and revoke any tokens pasted into chat
