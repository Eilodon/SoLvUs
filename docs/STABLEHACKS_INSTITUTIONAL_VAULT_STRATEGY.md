# StableHacks Strategy — Institutional Permissioned DeFi Vaults

## Purpose
This document turns the Cycle #5 VHEATM audit into one enforceable strategy for StableHacks.

The goal is not to make Solvus look broader. The goal is to make Solvus look **truer, sharper, and more institution-ready** than it currently appears.

## Hard Reality Check
- Tenity currently lists StableHacks 2026 as running **13-22 March 2026** and describes it as institutional-grade stablecoin infrastructure on Solana:
  https://www.tenity.com/program/stablehacks/
- Today in this workspace is **2026-03-29**.
- Therefore the highest-ROI play is:
  - maximize clarity and credibility of the Solvus thesis,
  - avoid broad architectural pivots that dilute the story,
  - define the exact capability layer that would make Solvus a strong fit for this track.

## Verified Strategic Thesis
**Solvus should be positioned as a Permissioned Collateralized Issuance Vault for regulated institutions on Solana.**

In plain terms:
- institutions mint zkUSD from BTC-collateralized vaults,
- collateral proof remains private through ZK,
- issuance rights are gated by compliance policy,
- each mint action is auditable and policy-bound.

This is the closest strong fit between:
- what StableHacks asks for,
- what Solvus already has,
- and what can be added without rewriting the whole protocol.

## What Solvus Already Has
- A real on-chain vault issuance engine.
- Verified devnet mint flow with Groth16-backed proof verification.
- Vault lifecycle, liquidation path, oracle-based collateral checks.
- Off-chain relayer and prover stack.
- Enough architecture depth to support an institutional-grade story once permissioning is added.

## What Solvus Is Missing For This Track
- Institution registry.
- Operator / compliance / admin role separation.
- Action-level compliance permits for mint/burn.
- KYB/KYT/AML decision records that survive audit.
- Travel Rule metadata or reference hashes.
- Policy caps by organization, wallet, and action.
- Honest separation of `shipped runtime` vs `roadmap hardening`.

## Winning Scope
### Build This
- `InstitutionRegistry`
  - `institution_id_hash`
  - `status`
  - `jurisdiction`
  - `risk_tier`
  - `approved_wallets`
  - `daily_mint_cap`
  - `lifetime_cap`
  - `updated_at`

- `CompliancePermit`
  - `institution_id_hash`
  - `wallet`
  - `action`
  - `max_amount`
  - `expires_at`
  - `kyt_band`
  - `travel_rule_ref_hash`
  - `kyb_ref_hash`
  - `nonce`

- `Compliance Gateway`
  - validates org and wallet policy,
  - runs external or mocked KYB/KYT checks,
  - issues a permit artifact,
  - stores an audit decision trail.

- `Mint gate integration`
  - `mint_zkusd` must require a valid permit and cap checks before issuance.

### Do Not Build In This Scope
- cross-border treasury product surface,
- programmable payment rails,
- commodity/RWA pivot,
- full multi-oracle or full governance rewrite before permissioning exists.

## Demo Story
### Demo narrative
1. Compliance admin onboards an institution.
2. Institution operator wallet is approved with a mint cap.
3. Operator requests a mint.
4. Compliance Gateway screens the request and issues a short-lived permit.
5. Solvus proves collateral and mints zkUSD only because:
   - collateral proof is valid,
   - relayer is authorized,
   - operator wallet is approved,
   - permit is valid,
   - cap is not exceeded.

### Why judges should care
- This is no longer “just another stablecoin mint”.
- It becomes a regulated issuance workflow with explicit operator controls.
- ZK protects collateral/privacy while policy controls protect institutional process.

## Submission Language To Use
Prefer:
- `institution`
- `operator`
- `compliance officer`
- `policy`
- `permit`
- `mint cap`
- `auditable issuance`
- `regulated vault workflow`

Avoid leading with:
- `Whale`
- `Hodler`
- `Stacker`
- `Xverse`
- `Phantom`
- `badge`

Those terms can stay in code if needed, but they should not define the submission story.

## Shipped vs Roadmap
### Shipped now
- BTC-collateralized zkUSD issuance on Solana
- Groth16 proof path
- verified devnet mint
- vault/liquidation/oracle core

### Roadmap hardening
- institution registry
- compliance permit plane
- broader audit trail
- multi-oracle aggregation
- circuit breaker
- admin multisig

## Highest-ROI Build Order
1. Add compliance/policy schemas.
2. Add permit issuance flow off-chain.
3. Gate `mint_zkusd` with permit + caps.
4. Reframe frontend/demo to operator/compliance story.
5. Tighten README/demo script to match shipped behavior exactly.

## Final Decision
**Do not broaden Solvus. Narrow it.**

The most credible StableHacks submission is:
**Solvus = permissioned institutional issuance vaults with ZK collateral attestation on Solana.**
