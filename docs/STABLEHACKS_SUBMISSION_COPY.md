# StableHacks Submission Copy

## One-Liner
Solvus is a permissioned BTC-backed zkUSD issuance vault on Solana for regulated institutions.

## Short Pitch
Solvus enables approved institutions to mint zkUSD from BTC collateral on Solana while keeping collateral proofs private with zero knowledge. Before issuance, a compliance gateway creates an institution profile and a short-lived mint permit bound to KYB, KYT, Travel Rule metadata, operator wallet, and mint caps. The protocol then verifies the proof, consumes the permit, updates institutional caps, and mints zkUSD on-chain.

## Problem
Institutional stablecoin infrastructure usually breaks in one of two ways:
- it is composable but not permissioned enough for regulated workflows
- it is permissioned but loses crypto-native transparency and programmability

That gap is especially visible when BTC collateral, privacy, and Solana settlement need to coexist under compliance controls.

## Solution
Solvus adds a compliance control plane on top of a BTC-backed ZK mint engine:
- `InstitutionAccount` stores the approved operator, KYB binding, mint caps, and institution status
- `CompliancePermit` stores a short-lived mint authorization with KYT score and Travel Rule reference
- compliance admins can inspect, suspend, reactivate, and revoke before settlement
- the mint consumes the permit on-chain and updates institutional usage counters

## Why It Fits Institutional Permissioned DeFi Vaults
- Permissioned issuance, not open retail minting
- Explicit operator gating and institution-level caps
- Compliance metadata tied into the mint path
- Admin controls for suspend / revoke
- Live audit visibility over institution and permit state
- Solana execution with a real devnet rehearsal

## Demo Talking Points
- Prepare a pending institutional mint and show the institution + permit state
- Suspend the institution and show state changes live
- Reactivate and revoke the permit
- Prepare a fresh permit and submit the operator mint
- Show the permit becomes `used` and institution counters increment

## Differentiators
- BTC-backed collateral with zero-knowledge proof path
- Permissioned control plane instead of a generic stablecoin dashboard
- On-chain audit surface for institution and permit state
- Solana-native execution with devnet-proofed flow
