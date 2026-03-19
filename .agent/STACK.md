# STACK.md — Solvus Protocol Tech Stack & Conventions
> Last updated: 2026-03-09

---

## 🔧 Runtime & Language

| Layer | Language | Notes |
|---|---|---|
| Client / Relayer | TypeScript (strict mode) | Node.js runtime |
| ZK Circuit | Noir (Aztec) | `circuits/main.nr` |
| Smart Contract | Cairo (Starknet) | `cairo/contract.cairo` |

---

## 📦 Dependencies — Pinned Versions

> **RULE:** KHÔNG thêm dependency mới mà không cập nhật bảng này.

### TypeScript (package.json)

| Package | Version | Pin Style | Purpose | Owner Module |
|---|---|---|---|---|
| `@noble/curves` | latest stable | `^` OK | secp256k1 ECDSA, BN254 mod | `packages/core/shared/utils.ts`, `packages/core/relayer/index.ts` |
| `@noble/hashes` | latest stable | `^` OK | SHA-512, SHA-256 | `packages/core/shared/utils.ts`, `packages/core/relayer/index.ts` |
| `circomlibjs` | **`0.1.7` EXACT** | ❌ NO `^` or `~` | Poseidon BN254 | `calldata_helper.ts` |
| `express` | `^5.2.1` | `^` OK | Prover Server API | `packages/prover-server/prover_server.ts` |
| `starknet` | `^7.1.0` | `^` OK | Starknet SDK | `cairo/scripts/deploy.ts`, `packages/frontend/` |
| `sats-connect`| latest | `^` OK | Bitcoin Wallet API | `packages/core/orchestrator.ts` |

> ⚠️ `circomlibjs@0.1.7` phải pin EXACT. Khác version = Poseidon output khác = proof luôn fail.
> Lý do: Poseidon parameters (MDS matrix, round constants) thay đổi giữa versions.
> **Note:** `circomlibjs` có thể xuất hiện cả ở root và `@solvus/core` để hỗ trợ cả unit testing riêng lẻ và global scripts. Cả hai nơi PHẢI dùng chung version 0.1.7.

### Noir Circuit

| Dependency | Version | Purpose | Notes |
|---|---|---|---|
| `nargo` | **`1.0.0-beta.16`** | Noir Compiler | Pinned for Garaga 1.0.1 compatibility |
| `@aztec/bb.js` | `^4.0.4` | Backend (WASM) | AVX2 hardware fallback |
| `dep::std` | Noir stdlib | Cryptography | `poseidon::bn254` |
| `dep::eddsa` | **`0.1.3`** | BabyJubJub | Relayer Signature Verification |
| `dep::poseidon` | **`0.1.1`** | Poseidon Hash | Relayer Signature Hash |

### Cairo Contract

| Dependency | Version | Purpose | Notes |
|---|---|---|---|
| Starknet std | **2.14.0** | Core SDK | `get_caller_address()`, etc. |
| Garaga | **1.0.1** | On-chain Verifier Logic | Used as a library and to generate `solvus_verifier/` |
| assert_macros | **2.14.0** | Testing Utilities | Required for 2.14.0 build |

---

## 📐 Encoding Conventions (Toàn Stack)

| Giá trị | TypeScript | Noir | Cairo |
|---|---|---|---|
| `starknet_address` | `toFieldHex(BigInt(addr))` → sign ASCII via `toHex64()` | `pub Field` → `to_be_bytes(32)` → `bytes_to_hex64()` | `felt252` → `assert == caller.into()` |
| `nonce` | `toFieldHex(BigInt(nonce))` → sign ASCII via `toHex64()` | `pub Field` → `to_be_bytes(32)` → `bytes_to_hex64()` | `felt252` → `assert == stored_nonce` |
| `badge_type` | `1 \| 2` (number) | `pub u8` → `badge_type as Field` khi Poseidon | `u8` → `get_expected_constraints()` |
| `nullifier_secret` | `toFieldHex(mod(SHA512, BN254_PRIME))` = `"0x" + 64hex` | `Field` private | không nhận |
| `relayer_pubkey_x/y` | `felt252ToU8Array32()` → `Array.from()` = `number[32]` | `pub [u8; 32]` — KHÔNG phải Field | `felt252` → `serialize_felt_to_u8_32()` |
| `pubkey_x/y` (BTC) | `Array.from(Uint8Array)` = `number[32]` | `[u8; 32]` **PRIVATE** | ❌ KHÔNG NHẬN |
| `user_sig` | `stripRecoveryByte()` → `Array.from()` = `number[64]` | `[u8; 64]` private | không nhận |
| `relayer_sig` | `.toCompactRawBytes()` → `Array.from()` = `number[64]` | `[u8; 64]` private | không nhận |
| `threshold` | `getThresholdForBadge(bt, tier)` (mirrors Cairo) | `pub u64` | `u64` từ `get_expected_constraints()` |
| `is_upper_bound` | `false` hardcoded (V1) | `pub bool` | `bool` |
| `timestamp` | `relayerResponse.timestamp` (**KHÔNG** `Date.now()`) | `pub u64` | `u64` → freshness check ≤ 3600s |
| `nullifier_hash` | `toFieldHex(await computeNullifierHash(...))` | `pub Field` | `felt252` → registry key |
| `btc_data` | Whale: satoshi balance, Hodler: days oldest UTXO | `u64` private | không nhận |

