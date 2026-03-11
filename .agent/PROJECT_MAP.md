# PROJECT_MAP.md — Solvus Protocol Module Registry
> Source of truth cho cấu trúc codebase. Agent phải đọc trước khi tạo hoặc sửa file.
> Last updated: 2026-03-11 (Refactored to Monorepo)

---

## 📁 Cấu trúc thư mục

```
solvus/
├── packages/
│   ├── core/                        # Cryptographic primitives, shared logic & types
│   │   ├── relayer/                 # Xverse API + relayer signing
│   │   ├── shared/                  # Common utils (BigEndian, etc.)
│   │   ├── identity/                # Nullifier secret generation
│   │   ├── prover/                  # Prover inputs assembler
│   │   ├── client/                  # User signature logic
│   │   ├── integrations/            # DeFi integration demos (Vesu)
│   │   ├── calldata_helper.ts       # Encoding & Poseidon
│   │   ├── orchestrator.ts          # Flow coordinator
│   │   ├── index.ts                 # Main entry point
│   │   └── package.json
│   │
│   └── frontend/                    # Vite + React Client UI
│       ├── src/                     # App logic & components
│       ├── package.json
│       └── .env
│
├── cairo/                           # Starknet contracts & deploy infrastructure
│   ├── src/                         # SolvusBadge.cairo & verifiers
│   └── scripts/                     # Deployment scripts
│
├── circuits/                        # Noir ZK circuits
│   ├── src/main.nr                  # Core ZK circuit logic
│   └── target/                      # Compiled artifacts & VK
│
├── .agent/                          # Governance, Invariants & AI logs
└── package.json                     # Root workspace management
```

---

## 📦 Module Registry

| Module | File | Responsibility | Exports | Consumers | Risk Level |
|---|---|---|---|---|---|
| **Core** | `packages/core/index.ts` | Centralized crypto & logic entry | All core functions | Server, Frontend | 🔴 CRITICAL |
| **SharedUtils** | `packages/core/shared/utils.ts` | Crypto primitives dùng chung | `BN254_PRIME`, `u64ToBigEndian()` | Core | 🔴 CRITICAL |
| **Relayer** | `packages/core/relayer/index.ts` | BTC data fetcher & signer | `fetchRelayerData()` | Prover Server | 🟠 HIGH |
| **Identity** | `packages/core/identity/nullifier_secret.ts`| Nullifier secret derivation | `computeNullifierSecret()` | Client logic | 🔴 CRITICAL |
| **ProverServer** | `packages/prover-server/prover_server.ts` | Proof API + /sign proxy | HTTP endpoints | Frontend | 🟠 HIGH |
| **NoirCircuit** | `circuits/src/main.nr` | ZK proof generation logic | `main()` | `prover-server` | 🔴 CRITICAL |
| **CairoContract** | `cairo/src/contract.cairo` | On-chain badge verification | `issue_badge()` | DeFi protocols | 🔴 CRITICAL |
| **Frontend** | `packages/frontend/src/App.tsx` | User dashboard & minting flow | React UI | Users | 🟡 MEDIUM |

---

## 🔗 Dependency Graph (Updated)

```
Frontend (@solvus/frontend)
    │
    ├──► /sign Proxy  ──► ProverServer (@solvus/prover-server)
    │                               │
    │                               └──► fetchRelayerData() [@solvus/core]
    │
    └──► /prove API   ──► ProverServer
                                    │
                                    └──► Nargo / bb.js (Proof Generation)
```

---

## ⚡ High-Risk Coupling Points (No change in logic, only paths)
- **Threshold Map:** `packages/core/shared/utils.ts` ↔ `cairo/src/contract.cairo`
- **Poseidon Hash:** TS (`circomlibjs`) ↔ Noir (`hash_4`)
- **VK Consistency:** `circuits/target/solvus.vk` ↔ `cairo/src/solvus_verifier/`
