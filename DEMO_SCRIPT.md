---
# Demo Video Script — Solvus Protocol (~2:30)

## [0:00-0:15] Hook
Screen: Landing screen với tagline
Narration: "Bitcoin holders have $1T+ in BTC but can't access DeFi without
revealing their identity. Solvus changes that with ZK proofs."

## [0:15-0:30] Problem visualization  
Screen: Show regular DeFi — requires KYC or wrapping BTC
Narration: "Current solutions force you to wrap BTC (losing self-custody)
or reveal your Bitcoin address on-chain."

## [0:30-1:00] Demo flow
Screen: Open Solvus UI
Action 1: Connect Xverse wallet → show BTC address masked (0x...xxxx)
Action 2: Connect Argent/Braavos Starknet wallet
Action 3: Select "Whale Badge Tier 2" (0.5 BTC threshold)
Narration: "User selects the badge type. Their actual BTC balance is never revealed."

## [1:00-1:45] Proof generation
Screen: Click "Generate ZK Proof"
Show progress: "Signing identity... Fetching BTC data... Generating ZK proof..."
(proof loads fast từ pre-generated cache)
Screen: Show proof hash + "Submitting to Starknet..."
Screen: Starkscan link → badge minted ✓
Narration: "A ZK proof verifies the balance without revealing it.
The proof is verified on-chain by Garaga, Starknet's ZK verifier."

## [1:45-2:15] DeFi integration
Screen: Check Badge section → show Vesu borrowing power
Show: "Whale Tier 2 + Hodler Tier 1 → 65% LTV at 8.5% APY"
Narration: "Any DeFi protocol on Starknet can now verify this badge in 1 line of Cairo.
Vesu, lending protocols, yield vaults — all composable."

## [2:15-2:30] Architecture + closing
Screen: Simple architecture diagram
Narration: "Built with Noir ZK circuits, Garaga on-chain verification,
Xverse Bitcoin wallet, and Cairo smart contracts.
Bitcoin identity, privately proven."
---