---

## 🔑 Constant Registry

| Constant | Value | Type | File | Notes |
|---|---|---|---|---|
| `BN254_PRIME` | `21888242871839275222246405745257275088548364400416034343698204186575808495617n` | BigInt | `packages/core/shared/utils.ts` | Decimal literal — KHÔNG hex |
| varint 128 | `0x80` | byte | `circuits/main.nr` prefix | message length = 128 chars |
| badge expiry | `259200` seconds | u64 | `cairo/contract.cairo` | 72 giờ |
| future timestamp tolerance | `60` seconds | u64 | `cairo/contract.cairo` | Clock drift |
| relayer sig expiry | `3600` seconds | u64 | `cairo/contract.cairo` | 1 giờ |

---

## 🏷️ Badge Threshold Reference

| badge_type | tier | threshold | unit | is_upper_bound |
|---|---|---|---|---|
| 1 (Whale) | 1 | 10,000,000 | satoshi = 0.1 BTC | false |
| 1 (Whale) | 2 | 50,000,000 | satoshi = 0.5 BTC | false |
| 1 (Whale) | 3 | 100,000,000 | satoshi = 1.0 BTC | false |
| 1 (Whale) | 4 | 500_000_000 | satoshi = 5.0 BTC | false |
| 2 (Hodler) | 1 | 180 | days | false |
| 2 (Hodler) | 2 | 365 | days | false |
| 3 (Stacker) | 1 | 5 | count (UTXOs) | false |
| 3 (Stacker) | 2 | 15 | count (UTXOs) | false |
| 3 (Stacker) | 3 | 30 | count (UTXOs) | false |

> Source of truth: Cairo `get_expected_constraints()`. TypeScript `getThresholdForBadge()` mirrors này.

---

## 📏 Import Conventions

### TypeScript
```typescript
// Shared utils — import tên cụ thể
import { BN254_PRIME, toFieldHex, stripRecoveryByte } from '../shared/utils';

// Types — import từ types.ts riêng
import { RelayerResponse } from '../relayer/types';
```

### Noir
```rust
// Tất cả từ stdlib
use dep::std;
// Dùng: std::hash::sha256, std::hash::poseidon::bn254::hash_4
//        std::ecdsa_secp256k1::verify_signature
```

---

## ⚠️ Breaking Changes Log

| Date | Change | Impact | Fixed In |
|---|---|---|---|
| [V12] | `||` thay `\|` trong Cairo is_badge_valid | Logic bug: singlebit OR | cairo/contract.cairo |
| [V13] | `reduce()` thay `Math.min(...spread)` cho UTXO | Crash large UTXO sets | packages/core/relayer/index.ts |
| [V14] | `buildProverInputs()` thành async | Silent bug nếu sync | packages/core/prover/inputs.ts |
| [V17] | timestamp source = relayerResponse | Cairo freshness fail | packages/core/prover/inputs.ts |

---

## 🛑 Deprecated Patterns — KHÔNG dùng lại

| Pattern | Thay bằng | Lý do |
|---|---|---|
| `Math.min(...utxos.map(...))` | `reduce()` với Infinity | Crash với >~10k args |
| `Buffer.allocUnsafe()` | `Buffer.alloc()` | Cryptographic safety |
| `Date.now()` trong prover | `relayerResponse.timestamp` | Cairo sig validation |
| Bitwise `\|` / `&` cho boolean | `\|\|` / `&&` | Logic correctness |
| `circomlibjs@^0.1.7` | `circomlibjs@0.1.7` (exact) | Poseidon compatibility |
| Hash 65-byte sig | `stripRecoveryByte()` trước | Determinism giữa wallets |
| `domain_field` trong circuit | Removed in v14 | Architecture change |
