# Devnet Runbook

Verified on 2026-03-29.

## Active Devnet IDs
- `GROTH16_VERIFIER_PROGRAM_ID=EVA4sSUJ2V3cXkT9fHpSHWbVnxBfPuUQUtRChxwg36Cn`
- `SOLVUS_PROGRAM_ID=Cik3PiifeUrKrWcAFsHM5R7ckQVkWAc9M9THrXVfanVR`
- `ORACLE_PRICE_FEED_ID=H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG`
- `ZKUSD_MINT_ADDRESS=J7BfSKht4THCuJv4TbZpPhUtX7w8cF6LVGARnjzNyEz9`
- Fee payer / upgrade authority: `5VhvNSyQtpr4HTnXwruFjfUPpSm4hjNs62bpa2VAo551`

## Verified Transactions
- Real verifier upgrade: `5S3phU8J1wpSh4MV8Ns7S6BqJQnzemA1mGjUbDQNBcic99Gs4enBvSJVnA7G6Lcn7zashWGn2uXMivjfvLF8dzgQ`
- Previous `solvus` upgrade: `5NXvkiQ3eDicb1DZccx3npJf6AgsiTTTWYhnUNubB6PrNheosAvuoqdNdWrpmHaEXia8LEzSL2TTbSbUmKcQgfkC`
- Latest `solvus` upgrade with institutional controls: `sZwWuSoLuWqBS71MVwaHmH41ZGXfwa8U1kVgeoHXgCwBXRaWsCH9gUcFUZKCJ2SREqzLhs9of9eubaqCfA7WKus`
- `update_protocol_config`: `2pqY1tVoUiyLxQQnbeLd4zR6xkkA34AYjvtk117eLb6rADHCBNe28jr4Ts8E8QwHqD4Mq6dYxkxRsBJZqLtTzutA`
- Real proof `mint_zkusd` smoke test: `WqAxERPe3Qmtuzyqnak7TPimTaVQTvgvPQ4P5E1vBp3to4NB3uyeW7xERtVZqdhwig9E5xdad3CvKaDnzF3PzqR`
- Institutional suspend action: `23qzYwKKnk55UUiM8nLAwrPMoU2L7oNh5XKN17yG754S4wxPk3Y9qhngD3cPDrikzKCEVbzR5tgD3Dg3esXQYwLK`
- Institutional reactivate action: `3azmjkFPRAT1Mq6iqihuRsryA1nzC5PQBAM7W91zrihGh8yWF1KNqEabTNVMRTvixjsWJqk7yNeu9zUZi55XAKdE`
- Permit revoke action: `2tBTMzc7K53VqRi28JSujudzX1AJ1eAP62iq8XpX9XCLBz8N2vFWMitqL14NpZ5nShVThawPgWV14rZcdu2PeSD7`
- Institutional live mint submit: `4dgpGjPbZ2kZPHyP2BKgQUuJoHPKLYE9wpyfEMJQaxqnwmVXhjkYuJuwf34bndwuUHBnpNPFwYUkPCxVfHWnRyBp`

## Preconditions
- Solana CLI and SBF toolchain installed
- Noir / `nargo` installed
- Sunspot installed
- Devnet wallet funded
- `config/devnet.env` populated with the active IDs above

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

For local bring-up:
```bash
PROVER_PORT=3901 npm run server
```

If port `3001` is already occupied by another local project, point the frontend and smoke script at the dedicated port:

```bash
VITE_PROVER_SERVER_URL=http://127.0.0.1:3901 npm run dev --workspace=@solvus/frontend
PROVER_SERVER_URL=http://127.0.0.1:3901 npm run stablehacks:smoke
```

## StableHacks Dress Rehearsal
The institutional rehearsal now covers two paths:

1. Control-plane rehearsal:
   - prepare a pending institutional mint
   - inspect live institution + permit state
   - suspend the institution
   - reactivate the institution
   - revoke the permit
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

The mint transaction must request a higher budget before the `mint_zkusd` instruction. The current repo uses `800_000` CUs in `packages/prover-server/devnet_mint.ts`.

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
