# INVARIANTS.md — Bất Biến Cryptographic Solvus Protocol
> Đây là file NGUY HIỂM NHẤT trong hệ thống.
> Mọi thứ trong file này là BẤT BIẾN — không thay đổi khi không có test vector confirm.
> Last updated: 2026-03-09

---

## 🔴 INVARIANT CẤP ĐỘ 1 — Vi phạm = Proof fail âm thầm

### INV-01: Poseidon Input Order
```
hash_4([nullifier_secret, x_hi, x_lo, badge_type])
         ^^^FIXED ORDER — KHÔNG đảo thứ tự bất kỳ element nào^^^
```
- TypeScript: `poseidon([nullifierSecret, x_hi, x_lo, BigInt(badgeType)])`
- Noir: `std::hash::poseidon::bn254::hash_4([nullifier_secret, x_hi, x_lo, badge_type as Field])`
- **Tại sao bất biến:** Poseidon không commutative. Đổi thứ tự = khác hash = nullifier mismatch.
- **Detect:** B#7 trong PHASE0_GATE.md phải pass với concrete test vector.

### INV-02: pubkey_x Split thành 128-bit Limbs
```
bytes[0..16]  → x_hi  (big-endian accumulation)
bytes[16..32] → x_lo  (big-endian accumulation)
```
- TypeScript: `splitTo128BitFields()` trong `packages/core/calldata_helper.ts`
- Noir: `split_to_128bit_fields()` trong `circuits/src/main.nr`
- **Cả hai phải cho CÙNG output với cùng input** — test B#3.
- **Tại sao split:** secp256k1 coord ~256-bit, BN254 prime ~254-bit. x_hi, x_lo đều < 2^128 < BN254_PRIME.

