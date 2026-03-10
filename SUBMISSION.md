# Solvus Protocol — Hackathon Submission

## FIELD: Project Name
Solvus Protocol

## FIELD: Tagline (≤ 80 chars)
ZK-powered Bitcoin identity for Starknet DeFi — prove solvency, stay private.

## FIELD: The problem it solves
Bitcoin holders currently sit on over $1 trillion in capital, yet they are largely excluded from the vibrant DeFi ecosystems on layers like Starknet. The primary reason is a fundamental choice between privacy and utility. If a Bitcoin holder wants to participate in DeFi, they must either "wrap" their BTC through a centralized bridge—introducing significant counterparty risk—or reveal their Bitcoin addresses on-chain to prove their holdings, effectively doxxing their entire financial history.

Furthermore, DeFi protocols on Starknet lack a robust identity primitive for Bitcoin assets. Without a way to verify a user's Bitcoin-based solvency or historical "Hodler" status trustlessly, protocols are forced to stick to over-collateralized lending models, limiting capital efficiency.

Solvus Protocol solves this by introducing a Zero-Knowledge Bitcoin Identity layer. By utilizing Noir ZK circuits and Xverse wallet signatures, users can prove they own a specific amount of BTC or have held it for a certain duration without ever revealing their Bitcoin address or public keys on-chain. This unlocks $1T+ of "lazy" BTC capital for DeFi while maintaining total self-custody and privacy.

## FIELD: Challenges I ran into
The most significant hurdle was achieving cross-implementation compatibility for the Poseidon hash function. We discovered that small differences in constants or field encoding between the TypeScript implementation (using `circomlibjs`) and the Noir circuit could lead to silent proof failures, which we solved by creating a strict `INVARIANTS.md` registry and cross-layer test vectors (B#7).

Another challenge was implementing dual ECDSA verification within the ZK circuit. We had to synchronize the payload format between the Xverse Bitcoin wallet signatures, the Relayer's data signatures, and the Noir circuit's internal verification steps. Ensuring that the 15 public/private input fields matched precisely across TypeScript, Noir, and Cairo required building a custom Orchestrator that manages the complex data flow without exposing private keys. Finally, optimizing proving time to under 60 seconds on a standard server while maintaining security was a constant balancing act.

## FIELD: Technologies used
Noir, Cairo, Starknet, Garaga, Xverse, TypeScript, secp256k1, BN254, Poseidon

## FIELD: Track selection
- **PRIMARY:** BTCFi Track
- **SECONDARY:** Open Innovation Track (fallback)
- **PARTNER PRIZE:** Xverse API Prize (top 3 projects using Xverse)

## FIELD: What I learned
This project was a deep dive into the pitfalls of ZK cross-layer integration. I learned that "standard" implementations aren't always interoperable out of the box. Integrating Garaga for on-chain verification taught us the intricacies of how Starknet handles ZK proofs. We also gained significant insights into Bitcoin signature formats (BIP-322 vs standard signatures) and how to design a privacy-preserving identity primitive that remains composable across the Starknet DeFi stack.

## FIELD: What's next
Our V2 roadmap includes:
- **Decentralized Relayer:** Moving away from a single server to an MPC-based decentralized relayer network using Utu.
- **Mainnet Deployment:** Graduating from Sepolia to Starknet Mainnet.
- **Deep DeFi Integration:** Partnering with protocols like Vesu for under-collateralized lending and Ekubo for liquidity incentives based on Solvus badges.
- **Mobile Support:** Bringing Solvus to mobile Bitcoin and Starknet wallets.
