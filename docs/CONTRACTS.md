# CONTRACTS.md — Schema Registry
### SOLVUS Protocol · v1.0.0 (Solana Contracts)

> **Nguyên tắc vàng:** Mọi type, schema, enum, constant được define **MỘT LẦN DUY NHẤT** tại đây.
> BLUEPRINT.md và code **reference** — không redefine, không copy, không paraphrase.
>
> Khi thấy conflict giữa file này và bất kỳ file nào khác → file này thắng.

---

## Mục lục

1. [Type Notation](#type-notation)
2. [Primitive Types & Constants](#1-primitive-types--constants)
3. [Enums](#2-enums)
4. [Core Schemas](#3-core-schemas)
5. [Input / Output Contracts](#4-input--output-contracts)
6. [Error Registry](#5-error-registry)
7. [External Contracts](#6-external-contracts)
8. [Naming Conventions](#7-naming-conventions)
9. [Schema Changelog](#8-schema-changelog)

---

## Type Notation

> **Type notation dùng trong file này:**

```
FieldName :: Type                       — required field
FieldName :: Type?                      — optional field (nullable)
FieldName :: List<Type>                 — list / array
FieldName :: Map<KeyType, ValueType>    — map / dict
FieldName :: TypeA | TypeB              — union type
FieldName :: Ref<SchemaName>            — reference đến schema khác
FieldName :: [u8; N]                    — fixed-size byte array (N bytes)
FieldName :: Field                      — BN254 field element
```

---

## 1. PRIMITIVE TYPES & CONSTANTS

> Các kiểu và hằng số dùng xuyên suốt hệ thống.
> Agent KHÔNG hard-code giá trị của các constants này ở bất kỳ nơi nào khác.

| Constant | Type | Value | Reason |
|---|---|---|---|
| `BN254_PRIME` | `BigInt` | `21888242871839275222246405745257275088548364400416034343698204186575808495617n` | Decimal literal for BN254 prime field (EIP-197). Dùng để reduce modulo trong Noir. |
| `ZKUSD_MINT_AUTHORITY_SEED` | `string` | `"zkusd_mint_authority"` | Seed for PDA that is the Mint Authority of zkUSD SPL Token. Không thay đổi. |
| `PDA_NULLIFIER_SEED` | `string` | `"nullifier_account"` | Seed for PDA that stores the nullifier hash. Không thay đổi. |
| `BADGE_EXPIRY` | `u64` | `259200` | 72 hours in seconds. **Phase 2 placeholder — NOT enforced in Phase 1.** Intent: badges require re-proof every 72h in future badge renewal feature. Nullifier PDA remains valid permanently. (ADR-030) |
| `TIMESTAMP_TOLERANCE` | `u64` | `300` | Clock drift tolerance in seconds (5 minutes for Solana - ADR-015). Cho phép sai lệch 5 phút. |
| `RELAYER_SIG_EXPIRY` | `u64` | `3600` | 1 hour window for relayer signature freshness. Chữ ký Relayer hết hạn sau 1 giờ. |
| `VARINT_128` | `byte` | `0x80` | Varint for 128-char ASCII message length. Dùng cho serialization. |
| `SPL_TOKEN_PROGRAM_ID` | `Pubkey` | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | Official SPL Token Program ID (ADR-017). Phải validate strict. |
| `COLLATERALIZATION_RATIO` | `u64` | `15000` | 150% collateral requirement in basis points (÷10000). Vault must maintain this ratio to remain HEALTHY. (ADR-019) |
| `LIQUIDATION_THRESHOLD` | `u64` | `12000` | 120% in basis points. Vault becomes UNHEALTHY and eligible for liquidation below this. (ADR-019) |
| `AT_RISK_THRESHOLD` | `u64` | `13000` | 130% in basis points. Vault enters AT_RISK state below this — warning issued. (ADR-019) |
| `CIRCUIT_BREAKER_TIMEOUT` | `u64` | `259200` | 72 hours in seconds. Circuit breaker auto-expires if admin multisig fails to renew. (ADR-023) |
| `DLC_CLOSE_TIMEOUT` | `u64` | `3600` | 1 hour in seconds. Max time for Relayer to close DLC after BurnZkUSD event. 3 retries within window. (ADR-024) |
| `GRACE_PERIOD_DURATION` | `u64` | `3600` | 1 hour in seconds. Duration of liquidation grace period (ADR-016, ADR-028). Always enabled in Phase 1 — no flag. |
| `L1_PREEMPTION_WINDOW` | `i64` | `86400` | 24 hours in seconds. Window before L1 refund timelock when liquidation is allowed. (ADR-041) |
| `MAX_MINT_ZKUSD_AMOUNT` | `u64` | `1_000_000_000` | Maximum zkUSD amount that can be minted in a single transaction. |
| `MAX_LIQUIDATOR_REWARD_BPS` | `u64` | `1000` | 10% in basis points. Maximum liquidator reward as percentage of seized collateral. |
| `PYTH_STALENESS_SECONDS` | `i64` | `60` | 60 seconds. Maximum age of Pyth oracle price before considered stale. (ADR-040) |
| `WHALE_THRESHOLD` | `u64` | `100_000_000` | 1 BTC in satoshis. Minimum BTC balance to qualify for Whale badge. INV-13. (ADR-027) |
| `HODLER_THRESHOLD` | `u64` | `365` | Days. Oldest UTXO must be ≥ 365 days to qualify for Hodler badge. INV-13. (ADR-027) |
| `STACKER_THRESHOLD` | `u64` | `10` | Count. Must have ≥ 10 UTXOs to qualify for Stacker badge. INV-13. (ADR-027) |
| `GROTH16_VERIFIER_PROGRAM_ID` | `Pubkey` | `[DEVNET: to be set by team — see ADR-020]` | Groth16 Verifier Program ID trên Solana (ADR-009, ADR-020). MUST be filled before any deploy. CI gate enforced. |
| `ORACLE_PRICE_FEED_ID` | `Pubkey` | `[DEVNET: H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG (Pyth BTC/USD) — see ADR-020]` | Oracle price feed ID (Chainlink/Pyth/Switchboard - ADR-015, ADR-020). MUST be filled before any deploy. CI gate enforced. |

---

## 2. ENUMS

> Mọi enum được define tại đây. Không tạo inline enum trong schema.

### BadgeType

```
BadgeType ::
  | Whale (1)   // Based on BTC balance (Satoshis) — user có balance > threshold
  | Hodler (2)  // Based on UTXO age (Days) — user có UTXO cũ > threshold
  | Stacker (3) // Based on UTXO count — user có số UTXO > threshold
```

**Dùng ở:** `ProverInputs.badge_type`, `MintZkUSD.badge_type`
**Không dùng cho:** Không thay đổi sau khi mint
**Lưu ý:** Badge type xác định tiêu chí tính toán `btc_data` từ Relayer.

### RecoveryByteRange

```
RecoveryByteRange ::
  | Xverse (31-34)  // Compressed Xverse format — recovery byte trong range [31-34]
  | Legacy (27-30)  // Legacy uncompressed format — recovery byte trong range [27-30]
  | REJECTED (0x30) // DER format (Not supported) — không hỗ trợ
```

**Dùng ở:** Signature validation trong Noir circuit
**Không dùng cho:** Không dùng cho Groth16 public inputs
**Lưu ý:** Xverse format được khuyến nghị. Recovery byte phải được strip trước hashing (ADR-006).

### VaultStatus

```
VaultStatus ::
  | Initialized (0)      // Vault vừa được tạo, chưa có collateral
  | Healthy (1)          // Vault đủ collateral (≥150%)
  | AtRisk (2)           // Vault cần attention (130-150%)
  | Unhealthy (3)        // Vault không đủ collateral (<120%), eligible cho liquidation
  | GracePeriod (4)      // Vault đang trong grace period (ADR-016)
  | Liquidated (5)       // Vault đã bị liquidate
  | Closed (6)           // DLC đã đóng, vault hoàn tất
  | PendingBtcRelease (7)// zkUSD burned, DLC close in-flight on Bitcoin (ADR-024)
  | DlcTimeoutPending (8)// DLC_CLOSE_TIMEOUT passed, Relayer failed (ADR-037)
```

**Dùng ở:** `VaultState.status`
**Lưu ý:** Đây là vault lifecycle states, khác với transaction status.

---

## 3. CORE SCHEMAS

> Schemas được sắp xếp từ primitive → composite.
> Schema phụ thuộc schema khác → schema kia phải được define TRÊN nó.

### RelayerResponse

> Dữ liệu được ký bởi Relayer để chứng minh trạng thái Bitcoin của người dùng.
> Relayer là một thực thể ngoài (off-chain) ký dữ liệu Bitcoin state.

```
RelayerResponse :: {
  btc_data       :: u64         // Balance (sat), Age (days), or Count (UTXOs) — tùy badge_type
  dlc_contract_id:: Field       // DLC contract ID from Bitcoin (Asset-Bound Nullifier)
  pubkey_x       :: [u8; 32]    // Relayer's public key X-coordinate (ECDSA)
  pubkey_y       :: [u8; 32]    // Relayer's public key Y-coordinate (ECDSA)
  signature      :: [u8; 64]    // Compact signature [r||s] (INV-10) — không có recovery byte
}
```

**Constraints:**
```
INVARIANT: btc_data > 0                          // Phải có dữ liệu
INVARIANT: dlc_contract_id != 0                  // DLC phải được tạo
INVARIANT: signature.length == 64                // Chính xác 64 bytes
RANGE:     btc_data ∈ [0, 2^64)                  // Fit trong u64
INV-10:    signature = r_bytes_be || s_bytes_be  // Big-endian [r||s], no recovery byte (ADR-021)
```

**Serialization contract (ADR-021 — MANDATORY):**
```
Field → [u8; 32]: ALWAYS big-endian byte order (Noir native output).
[u8; 32] → PDA seed: use bytes as-is (no conversion on Rust/Anchor side).
Cross-language test vectors: see ADR-021 for 3 canonical (Field, bytes_be, PDA) tuples.
```

**Không được nhầm với:** `ProverInputs` — khác ở chỗ RelayerResponse là off-chain data, ProverInputs là on-chain.

**Xem thêm:** ADR-001 (Poseidon hash), ADR-003 (SHA-512 nullifier)

---

### ProverInputs

> Các đầu vào (Private & Public) cho mạch Noir ZK.
> Private inputs không được lộ trên chuỗi, public inputs được verify bởi Groth16 verifier.

```
ProverInputs :: {
  // ========== PRIVATE INPUTS (không lộ trên chuỗi) ==========
  nullifier_secret :: Field      // Derived from user signature (ADR-003, ADR-006)
  pubkey_x         :: [u8; 32]   // User's BTC pubkey X (ADR-002) — PRIVATE
  pubkey_y         :: [u8; 32]   // User's BTC pubkey Y (ADR-002) — PRIVATE
  user_sig         :: [u8; 64]   // User's signature on Solana address + dlc_contract_id — PRIVATE
  btc_data         :: u64        // Data from Relayer — PRIVATE
  relayer_sig      :: [u8; 64]   // Signature from Relayer — PRIVATE

  // ========== PUBLIC INPUTS (verify bởi Groth16 verifier) ==========
  solana_address   :: [u8; 32]   // Target Solana address for zkUSD (Pubkey) — PUBLIC
  dlc_contract_id  :: Field      // DLC contract ID from Relayer — PUBLIC
  relayer_pubkey_x :: [u8; 32]   // For relayer sig verification — PUBLIC
  relayer_pubkey_y :: [u8; 32]   // For relayer sig verification — PUBLIC
  badge_type       :: u8         // INV-14 — PUBLIC
  threshold        :: u64        // INV-13 — PUBLIC
  is_upper_bound   :: bool       // Always false in V1 — PUBLIC
  nullifier_hash   :: Field      // For on-chain PDA registry (ADR-010) — PUBLIC
                                 // Serialization: Field → [u8;32] big-endian (ADR-021)
}
```

**Constraints:**
```
INVARIANT: nullifier_secret != 0                 // Phải khác 0
INVARIANT: pubkey_x, pubkey_y là điểm trên curve // Phải là điểm ECDSA hợp lệ
INVARIANT: badge_type ∈ [1, 3]                   // Phải là Whale, Hodler, hoặc Stacker
INVARIANT: threshold > 0                         // Threshold phải dương
INVARIANT: threshold ∈ {WHALE_THRESHOLD, HODLER_THRESHOLD, STACKER_THRESHOLD} per badge_type  // INV-13 (ADR-027)
INVARIANT: nullifier_hash = Poseidon(dlc_contract_id, badge_type, nullifier_secret, 0)
INV-13:    threshold must equal the canonical constant for its badge_type:
           Whale(1) → WHALE_THRESHOLD, Hodler(2) → HODLER_THRESHOLD, Stacker(3) → STACKER_THRESHOLD
```

**Không được nhầm với:** `RelayerResponse` — khác ở chỗ ProverInputs bao gồm cả private inputs.

**Xem thêm:** ADR-002, ADR-003, ADR-006, ADR-010

---

### MintZkUSDInput

> Input schema cho operation MintZkUSD.

```
MintZkUSDInput :: {
  nullifier_hash    :: [u8; 32]    // PDA seed, derived from Noir Field (ADR-010)
  zkusd_amount      :: u64         // Amount of zkUSD to mint (INV-16)
  proof             :: Vec<u8>     // Groth16 ZK Proof (canonical verifier wire format)
  public_inputs     :: Vec<u8>     // Serialized public inputs for verifier (ADR-009)
  l1_refund_timelock:: i64         // Bitcoin L1 refund timelock timestamp
  relayer_fee       :: u64?        // Optional relayer fee (ADR-012)
}
```

**Constraints:**
```
INVARIANT: nullifier_hash.length == 32          // Chính xác 32 bytes
INVARIANT: nullifier_hash encoding == big-endian // Field serialized as big-endian (ADR-021)
INVARIANT: zkusd_amount > 0                     // Phải mint > 0
INVARIANT: proof.length > 0                     // Proof phải có
INVARIANT: public_inputs.length > 0             // Public inputs phải có
RANGE:     zkusd_amount ∈ [1, 2^64)             // Fit trong u64
```

**Không được nhầm với:** `BurnZkUSDInput` — khác ở chỗ MintZkUSDInput tạo token, BurnZkUSDInput hủy token.

---

### MintZkUSDOutput

> Output schema cho operation MintZkUSD.

```
MintZkUSDOutput :: {
  success          :: bool       // Mint thành công hay không
  tx_signature     :: [u8; 64]?  // Solana transaction signature (optional)
  zkusd_account    :: [u8; 32]?  // Account nhận zkUSD (optional)
  nullifier_pda    :: [u8; 32]?  // PDA account được tạo (optional)
}
```

**Constraints:**
```
INVARIANT: success == true ⟹ nullifier_pda != null  // Nếu thành công, phải có PDA
INVARIANT: success == true ⟹ zkusd_account != null  // Nếu thành công, phải có account
```

---

### BurnZkUSDInput

> Input schema cho operation BurnZkUSD.

```
BurnZkUSDInput :: {
  zkusd_amount    :: u64         // Amount of zkUSD to burn
  recipient_btc   :: [u8; 32]    // Bitcoin address để nhận BTC (optional, default = user)
}
```

**Constraints:**
```
INVARIANT: zkusd_amount > 0                     // Phải burn > 0
INVARIANT: zkusd_amount <= user_balance         // Không được burn hơn balance
```

---

### VaultState

> Trạng thái của một vault (người dùng) trong hệ thống.

```
VaultState :: {
  owner              :: [u8; 32]      // Solana address của vault owner
  collateral_btc     :: u64           // BTC collateral (satoshis)
  zkusd_minted       :: u64           // zkUSD đã mint
  last_update        :: u64           // Timestamp của lần update cuối
  status             :: VaultStatus   // Trạng thái vault
  liquidation_price  :: u64?          // Giá liquidation (optional)
  grace_period_end   :: u64?          // Khi nào grace period kết thúc (ADR-016)
  dlc_contract_id    :: [u8; 32]?     // DLC contract ID trên Bitcoin (ADR-024, set at mint)
  dlc_close_deadline :: u64?          // Deadline để Relayer close DLC sau burn (ADR-024)
  l1_refund_timelock :: i64           // Bitcoin L1 refund timelock timestamp (ADR-041)
}
```

**Constraints:**
```
INVARIANT: collateral_btc >= 0                  // Collateral không âm
INVARIANT: zkusd_minted >= 0                    // Minted không âm
INVARIANT: collateral_btc * 10000 >= zkusd_minted * COLLATERALIZATION_RATIO  // Phải đủ collateral (150% — ADR-019)
INVARIANT: collateral_btc * 10000 >= zkusd_minted * LIQUIDATION_THRESHOLD    // Nếu vi phạm → UNHEALTHY (ADR-019)
INVARIANT: last_update <= current_time          // Update time không thể trong tương lai
```

**Không được nhầm với:** `ProverInputs` — khác ở chỗ VaultState là on-chain state, ProverInputs là input cho Noir.

---

## 4. INPUT / OUTPUT CONTRACTS

> I/O contract của từng entry point / API boundary trong hệ thống.
> Đây là "giao kèo" giữa các components — không thay đổi mà không có ADR entry.

### MintZkUSD

> Mint zkUSD dựa trên ZK proof chứng minh BTC holdings.

```
INPUT  :: Ref<MintZkUSDInput>

OUTPUT :: Ref<MintZkUSDOutput>
       | Ref<ERROR_INVALID_PROOF>     // khi proof verification fail
       | Ref<ERROR_DOUBLE_SPEND>      // khi nullifier_hash đã tồn tại (ADR-010)
       | Ref<ERROR_EXPIRED_TIMESTAMP> // khi timestamp quá cũ (INV-05)
       | Ref<ERROR_INVALID_THRESHOLD> // khi btc_data < threshold (INV-13)

SIDE EFFECTS:
  - Initializes PDA for nullifier_hash (ADR-010)
  - Mints zkUSD SPL Tokens to caller's account
  - Updates collateral tracking (DLCs - ADR-011)
  - Emits MintZkUSD event với nullifier_hash, amount, timestamp

PRE-CONDITIONS:
  - proof phải hợp lệ (Groth16 verifier pass)
  - nullifier_hash chưa tồn tại (không double-spend)
  - timestamp trong tolerance (INV-05)
  - btc_data >= threshold (INV-13)
  - token_program phải là SPL Token Program chính thức (ADR-017)

POST-CONDITIONS:
  - PDA được tạo với nullifier_hash làm seed
  - zkUSD được mint vào caller's account
  - Collateral được lock (DLCs - ADR-011)
  - Nullifier được ghi lại (chống double-spend)

IDEMPOTENT: KHÔNG — Mỗi lần gọi phải có nullifier_hash mới
```

**Xem thêm:** ADR-010, ADR-011, ADR-017, BLUEPRINT.md Section 4

---

### BurnZkUSD

> Burn zkUSD và nhận BTC tương ứng.

```
INPUT  :: Ref<BurnZkUSDInput>

OUTPUT :: {
  success        :: bool
  btc_received   :: u64
  tx_signature   :: [u8; 64]?
}
       | Ref<ERROR_INSUFFICIENT_BALANCE>  // khi user không có đủ zkUSD
       | Ref<ERROR_INVALID_BTC_ADDRESS>   // khi recipient_btc không hợp lệ
       | Ref<ERROR_BURN_IN_GRACE_PERIOD>  // khi vault đang trong GRACE_PERIOD (ADR-025)

SIDE EFFECTS:
  - Burns zkUSD SPL Tokens từ caller's account
  - Sets vault.status = PendingBtcRelease (ADR-024)
  - Sets vault.dlc_close_deadline = current_time + DLC_CLOSE_TIMEOUT
  - Emits BurnZkUSD event với { owner, amount, dlc_contract_id, timestamp }
  - Relayer observes event → closes DLC on Bitcoin within DLC_CLOSE_TIMEOUT

PRE-CONDITIONS:
  - user_balance >= zkusd_amount
  - recipient_btc là Bitcoin address hợp lệ (hoặc null để dùng user's address)
  - vault.status != GRACE_PERIOD (ADR-016, ADR-025) — MUST be checked by Anchor

POST-CONDITIONS:
  - zkUSD bị burn
  - vault.status = PendingBtcRelease (BTC released async by Relayer within 60 min)
  - Collateral unlocked only after DLC closes on Bitcoin

IDEMPOTENT: KHÔNG — Mỗi lần burn là một transaction riêng
```

**Xem thêm:** ADR-011, ADR-016, BLUEPRINT.md Section 4

---

### QueryVaultState

> Query trạng thái của một vault.

```
INPUT  :: {
  owner :: [u8; 32]  // Solana address của vault owner
}

OUTPUT :: Ref<VaultState>
       | Ref<ERROR_VAULT_NOT_FOUND>  // khi vault không tồn tại

SIDE EFFECTS: none

PRE-CONDITIONS:
  - owner phải là Solana address hợp lệ

POST-CONDITIONS:
  - Không thay đổi state

IDEMPOTENT: CÓ — Query không thay đổi state
```

---

### LiquidateVault

> Liquidate một vault nếu collateral không đủ.

```
INPUT  :: {
  vault_owner :: [u8; 32]
  liquidator  :: [u8; 32]  // Người thực hiện liquidation
}

OUTPUT :: {
  success           :: bool
  collateral_seized :: u64
  liquidator_reward :: u64
}
       | Ref<ERROR_VAULT_HEALTHY>      // khi vault vẫn healthy
       | Ref<ERROR_GRACE_PERIOD>       // khi vault trong grace period (ADR-016)
       | Ref<ERROR_ALREADY_LIQUIDATED> // khi vault đã bị liquidate

SIDE EFFECTS:
  - Seizes collateral
  - Pays liquidator reward
  - Emits LiquidateVault event
  - Updates vault status

PRE-CONDITIONS:
  - Vault phải unhealthy (collateral < zkusd_minted * ratio)
  - Không trong grace period (ADR-016)
  - Vault chưa bị liquidate

POST-CONDITIONS:
  - Vault status = Liquidated
  - Collateral bị seize
  - Liquidator nhận reward

IDEMPOTENT: KHÔNG — Mỗi liquidation là một transaction riêng
```

**Xem thêm:** ADR-016, BLUEPRINT.md Section 4

---

## 5. ERROR REGISTRY

> Mọi error code được define tại đây với HTTP status tương ứng (nếu có),
> message template, và context cần thiết để debug.

| Code | HTTP | Message Template | Context cần thiết | Khi nào xảy ra |
|---|---|---|---|---|
| `ERROR_INVALID_PROOF` | 400 | `"Invalid ZK proof: verification failed"` | `proof_hash`, `public_inputs_hash` | Groth16 verifier fail |
| `ERROR_DOUBLE_SPEND` | 409 | `"Nullifier already used: {nullifier_hash}"` | `nullifier_hash`, `previous_tx` | Nullifier đã tồn tại (ADR-010) |
| `ERROR_EXPIRED_TIMESTAMP` | 400 | `"Timestamp expired: {timestamp} < {current_time - TOLERANCE}"` | `timestamp`, `current_time`, `tolerance` | Timestamp quá cũ (INV-05) |
| `ERROR_INVALID_THRESHOLD` | 400 | `"BTC data below threshold: {btc_data} < {threshold}"` | `btc_data`, `threshold`, `badge_type` | btc_data < threshold (INV-13) |
| `ERROR_INVALID_TOKEN_PROGRAM` | 400 | `"Invalid token program: expected {SPL_TOKEN_PROGRAM_ID}"` | `provided_program_id`, `expected_program_id` | token_program không phải SPL (ADR-017) |
| `ERROR_INSUFFICIENT_BALANCE` | 400 | `"Insufficient balance: {user_balance} < {requested_amount}"` | `user_balance`, `requested_amount` | Burn hơn balance |
| `ERROR_VAULT_NOT_FOUND` | 404 | `"Vault not found for owner: {owner}"` | `owner` | Vault không tồn tại |
| `ERROR_VAULT_HEALTHY` | 400 | `"Vault is healthy, cannot liquidate"` | `collateral`, `zkusd_minted`, `ratio` | Vault vẫn healthy |
| `ERROR_GRACE_PERIOD` | 429 | `"Vault in grace period until {grace_period_end}"` | `grace_period_end`, `current_time` | Vault trong grace period (ADR-016) |
| `ERROR_ALREADY_LIQUIDATED` | 400 | `"Vault already liquidated"` | `vault_owner`, `liquidation_time` | Vault đã bị liquidate |
| `ERROR_INVALID_BTC_ADDRESS` | 400 | `"Invalid Bitcoin address: {address}"` | `address`, `address_format` | Bitcoin address không hợp lệ |
| `ERROR_RELAYER_SIGNATURE_INVALID` | 400 | `"Relayer signature invalid or expired"` | `relayer_pubkey`, `signature_timestamp` | Relayer signature fail (ADR-014) |
| `ERROR_ORACLE_PRICE_STALE` | 503 | `"Oracle price too stale: {age} > {max_age}"` | `price_age`, `max_age`, `oracle_source` | Oracle price quá cũ (ADR-015) |
| `ERROR_ORACLE_PRICE_DIVERGENCE` | 503 | `"Oracle prices diverge too much: {divergence}% > {max_divergence}%"` | `prices`, `divergence`, `max_divergence` | Oracle prices lệch quá 5% (ADR-015) |
| `ERROR_BURN_IN_GRACE_PERIOD` | 409 | `"Cannot burn zkUSD while vault is in grace period until {grace_period_end}"` | `vault_status`, `grace_period_end`, `current_time` | Vault đang ở GRACE_PERIOD — burn blocked (ADR-025) |
| `ERROR_DLC_CLOSE_TIMEOUT` | 503 | `"DLC close timed out after {DLC_CLOSE_TIMEOUT}s. Admin multisig alerted."` | `dlc_contract_id`, `vault_owner`, `elapsed_time` | Relayer failed to close DLC within SLA (ADR-024) |
| `ERROR_BTC_ALREADY_LOCKED_IN_DLC` | 409 | `"BTC address {btc_address} is already locked in an active DLC. Wait for DLC closure before minting."` | `btc_address`, `active_dlc_id`, `dlc_status` | Relayer rejects attestation when BTC UTXO still in active DLC (ADR-036) |
| `ERROR_DLC_DEADLINE_NOT_REACHED` | 400 | `"DLC close deadline not yet reached: {dlc_close_deadline} > {current_time}"` | `dlc_close_deadline`, `current_time` | claim_dlc_timeout called before deadline (ADR-037) |
| `ERROR_VAULT_NOT_PENDING_BTC_RELEASE` | 400 | `"Vault is not in PendingBtcRelease state: {current_status}"` | `vault_owner`, `current_status` | claim_dlc_timeout called on wrong vault state (ADR-037) |
| `ERROR_PROOF_SERVER_TIMEOUT` | 504 | `"Proof generation timed out. Retry with same X-Idempotency-Key."` | `idempotency_key`, `elapsed_ms` | Prover Server 30s timeout — client should retry (ADR-029) |

> **Error format chuẩn:**
> ```
> Error :: {
>   code    :: ErrorCode        // từ registry này
>   message :: string           // theo message template
>   context :: Map<string, any> // các fields liệt kê trong cột "Context"
>   trace   :: string?          // optional, chỉ trong dev mode
> }
> ```

**Xem thêm:** ADR-010, ADR-014, ADR-015, ADR-016, ADR-017

---

## 6. EXTERNAL CONTRACTS

> Interface với các external services, third-party APIs, hoặc databases.
> Ghi lại những gì hệ thống này *expect* từ bên ngoài — không phải implementation của bên ngoài.

### Bitcoin Network

> Hệ thống này gọi Bitcoin Network (thông qua Relayer) để lấy UTXO state.

```
// Hệ thống này expect Relayer lấy từ Bitcoin:
REQUEST :: {
  user_pubkey :: [u8; 33]  // Compressed Bitcoin pubkey
  badge_type  :: BadgeType // Whale, Hodler, hoặc Stacker
}

// Hệ thống này expect Relayer trả về:
RESPONSE :: {
  btc_data  :: u64         // Balance (sat), Age (days), or Count (UTXOs)
  timestamp :: u64         // Unix timestamp
  signature :: [u8; 64]    // Relayer's signature trên dữ liệu
}

// Failure modes hệ thống phải handle:
FAILURES ::
  | TIMEOUT      // sau 30s → retry hoặc fail
  | UNAVAILABLE  // Relayer offline → fail
  | INVALID_DATA // btc_data không hợp lệ → fail
```

**Xem thêm:** ADR-011, ADR-014

---

### Solana Blockchain

> Hệ thống này gọi Solana để verify proof và mint zkUSD.

```
// Hệ thống này gọi Groth16 Verifier trên Solana:
REQUEST :: {
  proof           :: Vec<u8>
  public_inputs   :: Vec<u8>
}

// Hệ thống này expect Solana trả về:
RESPONSE :: {
  verified :: bool
}

// Failure modes hệ thống phải handle:
FAILURES ::
  | VERIFICATION_FAILED  // Proof không hợp lệ → reject
  | PROGRAM_ERROR        // Verifier program error → fail
  | INSUFFICIENT_COMPUTE // Compute budget exceeded → fail
```

**Xem thêm:** ADR-009

---

### Oracle (Chainlink / Pyth / Switchboard)

> Hệ thống này gọi Oracle để lấy giá BTC/USD.

```
// Hệ thống này gọi Oracle:
REQUEST :: {
  feed_id :: string  // "BTC/USD" hoặc tương tự
}

// Hệ thống này expect Oracle trả về:
RESPONSE :: {
  price     :: u64       // Price * 10^8 (e.g., 67000 USD = 6700000000000)
  timestamp :: u64       // Unix timestamp của price
  confidence :: u64?     // Optional confidence interval
}

// Failure modes hệ thống phải handle:
FAILURES ::
  | STALE_PRICE      // Price quá cũ (> 5 phút) → reject (ADR-015)
  | PRICE_DIVERGENCE // Prices từ 3 oracle lệch > 5% → circuit breaker (ADR-015)
  | FEED_UNAVAILABLE // Oracle feed offline → fail
```

**Xem thêm:** ADR-015

---

### Admin Multisig (Circuit Breaker Governance)

> Hệ thống này yêu cầu một Admin Multisig để deactivate Circuit Breaker và thực hiện emergency operations. (ADR-023)

```
// Hệ thống này expect Admin Multisig là:
SPEC ::
  type:      3-of-5 multisig (Squads Protocol hoặc tương đương trên Solana)
  timeout:   CIRCUIT_BREAKER_TIMEOUT = 259200s (72h) — auto-expire nếu không renew
  rotation:  requires 4-of-5 approval
  registry:  public ADR documenting signer identities

// Operations requiring multisig:
REQUIRED_FOR ::
  | deactivate_circuit_breaker  // sau khi Oracle prices reconcile
  | renew_circuit_breaker       // extend beyond 72h timeout
  | rotate_admin_keys           // change multisig signers

// Failure modes hệ thống phải handle:
FAILURES ::
  | TIMEOUT_EXPIRED    // CB auto-deactivates after 72h (CIRCUIT_BREAKER_TIMEOUT)
  | MULTISIG_UNAVAIL   // If < 3 signers reachable → CB auto-expires (không freeze vĩnh viễn)
  | KEY_COMPROMISE     // 1 key compromise không đủ — cần 3-of-5
```

**Xem thêm:** ADR-023, ADR-015 (Circuit Breaker)

> Hệ thống này gọi SPL Token Program để mint/burn zkUSD.

```
// Hệ thống này gọi SPL Token Program:
REQUEST :: {
  mint_authority :: Pubkey
  destination    :: Pubkey
  amount         :: u64
}

// Hệ thống này expect SPL Token Program trả về:
RESPONSE :: {
  success :: bool
}

// Failure modes hệ thống phải handle:
FAILURES ::
  | INVALID_MINT_AUTHORITY  // Mint authority không hợp lệ → fail
  | INSUFFICIENT_TOKENS     // Không đủ token để mint → fail
  | INVALID_ACCOUNT         // Destination account không hợp lệ → fail
```

**Xem thêm:** ADR-017

---

## 7. NAMING CONVENTIONS

> Quy ước đặt tên xuyên suốt codebase. Agent phải tuân theo khi generate code.

| Context | Convention | Ví dụ |
|---|---|---|
| Schema names | `PascalCase` | `RelayerResponse`, `ProverInputs`, `VaultState` |
| Field names | `snake_case` | `nullifier_hash`, `btc_data`, `user_sig` |
| Constants | `SCREAMING_SNAKE` | `BN254_PRIME`, `BADGE_EXPIRY`, `SPL_TOKEN_PROGRAM_ID` |
| Functions | `snake_case` | `compute_nullifier_secret()`, `verify_proof()` |
| Enum variants | `PascalCase` | `Whale`, `Hodler`, `Stacker` |
| Error codes | `SCREAMING_SNAKE` | `ERROR_INVALID_PROOF`, `ERROR_DOUBLE_SPEND` |
| Event names | `PascalCase` | `MintZkUSD`, `BurnZkUSD`, `LiquidateVault` |

**Domain-specific rules:**

- **Nullifier naming:** Luôn sử dụng `nullifier_hash` cho on-chain PDA, `nullifier_secret` cho Noir private input.
- **Signature naming:** `user_sig` cho user's signature, `relayer_sig` cho Relayer's signature.
- **Pubkey naming:** `pubkey_x`, `pubkey_y` cho ECDSA coordinates (không dùng `pk_x`, `pk_y`).
- **BTC data naming:** `btc_data` cho generic data từ Relayer, `collateral_btc` cho on-chain collateral.

```
✅ ĐÚNG:
  nullifier_hash, nullifier_secret
  user_sig, relayer_sig
  pubkey_x, pubkey_y
  btc_data, collateral_btc

❌ SAI:
  nullifier, nullifier_hash_secret
  sig, signature
  pk_x, pk_y
  btc, bitcoin_data
```

---

## 8. SCHEMA CHANGELOG

> Append-only. Mọi thay đổi schema đều phải có entry ở đây.
> Breaking changes phải có ADR entry tương ứng trong ADR.md.

| Version | Date | Schema | Thay đổi | Breaking? | ADR Ref |
|---|---|---|---|---|---|
| v1.0 | 2026-03-09 | All | Initial Solana-native contract baseline | Yes | — |
| v1.0.1 | 2026-03-17 | ProverInputs | Added nullifier_hash to public inputs | Yes | ADR-010 |
| v1.1 | 2026-03-17 | All | Solana execution + Groth16 proving + VHEATM audit integration | Yes | ADR-008, ADR-009 |
| v1.1.1 | 2026-03-17 | RelayerResponse | Removed recovery byte (strip required) | Yes | ADR-006 |
| v1.1.2 | 2026-03-17 | MintZkUSDInput | Added relayer_fee field | No | ADR-012 |
| v1.2 | TBD | VaultState | Added grace_period_end field | No | ADR-016 |
| **v1.3** | **2026-03-17** | **CONTRACTS** | **Added COLLATERALIZATION_RATIO, LIQUIDATION_THRESHOLD, AT_RISK_THRESHOLD, CIRCUIT_BREAKER_TIMEOUT constants** | **No** | **ADR-019, ADR-023** |
| **v1.3** | **2026-03-17** | **CONTRACTS** | **Fixed VaultState invariant to use basis-points formula** | **Yes** | **ADR-019** |
| **v1.3** | **2026-03-17** | **CONTRACTS** | **Added INV-10 definition + serialization endianness contract** | **Yes** | **ADR-021** |
| **v1.3** | **2026-03-17** | **CONTRACTS** | **Replaced {{VERIFIER_ID}}/{{FEED_ID}} placeholders with spec + CI gate note** | **No** | **ADR-020** |
| **v1.3** | **2026-03-17** | **CONTRACTS** | **Added Admin Multisig to External Contracts** | **No** | **ADR-023** |
| **v1.4** | **2026-03-17** | **TransactionStatus** | **Added PendingBtcRelease (4)** | **Yes** | **ADR-024** |
| **v1.4** | **2026-03-17** | **VaultState** | **Added dlc_contract_id, dlc_close_deadline fields** | **No** | **ADR-024** |
| **v1.4** | **2026-03-17** | **BurnZkUSD** | **Added ERROR_BURN_IN_GRACE_PERIOD to output contract. Fixed pre-conditions. Updated side effects for DLC async.** | **Yes** | **ADR-024, ADR-025** |
| **v1.4** | **2026-03-17** | **ProverInputs** | **Added INV-13 (threshold constants), INV-15 (nonce generation protocol)** | **Yes** | **ADR-026, ADR-027** |
| **v1.4** | **2026-03-17** | **Constants** | **Added DLC_CLOSE_TIMEOUT, GRACE_PERIOD_DURATION, WHALE_THRESHOLD, HODLER_THRESHOLD, STACKER_THRESHOLD** | **No** | **ADR-024, ADR-027, ADR-028** |
| **v1.4** | **2026-03-17** | **Constants** | **BADGE_EXPIRY clarified as Phase 2 placeholder — not enforced in Phase 1** | **No** | **ADR-030** |
| **v1.5** | **2026-03-17** | **TransactionStatus** | **Added DlcTimeoutPending (5)** | **Yes** | **ADR-037** |
| **v1.5** | **2026-03-17** | **ProverInputs** | **Updated INV-15: removed badge_type from nonce seed — rate-limit now per (solana_address, minute) only** | **Yes** | **ADR-038** |
| **v1.5** | **2026-03-17** | **ErrorRegistry** | **Added ERROR_BTC_ALREADY_LOCKED_IN_DLC, ERROR_DLC_DEADLINE_NOT_REACHED, ERROR_VAULT_NOT_PENDING_BTC_RELEASE** | **No** | **ADR-036, ADR-037** |
| **v1.5** | **2026-03-17** | **ExternalContracts** | **Updated Bitcoin Network contract: Relayer must check DLC registry before signing** | **No** | **ADR-036** |

> **Template một entry:**
> `| v{{X.Y.Z}} | {{DATE}} | {{SCHEMA}} | {{ADDED/REMOVED/RENAMED}}: {{FIELD}} {{→ NEW_NAME/TYPE}} | {{CÓ/KHÔNG}} | ADR-{{N}} |`

---

**Ghi chú:** File này được nâng cấp để tuân thủ đầy đủ template mẫu 1CONTRACTS.md, bao gồm:
- ✅ Mục lục chi tiết
- ✅ Type Notation rõ ràng
- ✅ Primitive Types & Constants với lý do
- ✅ Enums với mô tả chi tiết
- ✅ Core Schemas với constraints và disambiguation
- ✅ Input / Output Contracts chi tiết
- ✅ Error Registry đầy đủ
- ✅ External Contracts
- ✅ Naming Conventions với domain-specific rules
- ✅ Schema Changelog
- ✅ Giữ nguyên toàn bộ nội dung kỹ thuật gốc
