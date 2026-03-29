# VHEATM Cycle #6 — StableHacks Optimization Roadmap

## Goal
Maximize SoLvUs hackathon score and institutional credibility without destabilizing the verified devnet mint path already shipped on `master`.

This roadmap is intentionally narrow. It optimizes for:
- judge comprehension,
- institutional fit,
- live demo reliability,
- honest roadmap framing.

It does not optimize for broad protocol ambition at the expense of demo quality.

## Verified Constraints
- The core proof + permit + mint flow is real and already credible.
- The current frontend is functional but still reads like a mixed operator/dev console.
- Submission/demo copy is too generic relative to official StableHacks partner context.
- Compliance evidence is structured but not yet exportable or IVMS101-typed.
- Demo ops are partially covered by `/health` and `stablehacks:smoke`, but not fully productionized for live judging.
- Relayer trust remains the largest protocol weakness, but it is not the highest-ROI immediate hackathon task.

## Strategic Decision
The best path is not “build more protocol.”

The best path is:
1. package current protocol capability into an institutional control plane,
2. make compliance evidence legible and exportable,
3. remove demo-day operational risk,
4. present remaining protocol trust assumptions as an intentional roadmap.

## Priority Order

### Wave 1 — Mandatory Demo-Surface Upgrades
These should land first.

#### 1. Dual-Mode Institutional Dashboard
Target files:
- `packages/frontend/src/App.tsx`

Implementation shape:
- add top-level navigation with `Compliance`, `Operator`, `Advanced`
- `Compliance` view:
  - institution cards
  - permit cards
  - status badges
  - audit timeline
  - export button
- `Operator` view:
  - collateral summary
  - permit summary
  - mint actions
  - oracle guard summary
- `Advanced` view:
  - keep current raw payload textarea
  - keep raw response / compliance JSON

Reason:
- highest judge-facing ROI
- preserves existing working controls
- avoids a risky rewrite

#### 2. AMINA-First Submission + Demo Narrative
Target files:
- `docs/STABLEHACKS_SUBMISSION_COPY.md`
- `docs/STABLEHACKS_2MIN_VIDEO_SCRIPT.md`
- `README.md`

Implementation shape:
- rewrite one-liner and opening paragraph around AMINA-style institutional workflow
- demo script becomes named persona narrative, not button tour
- map partner relevance truthfully:
  - AMINA = institutional compliance/custody workflow
  - Fireblocks = policy + MPC signing path
  - Solstice = infra challenge partner
  - UBS / Keyrock / Steakhouse = ecosystem context, not fake integrations

Reason:
- highest non-code leverage
- directly aligns with official hackathon framing

### Wave 2 — Mandatory Compliance-Evidence Upgrades

#### 3. IVMS101-Aligned Travel Rule Schema
Target files:
- new `packages/core/compliance/travel_rule.ts`
- `packages/prover-server/prover_server.ts`
- `docs/STABLEHACKS_SUBMISSION_COPY.md`

Implementation shape:
- define TS interfaces for:
  - originator VASP
  - beneficiary VASP
  - legal/natural person payloads
  - transfer metadata
  - compliance decision metadata
- derive `travel_rule_ref_hash` from typed records
- keep on-chain hash model unchanged

Reason:
- closes biggest compliance credibility gap
- low blast radius

#### 4. Institution Audit Export
Target files:
- `packages/prover-server/prover_server.ts`
- `packages/frontend/src/App.tsx`

Implementation shape:
- add `GET /compliance/audit-trail`
- output `json` and `csv`
- include:
  - event type
  - timestamp
  - institution id
  - operator
  - amount
  - KYT score
  - Travel Rule hash
  - tx signature
  - slot if available
- frontend adds `Export Audit Trail`

Reason:
- strongest direct answer to regulator/reporting questions
- fits current compliance gateway cleanly

### Wave 3 — Required Demo-Ops Upgrades

#### 5. Warm Oracle + Proof Warm-Up + Preflight
Target files:
- `packages/prover-server/prover_server.ts`
- `packages/prover-server/devnet_mint.ts`
- new `scripts/demo-preflight.sh`
- `docs/DEVNET_RUNBOOK.md`

Implementation shape:
- `POST /compliance/warm-oracle`
- add optional `--phase=proof-only` to smoke or a dedicated warm-up script
- script checks:
  - `COMPLIANCE_API_KEY`
  - prover `/health`
  - devnet reachability
  - oracle freshness path

Reason:
- reduces the most embarrassing live-demo failures
- cheaper than adding new protocol scope

#### 6. Verify Freeze/Thaw in Runbook
Target files:
- `docs/DEVNET_RUNBOOK.md`

Implementation shape:
- record verified freeze/thaw tx signatures once executed
- extend control-plane rehearsal steps

Reason:
- closes the loop on a feature already shipped
- strengthens “compliance intervention” story

### Wave 4 — Recommended Partner/Ecosystem Signaling

#### 7. Fireblocks Policy Stub
Target files:
- `packages/prover-server/prover_server.ts`
- `docs/STABLEHACKS_SUBMISSION_COPY.md`

Implementation shape:
- add commented production stub / type for Fireblocks webhook payload
- explain permit as policy trigger, not direct raw-key signing

Reason:
- high ecosystem leverage
- low runtime risk

#### 8. Ecosystem Integration Map
Target files:
- `docs/STABLEHACKS_SUBMISSION_COPY.md`

Implementation shape:
- one section mapping truthful Phase 1 / Phase 2 relevance:
  - Fireblocks
  - Solstice
  - AMINA
  - UBS
  - Keyrock
  - Steakhouse

Reason:
- shows ecosystem literacy without overclaiming integration

### Wave 5 — Roadmap-Only Protocol Hardening
These should be documented now, not prioritized ahead of Waves 1-3.

#### 9. Relayer Hardening
Target files:
- `docs/STABLEHACKS_SUBMISSION_COPY.md`
- future changes in `circuits/`, `packages/core/relayer/`, `solana/programs/solvus/`

Recommended direction:
- add payload freshness bounds
- move from 1 relayer to committee/quorum attestation
- add admin rotation and circuit-breaker pause policy

Do not do first:
- Bitcoin light client
- full trustless BTC proof rewrite

#### 10. Oracle Cross-Check Roadmap
Target files:
- docs only for now

Recommended direction:
- keep Pyth as current settlement oracle
- add safety cross-check + auto-pause roadmap

#### 11. Multisig Migration
Target files:
- docs now, protocol/admin ops later

Recommended direction:
- move `protocol_admin` and `compliance_admin` to Squads multisig
- keep devnet convenience setup clearly labeled as non-production

## Explicit Non-Goals For Immediate Sprint
- No full Token-2022 transfer-hook migration now
- No full privacy-preserving public-input rewrite now
- No Bitcoin light client now
- No broad RWA-track pivot now
- No removal of current debug desk until dual-mode UI is stable

## Best Execution Sequence
1. Rewrite submission and demo script.
2. Refactor frontend into `Compliance` / `Operator` / `Advanced`.
3. Add IVMS101 schema module.
4. Add audit export endpoint + frontend button.
5. Add warm-oracle + preflight tooling.
6. Add Fireblocks stub and ecosystem section.
7. Update runbook with verified freeze/thaw and new rehearsal steps.
8. Tighten trust-model roadmap copy.

## Success Criteria
- A judge can understand the product in under 20 seconds from the screen alone.
- A compliance-oriented reviewer can answer “how do you audit/export/report this?” from the product demo.
- The team can run a reliable live demo with low oracle/prover surprise risk.
- Remaining protocol trust assumptions are framed honestly and professionally.
