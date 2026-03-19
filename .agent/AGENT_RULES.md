# AGENT_RULES.md — Solvus Protocol Constitution
> **ĐỌC FILE NÀY TRƯỚC MỌI TASK. KHÔNG NGOẠI LỆ.**
> Last updated: 2026-03-09

---

## 🔴 IDENTITY TUYỆT ĐỐI — Đây là ZK Cryptography Project

Solvus không phải CRUD app. Sai 1 byte trong hash input = proof fail âm thầm, không có error
message rõ ràng. Agent không được "tối ưu", "refactor sáng tạo", hoặc "simplify" bất kỳ
cryptographic primitive nào mà không đọc INVARIANTS.md trước.

---

## 📋 PROTOCOL TRƯỚC MỖI TASK

### MAINT-01 — Thêm Badge Type
⚠️ **KHÔNG** được sửa `circuits/main.nr` khi thêm badge type.
   Noir payload structure là bất biến (INV-09).
   Chỉ update Cairo và TypeScript threshold maps.

### Bước 1 — Định vị (bắt buộc)
```
[ ] Đọc PROJECT_MAP.md → xác định module nào bị ảnh hưởng
[ ] Đọc INVARIANTS.md → kiểm tra task có liên quan đến invariant nào không
[ ] Đọc GRAVEYARD.md → đảm bảo không recreate file/pattern đã bị xóa
[ ] List ra: file nào sẽ touch, file nào import từ đó, file nào bị ảnh hưởng downstream
```

### Bước 2 — Khai báo plan (bắt buộc trước khi code)
```
Tôi sẽ sửa: [list files]
Files downstream bị ảnh hưởng: [list]
Invariants liên quan: [list từ INVARIANTS.md]
Tôi sẽ KHÔNG thay đổi: [list những gì tôi cố tình giữ nguyên]
```

### Bước 3 — Sau khi hoàn thành (bắt buộc)
```
[ ] Cập nhật PROJECT_MAP.md nếu thêm/xóa/đổi tên file hoặc export
[ ] Cập nhật STACK.md nếu thêm/đổi dependency
[ ] Append vào SESSION_LOG.md (3 dòng: changed / impact / open issues)
[ ] Chạy consistency check (xem phần dưới)
```

---

## 🚫 HARD RULES — VI PHẠM = DỪNG NGAY, BÁO CÁO

### R1 — Không tạo file khi chưa kiểm tra PROJECT_MAP.md
File đã tồn tại rồi mà tạo lại = conflict, import path hỏng, duplicate logic.
→ Luôn grep PROJECT_MAP.md trước khi `touch` bất kỳ file mới nào.

### R2 — Không đổi import path mà không update tất cả consumers
Xem cột "Consumers" trong PROJECT_MAP.md. Đổi 1 file = phải check toàn bộ consumers đó.

### R3 — Không thay đổi cryptographic primitive mà không có test vector
Áp dụng cho: hash functions, signature format, field encoding, byte order.
→ Phải có concrete input/output test PASS trước khi merge.

### R4 — Không dùng `allocUnsafe`, `|`, `&` (bitwise) trong bất kỳ context nào
- TypeScript: `Buffer.alloc` không `allocUnsafe`, `&&` không `&`, `||` không `|`
- Cairo: `&&` không `&`, `||` không `|`
→ Rule 4 của PRD. Grep toàn bộ file sau khi viết xong.

### R5 — Không hardcode giá trị cryptographic bằng cách gõ lại
Dùng constant đã định nghĩa trong `packages/core/shared/utils.ts`. KHÔNG tự tính lại `BN254_PRIME`.

### R6 — `pubkey_x` và `pubkey_y` (BTC) là PRIVATE tuyệt đối
KHÔNG truyền vào Cairo contract. KHÔNG log. KHÔNG expose qua bất kỳ public interface nào.
Bitcoin address của user sẽ lộ on-chain nếu vi phạm rule này.

### R7 — `buildProverInputs()` phải `async`, mọi caller phải `await`
`computeNullifierHash()` là async (Poseidon lazy init). Quên `await` = Promise object thay
vì bigint = proof fail âm thầm không có error.

### R8 — `timestamp` chỉ được lấy từ `relayerResponse.timestamp`
KHÔNG dùng `Date.now()`. KHÔNG dùng `new Date()`. Chỉ `relayerResponse.timestamp`.
Sai source = Cairo freshness check fail (3600s window).

### R9 — Poseidon input order là bất biến: `[secret, x_hi, x_lo, badge_type]`
TypeScript và Noir phải match 1-to-1. Đổi order = nullifier mismatch = proof fail.
Kiểm tra INVARIANTS.md section Poseidon trước khi touch bất kỳ thứ gì liên quan.

### R10 — `circomlibjs` phải pin EXACT version `0.1.7`
Không dùng `^0.1.7` hay `~0.1.7`. Khác version = Poseidon output khác = proof fail.

---

## ✅ CONSISTENCY CHECK — Chạy sau mỗi task

```bash
# 1. Kiểm tra import paths còn hợp lệ không
npx tsc --noEmit

# 2. Kiểm tra boolean operators sai
grep -rn " | " packages/core/ --include="*.ts" | grep -v "||"   # bitwise OR leak
grep -rn " & " packages/core/ --include="*.ts" | grep -v "&&"   # bitwise AND leak

# 3. Kiểm tra allocUnsafe
grep -rn "allocUnsafe" packages/core/ --include="*.ts"

# 4. Kiểm tra Date.now() trong context sai
grep -rn "Date.now()" packages/core/prover/ packages/core/client/ --include="*.ts"

# 5. Kiểm tra await bị thiếu cho buildProverInputs / computeNullifierHash
grep -rn "buildProverInputs\|computeNullifierHash" packages/core/ --include="*.ts" | grep -v "await"

# 6. Noir (nếu sửa circuit)
cd circuits && nargo check
```

Nếu bất kỳ check nào fail → FIX trước khi close session. KHÔNG để open.

---

## 🧠 MENTAL MODEL ĐỂ AGENT NHỚ

```
Solvus = 3 layer phải đồng bộ TUYỆT ĐỐI:

  TypeScript (Client)
       ↕  phải mirror chính xác
  Noir Circuit
       ↕  phải mirror chính xác  
  Cairo Contract

  Bất kỳ divergence nào = ZK proof fail.
  ZK proof fail thường KHÔNG có error message mô tả nguyên nhân.
  Debug ZK fail = cực kỳ tốn thời gian.
  Phòng bệnh >> chữa bệnh.
```

---

## 📍 Navigation nhanh

| Cần biết gì | Đọc file nào |
|---|---|
| File nào làm gì, nằm đâu | `PROJECT_MAP.md` |
| Tech stack, package versions | `STACK.md` |
| Invariants cryptographic | `INVARIANTS.md` |
| File/pattern đã bị xóa | `GRAVEYARD.md` |
| Thay đổi session trước | `SESSION_LOG.md` |
| Phase 0 status | `PHASE0_GATE.md` |
