# StableHacks 2-Minute Video Script

## Goal
Show that Solvus is not just a BTC-backed mint. It is a compliance-controlled issuance workflow for institutional clients.

## Setup
- Terminal 1: `npm run server`
- Terminal 2: `npm run dev`
- Terminal 3: `COMPLIANCE_API_KEY=... npm run demo:preflight`
- Browser: open the frontend desk and keep Phantom ready

## 0:00 - 0:15
Narration:
"I am going to show one workflow: Sophie, a compliance officer at AMINA Bank, needs to authorize Meridian Asset Management's first BTC-backed zkUSD issuance while keeping full intervention power at every step."

Screen:
- Show the hero plus the `Compliance`, `Operator`, and `Advanced` tabs.

## 0:15 - 0:35
Narration:
"Sophie starts in the Compliance view. She creates Meridian's institution profile, binds KYB and Travel Rule evidence, and issues a short-lived mint permit tied to Meridian's operator wallet, mint cap, and KYT score."

Screen:
- Highlight the institution card, permit card, and audit timeline.

## 0:35 - 0:55
Narration:
"Now we switch to the Operator view. Meridian sees the permit summary, the current BTC price guard, and the amount they are allowed to mint. The permit is real, and the dashboard is reading live state, not mocked UI."

Screen:
- Show the permit summary, oracle guard, and mint controls.

## 0:55 - 1:20
Narration:
"Meridian signs the operator leg. Solvus verifies the Groth16 proof, checks the permit, screens the operator, updates caps, and records the mint submission in the audit trail."

Screen:
- Click `Mint With Browser Wallet`.
- Show the submitted Solana signature and the audit trail gaining a new mint record.

## 1:20 - 1:45
Narration:
"A few minutes later, Sophie sees unusual activity. She returns to Compliance, suspends the institution, freezes the holder account, and can export the whole audit trail as CSV. The system is permissioned because her decision is enforceable."

Screen:
- Click `Suspend Institution`, `Freeze Holder`, then `Export CSV`.
- Show updated institution status and holder state.

## 1:45 - 2:00
Narration:
"So Solvus is not a generic stablecoin dashboard. It is institutional issuance infrastructure: permit-bound minting, exportable compliance evidence, intervention controls, and a real Solana settlement path. Today it ships with relayer-attested BTC collateral and a real proof system. The next production hardening step is committee-based attestation and multisig governance."

Screen:
- End on the Compliance view with institution status, audit records, and the latest transaction signature.
