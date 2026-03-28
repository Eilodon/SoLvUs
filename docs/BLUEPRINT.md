# BLUEPRINT.md — Behavior Specification
### SOLVUS Protocol · v1.0.0 (Solana Behavior)

> **Mục đích file này:** Mô tả hệ thống *hoạt động như thế nào* trên Solana — không phải *trông như thế nào*.
> Schemas đã có trong CONTRACTS.md — file này chỉ **reference**, không redefine.
>
> Agent đọc file này: hiểu đủ để implement mà không cần hỏi thêm bất kỳ câu nào.

---

## Mục lục

1. [System Overview](#1-system-overview)
2. [Component Registry](#2-component-registry)
3. [Data Flow](#3-data-flow)
4. [State Machine](#4-state-machine)
5. [Component Specifications](#5-component-specifications)
6. [Integration Points](#6-integration-points)
7. [Non-Functional Requirements](#7-non-functional-requirements)
8. [Scaffolding & Build Order](#8-scaffolding--build-order)

---

## 1. SYSTEM OVERVIEW

> Kiến trúc tổng thể của Solvus Protocol trên Solana.

```
┌─────────────────────────────────────────────────────────────┐
│                   SOLVUS PROTOCOL (Solana)                  │
│                                                             │
│  ┌──────────────┐     ┌──────────────┐     ┌────────────┐  │
│  │   Relayer    │────▶│   Prover     │────▶│   Solana   │  │
│  │ (BTC Data)   │     │ (Noir ZK)    │     │  (Anchor)  │  │
│  │ (TSS-signed) │     │ (Groth16)    │     │ (PDA Init) │  │
│  └──────────────┘     └──────────────┘     └────────────┘  │
│         ▲                    │                    │         │
│         │                    ▼                    ▼         │
│    ┌──────────────┐   ┌──────────────┐   ┌────────────┐    │
│    │   Xverse     │◀──│   Frontend   │   │ Oracle     │    │
│    │   (Wallet)   │   │   (React)    │   │ (Multi)    │    │
│    └──────────────┘   └──────────────┘   └────────────┘    │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              SPL Token (zkUSD)                       │  │
│  │              Collateral (DLCs)                       │  │
│  │              Liquidation Engine                      │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
       ▲ Bitcoin Network (via Relayer)    Solana Network ▶
```

**Luồng chính một câu:** Người dùng ký tin nhắn qua ví Xverse để lấy dữ liệu BTC từ Relayer (TSS-signed), sau đó tạo bằng chứng ZK (Noir + Groth16) và bundle `proof + public_inputs` theo canonical verifier wire contract để mint zkUSD (SPL Token) trên Solana với atomic PDA initialization chống double-spending.

**Những gì hệ thống này KHÔNG làm:**
- Không quản lý Bitcoin wallet trực tiếp — chỉ verify UTXO state thông qua Relayer (xem ADR-011 để biết lý do)
- Không support multi-chain — chỉ Solana (xem ADR-008 để biết lý do)
- Không có governance token — chỉ zkUSD (xem ADR-008)

---

## 2. COMPONENT REGISTRY

> Mỗi component có một nhiệm vụ duy nhất. Không overlap.

| Component | File/Module | Nhiệm vụ | Input | Output | Stateful? |
|---|---|---|---|---|---|
| **Identity** | `packages/core/identity/` | Tạo Nullifier Secret từ chữ ký ví. | `Ref<UserSignature>` | `Field` (nullifier_secret) | Không |
| **Relayer** | `packages/core/relayer/` | Lấy và ký dữ liệu BTC (Whale, Hodler, Stacker). Phát hành Signed Commitment (Ed25519 TSS — ADR-022, Phase 1). | `btc_address`, `badge_type` | `Ref<RelayerResponse>` (TSS-signed - ADR-011, ADR-014) | Không |
| **Prover** | `packages/core/prover/` | Lắp ráp input cho mạch Noir. | `Ref<ProverInputs>` | `Ref<ProverInputs>` (validated) | Không |
| **Prover Server** | `packages/prover-server/` | API tạo proof bundle ZK (Groth16). | `Ref<ProverInputs>` | `proof: Vec<u8>` + `public_inputs: Vec<u8>` | Không |
| **Anchor Program** | `solana/programs/solvus/` | Xác thực Proof, init PDA, mint zkUSD. | `Ref<MintZkUSDInput>` | `Ref<MintZkUSDOutput>` | Có |
| **Oracle Aggregator** | `packages/oracle/` | Lấy giá BTC/USD từ multi-oracle. **Normalize tất cả giá về 8 decimal trước khi tổng hợp (ADR-040).** | `feed_id` | `u64` (price) | Không |
| **Liquidation Engine** | `solana/programs/liquidation/` | Liquidate vault unhealthy. | `vault_owner` | `Ref<LiquidateVaultOutput>` | Có |
| **Admin Multisig** | External (Squads Protocol) | Deactivate/renew Circuit Breaker. Emergency protocol ops. | CB event + 3-of-5 sigs | Circuit Breaker state | Không (Squads-managed) |

> **"Stateful"** = component giữ state giữa các invocations.
> Stateful components: Anchor Program (PDA, vault state), Liquidation Engine (liquidation queue).

---

## 3. DATA FLOW

> Dữ liệu đi qua hệ thống như thế nào — từ input đến output.
> Mỗi bước: ai làm, dùng operation gì, input/output là schema nào.

### Happy Path — Minting zkUSD

```
[1] User: Ký tin nhắn ví (Solana Address + Nonce)
      │ produces: Ref<UserSignature>
      │ signature: [u8; 64] (ECDSA)
      ▼
[2] Identity: computeNullifierSecret(user_sig) (ADR-006)
      │ input:  Ref<UserSignature>
      │ output: Field (nullifier_secret)
      │ side effect: none
      ▼
[3] Frontend: Fetch BTC address từ Xverse wallet
      │ input:  user wallet
      │ output: btc_address (string)
      ▼
[4] Relayer: fetchRelayerData(btc_address, badge_type) (Multi-Oracle Aggregation - ADR-015)
      │ input:  btc_address, badge_type (Whale/Hodler/Stacker)
      │ output: Ref<RelayerResponse> (TSS-signed - ADR-011, ADR-014)
      │ side effect: Query Bitcoin network
      ▼
[5] Prover: buildProverInputs(RelayerResponse, nullifier_secret, solana_address)
      │ input:  Ref<RelayerResponse>, Field (nullifier_secret), [u8; 32] (solana_address)
      │ output: Ref<ProverInputs> (validated)
      │ side effect: Compute nullifier_hash = Poseidon(dlc_contract_id, badge_type, nullifier_secret, 0)
      ▼
[6] Prover Server: generateProof(ProverInputs)
      │ input:  Ref<ProverInputs>
      │ output: Vec<u8> (Groth16 proof)
      │ side effect: none (stateless)
      ▼
[7] Solana (Anchor Program): mint_zkusd(proof, public_inputs, nullifier_hash, zkusd_amount)
      │ input:  Ref<MintZkUSDInput>
      │ output: Ref<MintZkUSDOutput>
      │ side effect: 
      │   - Verify Groth16 proof (ADR-009)
      │   - Init PDA với nullifier_hash làm seed (ADR-010)
      │   - Mint zkUSD SPL Tokens (ADR-017)
      │   - Lock collateral (DLCs - ADR-011)
      │   - Emit MintZkUSD event
      ▼
[N] Final State: zkUSD minted, collateral locked, PDA initialized
      └─ result: Ref<MintZkUSDOutput>
```

### Error Path — Invalid Proof

```
[6] Prover Server: generateProof(ProverInputs)
      │ output: Vec<u8> (proof)
      ▼
[7] Solana (Anchor Program): mint_zkusd(proof, ...)
      │ Groth16 verifier: FAIL
      │ error: Ref<ERROR_INVALID_PROOF>
      ▼
[7a] Error Handler: Return ERROR_INVALID_PROOF
      │ message: "Invalid ZK proof: verification failed"
      │ context: proof_hash, public_inputs_hash
      ▼
[7b] Frontend: Display error message to user
      └─ user action: Retry proof generation
```

### Error Path — Double-spending (Nullifier Collision)

```
[7] Solana (Anchor Program): mint_zkusd(proof, nullifier_hash, ...)
      │ Check: nullifier_hash PDA already exists?
      │ Result: YES (already used)
      │ error: Ref<ERROR_DOUBLE_SPEND>
      ▼
[7a] Error Handler: Return ERROR_DOUBLE_SPEND (ADR-010)
      │ message: "Nullifier already used: {nullifier_hash}"
      │ context: nullifier_hash, previous_tx
      ▼
[7b] Frontend: Display error message to user
      └─ user action: Cannot retry (same nullifier)
```

### Error Path — Double Spend

```
[7] Solana (Anchor Program): mint_zkusd(proof, public_inputs, ...)
      │ Check: dlc_contract_id valid and not already used?
      │ Result: NO (already spent)
      │ error: Ref<ERROR_DOUBLE_SPEND>
      ▼
[7a] Error Handler: Return ERROR_DOUBLE_SPEND (ADR-010)
      │ message: "Nullifier already used: {nullifier_hash}"
      │ context: nullifier_hash
      ▼
[7b] Frontend: Display error message to user
      └─ user action: Retry with fresh proof
```

### Edge Case — Grace Period (Anti-MEV)

```
[1] Liquidation Engine: Check if vault unhealthy
      │ Check: collateral < zkusd_minted * ratio?
      │ Result: YES (unhealthy)
      ▼
[2] Check: Vault in grace period? (ADR-016)
      │ Check: current_time < grace_period_end?
      │ Result: YES (in grace period)
      ▼
[3] Error Handler: Return ERROR_GRACE_PERIOD
      │ message: "Vault in grace period until {grace_period_end}"
      │ context: grace_period_end, current_time
      ▼
[4] User Action: Nạp thêm collateral trong grace period
      │ Call: depositCollateral(amount)
      │ Result: Vault becomes healthy again
      └─ Liquidation cancelled
```

### Edge Case — Oracle Price Divergence (Circuit Breaker)

```
[1] Liquidation Engine: Query oracle prices
      │ Oracle 1 (Chainlink): 67000 USD
      │ Oracle 2 (Pyth): 67500 USD
      │ Oracle 3 (Switchboard): 63000 USD
      ▼
[2] Check: Prices diverge > 5%? (ADR-015)
      │ Divergence: (67500 - 63000) / 67000 = 6.7% > 5%
      │ Result: YES (diverge too much)
      ▼
[3] Circuit Breaker: ACTIVATE
      │ Pause: mint, burn, liquidate operations
      │ Emit: CircuitBreakerActivated event
      │ Alert: Admin to investigate
      ▼
[4] Manual Resolution: Admin resolves issue
      │ Deactivate circuit breaker
      │ Resume operations
```

### Edge Case — Large UTXO Set (>100k UTXOs)

```
[4] Relayer: fetchRelayerData(btc_address, Whale)
      │ Query Bitcoin: 150,000 UTXOs
      ▼
[4a] Compute minimum UTXO
      │ Old approach: Math.min(...spread) → Stack overflow
      │ New approach: reduce() (ADR-004) → Success
      ▼
[4b] Compute btc_data (total balance)
      │ Sum all UTXOs: 50 BTC
      │ Result: 5000000000 satoshis
      ▼
[5] Continue with normal flow
```

---

## 4. STATE MACHINE

> Trạng thái của một vault (người dùng) trong hệ thống.
> Đây là source of truth cho mọi state transition — không implement transition nào không có trong diagram này.

```
STATES:
  INITIALIZED     — Vault vừa được tạo, chưa mint zkUSD
  HEALTHY         — Collateral đủ, không có vấn đề
  AT_RISK         — Collateral sắp không đủ, cần monitor
  UNHEALTHY       — Collateral không đủ, có thể liquidate
  GRACE_PERIOD    — Trong grace period, user có thời gian nạp thêm (ADR-016)
  LIQUIDATED      — Vault đã bị liquidate, không thể recover
  CLOSED          — Vault đã đóng (burn hết zkUSD)

TRANSITIONS:
  INITIALIZED ──[mint_zkusd]──▶ HEALTHY
                  guard: proof valid, collateral >= zkusd_minted * ratio
                  action: mint zkUSD, lock collateral

  HEALTHY ──[price_drop]──▶ AT_RISK
              guard: collateral < zkusd_minted * ratio * 1.2
              action: emit warning event

  AT_RISK ──[price_drop]──▶ UNHEALTHY
            guard: collateral < zkusd_minted * ratio
            action: emit liquidation alert

  UNHEALTHY ──[liquidation_triggered]──▶ GRACE_PERIOD
              guard: ALWAYS ENABLED in Phase 1 (ADR-028 — static behavior, no flag)
              action: start grace period timer (GRACE_PERIOD_DURATION = 3600s)

  GRACE_PERIOD ──[deposit_collateral]──▶ HEALTHY
                 guard: collateral >= zkusd_minted * ratio
                 action: cancel liquidation

  GRACE_PERIOD ──[grace_period_expired]──▶ LIQUIDATED
                 guard: current_time >= grace_period_end
                 action: liquidate vault, seize collateral

  UNHEALTHY ──[liquidation_triggered]──▶ LIQUIDATED
             guard: grace_period_disabled
             action: liquidate vault immediately

  PendingBtcRelease ──[claim_dlc_timeout]──▶ DlcTimeoutPending
                      guard: current_time > vault.dlc_close_deadline (ADR-037)
                      action: emit DlcTimeoutClaimed, alert Admin Multisig
                      callable: permissionless (any caller after deadline)

  PendingBtcRelease ──[close_dlc]──▶ CLOSED
                      guard: Relayer confirms BTC release
                      action: release collateral, update vault state (ADR-039)

  DlcTimeoutPending ──[close_dlc]──▶ CLOSED
                      guard: Relayer confirms BTC release (late)
                      action: release collateral, update vault state (self-healing) (ADR-039)

  HEALTHY ──[burn_zkusd]──▶ CLOSED
           guard: zkusd_minted == 0
           action: unlock collateral, close vault

INVARIANTS:
  - Không thể transition từ LIQUIDATED sang bất kỳ state nào
  - Không thể transition từ CLOSED sang bất kỳ state nào
  - GRACE_PERIOD phải có timeout (1 hour)
  - Chỉ UNHEALTHY hoặc GRACE_PERIOD mới có thể liquidate
  - collateral >= 0 luôn đúng
  - zkusd_minted >= 0 luôn đúng
```

---

## 5. COMPONENT SPECIFICATIONS

> Chi tiết cách mỗi component hoạt động.

### 5.1 Identity Component

> Tạo Nullifier Secret từ chữ ký ví.

#### Hàm: `computeNullifierSecret()`

```
SIGNATURE:
  computeNullifierSecret(user_sig: [u8; 64]) → Field

PSEUDOCODE:
  1. Validate: user_sig.length == 64
  2. stripRecoveryByte(user_sig) → stripped [u8; 64] (ADR-006)
  3. hash = SHA512(stripped) → [u8; 64]
  4. return BigInt(hash) % BN254_PRIME

CONSTRAINTS:
  - user_sig phải chính xác 64 bytes
  - Recovery byte phải được strip (ADR-006)
  - SHA512 phải được sử dụng (ADR-003)
  - Output phải là Field trong BN254

ERROR HANDLING:
  - Nếu user_sig.length != 64 → throw "Invalid signature length"
  - Nếu hash == 0 → throw "Nullifier secret cannot be zero"
```

#### Hàm: `stripRecoveryByte()`

```
SIGNATURE:
  stripRecoveryByte(sig: [u8; 65]) → [u8; 64]

PSEUDOCODE:
  1. Validate: sig.length == 65
  2. return sig.slice(0, 64)  // [r||s]

CONSTRAINTS:
  - Input phải chính xác 65 bytes (recovery byte + r + s)
  - Output phải chính xác 64 bytes (r + s)

ERROR HANDLING:
  - Nếu sig.length != 65 → throw "Invalid signature length"
```

### 5.2 Relayer Component

> Lấy và ký dữ liệu BTC.

#### Hàm: `fetchRelayerData()`

```
SIGNATURE:
  fetchRelayerData(btc_address: string, badge_type: BadgeType) → RelayerResponse

PSEUDOCODE:
  1. Query Bitcoin network (via Bitcoin RPC or Indexer)
  2. Get UTXO set for btc_address
  2a. [ADR-036] Check DLC registry: if btc_address has active DLC (status ≠ CLOSED)
      → throw "ERROR_BTC_ALREADY_LOCKED_IN_DLC" (prevent double-collateral)
  3. Compute btc_data based on badge_type:
     - Whale: sum of all UTXO values (satoshis)
     - Hodler: age of oldest UTXO (days)
     - Stacker: count of UTXOs
  4. Create DLC contract on Bitcoin (returns dlc_contract_id)
  5. payload = [x_hi, x_lo, btc_data, dlc_contract_id]
  6. hash = Poseidon(payload) (ADR-001)
  7. signature = TSS_SIGN(hash) (ADR-011, ADR-014)
  8. return RelayerResponse {
       btc_data,
       dlc_contract_id,
       pubkey_x,
       pubkey_y,
       signature
     }

CONSTRAINTS:
  - btc_address phải hợp lệ (Bitcoin address format)
  - badge_type phải là Whale, Hodler, hoặc Stacker
  - btc_data phải > 0 (có ít nhất 1 UTXO)
  - dlc_contract_id phải hợp lệ (từ DLC contract trên Bitcoin)
  - Signature phải hợp lệ (TSS-signed)

ERROR HANDLING:
  - Nếu btc_address không hợp lệ → throw "Invalid Bitcoin address"
  - Nếu không có UTXO → throw "No UTXOs found"
  - Nếu btc_address có active DLC (ADR-036) → throw "ERROR_BTC_ALREADY_LOCKED_IN_DLC"
  - Nếu TSS signing fail → throw "Relayer signing failed"
  - Nếu timeout (>30s) → throw "Relayer timeout"

OPTIMIZATION (ADR-004):
  - Sử dụng reduce() thay vì Math.min(...spread) cho UTXO lớn
```

### 5.3 Prover Component

> Lắp ráp input cho mạch Noir.

#### Hàm: `buildProverInputs()`

```
SIGNATURE:
  buildProverInputs(
    relayer_response: RelayerResponse,
    nullifier_secret: Field,
    solana_address: [u8; 32],
    badge_type: BadgeType,
    threshold: u64
  ) → ProverInputs

PSEUDOCODE:
  1. Validate all inputs
  2. Compute nullifier_hash:
     nullifier_hash = Poseidon(dlc_contract_id, badge_type, nullifier_secret, 0)
  3. Extract pubkey_x, pubkey_y từ relayer_response
  4. return ProverInputs {
       dlc_contract_id: relayer_response.dlc_contract_id,
       nullifier_secret,  // PRIVATE INPUT
       pubkey_x,
       pubkey_y,
       user_sig,
       btc_data: relayer_response.btc_data,
       relayer_sig: relayer_response.signature,
       solana_address,
       relayer_pubkey_x: relayer_response.pubkey_x,
       relayer_pubkey_y: relayer_response.pubkey_y,
       badge_type,
       threshold,
       is_upper_bound: false,
       nullifier_hash
     }

CONSTRAINTS:
  - Tất cả inputs phải hợp lệ
  - nullifier_hash phải deterministic (ADR-006)
  - Public inputs phải khớp với Noir circuit

ERROR HANDLING:
  - Nếu input không hợp lệ → throw "Invalid input"
  - Nếu nullifier_hash collision → throw "Nullifier collision"
```

### 5.4 Prover Server

> API tạo Groth16 proof bundle cho verifier path trên Solana.

#### Endpoint: `POST /prove`

```
REQUEST HEADERS:
  X-Idempotency-Key: sha256(JSON.stringify(prover_inputs))  // client generates (ADR-029)

REQUEST:
  {
    prover_inputs: ProverInputs
  }

RESPONSE (Success):
  {
    proof: Vec<u8>,
    public_inputs: Vec<u8>,
    proving_time: u64,  // milliseconds
    cached: bool,       // true if returned from idempotency cache (ADR-029)
    retry_count: u8     // 0 for first attempt
  }

RESPONSE (Error):
  {
    error: string,
    message: string
  }

PSEUDOCODE:
  1. Check X-Idempotency-Key in cache (TTL = RELAYER_SIG_EXPIRY = 3600s)
     If found → return cached proof immediately (cached: true)
  2. Validate prover_inputs
  3. Compile Noir circuit (if not cached)
  4. Generate Groth16 proof bundle theo canonical verifier wire format
  5. Cache result by X-Idempotency-Key for RELAYER_SIG_EXPIRY
  6. return {proof, public_inputs, proving_time, cached: false}

CLIENT RETRY POLICY (ADR-029):
  max_retries: 3
  backoff: [5s, 15s, 30s]
  retry_with: same X-Idempotency-Key (idempotent — server returns cached proof)
  on_all_fail: display "Proof generation failed, please retry"

CONSTRAINTS:
  - Proving time phải < 30 seconds
  - Proof phải hợp lệ (verifiable)
  - Public inputs phải khớp verifier contract
  - Idempotency key ensures at-most-once proof generation per request

ERROR HANDLING:
  - Nếu input không hợp lệ → return 400 Bad Request
  - Nếu proving timeout → return ERROR_PROOF_SERVER_TIMEOUT (504) + X-Idempotency-Key in response
  - Nếu server error → return 500 Internal Server Error
```

### 5.5 Anchor Program (Solana)

> Xác thực Proof, init PDA, mint zkUSD.

#### Instruction: `mint_zkusd`

```
SIGNATURE (Rust/Anchor):
  pub fn mint_zkusd(
    ctx: Context<MintZkUSD>,
    nullifier_hash: [u8; 32],
    zkusd_amount: u64,
    proof: Vec<u8>,
    public_inputs: Vec<u8>
  ) → Result<()>

PSEUDOCODE:
  1. Validate token_program is SPL Token Program (ADR-017)
  2. Verify Groth16 proof using public_inputs (ADR-009)
  3. If proof invalid → return ERROR_INVALID_PROOF
  4. Check nullifier_hash PDA doesn't exist (ADR-010)
  5. If exists → return ERROR_DOUBLE_SPEND
  6. Initialize PDA with nullifier_hash as seed (ADR-010)
  7. Mint zkUSD SPL Tokens to caller
  8. Lock collateral via DLCs (ADR-011)
  9. Emit MintZkUSD event
  10. return Ok(())

CONSTRAINTS:
  - Proof phải hợp lệ
  - Nullifier_hash chưa tồn tại
  - Token program phải là SPL Token Program chính thức
  - Atomic transaction (không thể fail một phần)

ERROR HANDLING:
  - Nếu proof invalid → return ERROR_INVALID_PROOF
  - Nếu double-spend → return ERROR_DOUBLE_SPEND
  - Nếu token_program invalid → return ERROR_INVALID_TOKEN_PROGRAM
  - Nếu insufficient compute → return ERROR_INSUFFICIENT_COMPUTE

SIDE EFFECTS:
  - PDA initialized
  - zkUSD minted
  - Collateral locked
  - Event emitted
```

#### Instruction: `burn_zkusd`

```
SIGNATURE (Rust/Anchor):
  pub fn burn_zkusd(
    ctx: Context<BurnZkUSD>,
    zkusd_amount: u64,
    recipient_btc: Option<[u8; 32]>
  ) → Result<()>

PSEUDOCODE:
  1. Validate user has enough zkUSD balance
  2. Check vault.status != GRACE_PERIOD → ERROR_BURN_IN_GRACE_PERIOD (ADR-025)
  3. Burn zkUSD SPL Tokens from caller
  4. Set vault.status = PendingBtcRelease (ADR-024)
  5. Set vault.dlc_close_deadline = current_time + DLC_CLOSE_TIMEOUT
  6. Emit BurnZkUSD event: { owner, amount, dlc_contract_id, timestamp }
  7. return Ok(())
  — Relayer observes event (WebSocket), closes DLC on Bitcoin async within 60 min (ADR-024)
  — BTC collateral released only after DLC close confirmed on Bitcoin

CONSTRAINTS:
  - User balance >= zkusd_amount
  - Recipient_btc phải hợp lệ (hoặc null)
  - Không trong grace period (ADR-016)

ERROR HANDLING:
  - Nếu insufficient balance → return ERROR_INSUFFICIENT_BALANCE
  - Nếu invalid BTC address → return ERROR_INVALID_BTC_ADDRESS
  - Nếu vault in GRACE_PERIOD → return ERROR_BURN_IN_GRACE_PERIOD (ADR-025)
```

---

## 6. INTEGRATION POINTS

> Các điểm kết nối với external systems.

### 6.1 Bitcoin Network

- **Via:** Relayer (TSS-signed)
- **What:** Query UTXO state (mint) + close DLC contracts (burn)
- **When:** `fetchRelayerData()` for mint; `BurnZkUSD` event observed for DLC close (ADR-024)
- **Failure Mode:** Timeout (>30s) → retry; DLC close fail → ERROR_DLC_CLOSE_TIMEOUT + Admin alert
- **Atomic window (ADR-024):** Between zkUSD burn (Solana, instant) and DLC close (Bitcoin, ~60 min), vault.status = PendingBtcRelease. User has 0 zkUSD and 0 BTC access during this window.
- **Mitigation:** Multi-Relayer (TSS — ADR-011, ADR-014); DLC_CLOSE_TIMEOUT = 3600s with 3 retries; Admin Multisig alert on failure (ADR-023)

### 6.2 Solana Blockchain

- **Via:** Anchor Program
- **What:** Verify Groth16 proof, mint SPL Token, init PDA
- **When:** During mint_zkusd instruction
- **Failure Mode:** Proof verification fail → reject
- **Mitigation:** Atomic transaction, PDA init + verify gộp (ADR-010)

### 6.3 Oracle (Chainlink / Pyth / Switchboard)

- **Via:** Oracle Aggregator
- **What:** Get BTC/USD price
- **When:** During liquidation check
- **Failure Mode:** Price divergence > 5% → circuit breaker (ADR-015)
- **Mitigation:** Multi-Oracle Aggregation, Circuit Breaker (ADR-015)

### 6.4 SPL Token Program

- **Via:** CPI (Cross-Program Invocation)
- **What:** Mint/Burn zkUSD
- **When:** During mint_zkusd / burn_zkusd
- **Failure Mode:** Invalid token_program → reject (ADR-017)
- **Mitigation:** Strict SPL Token Program ID validation (ADR-017)

### 6.5 Groth16 Verifier

- **Via:** Noir artifacts + canonical verifier adapter
- **What:** Verify ZK proof
- **When:** During mint_zkusd
- **Failure Mode:** Proof invalid → reject
- **Mitigation:** Proof generation + verification tested end-to-end bằng golden vectors và serialization contract thống nhất

---

## 7. NON-FUNCTIONAL REQUIREMENTS

> Yêu cầu về hiệu suất, bảo mật, độ tin cậy, v.v.

### 7.1 Performance

| Requirement | Target | Rationale |
|---|---|---|
| Proof Generation Time | < 30 seconds | User experience — không quá lâu |
| Proof Verification Time | < 1 second | On-chain verification — tối ưu compute |
| Relayer Response Time | < 5 seconds | User experience — không quá lâu |
| Oracle Query Time | < 2 seconds | Liquidation responsiveness |
| Mint Transaction Time | < 10 seconds | Solana block time (400ms) |

### 7.2 Security

| Requirement | Mechanism | Rationale |
|---|---|---|
| Double-spending Prevention | PDA with nullifier_hash (ADR-010) | Prevent replay attacks |
| Collateral Locking | DLCs with TSS-Relayer (ADR-011) | Ensure zkUSD backed |
| Proof Validity | Groth16 verifier (ADR-009) | Ensure correct computation |
| Relayer Integrity | Staking + Slashing (ADR-014) | Incentivize honest behavior |
| Oracle Manipulation | Multi-Oracle + Circuit Breaker (ADR-015) | Prevent price attacks |
| Token Program Validation | Strict SPL Token Program ID check (ADR-017) | Prevent fake token minting |

### 7.3 Availability

| Requirement | Target | Mechanism |
|---|---|---|
| Uptime | 99.9% | Multi-Relayer (TSS), redundant Oracle |
| Graceful Degradation | Circuit Breaker | Pause operations if Oracle diverges |
| Recovery Time | < 5 minutes | Manual circuit breaker deactivation |

### 7.4 Scalability

| Requirement | Target | Mechanism |
|---|---|---|
| Max Concurrent Users | 10,000 | Stateless Prover, Solana throughput |
| Max UTXO Set | 100,000+ | reduce() optimization (ADR-004) |
| Max Proof Size | < 1 KB | Groth16 compression |

### 7.5 Privacy

| Requirement | Mechanism | Rationale |
|---|---|---|
| User Identity Privacy | pubkey_x as private input (ADR-002) | Prevent linking Bitcoin ↔ Solana |
| Nullifier Privacy | nullifier_hash only public (ADR-010) | Prevent tracking mints |
| Transaction Privacy | Meta-transactions (ADR-012) | Prevent linking SOL transfers |

---

## 8. SCAFFOLDING & BUILD ORDER

> Phân chia công việc thành các phase với dependencies rõ ràng.

### PHASE 0 — Foundation (PASSED ✅)

**Deliverables:**
- [0.1] Core Crypto (Poseidon, SHA512, BN254)
- [0.2] Identity Logic (Nullifier Secret with `stripRecoveryByte`)
- [0.3] Relayer Signing Protocol (TSS-enabled)

**Gate:** Core crypto, deterministic signing flow, và fixture vectors đã được verify ✅

**Dependencies:** None

---

### PHASE 1 — Core Logic (IN PROGRESS 🔄)

**Deliverables:**
- [1.1] Noir Circuit (main.nr)
  - Poseidon hash (ADR-001)
  - ECDSA signature verification (ADR-002)
  - SHA512 nullifier (ADR-003)
  - Optimized for BN254 (ADR-005)
  
- [1.2] Anchor Program (Solvus.rs)
  - Groth16 verifier path (ADR-009)
  - Atomic PDA Init + Verify (ADR-010)
  - SPL Token minting (ADR-017)
  - Double-spending protection (ADR-010)
  
- [1.3] Prover Input Assembler
  - Generates ZK-Validity Proofs (ADR-014)
  - Validates all inputs
  - Computes nullifier_hash

**Gate:** Successful Proof Generation & On-chain Verification on Solana Devnet

**Dependencies:** PHASE 0

---

### PHASE 2 — Integration & Security (PLANNED 📋)

**Deliverables:**
- [2.1] Prover Server API
  - REST endpoint for proof generation
  - Caching for performance
  - Error handling
  
- [2.2] Frontend UI (React)
  - Wallet integration (Xverse)
  - Proof generation UI
  - Transaction status tracking
  
- [2.3] E2E Testing on Devnet/Testnet
  - Happy path testing
  - Error path testing
  - MEV scenario testing (ADR-016)
  - Oracle manipulation testing (ADR-015)
  - Relayer collusion testing (ADR-014)

**Gate:** Demo ready for mainnet

**Dependencies:** PHASE 1

---

### PHASE 3 — Advanced Features & Compliance (PLANNED 📋)

**Deliverables:**
- [3.1] Liquidation Grace Period (ADR-016)
  - Grace period timer
  - Deposit collateral during grace period
  - Liquidation queue
  
- [3.2] View Keys for Institutional Compliance
  - Audit trail
  - Transaction history
  - Compliance reports
  
- [3.3] Circuit Breaker Implementation (ADR-015)
  - Oracle price divergence detection
  - Automatic pause/resume
  - Admin controls

**Gate:** Production Ready for Institutional DeFi Vaults

**Dependencies:** PHASE 2

---

### PHASE 4 — Multi-Chain & Governance (FUTURE 🚀)

**Deliverables:**
- [4.1] Multi-Chain Support (Ethereum, Polygon, etc.)
- [4.2] Governance Token (DAO)
- [4.3] Advanced Liquidation Strategies

**Gate:** Multi-chain launch

**Dependencies:** PHASE 3

---

**Ghi chú:** File này được nâng cấp để tuân thủ đầy đủ template mẫu 1BLUEPRINT.md, bao gồm:
- ✅ Mục lục chi tiết
- ✅ System Overview với ASCII diagram
- ✅ Component Registry đầy đủ
- ✅ Data Flow: Happy path, Error paths, Edge cases
- ✅ State Machine với transitions và invariants
- ✅ Component Specifications chi tiết (pseudocode, constraints, error handling)
- ✅ Integration Points rõ ràng
- ✅ Non-Functional Requirements (Performance, Security, Availability, Scalability, Privacy)
- ✅ Scaffolding & Build Order với dependencies
- ✅ Giữ nguyên toàn bộ nội dung kỹ thuật gốc