### INV-03: Nullifier Secret Generation
```
canonical64 = stripRecoveryByte(base64_sig)  ← 64 bytes [r||s], NOT 65
rawInt = BigInt("0x" + SHA512(canonical64).hex)
nullifier_secret = mod(rawInt, BN254_PRIME)
format = "0x" + hex.padStart(64, "0")        ← toFieldHex()
```
- **CRITICAL:** Hash 64 bytes, KHÔNG phải 65. Recovery byte PHẢI stripped trước hash.
- **Tại sao:** Recovery byte phụ thuộc wallet version. Hash 65 bytes → đổi wallet → đổi recovery byte → đổi secret → user mất tất cả badges.
- **Determinism requirement:** Gọi 3 lần liên tiếp → output identical (B#9).

### INV-04: Recovery Byte Range
```
Xverse compressed: [31, 34]   ← SUPPORTED
Legacy uncompressed: [27, 30] ← SUPPORTED  
DER format: starts with 0x30  ← REJECTED, throw Error
```
- `stripRecoveryByte()` throw nếu rb < 27 hoặc rb > 34.
- DER format KHÔNG được xử lý — phải implement DER canonicalizer riêng trước khi gọi hàm này.

### INV-05: Timestamp Source
```
✅ ĐÚNG: relayerResponse.timestamp
❌ SAI:  Date.now() / 1000
❌ SAI:  Math.floor(Date.now() / 1000)
❌ SAI:  new Date().getTime()
```
- Timestamp phải từ `RelayerResponse` object — đây là giá trị relayer đã ký.
- Cairo check: `current_block_timestamp - timestamp <= 3600` (1 giờ window).
- Dùng timestamp khác = signature không cover timestamp đó = proof fail.
- **⚠️ WARNING:** Hiện tại một số script (`packages/core/relayer/index.ts`, `pregenerate.ts`) có thể vẫn dùng `Date.now()` — đây là VI PHẠM cần được fix trong code để khớp với Invariant này.

### INV-06: Boolean Operators (Runtime Safety)
```
TypeScript:  && không &    || không |
Cairo:       && không &    || không |
```
- `&` và `|` là bitwise — hoạt động với số nhưng logic sai với boolean.
- Cairo: `is_empty || is_expired` phải là logical OR, không bitwise OR.
- Không bao giờ "optimize" bằng cách dùng bitwise trong boolean context.

### INV-07: BN254_PRIME — Decimal Literal
```typescript
// ✅ ĐÚNG — decimal literal, copy chính xác
export const BN254_PRIME =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// ❌ SAI — hex có thể transcription error
export const BN254_PRIME = 0x30644e72e131a029b85045b68181585d2833e84879b9709142e0f853d...n;
```
- Source: EIP-197, circom/snarkjs, Noir stdlib — đã verified.
- KHÔNG tự tính lại. KHÔNG convert sang hex. Copy nguyên từ `packages/core/shared/utils.ts`.

---

## 🟠 INVARIANT CẤP ĐỘ 2 — Vi phạm = Logic bug hoặc Security hole

### INV-08: User Signature Message Format
```
message = toHex64(BigInt(starknetAddress)) + toHex64(nonce)
        = 128 ASCII chars, lowercase hex, NO "0x" prefix, NO separator
```
- Noir reconstruct: `bytes_to_hex64(addr.to_be_bytes(32)) + bytes_to_hex64(nonce.to_be_bytes(32))`
- Bitcoin Signed Message prefix: `0x18` + "Bitcoin Signed Message:\n" + varint `0x80`
- `0x80` = 128 = varint cho 128-char message (FIXED, không dynamic). Xác nhận B#1.

### INV-09: Relayer Payload Format (Poseidon Fields)
```
payload_hash = poseidon([x_hi, x_lo, btc_data, timestamp])
```
- **FIXED ORDER:** `[x_hi_r, x_lo_r, btc_data as Field, timestamp as Field]`
- Noir: `std::hash::poseidon::bn254::hash_4`
- TypeScript: `poseidon([x_hi, x_lo, BigInt(btc_data), BigInt(timestamp)])`
- **Lý do:** Dùng Poseidon thay vì byte-concatenation giúp tối ưu mạch Noir (ZK-native).
- **btc_data units:**
  - Type 1 (Whale): Satoshis (u64)
  - Type 2 (Hodler): Days (u64)
  - Type 3 (Stacker): UTXO Count (u64)

### INV-10: Relayer Signature Format
```
✅ ĐÚNG: compact 64 bytes [r(32)||s(32)] — secp256k1.sign(...).toCompactRawBytes()
❌ SAI:  DER format (starts with 0x30, variable length)
❌ SAI:  65 bytes (có recovery byte)
```
- Noir `verify_signature` nhận compact [u8;64] — không phải DER.

### INV-11: Field Encoding Format
```typescript
toFieldHex(value: bigint): string
  → "0x" + value.toString(16).padStart(64, "0")
  // 66 chars total: "0x" + 64 hex chars

toHex64(value: bigint): string  
  → value.toString(16).padStart(64, "0")
  // 64 chars, NO "0x" prefix — dùng để sign ASCII message
```
- **KHÔNG được dùng lẫn lộn hai hàm này.** Xem convention table trong STACK.md.

### INV-12: pubkey_x/y Privacy Boundary
```
✅ Được phép: Client (private input to prover)
✅ Được phép: Noir circuit (private input)
❌ KHÔNG được: Cairo contract (bất kỳ hình thức nào)
❌ KHÔNG được: Relayer response
❌ KHÔNG được: Log files
❌ KHÔNG được: Error messages
```

### INV-13: Threshold Source of Truth
```
Cairo: get_expected_constraints() → (threshold, is_upper_bound)
TypeScript: getThresholdForBadge() phải mirror CHÍNH XÁC Cairo
```
- **Khi thêm badge type hoặc tier mới: update CẢ HAI đồng thời.**
- TypeScript version KHÔNG phải source of truth — Cairo là nguồn gốc.

### INV-14: Nullifier Key Structure
```
nullifier_registry key = (nullifier_hash: felt252, badge_type: u8)
```
- Badge type được include trong Poseidon hash VÀ trong registry key.
- Mục đích: cùng BTC key + khác badge_type → khác nullifier → không cross-badge linkability.
- KHÔNG simplify thành chỉ `nullifier_hash` làm key.

---

## 🟡 INVARIANT CẤP ĐỘ 3 — Vi phạm = Test fail hoặc Performance issue

### INV-15: Poseidon Singleton
```typescript
let _poseidon: any = null;
async function getPoseidon(): Promise<any> {
  if (!_poseidon) _poseidon = await buildPoseidon();
  return _poseidon;
}
```
- `buildPoseidon()` tốn ~200ms. Phải lazy singleton — KHÔNG gọi nhiều lần.
- KHÔNG refactor thành non-singleton "cho sạch code".

### INV-16: UTXO Min với reduce()
```typescript
// ✅ ĐÚNG
const oldest = utxos.reduce(
  (min: number, u: any) => Math.min(min, u.block_time),
  Infinity
);

// ❌ SAI — crash với large UTXO sets (V-4 fix)
const oldest = Math.min(...utxos.map(u => u.block_time));
```

### INV-17: Noir Helpers ở Top-Level
```
// ✅ ĐÚNG: helpers ở top-level trong circuits/main.nr
fn u64_to_be_bytes(...) { ... }
fn split_to_128bit_fields(...) { ... }
fn bytes_to_hex64(...) { ... }
fn main(...) { ... }

// ❌ SAI: helpers nested bên trong main()
fn main(...) {
  fn u64_to_be_bytes(...) { ... } // Noir không support nested fn
}
```

---

## 🔍 QUICK REFERENCE — Khi agent không chắc

| Câu hỏi | Invariant | Answer |
|---|---|---|
| Poseidon order là gì? | INV-01 | `[secret, x_hi, x_lo, badge_type]` |
| timestamp lấy từ đâu? | INV-05 | `relayerResponse.timestamp` ONLY |
| buildProverInputs có async không? | INV-05 + R7 | YES, async, mọi caller phải await |
| pubkey_x có thể log không? | INV-12 | KHÔNG BAO GIỜ |
| Boolean OR trong Cairo dùng gì? | INV-06 | `||` không phải `\|` |
| BN254_PRIME dùng decimal hay hex? | INV-07 | Decimal literal |
| circomlibjs version bao nhiêu? | STACK.md | `0.1.7` EXACT, không ^ hay ~ |
| Relayer sig format? | INV-10 | compact 64 bytes, NOT DER |
| User sig message có "0x" không? | INV-08 | KHÔNG, ASCII lowercase hex only |
| x_hi lấy bytes nào? | INV-02 | bytes[0..16] (first 16 bytes) |
