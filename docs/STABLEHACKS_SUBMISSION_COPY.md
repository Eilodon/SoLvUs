# StableHacks Submission Copy

## One-Liner
Solvus is the permissioned issuance infrastructure AMINA Bank-style institutional clients need to mint BTC-backed zkUSD on Solana under an explicit compliance control plane.

## Short Pitch
Solvus lets a compliance officer onboard an institution, bind KYB and Travel Rule evidence to a short-lived mint permit, and authorize an operator to mint zkUSD from BTC collateral on Solana. The protocol uses a real Groth16/Noir proof path, verifies the permit on-chain, screens the operator against a devnet sanctions deny-list, updates institutional caps, and records an auditable issuance trail that can be exported by the compliance gateway.

## Problem
Institutional stablecoin infrastructure usually fails one of three tests:
- it is composable but not permissioned enough for regulated workflows,
- it is permissioned but not transparent enough for on-chain auditability,
- or it treats compliance as an off-chain checkbox instead of an enforceable operating surface.

That gap becomes sharper when Bitcoin collateral, Solana settlement, Travel Rule evidence, and intervention controls must coexist in one workflow.

## Solution
Solvus adds a compliance control plane on top of a BTC-backed issuance engine:
- `InstitutionAccount` stores the approved operator, KYB binding, mint caps, and institution status
- `CompliancePermit` stores a short-lived mint authorization with KYT score and Travel Rule audit reference hash
- compliance admins can inspect, suspend, reactivate, revoke, freeze holder accounts, and export the audit trail
- protocol admins manage oracle policy and can pause issuance before settlement if the feed path is unsafe
- the mint consumes the permit on-chain and updates institutional usage counters

## Why AMINA Bank Would Pilot This
Scenario: a Swiss institutional client holds a BTC treasury position and wants liquidity without selling the underlying collateral.

With Solvus:
1. the compliance officer creates the institution profile,
2. KYB and Travel Rule evidence are attached to the permit path,
3. the operator receives a short-lived, wallet-bound mint authorization,
4. the operator signs the mint leg,
5. the protocol verifies the proof, consumes the permit, updates caps, and settles on Solana,
6. the compliance team can suspend, revoke, freeze, export, or review the full trail at any point.

This is not a retail stablecoin dashboard. It is a regulated issuance workflow.

## Why It Fits Institutional Permissioned DeFi Vaults
- Permissioned issuance, not open retail minting
- Explicit operator gating and institution-level caps
- Compliance metadata tied into the mint path
- Admin controls for suspend / revoke / freeze / pause
- Live audit visibility over institution and permit state
- Structured audit export from the compliance gateway
- Solana execution with a real devnet rehearsal

## Demo Talking Points
- Open the `Compliance` view and show the institution profile, permit card, and audit trail
- Switch to `Operator` view and prepare the operator mint with BTC price guard visible
- Show the permit-bound browser-wallet mint flow and record the submitted Solana signature
- Return to `Compliance` and demonstrate suspend / revoke / freeze powers
- Export the audit trail as CSV

## Differentiators
- Real Groth16-backed collateral proof path instead of a mock demo
- Permissioned control plane instead of a generic stablecoin dashboard
- On-chain audit surface for institution and permit state
- Compliance gateway can export the institution trail as machine-readable evidence
- Solana-native execution with devnet-proofed flow

## Travel Rule Audit Trail
Solvus stores a hashed Travel Rule audit reference on-chain per permit, while the compliance gateway keeps the pre-image off-chain as an IVMS101-aligned structured record. That record includes:
- originator VASP identity,
- beneficiary VASP identity,
- transfer metadata,
- compliance decision provider and decision reference.

`travel_rule_ref_hash = SHA256(travelRuleRecord)` creates an immutable link between each mint and its off-chain Travel Rule record without exposing identity data on-chain.

Full IVMS101 payload exchange, originator and beneficiary data routing, and counterparty interoperability are Phase 2 work. The shipped demo is an auditable reference trail, not a complete Travel Rule network.

## KYB Audit Trail
`kyb_ref_hash` is an immutable on-chain reference to the institution approval decision used during onboarding. The compliance gateway derives it from a structured decision record and keeps the pre-image off-chain so the protocol can prove that a registered institution maps back to a specific KYB outcome without exposing sensitive data on-chain.

The shipped demo presents this as a privacy-preserving audit trail, not as a full KYB provider network. Provider adapters and deeper regulator-facing evidence bundles are Phase 2 work.

## Compliance Export
Compliance admins can export the institution trail as `json` or `csv`, including:
- onboarding and permit records,
- status-change actions,
- mint preparation and submission records,
- tx signatures that anchor the off-chain compliance log back to Solana execution.

## Oracle Architecture
- Phase 1 shipped: a single Pyth BTC/USD feed with configurable staleness checks on Solana devnet
- Phase 1 shipped: callers can enforce a `min_btc_price_e8` execution guard to avoid minting under a worse-than-expected price
- Phase 1 shipped: protocol admins can manually pause issuance if the oracle path is unsafe during operations or demo rehearsal
- Phase 2 roadmap: multi-oracle aggregation across Pyth, Switchboard, and Chainlink
- Planned hardening: circuit breaker pause when feeds diverge beyond policy bounds, followed by multisig-controlled resume

## Bitcoin Trust Model
Phase 1 shipped: Bitcoin collateral is relayer-attested. The Noir circuit proves that the submitted BTC data was signed by the relayer key registered in `ProtocolConfig`, which gives the protocol a working collateral attestation path today.

The roadmap hardening path is:
- freshness-bounded relayer payloads,
- committee/quorum attestation rather than one relayer key,
- stronger Bitcoin verification primitives when they are operationally mature.

The current demo should be presented as relayer-attested collateral, not trustless BTC light-client verification.

## Fireblocks Production Signing
In production, Solvus is designed so the operator leg of the mint transaction can move behind Fireblocks MPC and Policy Engine controls:
- the CompliancePermit becomes the policy trigger,
- no permit means no operator signing authorization,
- Fireblocks signs with institution-specific vault keys rather than exposing raw operator keys.

The repo includes a typed Fireblocks webhook stub as a production-path signal, not as a claim of a live integration in the devnet demo.

## Ecosystem Integration
- **AMINA Bank:** institutional custody/compliance workflow fit
- **Fireblocks:** MPC signing and policy approval path for production
- **Solstice:** challenge-partner infrastructure alignment on Solana
- **UBS / Keyrock / Steakhouse:** ecosystem context for institutional treasury, market structure, and stablecoin operations

These are hackathon ecosystem alignments, not claims that every integration is already live in the shipped demo.

## Production Note
The current code already separates `protocol_admin` and `compliance_admin` responsibilities on-chain. The devnet demo still maps both roles to one local key for speed, but the production control plane is designed to move these roles behind a `3-of-5` Squads multisig plus MPC or HSM-backed operator custody. That keeps one compromised key from controlling the full system.
