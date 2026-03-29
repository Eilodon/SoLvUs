# StableHacks 2-Minute Video Script

## Goal
Show that Solvus is no longer just a BTC-backed stablecoin prototype. It is now a permissioned issuance vault with visible compliance controls for regulated institutions.

## Setup
- Terminal 1: `npm run server`
- Terminal 2: `npm run dev`
- Terminal 3: `node scripts/institutional-mint-smoke.mjs`
- Browser: open the frontend desk and keep Phantom ready

## 0:00 - 0:15
Narration:
"Solvus lets an approved institution mint zkUSD from BTC collateral on Solana, while keeping collateral proofs private with zero knowledge and enforcing policy gates before issuance."

Screen:
- Show the frontend hero and the four cards: `Policy`, `Identity`, `Prover`, `Solana`.

## 0:15 - 0:35
Narration:
"The key change for StableHacks is the permissioned control plane. Every mint now requires an institution profile, KYB reference, Travel Rule reference, KYT score, a sanctions screen, and a short-lived compliance permit."

Screen:
- Highlight the policy form fields in the frontend:
  `Institution Label`, `KYB Reference`, `Travel Rule Reference`, `KYT Score`, `Permit TTL`, `Daily Mint Cap`, `Lifetime Mint Cap`.

## 0:35 - 0:55
Narration:
"The server provisions the institution account and compliance permit on devnet before the operator signs. The dashboard reads actual on-chain institution and permit state, not mocked UI state."

Screen:
- Click `Mint With Browser Wallet` once or run the smoke script phase-one output.
- Show `Compliance Audit` panel loading `institution` and `permit` JSON.

## 0:55 - 1:20
Narration:
"Compliance admins can freeze the institution or revoke a permit before execution. That makes the vault meaningfully permissioned and much closer to institutional operating requirements."

Screen:
- Click `Suspend Institution`.
- Refresh and show institution status becomes `suspended`.
- Click `Reactivate`.
- Click `Revoke Permit`.
- Click `Pause Protocol` and then `Resume Protocol`.
- Refresh and show permit state becomes `revoked`.

## 1:20 - 1:45
Narration:
"For an approved operator, Solvus prepares a partially signed transaction, the demo browser wallet signs the operator leg, and the mint settles on Solana. In production that signing step moves to MPC or HSM-backed institutional custody. The permit is then consumed and the institution caps update."

Screen:
- Run the smoke script phase-two or use the frontend `Mint With Phantom` live path.
- Show submitted transaction signature and the post-mint compliance state where permit moves to `used`.

## 1:45 - 2:00
Narration:
"So the product is not just a stablecoin contract. It is a permissioned BTC-backed issuance vault with compliance gating, sanctions screening, operator controls, audit visibility, and Solana execution. The current code already separates protocol-admin and compliance-admin responsibilities on-chain. The devnet demo maps both roles to one local key and a browser wallet for convenience, while the production design moves them behind a 3-of-5 Squads multisig plus institutional custody."

Screen:
- End on the compliance audit panel plus the response panel showing:
  `institution_id_hash`, `compliance_permit_pda`, `submitted_signature`.
