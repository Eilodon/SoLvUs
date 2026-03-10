# Solvus Protocol
### Bitcoin Financial Identity Layer for Starknet
> Prove your Bitcoin worth. Unlock DeFi. Stay private.

## The Problem
Bitcoin holders sitting on life-changing wealth cannot access DeFi because protocols require wrapping BTC and exposing financial history on-chain. Currently, there's no way to prove "I'm a serious Bitcoin holder" without revealing your exact balance or Bitcoin address, leading to a massive capital inefficiency for long-term satoshi stackers.

## The Solution
Solvus lets Bitcoin holders prove solvency and holding behavior on Starknet using ZK proofs — without ever revealing their Bitcoin address, balance, or transaction history. A Whale Badge proves you hold above a threshold. A Hodler Badge proves long-term commitment. All verified on-chain, preserving absolute privacy for the user while providing reliability for protocols.

## How It Works
```text
  BTC Wallet (Xverse)
       │ sign identity
       ▼
  [Relayer] verify BTC data via Xverse API
       │ sign attestation
       ▼  
  [Noir ZK Circuit] dual ECDSA verify + threshold check
       │ generate proof
       ▼
  [Cairo Contract] verify proof via Garaga → mint badge
```

**Step 1:** Connect Xverse wallet and sign a deterministic identity message.  
**Step 2:** Relayer fetches your real-time BTC data (balance/UTXO age) — data is processed but never stored.  
**Step 3:** A ZK proof is generated locally: it proves your data meets a chosen threshold without revealing the actual value.  
**Step 4:** A soulbound Badge is minted on Starknet — instantly usable by any DeFi protocol to grant you better terms.

## Badge Types
| Badge Type | Basis | Tiers | Thresholds |
|---|---|---|---|
| **Whale** | BTC Balance | 1 - 4 | 0.1, 0.5, 1.0, 5.0 BTC |
| **Hodler** | Oldest UTXO Age | 1 - 2 | 180, 365 Days |
| **Stacker** | Total UTXOs | 1 - 3 | 5, 15, 30 UTXOs |

## DeFi Integration
```typescript
// Any Starknet protocol can verify in 1 line:
assert(solvus.is_badge_valid(borrower, WHALE_BADGE, tier: 2),
       "Need Whale Badge Tier 2+ to borrow");
```

## Tech Stack
- **ZK Circuit:** Noir (Aztec) — utilizing dual secp256k1 ECDSA verification + Poseidon nullifiers.
- **On-chain Verification:** Garaga verifier deployed on Starknet Sepolia.
- **Smart Contract:** Cairo — implementing 9-assertion proof verification and soulbound registry.
- **Bitcoin Wallet:** Xverse SDK — utilizing compact 64-byte signature format.
- **Privacy:** `pubkey_x` and `pubkey_y` never leave the ZK circuit environment.

## Live Demo
- **Testnet contract:** [0x00...000 (Sepolia)](https://sepolia.starkscan.co/contract/0x0000000000000000000000000000000000000000)
- **Demo Site:** [Live on Vercel (Coming Soon) / See video in walkthrough.md]

## Security Design
- **Nullifier:** Prevents double-minting the same badge type from the same Bitcoin address.
- **72h Expiry:** Forces regular proof renewal to mitigate price/balance volatility and flash loan attacks.
- **Relayer Attestation:** Relayer signs BTC data + timestamp to prevent user-side data tampering.
- **Private Inputs:** Bitcoin public keys are private inputs to the circuit — addresses never appear on-chain.

## Setup
```bash
# Install dependencies
npm install

# Run Prover Server (Terminal 1)
npm run server

# Run Demo UI (Terminal 2)
cd ui && npm install && npm run dev
```
