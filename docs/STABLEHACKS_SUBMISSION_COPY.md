# StableHacks Submission Copy

## One-Liner
Solvus is a permissioned BTC-backed zkUSD issuance vault on Solana for regulated institutions.

## Short Pitch
Solvus enables approved institutions to mint zkUSD from BTC collateral on Solana while keeping collateral proofs private with zero knowledge. Before issuance, a compliance gateway creates an institution profile and a short-lived mint permit bound to KYB, KYT, Travel Rule audit references, operator wallet, and mint caps. The protocol then verifies the proof, screens the operator against a devnet sanctions deny-list, consumes the permit, updates institutional caps, and mints zkUSD on-chain.

## Problem
Institutional stablecoin infrastructure usually breaks in one of two ways:
- it is composable but not permissioned enough for regulated workflows
- it is permissioned but loses crypto-native transparency and programmability

That gap is especially visible when BTC collateral, privacy, and Solana settlement need to coexist under compliance controls.

## Solution
Solvus adds a compliance control plane on top of a BTC-backed ZK mint engine:
- `InstitutionAccount` stores the approved operator, KYB binding, mint caps, and institution status
- `CompliancePermit` stores a short-lived mint authorization with KYT score and Travel Rule audit reference hash
- compliance admins can inspect, suspend, reactivate, and revoke before settlement
- protocol admins manage oracle policy and can pause issuance before settlement if the feed path is unsafe
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

## Travel Rule Audit Trail
Solvus currently stores a hashed audit reference for each Travel Rule decision on-chain per compliance permit. The compliance gateway now derives that hash from a structured off-chain record containing provider, decision reference, originator VASP, and beneficiary VASP fields. That creates an immutable link between every mint and its off-chain compliance record without claiming full VASP-to-VASP message routing on devnet.

Full IVMS101 payload exchange, originator and beneficiary data routing, and counterparty interoperability are Phase 2 work. The shipped demo is an auditable reference trail, not a complete Travel Rule network.

## KYB Audit Trail
`kyb_ref_hash` is an immutable on-chain reference to the institution approval decision used during onboarding. The compliance gateway derives it from a structured decision record and keeps the pre-image off-chain so the protocol can prove that a registered institution maps back to a specific KYB outcome without exposing sensitive data on-chain.

The shipped demo presents this as a privacy-preserving audit trail, not as a full KYB provider network. Provider adapters and regulator-facing evidence export are part of the next compliance gateway iteration.

## Oracle Architecture
- Phase 1 shipped: a single Pyth BTC/USD feed with configurable staleness checks on Solana devnet
- Phase 1 shipped: protocol admins can manually pause issuance if the oracle path is unsafe during operations or demo rehearsal
- Phase 2 roadmap: multi-oracle aggregation across Pyth, Switchboard, and Chainlink
- Planned hardening: circuit breaker pause when feeds diverge beyond policy bounds, followed by multisig-controlled resume

## Bitcoin Trust Model
Bitcoin collateral is currently attested by an authorized relayer path, and the Noir circuit proves that the submitted BTC data was signed by the relayer key registered in `ProtocolConfig`. That means the shipped system still assumes relayer and indexer integrity for BTC state.

The roadmap mitigation is relayer staking and slashing plus a longer-term move toward stronger Bitcoin verification primitives. The current demo should be presented as relayer-attested collateral, not trustless BTC light-client verification.

## Production Note
The current code already separates `protocol_admin` and `compliance_admin` responsibilities on-chain. The devnet demo still maps both roles to one local key for speed, but the production control plane is designed to move these roles behind a `3-of-5` Squads multisig plus MPC or HSM-backed operator custody. That keeps one compromised key from controlling the full system.
