# groth16_verifier

Real Groth16 verifier program for Solvus devnet.

The repo no longer uses the old artifact-bound placeholder verifier. The active flow builds a real
Solana verifier from the Sunspot/Gnark artifacts generated for `circuits/target/solvus.vk`, and
`solvus` forwards raw `proof || public_inputs` bytes to this program over CPI.

## Current Devnet Deployment
- Program id: `EVA4sSUJ2V3cXkT9fHpSHWbVnxBfPuUQUtRChxwg36Cn`
- Verified upgrade on 2026-03-21:
  `5S3phU8J1wpSh4MV8Ns7S6BqJQnzemA1mGjUbDQNBcic99Gs4enBvSJVnA7G6Lcn7zashWGn2uXMivjfvLF8dzgQ`

## Build and Deploy
Use the repo-level helper:

```bash
npm run groth16:build-verifier
```

This script:
- patches the generated `gnark-solana` workspace for the Solana toolchain used here
- runs `cargo update` for the pinned dependency version
- calls `sunspot deploy` against `circuits/target/solvus.vk`

Then deploy both programs with:

```bash
npm run solana:deploy:devnet
```

After redeploying the verifier, always sync the protocol config:

```bash
npm run solana:init:protocol-config
```

## Related Runbook
For the full devnet procedure, active program IDs, verified transaction signatures, smoke-test
results, and the required compute budget for `mint_zkusd`, see `docs/DEVNET_RUNBOOK.md`.
