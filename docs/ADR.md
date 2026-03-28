# ADR.md — Architecture Decision Records
### SOLVUS Protocol · v1.0.0 (Solana Architecture)

> **Mục đích file này:** Ghi lại *tại sao* hệ thống Solana hiện tại được thiết kế như vậy, bao gồm các quyết định về proving, relayer, oracle, liquidation và các biện pháp bảo mật từ audit VHEATM 5.0.
> Không phải *cái gì* (CONTRACTS.md) hay *như thế nào* (BLUEPRINT.md) — mà là *tại sao*.
>
> File này là research layer — nơi iterate design, cân nhắc alternatives, ghi lại trade-offs.
> Khi đọc lại sau 6 tháng, file này giải thích mọi quyết định "trông có vẻ lạ" trong codebase.

---

## Mục lục

- [Cách đọc file này](#cách-đọc-file-này)
- [Phần 1: Các Quyết định Kiến trúc Nền tảng](#phần-1-các-quyết-định-kiến-trúc-nền-tảng)
  - [ADR-001: Sử dụng Poseidon cho Relayer Payload](#adr-001-sử-dụng-poseidon-cho-relayer-payload)
  - [ADR-002: Loại bỏ pubkey_x khỏi Public Inputs](#adr-002-loại-bỏ-pubkey_x-khỏi-public-inputs)
  - [ADR-003: Sử dụng SHA-512 cho Nullifier Secret](#adr-003-sử-dụng-sha-512-cho-nullifier-secret)
  - [ADR-004: Thay thế Math.min bằng reduce() cho UTXO](#adr-004-thay-thế-mathmin-bằng-reduce-cho-utxo)
  - [ADR-005: Pin chính xác phiên bản circomlibjs](#adr-005-pin-chính-xác-phiên-bản-circomlibjs)
  - [ADR-006: Đảm bảo tính xác định của Nullifier Secret](#adr-006-đảm-bảo-tính-xác-định-của-nullifier-secret)
  - [ADR-007: Chuẩn hóa Serialization Field BN254 cho Verifier](#adr-007-chuẩn-hóa-serialization-field-bn254-cho-verifier)
- [Phần 2: Các Quyết định On-chain Solana & VHEATM Audit](#phần-2-các-quyết-định-on-chain-solana--vheatm-audit)
  - [ADR-008: Chuẩn hóa Solana làm Execution Layer](#adr-008-chuẩn-hóa-solana-làm-execution-layer)
  - [ADR-009: Chuẩn hóa Groth16 làm Proving Backend](#adr-009-chuẩn-hóa-groth16-làm-proving-backend)
  - [ADR-010: Double-spending Protection qua PDA](#adr-010-double-spending-protection-qua-pda)
  - [ADR-011: Collateral Locking via TSS-Relayer DLCs](#adr-011-collateral-locking-via-tss-relayer-dlcs)
  - [ADR-012: Meta-transactions cho Rent Exemption](#adr-012-meta-transactions-cho-rent-exemption)
  - [ADR-013: VK Integrity & CI/CD Automation](#adr-013-vk-integrity--cicd-automation)
  - [ADR-014: Relayer Staking, Slashing & ZK-Validity Proofs](#adr-014-relayer-staking-slashing--zk-validity-proofs)
  - [ADR-015: Multi-Oracle Aggregation & Circuit Breaker](#adr-015-multi-oracle-aggregation--circuit-breaker)
  - [ADR-016: Liquidation Grace Period & Anti-MEV](#adr-016-liquidation-grace-period--anti-mev)
  - [ADR-017: Strict SPL Token Program ID Validation](#adr-017-strict-spl-token-program-id-validation)
  - [ADR-018: Nullifier Hash Collision Resistance](#adr-018-nullifier-hash-collision-resistance)
- [Index](#index)

---

## Cách đọc file này

**Status của mỗi ADR:**

| Status | Ý nghĩa |
|---|---|
| 🟡 `PROPOSED` | Đang cân nhắc, chưa chốt |
| ✅ `ACCEPTED` | Đã chốt, đang implement |
| ❌ `REJECTED` | Đã cân nhắc, không chọn — nhưng giữ lại để tránh propose lại |
| 🔄 `SUPERSEDED by ADR-xxx` | Đã thay thế bởi ADR khác |
| ⏸️ `DEFERRED` | Quyết định hoãn lại đến phase sau |
| 🔴 `MANDATORY` | Quyết định bắt buộc, không thể thay đổi |
| 🟠 `REQUIRED` | Quyết định cần thiết, phải implement |
| 🟡 `RECOMMENDED` | Quyết định được khuyến nghị, nên implement |

**Khi nào cần tạo ADR mới:**
- Thay đổi ảnh hưởng đến schema hoặc I/O contract (breaking change)
- Chọn giữa hai hoặc nhiều technical approaches
- Quyết định về security, privacy, hoặc compliance
- Bất kỳ thứ gì mà sau này sẽ tự hỏi "tại sao lại làm vậy?"

---

## Phần 1: Các Quyết định Kiến trúc Nền tảng

### ADR-001: Sử dụng Poseidon cho Relayer Payload

**Status:** ✅ ACCEPTED
**Date:** 2026-03-09
**Deciders:** Solvus Core Team
**Tags:** `cryptography` `noir` `optimization`

#### Context

Relayer cần ký một gói dữ liệu (x_hi, x_lo, btc_data, dlc_contract_id) để chứng minh trạng thái Bitcoin. Lựa chọn hàm hash ảnh hưởng trực tiếp đến:
- Thời gian tạo bằng chứng (proving time)
- Chi phí xác minh trên chuỗi
- Tối ưu hóa mạch Noir (số constraints)

**Constraints:**
- Hàm hash phải tương thích với mạch Noir
- Phải giảm thiểu số constraints để tối ưu proving time
- Phải đủ an toàn về mặt mật mã

**Requirements:**
- Hỗ trợ đầu vào 4 fields (x_hi, x_lo, btc_data, dlc_contract_id)
- Output phải là Field trong BN254
- Phải có thư viện TypeScript để verify trên client

#### Options Considered

##### Option A: Poseidon Hash (BN254) ← **CHOSEN**

```
Mô tả: Hàm hash được tối ưu hóa cho mạch Noir, sử dụng tham số BN254.
Cho phép hash 4 fields thành 1 Field output.
```

| Pros | Cons |
|---|---|
| Cực kỳ tối ưu cho mạch Noir (ít constraints) | Ít được biết đến so với SHA-256 |
| Giảm thời gian tạo bằng chứng đáng kể | Cần thư viện TypeScript riêng |
| Chi phí xác minh thấp trên chuỗi | Chưa được audit rộng rãi |

##### Option B: SHA-256

```
Mô tả: Hàm hash tiêu chuẩn, được audit rộng rãi.
Nhưng không được tối ưu hóa cho mạch Noir.
```

| Pros | Cons |
|---|---|
| Được audit rộng rãi, an toàn đã chứng minh | Tạo nhiều constraints trong Noir |
| Có thư viện TypeScript sẵn | Thời gian proving lâu hơn |
| | Chi phí xác minh cao hơn |

**Loại vì:** Thời gian proving quá lâu, chi phí xác minh cao, không phù hợp với yêu cầu tối ưu hóa.

##### Option C: Keccak-256

```
Mô tả: Hàm hash được sử dụng trong Ethereum.
```

| Pros | Cons |
|---|---|
| Được sử dụng rộng rãi | Cũng không được tối ưu cho Noir |
| | Constraints tương tự SHA-256 |

**Loại vì:** Không có lợi thế so với SHA-256, vẫn không tối ưu cho Noir.

#### Decision

> **Chọn Poseidon Hash (BN254) vì:** Nó cực kỳ tối ưu cho mạch Noir (ít constraints), giảm thời gian tạo bằng chứng (Proving time) và chi phí xác minh. Điều này trực tiếp hỗ trợ mục tiêu tối ưu hóa hiệu suất của Solvus Protocol.

#### Consequences

**Tích cực:**
- Thời gian proving giảm 50-70% so với SHA-256
- Chi phí xác minh trên chuỗi thấp hơn
- Trải nghiệm người dùng tốt hơn (proof generation nhanh hơn)

**Tiêu cực / Trade-offs chấp nhận được:**
- Poseidon ít được biết đến so với SHA-256 — chấp nhận vì Noir circuit đã được audit
- Cần maintain thư viện TypeScript riêng — sẽ revisit ở v1.1 nếu có thư viện tốt hơn

**Rủi ro:**
- Nếu Poseidon bị tìm thấy lỗ hổng — mitigate bằng việc audit Noir circuit định kỳ
- Sự thay đổi tham số Poseidon — mitigate bằng ADR-005 (pin version)

#### Implementation Notes

- Sử dụng `circomlibjs@0.1.7` chính xác (xem ADR-005)
- Verify Poseidon hash trên client trước khi gửi proof
- Đảm bảo input order luôn: [x_hi, x_lo, btc_data, dlc_contract_id]
- Không thay đổi tham số Poseidon mà không có ADR mới

**Xem thêm:** BLUEPRINT.md Section 4 (Relayer Component), CONTRACTS.md `RelayerResponse`

---

### ADR-002: Loại bỏ pubkey_x khỏi Public Inputs

**Status:** ✅ ACCEPTED (REJECTED Option A)
**Date:** 2026-03-09
**Deciders:** Solvus Core Team
**Tags:** `privacy` `security`

#### Context

Hệ thống cần xác thực quyền sở hữu khóa Bitcoin trong Noir circuit mà không làm rò rỉ danh tính người dùng lên chuỗi. Nếu đưa `pubkey_x` vào public inputs hoặc state on-chain thì sẽ phát sinh các vấn đề:
- Địa chỉ Bitcoin sẽ công khai trên Solana
- Có thể liên kết người dùng giữa ví Solana và khóa Bitcoin
- Vi phạm nguyên tắc bảo mật và riêng tư của Solvus

**Constraints:**
- Phải xác minh chữ ký Bitcoin
- Phải không lộ thông tin nhận dạng người dùng
- Phải tương thích với Noir circuit

**Requirements:**
- `pubkey_x` phải là Private Input
- Xác minh chữ ký vẫn phải hoạt động
- Không có thông tin nhận dạng công khai

#### Options Considered

##### Option A: Công khai pubkey_x trong Public Inputs ← **REJECTED**

```
Mô tả: Đưa pubkey_x lên chuỗi để xác minh.
```

| Pros | Cons |
|---|---|
| Dễ xác minh công khai | Lộ thông tin nhận dạng |
| | Người dùng không riêng tư |
| | Vi phạm nguyên tắc bảo mật |

**Loại vì:** Vi phạm nguyên tắc bảo mật và riêng tư của Solvus. Địa chỉ Bitcoin sẽ công khai, có thể liên kết người dùng.

##### Option B: pubkey_x là Private Input ← **CHOSEN**

```
Mô tả: Giữ pubkey_x trong Noir circuit, chỉ công khai nullifier_hash.
```

| Pros | Cons |
|---|---|
| Bảo vệ riêng tư người dùng | Cần xác minh chữ ký trong circuit |
| Không lộ thông tin nhận dạng | Tăng số constraints |
| Tuân thủ nguyên tắc bảo mật | |

#### Decision

> **Chọn Option B vì:** Bảo vệ riêng tư người dùng là ưu tiên hàng đầu. `pubkey_x` phải là Private Input để không lộ thông tin nhận dạng.

#### Consequences

**Tích cực:**
- Bảo vệ riêng tư người dùng
- Không thể liên kết người dùng giữa Solana và Bitcoin
- Tuân thủ nguyên tắc bảo mật

**Tiêu cực / Trade-offs chấp nhận được:**
- Tăng số constraints trong Noir circuit — chấp nhận vì bảo mật quan trọng hơn
- Xác minh chữ ký phức tạp hơn — sẽ optimize ở v1.1

**Rủi ro:**
- Nếu Noir circuit bị lỗi — mitigate bằng audit định kỳ
- Người dùng quên private key — không thể recover

#### Implementation Notes

- `pubkey_x` và `pubkey_y` phải là Private Inputs trong Noir
- Xác minh chữ ký ECDSA trong circuit
- Công khai `nullifier_hash` thay vì `pubkey_x`
- Không bao giờ log hoặc lưu `pubkey_x` công khai

**Xem thêm:** BLUEPRINT.md Section 4 (Identity Component), CONTRACTS.md `ProverInputs`

---

### ADR-003: Sử dụng SHA-512 cho Nullifier Secret

**Status:** ✅ ACCEPTED
**Date:** 2026-03-09
**Deciders:** Solvus Core Team
**Tags:** `cryptography` `nullifier`

#### Context

Cần tạo một secret định danh từ chữ ký ví để tạo `nullifier_hash`. Lựa chọn hàm hash ảnh hưởng đến:
- Modulo bias (khả năng collision)
- An toàn mật mã
- Tính xác định

**Constraints:**
- Phải giảm thiểu modulo bias
- Phải an toàn về mặt mật mã
- Phải tạo từ chữ ký 64-byte

**Requirements:**
- Output phải là Field trong BN254
- Phải xác định (deterministic)
- Phải có entropy đủ

#### Options Considered

##### Option A: SHA-256

```
Mô tả: Hàm hash 256-bit, output là 256 bits.
```

| Pros | Cons |
|---|---|
| Được audit rộng rãi | Modulo bias ~1/2^128 (cao hơn) |
| Có thư viện sẵn | |

##### Option B: SHA-512 ← **CHOSEN**

```
Mô tả: Hàm hash 512-bit, output là 512 bits.
Cho phép giảm modulo bias khi chia cho BN254_PRIME.
```

| Pros | Cons |
|---|---|
| Modulo bias ~1/2^258 (cực thấp) | Output lớn hơn (512 bits) |
| An toàn hơn | |
| Giảm khả năng collision | |

#### Decision

> **Chọn SHA-512 vì:** Giảm thiểu modulo bias xuống mức cực thấp (~1/2^258), an toàn hơn cho định danh.

#### Consequences

**Tích cực:**
- Modulo bias cực thấp, gần như không thể collision
- An toàn mật mã cao hơn
- Phù hợp cho ứng dụng critical

**Tiêu cực / Trade-offs chấp nhận được:**
- Output lớn hơn — chấp nhận vì an toàn quan trọng hơn

**Rủi ro:**
- Nếu SHA-512 bị tìm thấy lỗ hổng — mitigate bằng việc audit định kỳ

#### Implementation Notes

- Sử dụng SHA-512 từ `@noble/hashes` hoặc `crypto` module
- Luôn strip recovery byte trước khi hash (xem ADR-006)
- Chia output cho BN254_PRIME để tạo Field
- Không bao giờ reuse nullifier_secret

**Xem thêm:** BLUEPRINT.md Section 4 (Identity Component), CONTRACTS.md `ProverInputs`

---

### ADR-004: Thay thế Math.min bằng reduce() cho UTXO

**Status:** ✅ ACCEPTED
**Date:** 2026-03-09
**Deciders:** Solvus Core Team
**Tags:** `performance` `bugfix`

#### Context

Khi xử lý tập dữ liệu UTXO lớn (>10k items), `Math.min(...spread)` gây ra lỗi "Maximum call stack size exceeded". Điều này ảnh hưởng đến người dùng "Cá voi" có hàng chục nghìn UTXO.

**Constraints:**
- Phải xử lý được UTXO lớn (>100k items)
- Phải không làm tăng độ phức tạp thời gian
- Phải tương thích với JavaScript

**Requirements:**
- Tìm UTXO nhỏ nhất trong mảng
- Không gây stack overflow
- Hiệu suất O(n)

#### Options Considered

##### Option A: Math.min(...spread)

```
Mô tả: Sử dụng spread operator với Math.min.
```

| Pros | Cons |
|---|---|
| Ngắn gọn | Stack overflow với mảng lớn |
| Dễ đọc | Không scalable |

**Loại vì:** Gây stack overflow với UTXO lớn.

##### Option B: reduce() ← **CHOSEN**

```
Mô tả: Sử dụng reduce() để tìm minimum mà không spread.
```

| Pros | Cons |
|---|---|
| Không stack overflow | Dài hơn một chút |
| Scalable với mảy lớn | |
| O(n) complexity | |

#### Decision

> **Chọn reduce() vì:** Đảm bảo hệ thống hoạt động ổn định với các "Cá voi" có hàng chục nghìn UTXO.

#### Consequences

**Tích cực:**
- Không gây stack overflow
- Hỗ trợ UTXO lớn
- Hiệu suất ổn định

**Tiêu cực / Trade-offs chấp nhận được:**
- Code dài hơn một chút — chấp nhận vì ổn định quan trọng hơn

**Rủi ro:**
- Nếu UTXO lớn hơn nữa — mitigate bằng batch processing

#### Implementation Notes

```javascript
const minUTXO = utxos.reduce((min, utxo) => 
  utxo.value < min.value ? utxo : min
);
```

- Luôn sử dụng reduce() thay vì Math.min(...spread)
- Không bao giờ spread mảy UTXO lớn
- Test với UTXO >100k items

**Xem thêm:** BLUEPRINT.md Section 4 (Relayer Component)

---

### ADR-005: Pin chính xác phiên bản `circomlibjs`

**Status:** 🔴 MANDATORY
**Date:** 2026-03-17
**Deciders:** Solvus Core Team
**Tags:** `cryptography` `invariance` `poseidon`

#### Context

Việc sử dụng thư viện `circomlibjs` để tính toán Poseidon hash trong TypeScript phải cho ra kết quả khớp hoàn toàn với Noir circuit. Các phiên bản khác nhau của `circomlibjs` có thể sử dụng các tham số Poseidon khác nhau, dẫn đến:
- Hash không khớp giữa TypeScript và Noir
- Proof verification fail
- Hệ thống không hoạt động

**Constraints:**
- Poseidon hash phải khớp hoàn toàn giữa TypeScript và Noir
- Không được phép sử dụng semver range
- Phải có cách verify tính khớp

**Requirements:**
- Pin chính xác phiên bản
- Verify cross-compatibility
- Không cho phép auto-update

#### Options Considered

##### Option A: Sử dụng semver range (^0.1.x)

```
Mô tả: Cho phép cập nhật minor version tự động.
```

| Pros | Cons |
|---|---|
| Dễ maintain | Có thể break hash compatibility |
| Tự động cập nhật | Proof verification fail |

**Loại vì:** Có thể break hash compatibility, gây lỗi khó debug.

##### Option B: Pin chính xác phiên bản (0.1.7) ← **CHOSEN**

```
Mô tả: Sử dụng phiên bản chính xác, không cho phép cập nhật.
```

| Pros | Cons |
|---|---|
| Hash khớp hoàn toàn | Cần update thủ công |
| Predictable | Phải test khi update |
| Không có surprise | |

#### Decision

> **Chọn pin chính xác phiên bản `circomlibjs@0.1.7` (EXACT) vì:** Đảm bảo Poseidon hash khớp hoàn toàn giữa TypeScript và Noir circuit.

#### Consequences

**Tích cực:**
- Hash khớp hoàn toàn
- Không có surprise breaks
- Predictable behavior

**Tiêu cực / Trade-offs chấp nhận được:**
- Cần update thủ công — chấp nhận vì an toàn quan trọng hơn
- Phải test khi update — sẽ có CI/CD automation (ADR-013)

**Rủi ko:**
- Nếu circomlibjs@0.1.7 có lỗ hổng — mitigate bằng việc audit định kỳ

#### Implementation Notes

- `package.json`: `"circomlibjs": "0.1.7"` (không `^0.1.7`)
- Không bao giờ auto-update
- Verify hash khớp trong CI/CD (ADR-013)
- Khi update: test toàn bộ proof generation

**Xem thêm:** BLUEPRINT.md Section 4 (Prover Component), ADR-013

---

### ADR-006: Đảm bảo tính xác định của Nullifier Secret

**Status:** 🔴 MANDATORY
**Date:** 2026-03-17
**Deciders:** Solvus Core Team
**Tags:** `cryptography` `privacy` `determinism`

#### Context

Nullifier Secret là thành phần cốt lõi để đảm bảo tính riêng tư và không thể liên kết các badge của người dùng. Nó phải được tạo ra một cách xác định (deterministic) từ chữ ký ví của người dùng. Nếu không xác định, người dùng có thể tạo nhiều nullifier_secret khác nhau từ cùng một chữ ký, dẫn đến:
- Có thể mint nhiều lần
- Bypass double-spending protection
- Mất tính riêng tư

**Constraints:**
- Phải xác định (deterministic)
- Phải không thay đổi giữa các lần gọi
- Phải tương thích với Noir circuit

**Requirements:**
- Luôn tạo cùng nullifier_secret từ cùng chữ ký
- Không có random element
- Phải có cách verify

#### Options Considered

##### Option A: Không strip recovery byte

```
Mô tả: Sử dụng chữ ký 65-byte (bao gồm recovery byte).
```

| Pros | Cons |
|---|---|
| Đơn giản | Recovery byte có thể thay đổi |
| | Nullifier secret không ổn định |

**Loại vì:** Recovery byte có thể thay đổi, nullifier secret không ổn định.

##### Option B: Strip recovery byte ← **CHOSEN**

```
Mô tả: Loại bỏ recovery byte, chỉ sử dụng 64 bytes [r||s].
```

| Pros | Cons |
|---|---|
| Nullifier secret ổn định | Cần strip byte |
| Deterministic | Cần verify trong circuit |
| Không có ambiguity | |

#### Decision

> **Luôn `stripRecoveryByte()` khỏi chữ ký 65-byte trước khi băm SHA512 để tạo Nullifier Secret. Chỉ sử dụng 64 byte `[r||s]` của chữ ký.**

#### Consequences

**Tích cực:**
- Nullifier secret ổn định
- Deterministic
- Không thể mint nhiều lần

**Tiêu cực / Trade-offs chấp nhận được:**
- Cần strip byte — chấp nhận vì an toàn quan trọng hơn

**Rủi ko:**
- Nếu recovery byte không được strip — mitigate bằng test coverage

#### Implementation Notes

```typescript
function stripRecoveryByte(sig: Uint8Array): Uint8Array {
  if (sig.length !== 65) throw new Error("Invalid signature length");
  return sig.slice(0, 64); // [r||s]
}

function computeNullifierSecret(userSig: Uint8Array): Field {
  const stripped = stripRecoveryByte(userSig);
  const hash = sha512(stripped);
  return BigInt(hash) % BN254_PRIME;
}
```

- Luôn strip recovery byte trước khi hash
- Test với nhiều chữ ký
- Verify trong Noir circuit

**Xem thêm:** BLUEPRINT.md Section 4 (Identity Component), ADR-003

---

### ADR-007: Chuẩn hóa Serialization Field BN254 cho Verifier

**Status:** 🔴 MANDATORY
**Date:** 2026-03-17
**Deciders:** Solvus Core Team
**Tags:** `serialization` `zkp` `solana`

#### Context

Solvus truyền dữ liệu BN254 giữa ba môi trường khác nhau: TypeScript off-chain, Noir circuit, và Solana verifier. Nếu không có một contract serialization duy nhất thì cùng một giá trị `Field` có thể bị diễn giải khác nhau giữa các bước:
- Endianness lệch giữa off-chain và on-chain
- Field reduction không nhất quán trước khi serialize
- `nullifier_hash`, `public_inputs`, và proof transcript bị drift

**Constraints:**
- Phải xử lý đúng semantics của `Field` trong Noir (BN254 scalar field)
- Phải tương thích với verifier wire format trên Solana
- Phải cho phép test vector kiểm chứng chéo giữa TypeScript, Noir, và Rust

**Requirements:**
- Serialization canonical
- Không lỗi overflow hoặc truncation
- Không tạo ambiguity khi derive `nullifier_hash` hay encode `public_inputs`

#### Decision

> **Tất cả `Field` BN254 được serialize theo big-endian canonical 32-byte sau khi áp dụng cùng semantics field reduction như Noir.** Quy ước này là bắt buộc cho `nullifier_hash`, `public_inputs`, vector prover fixtures, và bất kỳ dữ liệu nào đi qua boundary TypeScript ↔ Noir ↔ Solana verifier.

#### Consequences

**Tích cực:**
- Loại bỏ class lỗi do endianness mismatch
- Fixture và test vector có thể kiểm chứng chéo ổn định
- Contract giữa off-chain và on-chain rõ ràng, dễ audit

**Tiêu cực / Trade-offs chấp nhận được:**
- Mọi producer/consumer của proof payload phải tuân thủ cùng một serializer
- Breaking change nếu từng component cũ encode khác chuẩn

**Rủi ro:**
- Nếu một adapter prover/verifier dùng wire format khác, proof pipeline sẽ fail rõ ràng thay vì ngầm chấp nhận dữ liệu sai

#### Implementation Notes

- `nullifier_hash` on-chain luôn là 32 bytes big-endian
- `nonce` và mọi giá trị `Field` off-chain phải reduce theo BN254 trước khi serialize
- Proof/public inputs fixtures phải được dùng làm golden vectors cho integration tests

**Xem thêm:** ADR-009, ADR-021, CONTRACTS.md `MintZkUSDInput`

---

## Phần 2: Các Quyết định On-chain Solana & VHEATM Audit

### ADR-008: Chuẩn hóa Solana làm Execution Layer

**Status:** 🔴 MANDATORY
**Date:** 2026-03-17
**Deciders:** Solvus Core Team
**Tags:** `blockchain` `solana` `execution`

#### Context

Solvus cần một execution layer đáp ứng đồng thời các yêu cầu của zkUSD mint/burn, PDA-based nullifier protection, SPL token integration, và relayer/oracle/liquidation flow có độ trễ thấp. Kiến trúc hiện tại được chuẩn hóa trên Solana vì:
- PDA cho phép khóa nullifier và state transition theo transaction atomic
- SPL token program là primitive tự nhiên cho zkUSD
- Anchor giúp kiểm soát account constraints rõ ràng và audit được
- Finality và chi phí phù hợp với mint/burn flow tần suất cao

**Constraints:**
- Phải tương thích với ZK proofs
- Phải có Groth16 verifier
- Phải có SPL Token support

**Requirements:**
- Sử dụng Anchor framework
- Implement Groth16 verifier
- Tương thích với SPL Token

#### Options Considered

##### Option A: Solana + Anchor ← **CHOSEN**

```
Mô tả: Chuẩn hóa toàn bộ execution path trên Solana, dùng PDA/account model của Anchor.
```

| Pros | Cons |
|---|---|
| PDA và account constraints phù hợp trực tiếp với nullifier/vault lifecycle | Cần quản lý rent/account sizing cẩn thận |
| SPL token integration tự nhiên cho zkUSD | Cần verifier path tối ưu cho Solana |
| Finality nhanh, phí thấp | |
| Hệ sinh thái oracle/liquidation tốt hơn cho DeFi flow | |

##### Option B: Generic alt-L1/L2

```
Mô tả: Thiết kế trừu tượng để có thể chuyển execution sang chain khác.
```

| Pros | Cons |
|---|---|
| Giảm lock-in | Làm mờ account model thực tế |
| Có thể mở rộng multi-chain về sau | Tăng độ phức tạp ngay từ v1 |
| | Không tận dụng được PDA/SPL primitives hiện có |

**Loại vì:** v1 cần một execution layer cụ thể, audit được và khớp trực tiếp với account model đang implement.

#### Decision

> **Chuẩn hóa Solana/Anchor làm execution layer duy nhất của Solvus v1.** Tất cả contract schema, PDA seeds, verifier integration, SPL token flows, và vault lifecycle đều được định nghĩa theo account model của Solana.

#### Consequences

**Tích cực:**
- Kiến trúc on-chain và docs thống nhất hoàn toàn
- Tận dụng trực tiếp PDA, SPL Token, CPI, và account constraints
- Đơn giản hóa threat model vì không còn execution path song song

**Tiêu cực / Trade-offs chấp nhận được:**
- Mọi tích hợp ngoài Solana phải đi qua adapter/off-chain bridge nếu xuất hiện ở phase sau
- Cần Groth16 verifier path phù hợp với Solana — được chốt ở ADR-009

**Rủi ro:**
- Nếu sau này mở rộng multi-chain thì phải thiết kế thêm layer đồng bộ state thay vì tái dùng trực tiếp contracts v1

#### Implementation Notes

- Sử dụng Anchor framework cho Solana
- Implement Groth16 verifier (ADR-009)
- Sử dụng SPL Token cho zkUSD

**Xem thêm:** ADR-009, ADR-010, BLUEPRINT.md Section 1

---

### ADR-009: Chuẩn hóa Groth16 làm Proving Backend

**Status:** 🔴 MANDATORY
**Date:** 2026-03-17
**Deciders:** Solvus Core Team
**Tags:** `zkp` `cryptography` `solana`

#### Context

Solvus cần một proving backend vừa chạy được với Noir circuit vừa có đường verifier/on-chain integration thực tế trên Solana. Bài toán không chỉ là proving nhanh, mà còn là:
- proof/public input phải có wire format ổn định
- verifier footprint phải phù hợp với Solana
- pipeline CI phải khóa được proving key / verifying key / artifact drift

**Constraints:**
- Phải tương thích với Solana
- Phải có verifier trên chuỗi
- Phải an toàn về mặt mật mã

**Requirements:**
- Hỗ trợ Noir circuit
- Có Solana verifier
- Có thư viện TypeScript

#### Options Considered

##### Option A: Groth16 ← **CHOSEN**

```
Mô tả: Chuẩn hóa prover/verifier quanh Groth16 artifacts và verifier wire contract.
```

| Pros | Cons |
|---|---|
| Verifier path rõ ràng hơn trên Solana | Cần kiểm soát malleability và VK drift |
| Tài liệu/contracts hiện tại đã quy định theo Groth16 | Ceremony/artifact management chặt hơn |
| Dễ chuẩn hóa public inputs/proof payload | |

##### Option B: Universal proving systems

```
Mô tả: Dùng proving system phổ quát hơn để giảm ceremony-specific assumptions.
```

| Pros | Cons |
|---|---|
| Có thể linh hoạt hơn về proving backend | Verifier/on-chain integration hiện không phải đường chính của repo |
| | Wire format và tooling khó ổn định hơn cho v1 |

**Loại vì:** Không phải proving backend đang được contracts/codebase chuẩn hóa và sẽ kéo thêm biến số cho verifier path.

#### Decision

> **Chuẩn hóa Groth16 làm proving backend duy nhất của Solvus v1.** Proof payload, public input serialization, verifier integration, CI integrity checks, và off-chain prover service đều phải tuân theo contract Groth16.

#### Consequences

**Tích cực:**
- Proof contract rõ ràng giữa Noir, prover service và Solana verifier
- Giảm số lượng execution paths cần duy trì
- Dễ đặt CI gates cho VK/artifact drift

**Tiêu cực / Trade-offs chấp nhận được:**
- Có rủi ro malleability — mitigate bằng ADR-014 (Relayer Staking)
- Ceremony và artifact management phải kỷ luật hơn

**Rủi ro:**
- Nếu toolchain Noir/prover adapter lệch version, proof generation có thể fail hard; cần khóa version và test vectors

#### Implementation Notes

- Sử dụng Groth16 artifacts từ pipeline Noir
- Implement Groth16 verifier path trên Solana
- Mitigate malleability bằng ADR-014
- Test proof generation, serialization, và verification bằng golden vectors

**Xem thêm:** ADR-014, BLUEPRINT.md Section 4

---

### ADR-010: Double-spending Protection qua PDA

**Status:** 🔴 MANDATORY
**Date:** 2026-03-17
**Deciders:** Solvus Core Team
**Tags:** `solana` `pda` `security`

#### Context

Cần một cơ chế chống double-spending hiệu quả trên Solana. Các tùy chọn:
- Nonce: Dễ implement nhưng phức tạp khi quản lý
- PDA (Program Derived Address): Tự nhiên trên Solana, an toàn
- Merkle tree: Phức tạp, không cần thiết

**Constraints:**
- Phải chống double-spending
- Phải không thể bypass
- Phải hiệu quả

**Requirements:**
- Sử dụng nullifier_hash làm seed
- Gộp init PDA và verify proof
- Atomic transaction

#### Options Considered

##### Option A: Nonce

```
Mô tả: Sử dụng nonce để chống double-spending.
```

| Pros | Cons |
|---|---|
| Dễ implement | Phức tạp khi quản lý |
| | Có thể quên increment |

**Loại vì:** Phức tạp khi quản lý, có thể quên increment.

##### Option B: PDA ← **CHOSEN**

```
Mô tả: Sử dụng Program Derived Address với nullifier_hash làm seed.
```

| Pros | Cons |
|---|---|
| Tự nhiên trên Solana | Cần init PDA |
| An toàn | Cần atomic transaction |
| Không thể bypass | |

#### Decision

> **Sử dụng Program Derived Address (PDA) với `nullifier_hash` làm seed. Gộp việc khởi tạo PDA (`init`) và xác minh bằng chứng ZK (`verify_proof`) vào cùng một instruction trong Anchor program.** Simulation 1 (PDA Front-running) đã xác nhận lỗ hổng và giải pháp này.

#### Consequences

**Tích cực:**
- Chống double-spending hiệu quả
- Không thể bypass
- Atomic transaction

**Tiêu cực / Trade-offs chấp nhận được:**
- Cần init PDA — chấp nhận vì an toàn quan trọng hơn

**Rủi ko:**
- Nếu PDA bị hack — mitigate bằng ADR-014 (Relayer Staking)

#### Implementation Notes

- Sử dụng `nullifier_hash` làm seed cho PDA
- Gộp init và verify vào cùng instruction
- Atomic transaction (không thể fail một phần)
- Test front-running scenarios

**Xem thêm:** ADR-014, BLUEPRINT.md Section 4

---

### ADR-011: Collateral Locking via TSS-Relayer DLCs

**Status:** 🔴 MANDATORY
**Date:** 2026-03-17
**Deciders:** Solvus Core Team
**Tags:** `defi` `bitcoin` `security`

#### Context

zkUSD hiện tại chỉ chứng minh "Reserves" tại một thời điểm, không phải "Locked Reserves". Điều này cho phép người dùng rút BTC sau khi mint zkUSD, dẫn đến:
- zkUSD không được bảo chứng đầy đủ
- Có thể mất tiền
- Hệ thống không ổn định

**Constraints:**
- Phải khóa BTC on-chain
- Phải đảm bảo zkUSD được bảo chứng
- Phải có cơ chế liquidation

**Requirements:**
- Sử dụng DLCs (Discreet Log Contracts)
- Multi-Relayer (TSS)
- Khóa BTC on-chain

#### Options Considered

##### Option A: Không khóa BTC

```
Mô tả: Chỉ chứng minh reserves, không khóa.
```

| Pros | Cons |
|---|---|
| Đơn giản | zkUSD không được bảo chứng |
| | Có thể mất tiền |

**Loại vì:** zkUSD không được bảo chứng đầy đủ.

##### Option B: DLCs + TSS-Relayer ← **CHOSEN**

```
Mô tả: Sử dụng DLCs để khóa BTC on-chain.
```

| Pros | Cons |
|---|---|
| zkUSD được bảo chứng | Phức tạp hơn |
| Khóa BTC on-chain | Cần TSS-Relayer |
| Ổn định | |

#### Decision

> **Tích hợp Discreet Log Contracts (DLCs) với mạng lưới Multi-Relayer (TSS) để khóa BTC on-chain, đảm bảo zkUSD luôn được bảo chứng đầy đủ.** Phân tích kinh tế và vận hành, cùng với đề xuất từ Multi-Agent Debate. Simulation 1 (Relayer Collusion) đã chứng minh rủi ro và giải pháp này.

#### Consequences

**Tích cực:**
- zkUSD được bảo chứng đầy đủ
- BTC khóa on-chain
- Hệ thống ổn định

**Tiêu cực / Trade-offs chấp nhận được:**
- Phức tạp hơn — chấp nhận vì an toàn quan trọng hơn
- Cần TSS-Relayer — sẽ implement ở v1.0

**Rủi ko:**
- Nếu DLC bị hack — mitigate bằng ADR-014 (Relayer Staking)

#### Implementation Notes

- Sử dụng DLCs để khóa BTC
- Multi-Relayer (TSS) để ký
- Khóa BTC on-chain
- Implement liquidation mechanism

**Xem thêm:** ADR-014, BLUEPRINT.md Section 4

---

### ADR-012: Meta-transactions cho Rent Exemption

**Status:** 🟠 REQUIRED
**Date:** 2026-03-17
**Deciders:** Solvus Core Team
**Tags:** `privacy` `solana` `ux`

#### Context

Người dùng phải trả phí SOL để khởi tạo PDA, có thể làm lộ danh tính thông qua các giao dịch nạp SOL. Điều này vi phạm nguyên tắc bảo mật:
- Có thể liên kết người dùng thông qua giao dịch SOL
- Lộ danh tính
- Trải nghiệm người dùng tệ

**Constraints:**
- Phải ẩn giao dịch nạp SOL
- Phải không lộ danh tính
- Phải có UX tốt

**Requirements:**
- Relayer trả phí SOL
- Meta-transaction
- Người dùng không cần SOL

#### Options Considered

##### Option A: Người dùng trả phí SOL

```
Mô tả: Người dùng tự trả phí SOL.
```

| Pros | Cons |
|---|---|
| Đơn giản | Lộ danh tính |
| | Trải nghiệm tệ |

**Loại vì:** Lộ danh tính, trải nghiệm tệ.

##### Option B: Meta-transactions ← **CHOSEN**

```
Mô tả: Relayer trả phí SOL cho người dùng.
```

| Pros | Cons |
|---|---|
| Ẩn danh tính | Cần trust Relayer |
| Trải nghiệm tốt | |
| Bảo mật | |

#### Decision

> **Triển khai cơ chế Meta-transactions, trong đó Relayer (hoặc một bên thứ ba được ủy quyền) đóng vai trò là người trả phí giao dịch cho việc khởi tạo PDA.** Simulation 3 (Rent Exemption Privacy Leak) đã xác nhận rủi ro này.

#### Consequences

**Tích cực:**
- Ẩn danh tính
- Trải nghiệm tốt
- Bảo mật

**Tiêu cực / Trade-offs chấp nhận được:**
- Cần trust Relayer — chấp nhận vì Relayer đã được audit

**Rủi ko:**
- Nếu Relayer lạm dụng — mitigate bằng ADR-014 (Relayer Staking)

#### Implementation Notes

- Relayer trả phí SOL
- Meta-transaction pattern
- Người dùng không cần SOL
- Verify transaction signature

**Xem thêm:** ADR-014, BLUEPRINT.md Section 4

---

### ADR-013: VK Integrity & CI/CD Automation

**Status:** 🟠 REQUIRED
**Date:** 2026-03-17
**Deciders:** Solvus Core Team
**Tags:** `zkp` `ci/cd` `invariance`

#### Context

Sự không khớp giữa Verification Key (VK) được sử dụng để biên dịch mạch Noir và VK được nhúng trong Anchor program có thể dẫn đến lỗi xác minh. Điều này có thể xảy ra khi:
- Cập nhật Noir circuit mà quên cập nhật VK
- VK bị sửa đổi nhưng circuit không
- CI/CD không kiểm tra

**Constraints:**
- VK phải khớp giữa Noir và Anchor
- Phải có cơ chế kiểm tra
- Phải tự động

**Requirements:**
- CI/CD automation
- Kiểm tra VK khớp
- Không cho phép deploy nếu không khớp

#### Options Considered

##### Option A: Thủ công kiểm tra

```
Mô tả: Kiểm tra VK thủ công trước deploy.
```

| Pros | Cons |
|---|---|
| Đơn giản | Dễ quên |
| | Không scalable |

**Loại vì:** Dễ quên, không scalable.

##### Option B: CI/CD Automation ← **CHOSEN**

```
Mô tả: Tự động kiểm tra VK trong CI/CD.
```

| Pros | Cons |
|---|---|
| Tự động | Cần setup CI/CD |
| Không quên | Cần maintain |
| Scalable | |

#### Decision

> **Thiết lập quy trình CI/CD tự động để đồng bộ hóa VK giữa Noir build và Anchor deploy, bao gồm các bước kiểm tra tự động.** Mọi prover/verifier adapter dependency và VK drift phải bị chặn bằng CI gate.

#### Consequences

**Tích cực:**
- VK tự động khớp
- Không quên
- Scalable

**Tiêu cực / Trade-offs chấp nhận được:**
- Cần setup CI/CD — chấp nhận vì lợi ích lớn hơn

**Rủi ko:**
- Nếu CI/CD fail — mitigate bằng manual check

#### Implementation Notes

- GitHub Actions CI/CD
- Kiểm tra VK khớp
- Không cho phép deploy nếu không khớp
- Log VK hash

**Xem thêm:** BLUEPRINT.md Section 4

---

### ADR-014: Relayer Staking, Slashing & ZK-Validity Proofs

**Status:** 🔴 MANDATORY
**Date:** 2026-03-17
**Deciders:** Solvus Core Team
**Tags:** `game-theory` `security` `relayer`

#### Context

Mạng lưới Relayer (TSS) có thể thông đồng để ký các payload gian lận. Điều này có thể dẫn đến:
- Chứng minh giả
- Mint zkUSD giả
- Mất tiền

**Constraints:**
- Phải chống thông đồng
- Phải có khuyến khích
- Phải có trừng phạt

**Requirements:**
- Staking mechanism
- Slashing mechanism
- ZK-Validity Proofs

#### Options Considered

##### Option A: Không có staking

```
Mô tả: Không có khuyến khích hoặc trừng phạt.
```

| Pros | Cons |
|---|---|
| Đơn giản | Có thể thông đồng |
| | Không an toàn |

**Loại vì:** Có thể thông đồng, không an toàn.

##### Option B: Staking + Slashing ← **CHOSEN**

```
Mô tả: Relayer phải stake, có thể bị slashing.
```

| Pros | Cons |
|---|---|
| Chống thông đồng | Phức tạp hơn |
| Có khuyến khích | Cần game theory |
| Có trừng phạt | |

#### Decision

> **Triển khai cơ chế Staking & Slashing cho Relayer. Mọi payload được ký bởi Relayer phải đi kèm với một Signed Commitment (Ed25519 TSS) chứng minh tính toàn vẹn của payload — thay thế "ZK-Validity Proof" ban đầu (xem ADR-022). ZK-Validity Proof deferred to Phase 2.** Simulation 1 (Relayer Collusion) đã xác nhận lỗ hổng này. Phân tích Game Theory cho thấy cần có cơ chế khuyến khích và trừng phạt.

#### Consequences

**Tích cực:**
- Chống thông đồng
- Có khuyến khích
- Có trừng phạt
- An toàn hơn

**Tiêu cực / Trade-offs chấp nhận được:**
- Phức tạp hơn — chấp nhận vì an toàn quan trọng hơn
- Cần game theory — sẽ phân tích ở v1.1

**Rủi ko:**
- Nếu Relayer vẫn thông đồng — mitigate bằng monitoring

#### Implementation Notes

- Relayer phải stake SOL
- Slashing nếu ký payload gian lận
- ZK-Validity Proofs cho mỗi payload
- Monitoring Relayer behavior

**Xem thêm:** ADR-011, BLUEPRINT.md Section 4

---

### ADR-015: Multi-Oracle Aggregation & Circuit Breaker

**Status:** 🔴 MANDATORY
**Date:** 2026-03-17
**Deciders:** Solvus Core Team
**Tags:** `oracle` `security` `game-theory`

#### Context

Sự phụ thuộc vào một Oracle duy nhất hoặc dễ bị thao túng có thể dẫn đến việc thao túng giá BTC/USD. Điều này có thể dẫn đến:
- Mint zkUSD giả
- Liquidation giả
- Mất tiền

**Constraints:**
- Phải sử dụng nhiều Oracle
- Phải có cơ chế kiểm tra
- Phải có circuit breaker

**Requirements:**
- Multi-Oracle Aggregation
- Circuit Breaker
- Ít nhất 3 Oracle

#### Options Considered

##### Option A: Single Oracle

```
Mô tả: Sử dụng một Oracle duy nhất.
```

| Pros | Cons |
|---|---|
| Đơn giản | Dễ bị thao túng |
| | Không an toàn |

**Loại vì:** Dễ bị thao túng, không an toàn.

##### Option B: Multi-Oracle ← **CHOSEN**

```
Mô tả: Sử dụng ít nhất 3 Oracle độc lập.
```

| Pros | Cons |
|---|---|
| Khó bị thao túng | Phức tạp hơn |
| An toàn hơn | Cần circuit breaker |
| | |

#### Decision

> **Sử dụng Multi-Oracle Aggregation từ ít nhất ba nguồn độc lập (ví dụ: Chainlink, Pyth, Switchboard). Triển khai cơ chế Circuit Breaker tự động tạm dừng các hoạt động mint/burn/liquidate nếu giá từ các Oracle lệch nhau quá 5%.** Simulation 2 (Oracle Manipulation) đã chứng minh rủi ro này. Phân tích Game Theory cho thấy kẻ tấn công có động cơ thao túng Oracle.

#### Consequences

**Tích cực:**
- Khó bị thao túng
- An toàn hơn
- Circuit breaker tự động

**Tiêu cực / Trade-offs chấp nhận được:**
- Phức tạp hơn — chấp nhận vì an toàn quan trọng hơn

**Rủi ko:**
- Nếu tất cả Oracle bị hack — mitigate bằng monitoring

#### Implementation Notes

- Sử dụng Chainlink, Pyth, Switchboard
- Aggregation: median hoặc weighted average
- Circuit breaker: 5% lệch
- Tạm dừng mint/burn/liquidate
- Monitoring Oracle prices

**Xem thêm:** BLUEPRINT.md Section 4

---

### ADR-016: Liquidation Grace Period & Anti-MEV

**Status:** 🟠 REQUIRED
**Date:** 2026-03-17
**Deciders:** Solvus Core Team
**Tags:** `defi` `mev` `ux`

#### Context

Kẻ tấn công có thể sử dụng MEV để front-run các giao dịch thanh lý, trục lợi từ người dùng. Điều này có thể dẫn đến:
- Thanh lý không công bằng
- Mất tiền cho người dùng
- Trải nghiệm tệ

**Constraints:**
- Phải chống MEV
- Phải có grace period
- Phải công bằng

**Requirements:**
- Grace period cho vault
- Cho phép nạp thêm tài sản
- Chống front-running

#### Options Considered

##### Option A: Không có grace period

```
Mô tả: Thanh lý ngay khi collateral không đủ.
```

| Pros | Cons |
|---|---|
| Đơn giản | Có thể bị MEV |
| | Không công bằng |

**Loại vì:** Có thể bị MEV, không công bằng.

##### Option B: Grace Period ← **CHOSEN**

```
Mô tả: Cho phép grace period trước thanh lý.
```

| Pros | Cons |
|---|---|
| Chống MEV | Phức tạp hơn |
| Công bằng | Cần implement |
| Cho phép nạp thêm | |

#### Decision

> **Triển khai Grace Period (khoảng thời gian ân hạn) cho các vault sắp bị thanh lý, cho phép người dùng có một khoảng thời gian nhất định để nạp thêm tài sản đảm bảo.** Simulation 3 (MEV Front-running Liquidation) đã xác nhận lỗ hổng này. Phân tích Game Theory cho thấy kẻ tấn công có động cơ mạnh mẽ để khai thác MEV.

#### Consequences

**Tích cực:**
- Chống MEV
- Công bằng
- Trải nghiệm tốt

**Tiêu cực / Trade-offs chấp nhận được:**
- Phức tạp hơn — chấp nhận vì công bằng quan trọng hơn

**Rủi ko:**
- Nếu vẫn bị MEV — mitigate bằng private mempool

#### Implementation Notes

- Grace period: 1 giờ (configurable)
- Cho phép nạp thêm collateral
- Chống front-running
- Implement liquidation queue

**Xem thêm:** BLUEPRINT.md Section 4

---

### ADR-017: Strict SPL Token Program ID Validation

**Status:** 🔴 MANDATORY
**Date:** 2026-03-17
**Deciders:** Solvus Core Team
**Tags:** `solana` `cpi` `security`

#### Context

Kẻ tấn công có thể truyền vào một `token_program` account giả mạo trong CPI để mint zkUSD vào ví của họ. Điều này có thể dẫn đến:
- Mint zkUSD giả
- Mất tiền

**Constraints:**
- Phải kiểm tra `token_program`
- Phải là SPL Token Program chính thức
- Phải không thể bypass

**Requirements:**
- Kiểm tra `token_program` ID
- Không cho phép giả mạo
- Atomic check

#### Options Considered

##### Option A: Không kiểm tra

```
Mô tả: Không kiểm tra token_program.
```

| Pros | Cons |
|---|---|
| Đơn giản | Có thể bị giả mạo |
| | Không an toàn |

**Loại vì:** Có thể bị giả mạo, không an toàn.

##### Option B: Strict Validation ← **CHOSEN**

```
Mô tả: Kiểm tra token_program là SPL Token Program chính thức.
```

| Pros | Cons |
|---|---|
| An toàn | Không linh hoạt |
| Không thể bypass | |
| | |

#### Decision

> **Anchor program phải thực hiện kiểm tra nghiêm ngặt để đảm bảo rằng `token_program` account được truyền vào trong các CPI là SPL Token Program ID chính thức (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`).** Root Cause Taxonomy V2 (Type Contract). Đây là một lỗ hổng cơ bản trong bảo mật CPI trên Solana.

#### Consequences

**Tích cực:**
- Chống giả mạo
- An toàn
- Không thể bypass

**Tiêu cực / Trade-offs chấp nhận được:**
- Không linh hoạt — chấp nhận vì an toàn quan trọng hơn

**Rủi ko:**
- Nếu SPL Token Program ID thay đổi — mitigate bằng ADR mới

#### Implementation Notes

```rust
require_eq!(
  ctx.accounts.token_program.key(),
  spl_token::ID,
  "Invalid token program"
);
```

- Kiểm tra token_program ID
- Không cho phép giả mạo
- Atomic check
- Test với giả mạo

**Xem thêm:** BLUEPRINT.md Section 4

---

### ADR-018: Nullifier Hash Collision Resistance

**Status:** 🟠 REQUIRED *(escalated from 🟡 RECOMMENDED — ADR-019 cycle, blast radius HIGH: collision enables vault PDA hijacking)*
**Date:** 2026-03-17
**Escalation date:** 2026-03-17
**Deciders:** Solvus Core Team
**Tags:** `cryptography` `security` `nullifier`

#### Context

Mặc dù xác suất thấp, nhưng nếu có collision trong `nullifier_hash`, một user có thể chiếm quyền kiểm soát PDA của user khác. Điều này có thể dẫn đến:
- Chiếm quyền kiểm soát PDA
- Mint zkUSD giả
- Mất tiền

**Constraints:**
- Phải tăng cường tính duy nhất
- Phải không làm tăng complexity
- Phải tương thích với Noir

**Requirements:**
- Kết hợp thêm entropy
- Không làm tăng complexity
- Tương thích với Noir

#### Options Considered

##### Option A: Không tăng cường

```
Mô tả: Giữ nguyên nullifier_hash.
```

| Pros | Cons |
|---|---|
| Đơn giản | Có thể collision |
| | Không an toàn |

**Loại vì:** Có thể collision, không an toàn.

##### Option B: Tăng cường entropy ← **CHOSEN**

```
Mô tả: Kết hợp thêm entropy vào nullifier_hash.
```

| Pros | Cons |
|---|---|
| Tăng cường tính duy nhất | Phức tạp hơn |
| Chống collision | Cần update Noir |
| An toàn hơn | |

#### Decision

> **Tăng cường tính duy nhất của `nullifier_hash` bằng Asset-Bound Nullifier architecture: `nullifier_hash = Poseidon(dlc_contract_id, badge_type, nullifier_secret, 0)`. DLC contract ID cung cấp entropy từ Bitcoin network, đảm bảo uniqueness và zero-knowledge.**

#### Consequences

**Tích cực:**
- Tăng cường tính duy nhất
- Chống collision
- An toàn hơn

**Tiêu cực / Trade-offs chấp nhận được:**
- Phức tạp hơn — chấp nhận vì an toàn quan trọng hơn
- Cần update Noir — sẽ implement ở v1.1

**Rủi ko:**
- Nếu vẫn collision — mitigate bằng monitoring

#### Implementation Notes

- Kết hợp commitment_hash hoặc transaction_hash
- Update Noir circuit
- Test collision scenarios
- Monitoring collision

**Xem thêm:** ADR-006, BLUEPRINT.md Section 4

---

---

## Phần 3: ADR từ VHEATM Audit Cycle #1

> Các quyết định dưới đây được phát hiện và verify trong VHEATM 5.0 Audit Cycle #1 (2026-03-17).
> Mỗi ADR có simulation evidence từ [E] — không có assumption-based decision.

---

### ADR-019: Định nghĩa Collateralization Ratio là Mandatory Constant

**Status:** 🔴 MANDATORY
**Date:** 2026-03-17
**Deciders:** VHEATM Audit Cycle #1
**Tags:** `defi` `invariant` `liquidation` `critical`

#### Context

`VaultState` invariant trong CONTRACTS.md tham chiếu `collateralization_ratio` nhưng constant này không được define ở bất kỳ đâu trong codebase. Hai developer implement độc lập sẽ dùng giá trị khác nhau (1.0 vs 1.5 là hai giá trị hợp lý nhất), tạo ra 50% discrepancy trong ngưỡng liquidation. Một vault với 120% collateral là HEALTHY dưới ratio=1.0 nhưng UNHEALTHY dưới ratio=1.5.

**Simulation E-01 confirmed:** Invariant gap verified. No definition found across all 3 project files.

#### Decision

> **Define `COLLATERALIZATION_RATIO = 15000`, `LIQUIDATION_THRESHOLD = 12000`, `AT_RISK_THRESHOLD = 13000` (basis points, ÷10000) là MANDATORY constants trong CONTRACTS.md. Sửa VaultState invariant thành: `collateral_btc * 10000 >= zkusd_minted * COLLATERALIZATION_RATIO`.**

#### Evidence

Simulation E-01 (micro_sim_small): Invariant text confirmed undefined. Two implementations with ratio=1.0 vs ratio=1.5 produce divergent liquidation decisions on identical vault state.

#### Pattern

```rust
// CONTRACTS.md constants (MANDATORY — do not hard-code elsewhere):
COLLATERALIZATION_RATIO: u64 = 15000  // 150% — must maintain to be HEALTHY
LIQUIDATION_THRESHOLD:   u64 = 12000  // 120% — UNHEALTHY below this
AT_RISK_THRESHOLD:       u64 = 13000  // 130% — AT_RISK below this

// Correct invariant check:
assert!(collateral_btc * 10000 >= zkusd_minted * COLLATERALIZATION_RATIO);
```

#### Rejected

- Runtime config: tạo attack surface (wrong config + oracle manipulation = mass liquidation).
- 100% ratio: không có buffer cho BTC volatility.
- 200% ratio: quá strict, kills UX.

---

### ADR-020: Placeholder Constants CI/CD Gate

**Status:** 🔴 MANDATORY
**Date:** 2026-03-17
**Deciders:** VHEATM Audit Cycle #1
**Tags:** `ci/cd` `deployment` `invariant`

#### Context

`GROTH16_VERIFIER_PROGRAM_ID = {{VERIFIER_ID}}` và `ORACLE_PRICE_FEED_ID = {{FEED_ID}}` là unfilled placeholders trong CONTRACTS.md. Nếu copy verbatim vào Anchor program hoặc config, deployment sẽ fail (parse panic) hoặc silently route proof verification đến wrong/null program — cho phép invalid proof pass. ADR-013 chỉ kiểm tra VK integrity, không kiểm tra program ID substitution.

**Simulation E-02 confirmed:** `grep "{{" CONTRACTS.md` returns 2 hits. No CI gate exists for these.

#### Decision

> **(1) Fill `GROTH16_VERIFIER_PROGRAM_ID` với devnet value khi available. Pyth BTC/USD devnet feed: `H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG` cho `ORACLE_PRICE_FEED_ID`. (2) Extend ADR-013 CI/CD pipeline với mandatory placeholder check: deploy fails nếu tìm thấy bất kỳ `{{...}}` nào. (3) Dùng per-environment constants file (devnet/testnet/mainnet), require explicit env flag tại build time.**

#### Evidence

Simulation E-02: 2 placeholders confirmed. Deployment failure mode confirmed (parse panic or null program routing).

#### Pattern

```bash
# Thêm vào CI/CD pipeline (extends ADR-013):
# Step: Check no unfilled placeholders
- name: Validate no placeholder constants
  run: |
    if grep -r "{{" programs/ config/ contracts/ 2>/dev/null; then
      echo "ERROR: Unfilled placeholder constants found. Fill before deploy."
      exit 1
    fi
```

```
# Per-environment file structure:
config/
  devnet.env    — GROTH16_VERIFIER_PROGRAM_ID=<devnet_id>
  testnet.env   — GROTH16_VERIFIER_PROGRAM_ID=<testnet_id>
  mainnet.env   — GROTH16_VERIFIER_PROGRAM_ID=<mainnet_id>
# Build requires: ENV=devnet|testnet|mainnet
```

#### Rejected

- Manual review: already failed — placeholders exist in merged docs today.
- Single constants file: tidak ada environment isolation.

---

### ADR-021: Field→[u8;32] Serialization Endianness Contract

**Status:** 🔴 MANDATORY
**Date:** 2026-03-17
**Deciders:** VHEATM Audit Cycle #1
**Tags:** `cryptography` `serialization` `nullifier` `solana`

#### Context

`nullifier_hash` trong Noir circuit adalah `Field` (BN254), tetapi `MintZkUSDInput.nullifier_hash` trong Anchor adalah `[u8; 32]`. Không có spec endianness giữa TypeScript (Noir output) và Rust (Anchor input). Nếu TypeScript serialize big-endian nhưng Rust interpret khác, PDA seed sẽ khác nhau — double-spend protection false-positive (chặn mint hợp lệ) hoặc false-negative (cho phép replay). `INV-10` được tham chiếu trong `RelayerResponse.signature` nhưng chưa bao giờ được định nghĩa.

**Simulation E-03 confirmed:** PDA address diverges by byte order. INV-10 undefined across all 3 files.

#### Decision

> **Tất cả `Field → [u8;32]` conversions phải dùng big-endian byte order (Noir native). Rust/Anchor nhận bytes và dùng as-is — không conversion. Define INV-10: `signature = r_bytes_be || s_bytes_be`. Thêm 3 canonical cross-language test vectors vào CI.**

#### Evidence

Simulation E-03 (micro_sim_medium): Test vector `Field=0x01` → big-endian `[0x00,...,0x01]` vs little-endian `[0x01,...,0x00]` produce different PDA addresses. INV-10 undefined confirmed.

#### Pattern

```typescript
// TypeScript — Noir Field → bytes (ALWAYS big-endian):
function fieldToBytes32(field: bigint): Uint8Array {
  const hex = field.toString(16).padStart(64, '0');
  return Uint8Array.from(Buffer.from(hex, 'hex')); // big-endian
}
```

```rust
// Rust/Anchor — receive and use as-is:
let nullifier_hash: [u8; 32] = ctx.accounts.nullifier_hash; // no conversion
let seeds = &[nullifier_hash.as_ref()];
```

```typescript
// CI Test Vectors (ADR-021 — 3 canonical tuples):
// Vector 1: Field=1n
//   bytes_be: [0x00,0x00,...,0x00,0x01]
//   PDA: (derived from above seed)
// Vector 2: Field=BN254_PRIME-1n
//   bytes_be: [0x30,0x64,...,0x00]
// Vector 3: Real nullifier from devnet test mint
//   (fill during Phase 1 integration testing)
```

#### Rejected

- Little-endian: Rust native mais requires conversion layer — more error-prone.
- Runtime detection: adds complexity, fails silently on edge cases.

---

### ADR-022: Redesign ADR-014 ZK-Validity Proof — Signed Commitment Protocol

**Status:** 🟠 REQUIRED
**Date:** 2026-03-17
**Deciders:** VHEATM Audit Cycle #1
**Tags:** `relayer` `security` `zkp` `architecture`

#### Context

ADR-014 yêu cầu mỗi Relayer payload kèm "ZK-Validity Proof chứng minh payload tuân thủ Noir circuit logic" nhưng không specify circuit nào được dùng. Nếu dùng main Groth16 circuit → circular dependency (proof cần Relayer data, Relayer data cần proof). Nếu dùng separate circuit → cần separate trusted setup (chưa có spec). ADR-014 như hiện tại không thể bootstrap Phase 1.

**Simulation E-04 confirmed:** Circular dependency traced. No separate circuit spec exists. Bootstrapping blocked.

#### Decision

> **Split ADR-014 thành hai concerns tách biệt:**
> **(a) Relayer Data Integrity (Phase 1):** Ed25519 TSS signatures on payload — đã có trong kiến trúc hiện tại. Gọi là "Signed Commitment Protocol v1". Không cần ZK proof riêng cho layer này.
> **(b) Circuit Compliance Verification (Phase 2):** Implement dưới dạng Poseidon commitment scheme (hash of circuit-valid inputs published on-chain). Không phải full ZK proof — đơn giản hơn, không cần trusted setup riêng.
> **Remove "ZK-Validity Proof" language từ ADR-014 decision text.**

#### Evidence

Simulation E-04 (single_llm_call): Dependency chain traced. Ed25519 TSS already present in architecture, sufficient for Phase 1 Relayer honesty. Circular dep confirmed for ZK approach.

#### Pattern

```
Phase 1 — Signed Commitment Protocol v1:
  payload = {btc_data, timestamp, pubkey_x, pubkey_y}
  commitment = Poseidon(payload)      // on-chain publishable
  signature = TSS_Ed25519(commitment) // existing Relayer signing
  → No separate ZK circuit needed

Phase 2 — Circuit Compliance (deferred):
  circuit_inputs_hash = Poseidon(all_noir_inputs)
  publish circuit_inputs_hash on-chain alongside signature
  → Verifier can check commitment matches submitted proof inputs
```

#### Rejected

- Keep "ZK-Validity Proof" as-is: circular dep, cannot bootstrap.
- Separate trusted setup in Phase 1: out of scope, adds 2-3 months.

---

### ADR-023: Admin Multisig Governance cho Circuit Breaker

**Status:** 🟠 REQUIRED
**Date:** 2026-03-17
**Deciders:** VHEATM Audit Cycle #1
**Tags:** `governance` `security` `circuit-breaker` `admin`

#### Context

ADR-015 Circuit Breaker yêu cầu "manual admin deactivation" nhưng không có spec nào cho admin key type, multisig threshold, key rotation, hay timeout. Single EOA admin = 1 key compromise hoặc 1 key loss → protocol permanently frozen hoặc attacker có full control. Không có 72h-hay-bao-lâu timeout. Không có governance ADR trong 18 ADRs hiện tại.

**Simulation E-05 confirmed:** No admin governance spec found. Permanent freeze possible. SPoF confirmed.

#### Decision

> **Admin cho circuit breaker và emergency operations PHẢI là 3-of-5 multisig (Squads Protocol hoặc tương đương). Circuit breaker auto-expire sau `CIRCUIT_BREAKER_TIMEOUT = 259200s (72h)` nếu multisig không renew. Key rotation yêu cầu 4-of-5 approval. Signer identities phải được public document trong một registry ADR.**

#### Evidence

Simulation E-05 (micro_sim_small): SPoF confirmed. No governance spec in 18 ADRs. Auto-expire pattern from Gnosis Safe / Squads battle-tested.

#### Pattern

```
Admin Multisig spec:
  type:           Squads Protocol v4 (Solana-native multisig)
  threshold:      3-of-5 to deactivate/renew CB
  rotation:       4-of-5 to change signers
  timeout:        CIRCUIT_BREAKER_TIMEOUT = 72h (auto-expire, không freeze vĩnh viễn)
  registry:       ADR-023-signers.md (public, updated per rotation)

Operations:
  deactivate_circuit_breaker → 3-of-5
  renew_circuit_breaker      → 3-of-5 (phải renew trước 72h nếu muốn giữ CB active)
  rotate_admin_keys          → 4-of-5
  emergency_pause_protocol   → 3-of-5 (separate from CB)
```

#### Rejected

- Single EOA: SPoF, confirmed dangerous.
- DAO governance: Phase 4 scope, too complex for Phase 1.
- No timeout: permanent freeze risk.
- 2-of-3: insufficient for protocol-level security.

---

## Index

> Danh sách nhanh để tìm ADR theo topic.

| ADR | Title | Status | Tags |
|---|---|---|---|
| ADR-001 | Sử dụng Poseidon cho Relayer Payload | ✅ | `cryptography` `noir` `optimization` |
| ADR-002 | Loại bỏ pubkey_x khỏi Public Inputs | ✅ | `privacy` `security` |
| ADR-003 | Sử dụng SHA-512 cho Nullifier Secret | ✅ | `cryptography` `nullifier` |
| ADR-004 | Thay thế Math.min bằng reduce() cho UTXO | ✅ | `performance` `bugfix` |
| ADR-005 | Pin chính xác phiên bản circomlibjs | 🔴 | `cryptography` `invariance` `poseidon` |
| ADR-006 | Đảm bảo tính xác định của Nullifier Secret | 🔴 | `cryptography` `privacy` `determinism` |
| ADR-007 | Chuẩn hóa Serialization Field BN254 cho Verifier | 🔴 | `serialization` `zkp` `solana` |
| ADR-008 | Chuẩn hóa Solana làm Execution Layer | 🔴 | `blockchain` `solana` `execution` |
| ADR-009 | Chuẩn hóa Groth16 làm Proving Backend | 🔴 | `zkp` `cryptography` `solana` |
| ADR-010 | Double-spending Protection qua PDA | 🔴 | `solana` `pda` `security` |
| ADR-011 | Collateral Locking via TSS-Relayer DLCs | 🔴 | `defi` `bitcoin` `security` |
| ADR-012 | Meta-transactions cho Rent Exemption | 🟠 | `privacy` `solana` `ux` |
| ADR-013 | VK Integrity & CI/CD Automation | 🟠 | `zkp` `ci/cd` `invariance` |
| ADR-014 | Relayer Staking, Slashing & Signed Commitment | 🔴 | `game-theory` `security` `relayer` |
| ADR-015 | Multi-Oracle Aggregation & Circuit Breaker | 🔴 | `oracle` `security` `game-theory` |
| ADR-016 | Liquidation Grace Period & Anti-MEV | 🟠 | `defi` `mev` `ux` |
| ADR-017 | Strict SPL Token Program ID Validation | 🔴 | `solana` `cpi` `security` |
| ADR-018 | Nullifier Hash Collision Resistance | 🟠 | `cryptography` `security` `nullifier` |
| **ADR-019** | **Collateralization Ratio Mandatory Constants** | 🔴 | `defi` `invariant` `liquidation` `critical` |
| **ADR-020** | **Placeholder Constants CI/CD Gate** | 🔴 | `ci/cd` `deployment` `invariant` |
| **ADR-021** | **Field→[u8;32] Serialization Endianness Contract** | 🔴 | `cryptography` `serialization` `nullifier` `solana` |
| **ADR-022** | **Redesign ADR-014: Signed Commitment Protocol** | 🟠 | `relayer` `security` `zkp` `architecture` |
| **ADR-023** | **Admin Multisig Governance cho Circuit Breaker** | 🟠 | `governance` `security` `circuit-breaker` `admin` |

---

---

## Phần 4: ADR từ VHEATM Audit Cycle #2

> Phát hiện và verify trong VHEATM 5.0 Audit Cycle #2 (2026-03-17).

---

### ADR-024: DLC Cross-Chain Coordination Interface v1

**Status:** 🔴 MANDATORY
**Date:** 2026-03-17
**Deciders:** VHEATM Audit Cycle #2
**Tags:** `defi` `bitcoin` `dlc` `cross-chain` `critical`

#### Context

`burn_zkusd` BLUEPRINT pseudocode: `"Release collateral via DLCs (ADR-011)"` — một dòng duy nhất, zero implementation detail. zkUSD burn là on-chain Solana (instant), DLC close là on-chain Bitcoin (~60 min). Không có spec cho: Relayer role, observation mechanism, DLC closing condition, failure retry, hay atomic window risk. Relayer offline = BTC locked forever.

**Simulation E-06 confirmed:** 4 failure modes traced. "Lost funds" window unacknowledged. No coordination spec in any of 3 files.

#### Decision

> **(1)** `burn_zkusd` emits `BurnZkUSD` event với `{owner, amount, dlc_contract_id, timestamp}`. **(2)** Relayer subscribes Solana WebSocket → khi nhận event, broadcast DLC close lên Bitcoin trong `DLC_CLOSE_TIMEOUT = 3600s`, 3 retries exponential backoff. **(3)** Vault status = `PendingBtcRelease` trong window. **(4)** DLC close fail sau 3 retries → alert Admin Multisig (ADR-023). **(5)** Atomic window risk explicitly acknowledged: user chịu BTC price risk trong ~60 phút.

#### Evidence

Sim E-06 (micro_sim_medium): Cross-chain gap confirmed. "Lost funds" window traced. Relayer-offline permanent-lock confirmed.

#### Pattern

```
VaultState.status transitions:
  burn_zkusd called → PendingBtcRelease
  DLC closed on BTC → Confirmed (vault closed)
  DLC_CLOSE_TIMEOUT exceeded → ERROR_DLC_CLOSE_TIMEOUT + Admin alert

Relayer DLC observer:
  subscribe: Solana WebSocket → filter BurnZkUSD events
  on_event:  broadcast DLC close tx (Bitcoin)
  retry:     3× exponential backoff within DLC_CLOSE_TIMEOUT
  on_fail:   alert Admin Multisig + freeze further burns for vault
```

#### Rejected

Trustless cross-chain bridge (Phase 4). Instant HTLC atomic swap (out of Phase 1 scope).

---

### ADR-025: Fix BurnZkUSD Output Contract — ERROR_GRACE_PERIOD

**Status:** 🔴 MANDATORY
**Date:** 2026-03-17
**Deciders:** VHEATM Audit Cycle #2
**Tags:** `contracts` `defi` `grace-period` `anchor`

#### Context

CONTRACTS.md `BurnZkUSD` output không include `ERROR_GRACE_PERIOD`. BLUEPRINT pseudocode có check này. CONTRACTS header: "file này thắng" → Anchor developer sẽ bỏ qua grace period check khi implement. User có thể burn zkUSD trong grace period, zkUSD = 0 nhưng vault state undefined.

**Simulation E-07 confirmed:** Contract/blueprint mismatch. CONTRACTS wins per file header. Anchor dev skips check.

#### Decision

> Thêm `ERROR_BURN_IN_GRACE_PERIOD` vào `BurnZkUSD` output contract trong CONTRACTS.md. Rename từ `ERROR_GRACE_PERIOD` (dùng riêng cho LiquidateVault) để tránh ambiguity. Thêm vào Error Registry. Update pre-condition: `vault.status != GRACE_PERIOD`.

#### Evidence

Sim E-07 (string_replace scan): BurnZkUSD output missing ERROR_GRACE_PERIOD confirmed. BLUEPRINT line 566 has check, CONTRACTS output does not.

#### Pattern

```
BurnZkUSD output (CONTRACTS.md):
  | Ref<ERROR_BURN_IN_GRACE_PERIOD>  // vault.status == GRACE_PERIOD

Anchor implementation:
  require!(vault.status != VaultStatus::GracePeriod,
           CustomError::BurnInGracePeriod);
```

#### Rejected

Allow burn during grace period (defeats anti-MEV purpose).

---

### ADR-026: Nonce Generation Protocol + Multi-Badge Clarification

**Status:** 🔴 MANDATORY
**Date:** 2026-03-17
**Deciders:** VHEATM Audit Cycle #2
**Tags:** `cryptography` `prover` `nonce` `multi-badge`

#### Context

`ProverInputs.nonce` không có generation spec — client có thể dùng nonce=0. Với nonce=0: `nullifier = Hash(secret, badge_type, timestamp, 0)` — timestamp thay đổi mỗi giây → 3600 unique mints/hour per badge type theoretically. Multi-badge minting (Whale + Hodler + Stacker simultaneously) chưa được document là intended hay forbidden.

**Simulation E-08 confirmed:** nonce=0 attack vector (3600 mints/hr). Multi-badge intent undocumented.

#### Decision

> **(1)** **Asset-Bound Nullifier:** Sử dụng `dlc_contract_id` thay thế cho `nonce` và `timestamp`. Nullifier được tính: `nullifier_hash = Poseidon(dlc_contract_id, badge_type, nullifier_secret, 0)`. Điều này đảm bảo:
> - Rate-limiting tự nhiên qua DLC contract (1 DLC per mint)
> - Stateless relayer (không cần stateStore)
> - Zero-knowledge (nullifier_secret là private input)
> **(2)** **Multi-badge minting: EXPLICITLY ALLOWED.** Whale + Hodler + Stacker = separate qualifications, separate DLC positions.

#### Evidence

Sim E-08 (micro_sim_small): nonce=0 + timestamp drift attack confirmed. Poseidon deterministic nonce eliminates attack.

#### Pattern

```typescript
// MANDATORY — Frontend/Prover nullifier computation:
function computeNullifierHash(
  dlcContractId: Field,
  badgeType: number,
  nullifierSecret: Field
): Field {
  return poseidon([
    dlcContractId,
    BigInt(badgeType),
    nullifierSecret,
    0n
  ]);
}
// nullifier_secret is generated from user signature (see ADR-003, ADR-006)
// dlc_contract_id comes from Relayer response (DLC contract on Bitcoin)
// Multi-badge: each badge_type produces different nullifier → different PDA → ALLOWED
```

#### Rejected

Random nonce (non-deterministic, can't retry). Sequential counter (needs on-chain state).

---

### ADR-027: Badge Threshold Constants — INV-13

**Status:** 🔴 MANDATORY
**Date:** 2026-03-17
**Deciders:** VHEATM Audit Cycle #2
**Tags:** `contracts` `invariant` `badge` `threshold`

#### Context

`ProverInputs.threshold :: u64 // INV-13` referenced 3× in CONTRACTS.md, defined 0×. No constants for Whale/Hodler/Stacker qualification thresholds. Developers will hardcode different values → threshold mismatch across Frontend, Prover, Anchor. Attack: threshold=0 → anyone qualifies → zkUSD with zero BTC backing. Third undefined invariant (after INV-10, INV-13 pattern confirmed).

**Simulation E-09 confirmed:** INV-13 undefined. 0× definition across all 3 files. threshold=0 attack vector confirmed.

#### Decision

> Define `WHALE_THRESHOLD = 100_000_000`, `HODLER_THRESHOLD = 365`, `STACKER_THRESHOLD = 10` as MANDATORY constants. Define INV-13 explicitly. Add CI gate for undefined INV references.

#### Evidence

Sim E-09 (string_replace scan): `grep "INV-13:"` returns 0 results. 3 references with 0 definitions.

#### Pattern

```
WHALE_THRESHOLD   = 100_000_000  // 1 BTC in satoshis
HODLER_THRESHOLD  = 365          // days — oldest UTXO ≥ 1 year
STACKER_THRESHOLD = 10           // count — ≥ 10 UTXOs

INV-13: threshold must equal canonical constant for badge_type:
  badge_type=1 (Whale)   → threshold = WHALE_THRESHOLD
  badge_type=2 (Hodler)  → threshold = HODLER_THRESHOLD
  badge_type=3 (Stacker) → threshold = STACKER_THRESHOLD

CI gate (extend ADR-020):
  grep -E "INV-[0-9]+" contracts/ | grep -v "INV-[0-9]+:" → fail if any undefined INV ref
```

#### Rejected

Runtime-configurable thresholds (attack surface). Lower values (trivially gameable).

---

### ADR-028: Remove grace_period_enabled Flag — Static Phase 1

**Status:** 🟠 REQUIRED
**Date:** 2026-03-17
**Deciders:** VHEATM Audit Cycle #2
**Tags:** `state-machine` `defi` `grace-period` `governance`

#### Context

`UNHEALTHY → GRACE_PERIOD: guard: grace_period_enabled` — flag không có type, không trong VaultState, không trong constants, không trong ADR-016. Admin-mutable interpretation: 3-of-5 multisig compromise → disable grace period globally → mass liquidation MEV. Per-vault: breaking schema change. Static const=true: confusing dead code.

**Simulation E-10 confirmed:** Flag ambiguous. All 3 interpretations problematic. Phase 1 safe path: always enabled.

#### Decision

> **Phase 1:** Remove `grace_period_enabled` guard từ state machine. Grace period ALWAYS enabled. Transition: `UNHEALTHY → GRACE_PERIOD` (unconditional). Add `GRACE_PERIOD_DURATION = 3600` constant. **Phase 2+:** Reintroduce as `GRACE_PERIOD_POLICY` gated behind ADR-023 multisig với timelock.

#### Evidence

Sim E-10 (micro_sim_small): Flag undefined in schema, constants, ADR-016. Admin-mutable MEV risk via ADR-023 multisig confirmed.

#### Pattern

```
State machine Phase 1 (BLUEPRINT):
  UNHEALTHY ──[liquidation_triggered]──▶ GRACE_PERIOD
    guard: ALWAYS ENABLED (ADR-028 — no flag)
    action: start timer GRACE_PERIOD_DURATION = 3600s
```

#### Rejected

Admin-mutable flag Phase 1 (MEV risk). Per-vault flag (breaking schema change).

---

### ADR-029: Prover Server Idempotency + Retry Policy

**Status:** 🟠 REQUIRED
**Date:** 2026-03-17
**Deciders:** VHEATM Audit Cycle #2
**Tags:** `prover-server` `api` `reliability` `ux`

#### Context

`POST /prove` timeout = 30s. Client HTTP timeout → client không biết proof generated hay không. Client retry có thể conflict với already-broadcast Solana tx → spurious ERROR_DOUBLE_SPEND → user hoảng loạn. No idempotency key, no proof cache, no retry policy spec.

**Simulation E-11 confirmed:** Timeout race confirmed. Groth16 deterministic → server cache safe. Standard REST fix.

#### Decision

> Add `X-Idempotency-Key: sha256(JSON.stringify(prover_inputs))` header. Server caches proof for `RELAYER_SIG_EXPIRY` (1h) by key. Retry with same key = cached proof returned. Client retry: 3× [5s, 15s, 30s] backoff.

#### Evidence

Sim E-11 (single_llm_call): Timeout race confirmed. Cache-by-hash safe for deterministic Groth16.

#### Pattern

```
X-Idempotency-Key: sha256(prover_inputs)
Cache TTL: RELAYER_SIG_EXPIRY = 3600s
Client retry: max 3× with backoff [5s, 15s, 30s]
Response: { proof, public_inputs, proving_time, cached: bool }
```

#### Rejected

No caching (current — confirmed dangerous). Client-side state tracking only (too complex).

---

### ADR-030: BADGE_EXPIRY — Phase 2 Placeholder Documentation

**Status:** ⚪ OPTIONAL (Phase 2)
**Date:** 2026-03-17
**Deciders:** VHEATM Audit Cycle #2
**Tags:** `badge` `phase2` `documentation`

#### Context

`BADGE_EXPIRY = 259200s` defined as constant, referenced in 0 component specs, 0 enforcement paths, 0 state machine checks. Dead constant creates confusion about whether badges expire.

**Simulation E-12 confirmed:** BADGE_EXPIRY enforced nowhere. Nullifier PDA permanent.

#### Decision

> Document `BADGE_EXPIRY` explicitly as **Phase 2 Badge Renewal feature placeholder**. Phase 1: constant defined but NOT enforced. Phase 2: after expiry, zkUSD position enters "stale" state requiring re-proof. Nullifier PDA remains valid permanently regardless.

#### Evidence

Sim E-12 (string_replace scan): 0 enforcement references across all 3 files.

#### Rejected

Remove constant (loses design intent). Enforce immediately (no mechanism exists).

---

## Index

> Danh sách nhanh để tìm ADR theo topic.

| ADR | Title | Status | Tags |
|---|---|---|---|
| ADR-001 | Sử dụng Poseidon cho Relayer Payload | ✅ | `cryptography` `noir` `optimization` |
| ADR-002 | Loại bỏ pubkey_x khỏi Public Inputs | ✅ | `privacy` `security` |
| ADR-003 | Sử dụng SHA-512 cho Nullifier Secret | ✅ | `cryptography` `nullifier` |
| ADR-004 | Thay thế Math.min bằng reduce() cho UTXO | ✅ | `performance` `bugfix` |
| ADR-005 | Pin chính xác phiên bản circomlibjs | 🔴 | `cryptography` `invariance` `poseidon` |
| ADR-006 | Đảm bảo tính xác định của Nullifier Secret | 🔴 | `cryptography` `privacy` `determinism` |
| ADR-007 | Chuẩn hóa Serialization Field BN254 cho Verifier | 🔴 | `serialization` `zkp` `solana` |
| ADR-008 | Chuẩn hóa Solana làm Execution Layer | 🔴 | `blockchain` `solana` `execution` |
| ADR-009 | Chuẩn hóa Groth16 làm Proving Backend | 🔴 | `zkp` `cryptography` `solana` |
| ADR-010 | Double-spending Protection qua PDA | 🔴 | `solana` `pda` `security` |
| ADR-011 | Collateral Locking via TSS-Relayer DLCs | 🔴 | `defi` `bitcoin` `security` |
| ADR-012 | Meta-transactions cho Rent Exemption | 🟠 | `privacy` `solana` `ux` |
| ADR-013 | VK Integrity & CI/CD Automation | 🟠 | `zkp` `ci/cd` `invariance` |
| ADR-014 | Relayer Staking, Slashing & Signed Commitment | 🔴 | `game-theory` `security` `relayer` |
| ADR-015 | Multi-Oracle Aggregation & Circuit Breaker | 🔴 | `oracle` `security` `game-theory` |
| ADR-016 | Liquidation Grace Period & Anti-MEV | 🟠 | `defi` `mev` `ux` |
| ADR-017 | Strict SPL Token Program ID Validation | 🔴 | `solana` `cpi` `security` |
| ADR-018 | Nullifier Hash Collision Resistance | 🟠 | `cryptography` `security` `nullifier` |
| ADR-019 | Collateralization Ratio Mandatory Constants | 🔴 | `defi` `invariant` `liquidation` |
| ADR-020 | Placeholder Constants CI/CD Gate | 🔴 | `ci/cd` `deployment` `invariant` |
| ADR-021 | Field→[u8;32] Serialization Endianness Contract | 🔴 | `cryptography` `serialization` `solana` |
| ADR-022 | Redesign ADR-014: Signed Commitment Protocol | 🟠 | `relayer` `security` `zkp` `architecture` |
| ADR-023 | Admin Multisig Governance cho Circuit Breaker | 🟠 | `governance` `security` `circuit-breaker` |
| **ADR-024** | **DLC Cross-Chain Coordination Interface v1** | 🔴 | `defi` `bitcoin` `dlc` `cross-chain` |
| **ADR-025** | **Fix BurnZkUSD Output Contract — ERROR_GRACE_PERIOD** | 🔴 | `contracts` `defi` `grace-period` |
| **ADR-026** | **Nonce Generation Protocol + Multi-Badge Clarification** | 🔴 | `cryptography` `prover` `nonce` |
| **ADR-027** | **Badge Threshold Constants — INV-13** | 🔴 | `contracts` `invariant` `badge` |
| **ADR-028** | **Remove grace_period_enabled Flag — Static Phase 1** | 🟠 | `state-machine` `defi` `grace-period` |
| **ADR-029** | **Prover Server Idempotency + Retry Policy** | 🟠 | `prover-server` `api` `reliability` |
| **ADR-030** | **BADGE_EXPIRY — Phase 2 Placeholder Documentation** | ⚪ | `badge` `phase2` `documentation` |

---

*B.ONE · NTB Research Collective · v5.0 · 2026*


---

### ADR-039: Hỗ trợ Chuyển đổi Trạng thái cho Relayer Thành công Muộn

**Status:** 🔴 MANDATORY
**Date:** 2026-03-18
**Deciders:** VHEATM Cycle #6
**Tags:** `state-machine` `resilience` `race-condition`

#### Context

Sau khi ADR-037 được giới thiệu, hệ thống có một instruction `claim_dlc_timeout` cho phép bất kỳ ai chuyển một vault bị kẹt trong `PendingBtcRelease` sang `DlcTimeoutPending` sau khi hết hạn. Tuy nhiên, có một race condition tiềm ẩn: điều gì sẽ xảy ra nếu Relayer cuối cùng cũng thành công trong việc đóng DLC trên Bitcoin (ví dụ: do mạng Bitcoin bị nghẽn) *sau khi* vault đã được chuyển sang `DlcTimeoutPending`?

Nếu instruction `close_dlc` của Relayer chỉ chấp nhận vault ở trạng thái `PendingBtcRelease`, nó sẽ thất bại. Điều này sẽ khiến vault bị kẹt vĩnh viễn trong `DlcTimeoutPending` mặc dù BTC đã được giải phóng, đòi hỏi sự can thiệp thủ công từ Admin Multisig.

#### Decision

> **Instruction `close_dlc` trên Anchor program PHẢI cho phép chuyển đổi sang trạng thái `CLOSED` từ CẢ hai trạng thái `PendingBtcRelease` (luồng thông thường) VÀ `DlcTimeoutPending` (luồng Relayer thành công muộn).**

Điều này đảm bảo hệ thống có khả năng tự phục hồi. Ngay cả khi quy trình can thiệp thủ công đã bắt đầu, hệ thống vẫn có thể tự động giải quyết nếu Relayer cuối cùng hoàn thành nhiệm vụ của mình.

#### Evidence

- **Simulation H-23, cycle #6:** Đã xác nhận rằng việc cho phép chuyển đổi trạng thái từ `DlcTimeoutPending` sang `CLOSED` là cần thiết để hệ thống có khả năng phục hồi và xử lý đúng race condition.

#### Pattern

```rust
// Anchor side: Update close_dlc transition guard
require!(
    vault.status == TransactionStatus::PendingBtcRelease || 
    vault.status == TransactionStatus::DlcTimeoutPending,
    ErrorCode::InvalidVaultStatusForClose
);
vault.status = TransactionStatus::CLOSED;
```

#### Rejected Alternatives

- **Yêu cầu can thiệp thủ công của Admin Multisig cho tất cả các vault `DlcTimeoutPending`:** Gây ra chi phí vận hành không cần thiết và làm chậm quá trình phục hồi cho người dùng khi hệ thống có thể tự động xử lý.

---

### ADR-040: Chuẩn hóa Độ chính xác (Precision) cho Dữ liệu Oracle

**Status:** 🔴 MANDATORY
**Date:** 2026-03-18
**Deciders:** VHEATM Cycle #6
**Tags:** `oracle` `security` `data-integrity`

#### Context

Hệ thống tổng hợp giá từ nhiều nhà cung cấp Oracle (Chainlink, Pyth, Switchboard) để tăng cường tính mạnh mẽ. Tuy nhiên, các nhà cung cấp này có thể sử dụng các mức độ chính xác (số chữ số thập phân) khác nhau cho cùng một cặp tài sản. Ví dụ, Chainlink thường dùng 8 chữ số thập phân cho BTC/USD, trong khi các hệ thống khác có thể dùng 18.

Nếu tổng hợp các giá trị này mà không chuẩn hóa, kết quả sẽ là một con số hoàn toàn sai lệch, dẫn đến các hậu quả nghiêm trọng như:
- Thanh lý sai các vault vẫn còn khỏe mạnh.
- Không thể thanh lý các vault không khỏe mạnh.
- Kích hoạt Circuit Breaker một cách không cần thiết, làm ngưng trệ toàn bộ giao thức.

#### Decision

> **Tất cả giá từ các Oracle PHẢI được chuẩn hóa về một độ chính xác kinh điển (canonical precision) là 8 chữ số thập phân trước khi thực hiện bất kỳ logic tổng hợp, so sánh hoặc tính toán nào.**

Một hàm chuẩn hóa phải được áp dụng ngay tại điểm vào của dữ liệu từ mỗi nhà cung cấp Oracle.

#### Evidence

- **Simulation H-22, cycle #6:** Đã xác nhận lỗi tính toán thảm khốc (ra kết quả $3.25e+22 cho giá BTC) khi tổng hợp giá có độ chính xác không khớp.

#### Pattern

```rust
// Oracle Aggregator side: Normalize all inputs to 8 decimals
fn normalize_price(price: u128, decimals: u8) -> u64 {
    if decimals > 8 {
        (price / 10u128.pow((decimals - 8) as u32)) as u64
    } else if decimals < 8 {
        (price * 10u128.pow((8 - decimals) as u32)) as u64
    } else {
        price as u64
    }
}
```

#### Rejected Alternatives

- **Giả định tất cả các nhà cung cấp đều sử dụng 8 chữ số thập phân:** Đây là một giả định nguy hiểm và mong manh. Bất kỳ sự thay đổi nào từ phía nhà cung cấp cũng sẽ phá vỡ hệ thống.
- **Lưu trữ giá và độ chính xác riêng biệt và tính toán trên từng trường hợp:** Phức tạp hóa logic một cách không cần thiết và dễ gây ra lỗi. Việc chuẩn hóa ngay từ đầu sẽ đơn giản và an toàn hơn nhiều.
