# GRAVEYARD.md — Deprecated Files & Patterns
> Agent PHẢI đọc file này trước khi tạo file mới.
> Mọi thứ trong file này: KHÔNG recreate, KHÔNG reference, KHÔNG dùng lại.
> Last updated: 2026-03-09

---

## 🪦 Files Đã Xóa

| File | Xóa khi | Lý do | Thay bằng |
|---|---|---|---|
| `src/auth/domain_field.ts` | v14 | Architecture change — domain_field không còn dùng trong circuit | Không có replacement, field removed |

---

## 🚫 Patterns Đã Deprecated

| Pattern | Lần cuối dùng | Lý do deprecated | Thay bằng |
|---|---|---|---|
| `Math.min(...array.map(...))` trong UTXO | v12 | Crash với large UTXO sets (>~10k items) — V-4 bug | `array.reduce((min, u) => Math.min(min, u.block_time), Infinity)` |
| `Buffer.allocUnsafe(n)` | v11 | Cryptographic safety — buffer có thể chứa garbage data | `Buffer.alloc(n)` |
| `Date.now()` trong `buildProverInputs` | v17 | Cairo reject: timestamp không match relayer sig | `relayerResponse.timestamp` |
| `\|` bitwise OR trong Cairo boolean | v12 | Logic bug: single-bit OR không short-circuit | `\|\|` logical OR |
| `&` bitwise AND trong Cairo boolean | v12 | Logic bug | `&&` logical AND |
| Hash 65-byte raw signature | v14 | Recovery byte thay đổi giữa wallets → non-deterministic | `stripRecoveryByte()` trước khi hash |
| `circomlibjs@^0.1.7` (semver range) | v15 | Minor version bump thay đổi Poseidon params | `circomlibjs@0.1.7` exact pin |
| Nested helper functions bên trong `fn main()` Noir | v14 | Noir không support nested fn | Top-level helpers |
| `pubkey_x` trong Cairo public inputs | REJECTED v10 | Bitcoin address lộ on-chain | KHÔNG thay thế — by design private |
| `pubkey_x` trong relayer response | REJECTED | Privacy violation | Không expose ra ngoài circuit |
| `is_upper_bound: true` bất kỳ đâu | V1 design | V1 chỉ hỗ trợ lower bound | Hardcode `false`, V2 roadmap |

---

## 📋 Decisions Đã Reject

| Proposal | Rejected vì | Decision |
|---|---|---|
| P1: Relayer verify pubkey_x ngoài circuit | Bitcoin address lộ on-chain | REJECTED — pubkey_x phải là private input trong Noir |
| Dùng SHA-256 thay SHA-512 cho nullifier | Modulo bias lớn hơn (~33% vs ~1/2^258) | REJECTED — giữ SHA-512 |
| Dynamic varint cho message length | Noir cần compile-time constants | REJECTED — fix varint = `0x80` = 128 |
| Domain separation field riêng trong hash | Không cần thiết, badge_type đã serve mục đích này | REMOVED v14 |

---

## ⚠️ V2 Roadmap Items (KHÔNG implement trong V1)

> Những thứ này sẽ làm sau — KHÔNG implement bây giờ dù có vẻ đơn giản.

| Feature | Lý do defer | Target |
|---|---|---|
| Utu Relay (decentralize relayer) | Relayer SPOF acceptable for V1/demo | V2 |
| `last_verified_block` trong NullifierEntry | Flash Loan 72h attack vector | V2 |
| Contract-level nonce (sequencer drift fix) | Out of scope | V2 |
| Backup flow cho mất device (nullifier_secret) | Storage architecture needed | V2 |
| `is_upper_bound: true` support | Badge design V2 | V2 |
| Proving time optimization (<8s) | Dedicated prover server | V2 |

---

## 🔄 Update Protocol

Khi xóa file hoặc deprecate pattern:
1. Move entry vào đây TRƯỚC KHI xóa code
2. Ghi rõ: file/pattern, thời điểm, lý do, thay bằng gì
3. Append vào SESSION_LOG.md cùng session
