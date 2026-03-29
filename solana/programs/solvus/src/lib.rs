use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::solana_program::program::invoke;
use anchor_lang::solana_program::pubkey;
use anchor_lang::system_program::{self, CreateAccount};
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount};
use pythnet_sdk::messages::PriceFeedMessage;

#[allow(dead_code)]
#[path = "../../../verifier_contract.rs"]
mod verifier_contract;

declare_id!("Cik3PiifeUrKrWcAFsHM5R7ckQVkWAc9M9THrXVfanVR");

const ZKUSD_MINT_AUTHORITY_SEED: &[u8] = b"zkusd_mint_authority";
const PDA_NULLIFIER_SEED: &[u8] = b"nullifier_account";
const VERIFICATION_PAYLOAD_SEED: &[u8] = b"verification_payload";
const PROTOCOL_CONFIG_SEED: &[u8] = b"protocol_config";
const INSTITUTION_ACCOUNT_SEED: &[u8] = b"institution_account";
const COMPLIANCE_PERMIT_SEED: &[u8] = b"compliance_permit";
const VAULT_SEED: &[u8] = b"vault";
const DLC_CLOSE_TIMEOUT: i64 = 3600;
const GRACE_PERIOD_DURATION: i64 = 3600;
const L1_PREEMPTION_WINDOW: i64 = 86400;
const INSTITUTION_MINT_WINDOW_SECONDS: i64 = 86400;
const BPS_DENOMINATOR: u128 = 10_000;
const COLLATERAL_RATIO_PRECISION: u128 = 100_000;
const DEFAULT_COLLATERAL_RATIO_BPS: u64 = 15_000;
const LIQUIDATION_THRESHOLD_BPS: u64 = 12_000;
const AT_RISK_THRESHOLD_BPS: u64 = 13_000;
// zkUSD uses 6 decimal places: 1_000_000 units = 1.000000 zkUSD.
// This per-transaction ceiling therefore equals 1,000,000 zkUSD.
const MAX_MINT_ZKUSD_AMOUNT: u64 = 1_000_000_000_000;
const MAX_LIQUIDATOR_REWARD_BPS: u64 = 1000;
const SPL_TOKEN_PROGRAM_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const PYTH_RECEIVER_PROGRAM_ID: Pubkey = pubkey!("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
const GROTH16_PUBLIC_INPUT_FIELD_COUNT: usize = 69;
const GROTH16_PUBLIC_INPUT_HEADER_BYTES: usize = 12;
const GROTH16_PUBLIC_INPUT_BYTES: usize = verifier_contract::GROTH16_PUBLIC_INPUT_BYTES;
const _: [(); GROTH16_PUBLIC_INPUT_BYTES] =
    [(); GROTH16_PUBLIC_INPUT_HEADER_BYTES + GROTH16_PUBLIC_INPUT_FIELD_COUNT * 32];
const DEFAULT_ORACLE_MAX_STALENESS_SECONDS: u64 = 60;
const VAULT_ACCOUNT_MIN_SPACE: usize = 8 + VaultState::MIN_LEN;
const BTC_USD_FEED_ID: &str = "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";

#[program]
pub mod solvus {
    use super::*;

    pub fn initialize_protocol_config(
        ctx: Context<InitializeProtocolConfig>,
        compliance_admin: Pubkey,
        groth16_verifier_program_id: Pubkey,
        oracle_price_feed_id: Pubkey,
        liquidation_program_id: Pubkey,
        authorized_relayer_pubkey_x: [u8; 32],
        authorized_relayer_pubkey_y: [u8; 32],
        collateral_ratio_bps: u64,
        oracle_max_staleness_seconds: u64,
    ) -> Result<()> {
        require!(
            compliance_admin != Pubkey::default(),
            SolvusError::Unauthorized
        );
        require!(
            groth16_verifier_program_id != Pubkey::default(),
            SolvusError::VerifierProgramNotConfigured
        );
        require!(
            oracle_price_feed_id != Pubkey::default(),
            SolvusError::OraclePriceFeedNotConfigured
        );
        require!(
            collateral_ratio_bps >= DEFAULT_COLLATERAL_RATIO_BPS,
            SolvusError::InvalidCollateralRatio
        );
        require!(
            oracle_max_staleness_seconds >= DEFAULT_ORACLE_MAX_STALENESS_SECONDS,
            SolvusError::InvalidOracleStaleness
        );

        let now = Clock::get()?.unix_timestamp;
        let protocol_config = &mut ctx.accounts.protocol_config;
        protocol_config.protocol_admin = ctx.accounts.protocol_admin.key();
        protocol_config.compliance_admin = compliance_admin;
        protocol_config.groth16_verifier_program_id = groth16_verifier_program_id;
        protocol_config.oracle_price_feed_id = oracle_price_feed_id;
        protocol_config.liquidation_program_id = liquidation_program_id;
        protocol_config.authorized_relayer_pubkey_x = authorized_relayer_pubkey_x;
        protocol_config.authorized_relayer_pubkey_y = authorized_relayer_pubkey_y;
        protocol_config.collateral_ratio_bps = collateral_ratio_bps;
        protocol_config.oracle_max_staleness_seconds = oracle_max_staleness_seconds;
        protocol_config.protocol_paused = false;
        protocol_config.updated_at = now;

        emit!(ProtocolConfigUpdatedEvent {
            protocol_admin: ctx.accounts.protocol_admin.key(),
            compliance_admin,
            groth16_verifier_program_id,
            oracle_price_feed_id,
            liquidation_program_id,
            collateral_ratio_bps,
            oracle_max_staleness_seconds,
            protocol_paused: false,
            updated_at: now,
            authorized_relayer_pubkey_x,
            authorized_relayer_pubkey_y,
        });

        Ok(())
    }

    pub fn update_protocol_config(
        ctx: Context<UpdateProtocolConfig>,
        next_protocol_admin: Pubkey,
        compliance_admin: Pubkey,
        groth16_verifier_program_id: Pubkey,
        oracle_price_feed_id: Pubkey,
        liquidation_program_id: Pubkey,
        authorized_relayer_pubkey_x: [u8; 32],
        authorized_relayer_pubkey_y: [u8; 32],
        collateral_ratio_bps: u64,
        oracle_max_staleness_seconds: u64,
    ) -> Result<()> {
        require!(
            next_protocol_admin != Pubkey::default() && compliance_admin != Pubkey::default(),
            SolvusError::Unauthorized
        );
        require!(
            groth16_verifier_program_id != Pubkey::default(),
            SolvusError::VerifierProgramNotConfigured
        );
        require!(
            oracle_price_feed_id != Pubkey::default(),
            SolvusError::OraclePriceFeedNotConfigured
        );
        require!(
            collateral_ratio_bps >= DEFAULT_COLLATERAL_RATIO_BPS,
            SolvusError::InvalidCollateralRatio
        );
        require!(
            oracle_max_staleness_seconds >= DEFAULT_ORACLE_MAX_STALENESS_SECONDS,
            SolvusError::InvalidOracleStaleness
        );

        let protocol_config_info = &ctx.accounts.protocol_config;
        require_keys_eq!(
            *protocol_config_info.owner,
            crate::ID,
            SolvusError::InvalidProtocolConfig
        );
        let legacy_len_v1 = 8 + LegacyProtocolConfigV1::LEN;
        let legacy_len_v2 = 8 + LegacyProtocolConfigV2::LEN;
        let legacy_len_v3 = 8 + LegacyProtocolConfigV3::LEN;
        let current_len = 8 + ProtocolConfig::LEN;
        let data_len = protocol_config_info.data_len();
        require!(
            data_len == legacy_len_v1
                || data_len == legacy_len_v2
                || data_len == legacy_len_v3
                || data_len == current_len,
            SolvusError::InvalidProtocolConfig
        );
        require!(
            data_len == current_len,
            SolvusError::ProtocolConfigMigrationRequired
        );

        let (current_protocol_admin, _current_compliance_admin, protocol_paused) =
            load_protocol_config_roles(protocol_config_info)?;
        require_keys_eq!(
            current_protocol_admin,
            ctx.accounts.protocol_admin.key(),
            SolvusError::Unauthorized
        );

        let now = Clock::get()?.unix_timestamp;
        store_protocol_config(
            protocol_config_info,
            &ProtocolConfig {
                protocol_admin: next_protocol_admin,
                compliance_admin,
                groth16_verifier_program_id,
                oracle_price_feed_id,
                liquidation_program_id,
                authorized_relayer_pubkey_x,
                authorized_relayer_pubkey_y,
                collateral_ratio_bps,
                oracle_max_staleness_seconds,
                protocol_paused,
                updated_at: now,
            },
        )?;

        emit!(ProtocolConfigUpdatedEvent {
            protocol_admin: next_protocol_admin,
            compliance_admin,
            groth16_verifier_program_id,
            oracle_price_feed_id,
            liquidation_program_id,
            collateral_ratio_bps,
            oracle_max_staleness_seconds,
            protocol_paused,
            updated_at: now,
            authorized_relayer_pubkey_x,
            authorized_relayer_pubkey_y,
        });

        Ok(())
    }

    pub fn migrate_protocol_config(
        ctx: Context<MigrateProtocolConfig>,
        next_protocol_admin: Pubkey,
        compliance_admin: Pubkey,
        groth16_verifier_program_id: Pubkey,
        oracle_price_feed_id: Pubkey,
        liquidation_program_id: Pubkey,
        authorized_relayer_pubkey_x: [u8; 32],
        authorized_relayer_pubkey_y: [u8; 32],
        collateral_ratio_bps: u64,
        oracle_max_staleness_seconds: u64,
    ) -> Result<()> {
        require!(
            next_protocol_admin != Pubkey::default() && compliance_admin != Pubkey::default(),
            SolvusError::Unauthorized
        );
        require!(
            groth16_verifier_program_id != Pubkey::default(),
            SolvusError::VerifierProgramNotConfigured
        );
        require!(
            oracle_price_feed_id != Pubkey::default(),
            SolvusError::OraclePriceFeedNotConfigured
        );
        require!(
            collateral_ratio_bps >= DEFAULT_COLLATERAL_RATIO_BPS,
            SolvusError::InvalidCollateralRatio
        );
        require!(
            oracle_max_staleness_seconds >= DEFAULT_ORACLE_MAX_STALENESS_SECONDS,
            SolvusError::InvalidOracleStaleness
        );

        let protocol_config_info = &ctx.accounts.protocol_config;
        require_keys_eq!(
            *protocol_config_info.owner,
            crate::ID,
            SolvusError::InvalidProtocolConfig
        );
        let legacy_len_v1 = 8 + LegacyProtocolConfigV1::LEN;
        let legacy_len_v2 = 8 + LegacyProtocolConfigV2::LEN;
        let legacy_len_v3 = 8 + LegacyProtocolConfigV3::LEN;
        let current_len = 8 + ProtocolConfig::LEN;
        let data_len = protocol_config_info.data_len();
        require!(
            data_len == legacy_len_v1
                || data_len == legacy_len_v2
                || data_len == legacy_len_v3
                || data_len == current_len,
            SolvusError::InvalidProtocolConfig
        );
        require!(
            data_len != current_len,
            SolvusError::ProtocolConfigAlreadyMigrated
        );

        let (current_protocol_admin, _legacy_compliance_admin, protocol_paused) =
            load_protocol_config_roles(protocol_config_info)?;
        require_keys_eq!(
            current_protocol_admin,
            ctx.accounts.protocol_admin.key(),
            SolvusError::Unauthorized
        );

        let now = Clock::get()?.unix_timestamp;
        protocol_config_info.resize(current_len)?;
        store_protocol_config(
            protocol_config_info,
            &ProtocolConfig {
                protocol_admin: next_protocol_admin,
                compliance_admin,
                groth16_verifier_program_id,
                oracle_price_feed_id,
                liquidation_program_id,
                authorized_relayer_pubkey_x,
                authorized_relayer_pubkey_y,
                collateral_ratio_bps,
                oracle_max_staleness_seconds,
                protocol_paused,
                updated_at: now,
            },
        )?;

        emit!(ProtocolConfigMigratedEvent {
            legacy_data_len: data_len as u32,
            protocol_admin: next_protocol_admin,
            compliance_admin,
            updated_at: now,
        });

        emit!(ProtocolConfigUpdatedEvent {
            protocol_admin: next_protocol_admin,
            compliance_admin,
            groth16_verifier_program_id,
            oracle_price_feed_id,
            liquidation_program_id,
            collateral_ratio_bps,
            oracle_max_staleness_seconds,
            protocol_paused,
            updated_at: now,
            authorized_relayer_pubkey_x,
            authorized_relayer_pubkey_y,
        });

        Ok(())
    }

    pub fn set_protocol_pause(ctx: Context<SetProtocolPause>, paused: bool) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.protocol_config.protocol_admin,
            ctx.accounts.protocol_admin.key(),
            SolvusError::Unauthorized
        );

        let now = Clock::get()?.unix_timestamp;
        let protocol_config = &mut ctx.accounts.protocol_config;
        protocol_config.protocol_paused = paused;
        protocol_config.updated_at = now;

        emit!(ProtocolPauseChangedEvent {
            protocol_admin: ctx.accounts.protocol_admin.key(),
            paused,
            updated_at: now,
        });

        Ok(())
    }

    pub fn upsert_institution(
        ctx: Context<UpsertInstitution>,
        institution_id_hash: [u8; 32],
        approved_operator: Pubkey,
        risk_tier: u8,
        daily_mint_cap: u64,
        lifetime_mint_cap: u64,
        kyb_ref_hash: [u8; 32],
        travel_rule_required: bool,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.protocol_config.compliance_admin,
            ctx.accounts.compliance_admin.key(),
            SolvusError::Unauthorized
        );
        require!(
            approved_operator != Pubkey::default(),
            SolvusError::InvalidInstitutionAccount
        );
        require!(daily_mint_cap > 0, SolvusError::InstitutionMintCapExceeded);
        require!(
            lifetime_mint_cap >= daily_mint_cap,
            SolvusError::InstitutionMintCapExceeded
        );

        let now = Clock::get()?.unix_timestamp;
        let institution = &mut ctx.accounts.institution_account;
        require!(
            institution.status != InstitutionStatus::Terminated as u8,
            SolvusError::InstitutionInTerminalState
        );
        if institution.current_period_start == 0 {
            institution.current_period_start = now;
        }

        institution.institution_id_hash = institution_id_hash;
        institution.approved_operator = approved_operator;
        if institution.status == InstitutionStatus::Uninitialized as u8 {
            institution.status = InstitutionStatus::Active as u8;
        }
        institution.risk_tier = risk_tier;
        institution.daily_mint_cap = daily_mint_cap;
        institution.lifetime_mint_cap = lifetime_mint_cap;
        institution.kyb_ref_hash = kyb_ref_hash;
        institution.travel_rule_required = travel_rule_required;
        institution.updated_at = now;

        emit!(InstitutionUpsertedEvent {
            institution_id_hash,
            approved_operator,
            risk_tier,
            daily_mint_cap,
            lifetime_mint_cap,
            kyb_ref_hash,
            travel_rule_required,
            timestamp: now,
        });

        Ok(())
    }

    pub fn issue_compliance_permit(
        ctx: Context<IssueCompliancePermit>,
        institution_id_hash: [u8; 32],
        nullifier_hash: [u8; 32],
        max_amount: u64,
        expires_at: i64,
        kyt_score: u16,
        travel_rule_ref_hash: [u8; 32],
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.protocol_config.compliance_admin,
            ctx.accounts.compliance_admin.key(),
            SolvusError::Unauthorized
        );
        require!(max_amount > 0, SolvusError::InvalidAmount);

        let now = Clock::get()?.unix_timestamp;
        require!(expires_at > now, SolvusError::CompliancePermitExpired);

        let institution = &ctx.accounts.institution_account;
        require!(
            institution.status == InstitutionStatus::Active as u8,
            SolvusError::InstitutionInactive
        );
        require!(
            institution.institution_id_hash == institution_id_hash,
            SolvusError::InvalidInstitutionAccount
        );
        if institution.travel_rule_required {
            require!(
                travel_rule_ref_hash != [0u8; 32],
                SolvusError::TravelRuleRequired
            );
        }

        let permit = &mut ctx.accounts.compliance_permit;
        permit.institution_id_hash = institution_id_hash;
        permit.operator = institution.approved_operator;
        permit.nullifier_hash = nullifier_hash;
        permit.max_amount = max_amount;
        permit.expires_at = expires_at;
        permit.kyt_score = kyt_score;
        permit.kyb_ref_hash = institution.kyb_ref_hash;
        permit.travel_rule_ref_hash = travel_rule_ref_hash;
        permit.issued_by = ctx.accounts.compliance_admin.key();
        permit.issued_at = now;
        permit.used_at = 0;

        emit!(CompliancePermitIssuedEvent {
            institution_id_hash,
            operator: institution.approved_operator,
            nullifier_hash,
            max_amount,
            expires_at,
            kyt_score,
            travel_rule_ref_hash,
            timestamp: now,
        });

        Ok(())
    }

    pub fn set_institution_status(
        ctx: Context<SetInstitutionStatus>,
        institution_id_hash: [u8; 32],
        status: u8,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.protocol_config.compliance_admin,
            ctx.accounts.compliance_admin.key(),
            SolvusError::Unauthorized
        );
        require!(
            institution_id_hash == ctx.accounts.institution_account.institution_id_hash,
            SolvusError::InvalidInstitutionAccount
        );
        require!(
            status == InstitutionStatus::Active as u8
                || status == InstitutionStatus::Suspended as u8
                || status == InstitutionStatus::Terminated as u8,
            SolvusError::InvalidInstitutionStatus
        );

        let institution = &mut ctx.accounts.institution_account;
        require!(
            institution.status != InstitutionStatus::Terminated as u8
                || status == InstitutionStatus::Terminated as u8,
            SolvusError::InstitutionInTerminalState
        );

        let now = Clock::get()?.unix_timestamp;
        institution.status = status;
        institution.updated_at = now;

        emit!(InstitutionStatusChangedEvent {
            institution_id_hash,
            status,
            timestamp: now,
        });

        Ok(())
    }

    pub fn revoke_compliance_permit(
        ctx: Context<RevokeCompliancePermit>,
        institution_id_hash: [u8; 32],
        nullifier_hash: [u8; 32],
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.protocol_config.compliance_admin,
            ctx.accounts.compliance_admin.key(),
            SolvusError::Unauthorized
        );

        let institution = &ctx.accounts.institution_account;
        require!(
            institution.institution_id_hash == institution_id_hash,
            SolvusError::InvalidInstitutionAccount
        );

        let permit = &mut ctx.accounts.compliance_permit;
        require!(
            permit.institution_id_hash == institution_id_hash,
            SolvusError::InvalidCompliancePermit
        );
        require!(
            permit.nullifier_hash == nullifier_hash,
            SolvusError::InvalidCompliancePermit
        );
        require!(
            permit.used_at == 0,
            SolvusError::CompliancePermitAlreadyUsed
        );

        let now = Clock::get()?.unix_timestamp;
        permit.used_at = -std::cmp::max(now, 1);

        emit!(CompliancePermitRevokedEvent {
            institution_id_hash,
            nullifier_hash,
            timestamp: now,
        });

        Ok(())
    }

    pub fn mint_zkusd(
        ctx: Context<MintZkUsd>,
        nullifier_hash: [u8; 32],
        zkusd_amount: u64,
        l1_refund_timelock: i64,
    ) -> Result<()> {
        require!(
            !ctx.accounts.protocol_config.protocol_paused,
            SolvusError::ProtocolPaused
        );
        require!(!is_sanctioned(&ctx.accounts.owner.key()), SolvusError::AddressSanctioned);
        require!(zkusd_amount > 0, SolvusError::InvalidAmount);
        require!(zkusd_amount <= MAX_MINT_ZKUSD_AMOUNT, SolvusError::InvalidAmount);
        require!(
            ctx.accounts.verification_payload.authority == ctx.accounts.fee_payer.key(),
            SolvusError::InvalidVerificationPayload
        );
        require!(
            ctx.accounts.verification_payload.nullifier_hash == nullifier_hash,
            SolvusError::InvalidVerificationPayload
        );
        require!(
            ctx.accounts.verification_payload.proof.len() == verifier_contract::GROTH16_PROOF_BYTES,
            SolvusError::InvalidProof
        );
        require!(
            ctx.accounts.verification_payload.public_inputs.len() == GROTH16_PUBLIC_INPUT_BYTES,
            SolvusError::InvalidPublicInputs
        );
        let now = Clock::get()?.unix_timestamp;
        let institution_key = ctx.accounts.institution_account.key();
        let compliance_permit_key = ctx.accounts.compliance_permit.key();
        authorize_permissioned_mint(
            &mut ctx.accounts.institution_account,
            &mut ctx.accounts.compliance_permit,
            institution_key,
            compliance_permit_key,
            ctx.accounts.owner.key(),
            nullifier_hash,
            zkusd_amount,
            now,
        )?;

        // Use Pyth SDK for safe price reading with staleness check
        let btc_price = read_btc_price_1e8(
            &ctx.accounts.oracle_price_feed,
            ctx.accounts.protocol_config.oracle_max_staleness_seconds,
        )?;

        let (btc_data, dlc_contract_id) = assert_canonical_public_inputs(
            &nullifier_hash,
            &ctx.accounts.verification_payload.public_inputs,
            &ctx.accounts.protocol_config.authorized_relayer_pubkey_x,
            &ctx.accounts.protocol_config.authorized_relayer_pubkey_y,
            &ctx.accounts.owner.key(),
        )?;

        // Dynamic collateral check based on the configured collateral ratio.
        // btc_price expected in USD with 8 decimals (e.g. 65000.00000000)
        // zkusd_amount expected with 6 decimals (e.g. 100.000000)
        // btc_data in satoshis (8 decimals)
        // Formula:
        // required_satoshi = zkusd_amount * collateral_ratio_bps * 100_000 / btc_price
        let required_collateral = required_collateral_from_price(
            zkusd_amount,
            btc_price,
            ctx.accounts.protocol_config.collateral_ratio_bps,
        )?;

        require!(
            btc_data >= required_collateral,
            SolvusError::InsufficientCollateral
        );
        require_keys_eq!(
            ctx.accounts.token_program.key(),
            SPL_TOKEN_PROGRAM_ID,
            SolvusError::InvalidTokenProgram
        );
        require_keys_eq!(
            ctx.accounts.verifier_program.key(),
            ctx.accounts.protocol_config.groth16_verifier_program_id,
            SolvusError::InvalidVerifierProgram
        );

        // Always verify the submitted proof in-program. Local/demo environments
        // should use a dedicated verifier deployment rather than weakening `solvus`.
        verify_groth16_proof(
            &ctx.accounts.verifier_program.to_account_info(),
            &ctx.accounts.verification_payload.proof,
            &ctx.accounts.verification_payload.public_inputs,
        )?;

        let mut vault = load_or_initialize_vault(
            &ctx.accounts.vault,
            &ctx.accounts.owner,
            &ctx.accounts.fee_payer,
            &ctx.accounts.system_program,
            ctx.bumps.vault,
        )?;

        // ADR-002: Prevent vault resurrection after terminal state (Liquidated/Closed)
        if vault.owner != Pubkey::default() {
            require!(
                vault.status != VaultStatus::Liquidated as u8
                    && vault.status != VaultStatus::Closed as u8,
                SolvusError::VaultInTerminalState
            );
        }

        if vault.owner == Pubkey::default() {
            vault.owner = ctx.accounts.owner.key();
            vault.collateral_btc = btc_data;
            vault.zkusd_minted = 0;
            vault.status = VaultStatus::Initialized as u8;
            vault.dlc_contract_id = Some(dlc_contract_id);
        } else {
            vault.collateral_btc = vault
                .collateral_btc
                .checked_add(btc_data)
                .ok_or(SolvusError::MathOverflow)?;
        }

        vault.zkusd_minted = vault
            .zkusd_minted
            .checked_add(zkusd_amount)
            .ok_or(SolvusError::MathOverflow)?;
        vault.last_update = now;
        vault.status = VaultStatus::Healthy as u8;
        vault.grace_period_end = None;
        vault.dlc_close_deadline = None;
        vault.l1_refund_timelock = l1_refund_timelock;

        let nullifier_account = &mut ctx.accounts.nullifier_account;
        nullifier_account.owner = ctx.accounts.owner.key();
        nullifier_account.nullifier_hash = nullifier_hash;
        nullifier_account.created_at = now;

        let signer_seeds: &[&[u8]] = &[ZKUSD_MINT_AUTHORITY_SEED, &[ctx.bumps.mint_authority]];
        let mint_accounts = MintTo {
            mint: ctx.accounts.zkusd_mint.to_account_info(),
            to: ctx.accounts.zkusd_token_account.to_account_info(),
            authority: ctx.accounts.mint_authority.to_account_info(),
        };

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                mint_accounts,
                &[signer_seeds],
            ),
            zkusd_amount,
        )?;

        store_vault_state(&ctx.accounts.vault, &vault)?;

        emit!(MintZkUsdEvent {
            owner: ctx.accounts.owner.key(),
            nullifier_hash,
            amount: zkusd_amount,
            timestamp: now,
        });

        emit!(InstitutionalMintAuthorizedEvent {
            institution_id_hash: ctx.accounts.institution_account.institution_id_hash,
            operator: ctx.accounts.owner.key(),
            nullifier_hash,
            amount: zkusd_amount,
            kyt_score: ctx.accounts.compliance_permit.kyt_score,
            travel_rule_ref_hash: ctx.accounts.compliance_permit.travel_rule_ref_hash,
            timestamp: now,
        });

        Ok(())
    }

    pub fn initialize_verification_payload(
        ctx: Context<InitializeVerificationPayload>,
        nullifier_hash: [u8; 32],
        max_proof_len: u32,
        max_public_inputs_len: u32,
    ) -> Result<()> {
        require!(max_proof_len > 0, SolvusError::InvalidVerificationPayload);
        require!(max_public_inputs_len > 0, SolvusError::InvalidVerificationPayload);

        let payload = &mut ctx.accounts.verification_payload;
        payload.authority = ctx.accounts.authority.key();
        payload.nullifier_hash = nullifier_hash;
        payload.max_proof_len = max_proof_len;
        payload.max_public_inputs_len = max_public_inputs_len;
        payload.proof = Vec::new();
        payload.public_inputs = Vec::new();
        Ok(())
    }

    pub fn append_verification_payload_proof_chunk(
        ctx: Context<AppendVerificationPayloadChunk>,
        chunk: Vec<u8>,
    ) -> Result<()> {
        let payload = &mut ctx.accounts.verification_payload;
        let next_len = payload
            .proof
            .len()
            .checked_add(chunk.len())
            .ok_or(SolvusError::MathOverflow)?;
        require!(
            next_len <= payload.max_proof_len as usize,
            SolvusError::InvalidVerificationPayload
        );
        payload.proof.extend_from_slice(&chunk);
        Ok(())
    }

    pub fn append_verification_payload_public_inputs_chunk(
        ctx: Context<AppendVerificationPayloadChunk>,
        chunk: Vec<u8>,
    ) -> Result<()> {
        let payload = &mut ctx.accounts.verification_payload;
        let next_len = payload
            .public_inputs
            .len()
            .checked_add(chunk.len())
            .ok_or(SolvusError::MathOverflow)?;
        require!(
            next_len <= payload.max_public_inputs_len as usize,
            SolvusError::InvalidVerificationPayload
        );
        payload.public_inputs.extend_from_slice(&chunk);
        Ok(())
    }



    pub fn burn_zkusd(
        ctx: Context<BurnZkUsd>,
        zkusd_amount: u64,
        recipient_btc: Option<[u8; 32]>,
    ) -> Result<()> {
        require!(
            !ctx.accounts.protocol_config.protocol_paused,
            SolvusError::ProtocolPaused
        );
        require!(!is_sanctioned(&ctx.accounts.owner.key()), SolvusError::AddressSanctioned);
        require!(zkusd_amount > 0, SolvusError::InvalidAmount);

        let vault = &mut ctx.accounts.vault;
        require_keys_eq!(vault.owner, ctx.accounts.owner.key(), SolvusError::Unauthorized);
        require!(
            vault.status != VaultStatus::GracePeriod as u8,
            SolvusError::BurnInGracePeriod
        );
        require!(
            vault.status == VaultStatus::Healthy as u8 || vault.status == VaultStatus::AtRisk as u8,
            SolvusError::BurnNotAllowedInCurrentState
        );
        require!(vault.zkusd_minted >= zkusd_amount, SolvusError::InsufficientBalance);

        let burn_accounts = Burn {
            mint: ctx.accounts.zkusd_mint.to_account_info(),
            from: ctx.accounts.zkusd_token_account.to_account_info(),
            authority: ctx.accounts.owner.to_account_info(),
        };
        token::burn(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), burn_accounts),
            zkusd_amount,
        )?;

        let now = Clock::get()?.unix_timestamp;
        let remaining_zkusd = vault
            .zkusd_minted
            .checked_sub(zkusd_amount)
            .ok_or(SolvusError::MathOverflow)?;

        // If burning all zkusd, skip collateral check
        if remaining_zkusd > 0 {
            // Use Pyth SDK for safe price reading with staleness check
            let btc_price = read_btc_price_1e8(
                &ctx.accounts.oracle_price_feed,
                ctx.accounts.protocol_config.oracle_max_staleness_seconds,
            )?;

            let required_collateral = required_collateral_from_price(
                remaining_zkusd,
                btc_price,
                ctx.accounts.protocol_config.collateral_ratio_bps,
            )?;

            require!(
                vault.collateral_btc >= required_collateral,
                SolvusError::InsufficientCollateral
            );
        }

        vault.zkusd_minted = remaining_zkusd;
        vault.last_update = now;
        vault.status = VaultStatus::PendingBtcRelease as u8;
        vault.dlc_close_deadline = Some(now + DLC_CLOSE_TIMEOUT);

        emit!(BurnZkUsdEvent {
            owner: ctx.accounts.owner.key(),
            amount: zkusd_amount,
            dlc_contract_id: vault.dlc_contract_id.unwrap_or([0u8; 32]),
            timestamp: now,
            recipient_btc: recipient_btc.unwrap_or([0u8; 32]),
        });

        Ok(())
    }

    pub fn claim_dlc_timeout(ctx: Context<ClaimDlcTimeout>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let vault = &mut ctx.accounts.vault;
        require_keys_eq!(vault.owner, ctx.accounts.caller.key(), SolvusError::Unauthorized);

        require!(
            vault.status == VaultStatus::PendingBtcRelease as u8,
            SolvusError::VaultNotPendingBtcRelease
        );

        let deadline = vault
            .dlc_close_deadline
            .ok_or(SolvusError::DlcDeadlineNotReached)?;
        require!(now >= deadline, SolvusError::DlcDeadlineNotReached);

        vault.status = VaultStatus::DlcTimeoutPending as u8;
        vault.last_update = now;

        emit!(DlcTimeoutClaimedEvent {
            owner: vault.owner,
            claimed_at: now,
            deadline,
        });

        Ok(())
    }

    pub fn close_dlc(ctx: Context<CloseDlc>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let vault = &mut ctx.accounts.vault;
        require_keys_eq!(vault.owner, ctx.accounts.authority.key(), SolvusError::Unauthorized);

        require!(
            vault.status == VaultStatus::PendingBtcRelease as u8
                || vault.status == VaultStatus::DlcTimeoutPending as u8,
            SolvusError::VaultNotPendingBtcRelease
        );
        require!(vault.zkusd_minted == 0, SolvusError::OutstandingDebt);

        vault.status = VaultStatus::Closed as u8;
        vault.last_update = now;
        vault.dlc_close_deadline = None;

        emit!(DlcClosedEvent {
            owner: vault.owner,
            closed_at: now,
        });

        Ok(())
    }

    pub fn enter_grace_period(ctx: Context<EnterGracePeriod>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.protocol_config.protocol_admin,
            ctx.accounts.protocol_admin.key(),
            SolvusError::Unauthorized
        );
        let now = Clock::get()?.unix_timestamp;
        let vault = &mut ctx.accounts.vault;
        require!(
            vault.status == VaultStatus::AtRisk as u8 || vault.status == VaultStatus::Unhealthy as u8,
            SolvusError::VaultNotLiquidatable
        );
        vault.status = VaultStatus::GracePeriod as u8;
        vault.grace_period_end = Some(now + GRACE_PERIOD_DURATION);
        vault.last_update = now;
        Ok(())
    }

    // ADR-007: Permissionless crank function to update vault health based on oracle price
    pub fn update_vault_health(ctx: Context<UpdateVaultHealth>) -> Result<()> {
        require!(
            !ctx.accounts.protocol_config.protocol_paused,
            SolvusError::ProtocolPaused
        );
        let vault = &mut ctx.accounts.vault;

        // Skip if vault is in terminal state
        require!(
            vault.status != VaultStatus::Liquidated as u8
                && vault.status != VaultStatus::Closed as u8,
            SolvusError::VaultInTerminalState
        );

        // Skip if vault has no debt
        if vault.zkusd_minted == 0 {
            return Ok(());
        }

        let btc_price = read_btc_price_1e8(
            &ctx.accounts.oracle_price_feed,
            ctx.accounts.protocol_config.oracle_max_staleness_seconds,
        )?;

        let required_collateral = required_collateral_from_price(
            vault.zkusd_minted,
            btc_price,
            ctx.accounts.protocol_config.collateral_ratio_bps,
        )?;
        let liquidation_collateral = scaled_collateral_threshold(
            required_collateral,
            LIQUIDATION_THRESHOLD_BPS,
            ctx.accounts.protocol_config.collateral_ratio_bps,
        )?;
        let at_risk_collateral = scaled_collateral_threshold(
            required_collateral,
            AT_RISK_THRESHOLD_BPS,
            ctx.accounts.protocol_config.collateral_ratio_bps,
        )?;

        let now = Clock::get()?.unix_timestamp;

        // Update vault status based on collateral ratio
        if vault.collateral_btc < liquidation_collateral {
            vault.status = VaultStatus::Unhealthy as u8;
        } else if vault.collateral_btc < at_risk_collateral || vault.collateral_btc < required_collateral {
            vault.status = VaultStatus::AtRisk as u8;
        } else {
            if vault.status != VaultStatus::Initialized as u8
                && vault.status != VaultStatus::PendingBtcRelease as u8
                && vault.status != VaultStatus::DlcTimeoutPending as u8
            {
                vault.status = VaultStatus::Healthy as u8;
            }
        }

        vault.last_update = now;

        emit!(VaultHealthUpdatedEvent {
            owner: vault.owner,
            collateral_btc: vault.collateral_btc,
            zkusd_minted: vault.zkusd_minted,
            required_collateral,
            btc_price,
            new_status: vault.status,
            timestamp: now,
        });

        Ok(())
    }

    pub fn liquidate_vault_cpi(
        ctx: Context<LiquidateVaultCpi>,
        collateral_seized: u64,
        liquidator_reward: u64,
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault;

        require!(
            vault.status == VaultStatus::AtRisk as u8
                || vault.status == VaultStatus::Unhealthy as u8
                || vault.status == VaultStatus::DlcTimeoutPending as u8,
            SolvusError::VaultNotLiquidatable
        );

        require_keys_eq!(
            ctx.accounts.liquidation_program.key(),
            ctx.accounts.protocol_config.liquidation_program_id,
            SolvusError::UnauthorizedLiquidator
        );

        require!(
            collateral_seized > 0 && collateral_seized <= vault.collateral_btc,
            SolvusError::InvalidLiquidationAmount
        );

        // Preemption Window: Allow liquidation 24 hours before L1 refund timelock
        let now = Clock::get()?.unix_timestamp;
        let is_in_preemption_window = now >= vault.l1_refund_timelock.saturating_sub(L1_PREEMPTION_WINDOW) 
            && now < vault.l1_refund_timelock;

        // Allow liquidation in preemption window if vault is at risk or unhealthy
        if is_in_preemption_window {
            require!(
                vault.status == VaultStatus::AtRisk as u8 
                    || vault.status == VaultStatus::Unhealthy as u8 
                    || vault.status == VaultStatus::GracePeriod as u8,
                SolvusError::VaultNotLiquidatable
            );
        }

        // Validate liquidator reward <= 10% of collateral
        let max_reward = collateral_seized
            .checked_mul(MAX_LIQUIDATOR_REWARD_BPS)
            .ok_or(SolvusError::MathOverflow)?
            .checked_div(10000)
            .ok_or(SolvusError::MathOverflow)?;
        require!(
            liquidator_reward <= max_reward,
            SolvusError::InvalidLiquidationAmount
        );

        let now = Clock::get()?.unix_timestamp;
        vault.collateral_btc = vault
            .collateral_btc
            .checked_sub(collateral_seized)
            .ok_or(SolvusError::MathOverflow)?;

        let liquidator_zkusd_account = &ctx.accounts.liquidator_zkusd_token_account;
        require_keys_eq!(
            liquidator_zkusd_account.owner,
            ctx.accounts.liquidator.key(),
            SolvusError::Unauthorized
        );
        require_keys_eq!(
            liquidator_zkusd_account.mint,
            ctx.accounts.zkusd_mint.key(),
            SolvusError::InvalidZkUsdTokenAccount
        );

        // ADR-006: Liquidator repays the vault debt in zkUSD, then the protocol burns it.
        let zkusd_to_burn = vault.zkusd_minted;
        if zkusd_to_burn > 0 {
            let burn_accounts = Burn {
                mint: ctx.accounts.zkusd_mint.to_account_info(),
                from: liquidator_zkusd_account.to_account_info(),
                authority: ctx.accounts.liquidator.to_account_info(),
            };
            token::burn(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    burn_accounts,
                ),
                zkusd_to_burn,
            )?;
        }

        vault.zkusd_minted = 0;
        vault.status = VaultStatus::Liquidated as u8;
        vault.last_update = now;

        emit!(VaultLiquidatedByProtocolEvent {
            vault_owner: vault.owner,
            liquidator: ctx.accounts.liquidator.key(),
            collateral_seized,
            liquidator_reward,
            timestamp: now,
        });

        Ok(())
    }
}

const DEVNET_SANCTIONED_ADDRESSES: &[[u8; 32]] = &[
    [
        0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11,
        0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11,
        0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11,
        0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11,
    ],
    [
        0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22,
        0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22,
        0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22,
        0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22,
    ],
    [
        0x33, 0x33, 0x33, 0x33, 0x33, 0x33, 0x33, 0x33,
        0x33, 0x33, 0x33, 0x33, 0x33, 0x33, 0x33, 0x33,
        0x33, 0x33, 0x33, 0x33, 0x33, 0x33, 0x33, 0x33,
        0x33, 0x33, 0x33, 0x33, 0x33, 0x33, 0x33, 0x33,
    ],
];

fn is_sanctioned(pubkey: &Pubkey) -> bool {
    // Devnet demo deny-list. Production should replace this with an external
    // sanctions decisioning service or an on-chain compliance oracle.
    DEVNET_SANCTIONED_ADDRESSES
        .iter()
        .any(|sanctioned| sanctioned == &pubkey.to_bytes())
}

fn read_btc_price_1e8(
    oracle_price_feed: &UncheckedAccount<'_>,
    max_staleness_seconds: u64,
) -> Result<u64> {
    let price_update = load_price_update_v2(oracle_price_feed)?;
    let clock = Clock::get()?;
    let feed_id = decode_feed_id(BTC_USD_FEED_ID)?;
    let price = price_update.get_price_no_older_than(&clock, max_staleness_seconds, &feed_id)?;
    scale_price_to_1e8(price.price, price.exponent)
}

fn load_price_update_v2(oracle_price_feed: &UncheckedAccount<'_>) -> Result<PriceUpdateV2> {
    require_keys_eq!(
        *oracle_price_feed.owner,
        PYTH_RECEIVER_PROGRAM_ID,
        SolvusError::OraclePriceFeedNotConfigured
    );
    let data = oracle_price_feed.try_borrow_data()?;
    let mut data_slice: &[u8] = &data;
    PriceUpdateV2::try_deserialize(&mut data_slice)
        .map_err(|_| error!(SolvusError::OraclePriceFeedNotConfigured))
}

fn decode_feed_id(feed_id_hex: &str) -> Result<[u8; 32]> {
    let input = feed_id_hex.strip_prefix("0x").unwrap_or(feed_id_hex);
    require!(input.len() == 64, SolvusError::OraclePriceFeedNotConfigured);

    let mut feed_id = [0u8; 32];
    for (index, chunk) in input.as_bytes().chunks(2).enumerate() {
        let hex_pair = std::str::from_utf8(chunk).map_err(|_| error!(SolvusError::OraclePriceFeedNotConfigured))?;
        feed_id[index] = u8::from_str_radix(hex_pair, 16)
            .map_err(|_| error!(SolvusError::OraclePriceFeedNotConfigured))?;
    }
    Ok(feed_id)
}

fn scale_price_to_1e8(price: i64, expo: i32) -> Result<u64> {
    require!(price > 0, SolvusError::InvalidOraclePrice);

    let adjustment = expo
        .checked_add(8)
        .ok_or(SolvusError::MathOverflow)?;
    let mut scaled = i128::from(price);

    if adjustment >= 0 {
        let factor = 10i128
            .checked_pow(adjustment as u32)
            .ok_or(SolvusError::MathOverflow)?;
        scaled = scaled
            .checked_mul(factor)
            .ok_or(SolvusError::MathOverflow)?;
    } else {
        let factor = 10i128
            .checked_pow((-adjustment) as u32)
            .ok_or(SolvusError::MathOverflow)?;
        scaled = scaled
            .checked_div(factor)
            .ok_or(SolvusError::MathOverflow)?;
    }

    u64::try_from(scaled).map_err(|_| error!(SolvusError::MathOverflow))
}

fn assert_canonical_public_inputs(
    nullifier_hash: &[u8; 32],
    public_inputs: &[u8],
    authorized_relayer_x: &[u8; 32],
    authorized_relayer_y: &[u8; 32],
    owner_pubkey: &Pubkey,
) -> Result<(u64, [u8; 32])> {
    require!(
        public_inputs.len() == GROTH16_PUBLIC_INPUT_BYTES,
        SolvusError::InvalidPublicInputs
    );

    // Verify owner binding: sol_hi (field 0) and sol_lo (field 1)
    let mut sol_hi_bytes = [0u8; 32];
    let mut sol_lo_bytes = [0u8; 32];
    sol_hi_bytes.copy_from_slice(&public_inputs[GROTH16_PUBLIC_INPUT_HEADER_BYTES..GROTH16_PUBLIC_INPUT_HEADER_BYTES + 32]);
    sol_lo_bytes.copy_from_slice(&public_inputs[GROTH16_PUBLIC_INPUT_HEADER_BYTES + 32..GROTH16_PUBLIC_INPUT_HEADER_BYTES + 64]);

    let sol_hi = u128::from_be_bytes(sol_hi_bytes[16..32].try_into().unwrap());
    let sol_lo = u128::from_be_bytes(sol_lo_bytes[16..32].try_into().unwrap());

    let owner_bytes = owner_pubkey.to_bytes();
    let expected_sol_hi = u128::from_be_bytes(owner_bytes[0..16].try_into().unwrap());
    let expected_sol_lo = u128::from_be_bytes(owner_bytes[16..32].try_into().unwrap());

    if sol_hi != expected_sol_hi || sol_lo != expected_sol_lo {
        return err!(SolvusError::Unauthorized);
    }

    let mut extracted_x = [0u8; 32];
    let mut extracted_y = [0u8; 32];
    for i in 0..32 {
        extracted_x[i] = public_inputs[GROTH16_PUBLIC_INPUT_HEADER_BYTES + 64 + i * 32 + 31];
        extracted_y[i] = public_inputs[GROTH16_PUBLIC_INPUT_HEADER_BYTES + 64 + 1024 + i * 32 + 31];
    }
    require!(
        &extracted_x == authorized_relayer_x && &extracted_y == authorized_relayer_y,
        SolvusError::UnauthorizedRelayer
    );

    let public_input_count = u32::from_be_bytes(
        public_inputs[0..4]
            .try_into()
            .map_err(|_| error!(SolvusError::InvalidPublicInputs))?,
    );
    let private_input_count = u32::from_be_bytes(
        public_inputs[4..8]
            .try_into()
            .map_err(|_| error!(SolvusError::InvalidPublicInputs))?,
    );
    let entry_count = u32::from_be_bytes(
        public_inputs[8..12]
            .try_into()
            .map_err(|_| error!(SolvusError::InvalidPublicInputs))?,
    );
    require!(
        public_input_count as usize == GROTH16_PUBLIC_INPUT_FIELD_COUNT,
        SolvusError::InvalidPublicInputs
    );
    require!(private_input_count == 0, SolvusError::InvalidPublicInputs);
    require!(entry_count == public_input_count, SolvusError::InvalidPublicInputs);

    let nullifier_start = GROTH16_PUBLIC_INPUT_HEADER_BYTES + 67 * 32;
    let nullifier_end = nullifier_start + 32;
    require!(
        &public_inputs[nullifier_start..nullifier_end] == nullifier_hash.as_ref(),
        SolvusError::PublicInputsNullifierMismatch
    );

    // Extract dlc_contract_id (Field at index 66, before nullifier_hash)
    let dlc_contract_id_start = GROTH16_PUBLIC_INPUT_HEADER_BYTES + 66 * 32;
    let mut dlc_contract_id = [0u8; 32];
    dlc_contract_id.copy_from_slice(&public_inputs[dlc_contract_id_start..dlc_contract_id_start + 32]);

    // Extract btc_data (last 8 bytes, at index 68)
    let mut btc_data_bytes = [0u8; 8];
    btc_data_bytes.copy_from_slice(
        &public_inputs[(GROTH16_PUBLIC_INPUT_BYTES - 8)..GROTH16_PUBLIC_INPUT_BYTES],
    );
    let btc_data = u64::from_be_bytes(btc_data_bytes);

    Ok((btc_data, dlc_contract_id))
}

fn verify_groth16_proof(
    verifier_program: &AccountInfo<'_>,
    proof: &[u8],
    public_inputs: &[u8],
) -> Result<()> {
    require!(
        verifier_program.key() != Pubkey::default(),
        SolvusError::VerifierProgramNotConfigured
    );

    let mut instruction_data = Vec::with_capacity(proof.len() + public_inputs.len());
    instruction_data.extend_from_slice(&proof);
    instruction_data.extend_from_slice(&public_inputs);

    let instruction = Instruction {
        program_id: verifier_program.key(),
        accounts: vec![],
        data: instruction_data,
    };

    invoke(&instruction, &[verifier_program.clone()])
        .map_err(|_| error!(SolvusError::InvalidProof))
}

fn load_or_initialize_vault<'info>(
    vault_info: &UncheckedAccount<'info>,
    owner: &Signer<'info>,
    fee_payer: &Signer<'info>,
    system_program: &Program<'info, System>,
    vault_bump: u8,
) -> Result<VaultState> {
    let vault_exists = vault_info.owner == &crate::ID && vault_info.data_len() > 0;
    if !vault_exists {
        let rent = Rent::get()?;
        let lamports = rent.minimum_balance(8 + VaultState::LEN);
        let owner_key = owner.key();
        let signer_seeds: &[&[u8]] = &[VAULT_SEED, owner_key.as_ref(), &[vault_bump]];
        let signer_seed_slices = [signer_seeds];
        let create_account_ctx = CpiContext::new(
            system_program.to_account_info(),
            CreateAccount {
                from: fee_payer.to_account_info(),
                to: vault_info.to_account_info(),
            },
        )
        .with_signer(&signer_seed_slices);
        system_program::create_account(
            create_account_ctx,
            lamports,
            (8 + VaultState::LEN) as u64,
            &crate::ID,
        )?;

        let vault = VaultState::default();
        store_vault_state(vault_info, &vault)?;
        return Ok(vault);
    }

    require_keys_eq!(*vault_info.owner, crate::ID, SolvusError::InvalidVaultAccount);
    require!(
        vault_info.data_len() >= VAULT_ACCOUNT_MIN_SPACE,
        SolvusError::InvalidVaultAccount
    );

    let data = vault_info.try_borrow_data()?;
    let mut data_slice: &[u8] = &data;
    VaultState::try_deserialize(&mut data_slice).map_err(Into::into)
}

fn store_vault_state(vault_info: &UncheckedAccount<'_>, vault: &VaultState) -> Result<()> {
    require_keys_eq!(*vault_info.owner, crate::ID, SolvusError::InvalidVaultAccount);
    let mut data = vault_info.try_borrow_mut_data()?;
    let mut data_slice: &mut [u8] = &mut data;
    vault.try_serialize(&mut data_slice)?;
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum VerificationLevel {
    Partial { num_signatures: u8 },
    Full,
}

impl VerificationLevel {
    fn gte(&self, other: VerificationLevel) -> bool {
        match self {
            VerificationLevel::Full => true,
            VerificationLevel::Partial { num_signatures } => match other {
                VerificationLevel::Full => false,
                VerificationLevel::Partial {
                    num_signatures: other_num_signatures,
                } => *num_signatures >= other_num_signatures,
            },
        }
    }
}

#[account]
pub struct PriceUpdateV2 {
    pub write_authority: Pubkey,
    pub verification_level: VerificationLevel,
    pub price_message: PriceFeedMessage,
    pub posted_slot: u64,
}

#[derive(Clone, Copy)]
pub struct Price {
    pub price: i64,
    pub exponent: i32,
    pub publish_time: i64,
}

impl PriceUpdateV2 {
    fn get_price_no_older_than(
        &self,
        clock: &Clock,
        maximum_age: u64,
        feed_id: &[u8; 32],
    ) -> Result<Price> {
        require!(
            self.verification_level.gte(VerificationLevel::Full),
            SolvusError::OraclePriceFeedNotConfigured
        );
        require!(
            self.price_message.feed_id == *feed_id,
            SolvusError::OraclePriceFeedNotConfigured
        );
        require!(
            self.price_message
                .publish_time
                .saturating_add(maximum_age as i64)
                >= clock.unix_timestamp,
            SolvusError::StaleOraclePrice
        );
        Ok(Price {
            price: self.price_message.price,
            exponent: self.price_message.exponent,
            publish_time: self.price_message.publish_time,
        })
    }
}

#[derive(Accounts)]
pub struct InitializeProtocolConfig<'info> {
    #[account(mut)]
    pub protocol_admin: Signer<'info>,
    #[account(
        init,
        payer = protocol_admin,
        space = 8 + ProtocolConfig::LEN,
        seeds = [PROTOCOL_CONFIG_SEED],
        bump
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateProtocolConfig<'info> {
    #[account(mut)]
    pub protocol_admin: Signer<'info>,
    /// CHECK: Deserialized manually to support current-format updates.
    #[account(mut, seeds = [PROTOCOL_CONFIG_SEED], bump)]
    pub protocol_config: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct MigrateProtocolConfig<'info> {
    #[account(mut)]
    pub protocol_admin: Signer<'info>,
    /// CHECK: Deserialized manually to migrate legacy ProtocolConfig layouts.
    #[account(mut, seeds = [PROTOCOL_CONFIG_SEED], bump)]
    pub protocol_config: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SetProtocolPause<'info> {
    #[account(mut)]
    pub protocol_admin: Signer<'info>,
    #[account(mut, seeds = [PROTOCOL_CONFIG_SEED], bump)]
    pub protocol_config: Account<'info, ProtocolConfig>,
}

#[derive(Accounts)]
#[instruction(institution_id_hash: [u8; 32])]
pub struct UpsertInstitution<'info> {
    #[account(mut)]
    pub compliance_admin: Signer<'info>,
    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump)]
    pub protocol_config: Account<'info, ProtocolConfig>,
    #[account(
        init_if_needed,
        payer = compliance_admin,
        space = 8 + InstitutionAccount::LEN,
        seeds = [INSTITUTION_ACCOUNT_SEED, institution_id_hash.as_ref()],
        bump
    )]
    pub institution_account: Account<'info, InstitutionAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(institution_id_hash: [u8; 32], nullifier_hash: [u8; 32])]
pub struct IssueCompliancePermit<'info> {
    #[account(mut)]
    pub compliance_admin: Signer<'info>,
    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump)]
    pub protocol_config: Account<'info, ProtocolConfig>,
    #[account(seeds = [INSTITUTION_ACCOUNT_SEED, institution_id_hash.as_ref()], bump)]
    pub institution_account: Account<'info, InstitutionAccount>,
    #[account(
        init,
        payer = compliance_admin,
        space = 8 + CompliancePermit::LEN,
        seeds = [COMPLIANCE_PERMIT_SEED, institution_id_hash.as_ref(), nullifier_hash.as_ref()],
        bump
    )]
    pub compliance_permit: Account<'info, CompliancePermit>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(institution_id_hash: [u8; 32])]
pub struct SetInstitutionStatus<'info> {
    #[account(mut)]
    pub compliance_admin: Signer<'info>,
    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump)]
    pub protocol_config: Account<'info, ProtocolConfig>,
    #[account(mut, seeds = [INSTITUTION_ACCOUNT_SEED, institution_id_hash.as_ref()], bump)]
    pub institution_account: Account<'info, InstitutionAccount>,
}

#[derive(Accounts)]
#[instruction(institution_id_hash: [u8; 32], nullifier_hash: [u8; 32])]
pub struct RevokeCompliancePermit<'info> {
    #[account(mut)]
    pub compliance_admin: Signer<'info>,
    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump)]
    pub protocol_config: Account<'info, ProtocolConfig>,
    #[account(seeds = [INSTITUTION_ACCOUNT_SEED, institution_id_hash.as_ref()], bump)]
    pub institution_account: Account<'info, InstitutionAccount>,
    #[account(
        mut,
        seeds = [COMPLIANCE_PERMIT_SEED, institution_id_hash.as_ref(), nullifier_hash.as_ref()],
        bump
    )]
    pub compliance_permit: Account<'info, CompliancePermit>,
}

#[derive(Accounts)]
#[instruction(nullifier_hash: [u8; 32], zkusd_amount: u64)]
pub struct MintZkUsd<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut)]
    pub fee_payer: Signer<'info>,
    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump)]
    pub protocol_config: Account<'info, ProtocolConfig>,
    #[account(mut)]
    pub institution_account: Account<'info, InstitutionAccount>,
    #[account(mut)]
    pub compliance_permit: Account<'info, CompliancePermit>,
    /// CHECK: Receiver-program ownership and PriceUpdateV2 layout are validated manually.
    #[account(address = protocol_config.oracle_price_feed_id)]
    pub oracle_price_feed: UncheckedAccount<'info>,
    /// CHECK: PDA ownership, size, and serialization are validated manually so
    /// existing oversized vault accounts remain usable across upgrades.
    #[account(mut, seeds = [VAULT_SEED, owner.key().as_ref()], bump)]
    pub vault: UncheckedAccount<'info>,
    #[account(
        init,
        payer = fee_payer,
        space = 8 + NullifierAccount::LEN,
        seeds = [PDA_NULLIFIER_SEED, nullifier_hash.as_ref()],
        bump
    )]
    pub nullifier_account: Account<'info, NullifierAccount>,
    #[account(
        mut,
        close = fee_payer,
        seeds = [VERIFICATION_PAYLOAD_SEED, nullifier_hash.as_ref()],
        bump
    )]
    pub verification_payload: Account<'info, VerificationPayload>,
    #[account(mut)]
    pub zkusd_mint: Account<'info, Mint>,
    #[account(mut)]
    pub zkusd_token_account: Account<'info, TokenAccount>,
    #[account(seeds = [ZKUSD_MINT_AUTHORITY_SEED], bump)]
    pub mint_authority: UncheckedAccount<'info>,
    /// CHECK: verifier account is validated by program id at runtime.
    pub verifier_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(nullifier_hash: [u8; 32], max_proof_len: u32, max_public_inputs_len: u32)]
pub struct InitializeVerificationPayload<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + VerificationPayload::base_len()
            + max_proof_len as usize
            + max_public_inputs_len as usize,
        seeds = [VERIFICATION_PAYLOAD_SEED, nullifier_hash.as_ref()],
        bump
    )]
    pub verification_payload: Account<'info, VerificationPayload>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AppendVerificationPayloadChunk<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority)]
    pub verification_payload: Account<'info, VerificationPayload>,
}

#[derive(Accounts)]
pub struct BurnZkUsd<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [VAULT_SEED, owner.key().as_ref()], bump)]
    pub vault: Account<'info, VaultState>,
    #[account(mut)]
    pub zkusd_mint: Account<'info, Mint>,
    #[account(mut)]
    pub zkusd_token_account: Account<'info, TokenAccount>,
    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump)]
    pub protocol_config: Account<'info, ProtocolConfig>,
    /// CHECK: Receiver-program ownership and PriceUpdateV2 layout are validated manually.
    #[account(address = protocol_config.oracle_price_feed_id)]
    pub oracle_price_feed: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimDlcTimeout<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(mut, seeds = [VAULT_SEED, caller.key().as_ref()], bump)]
    pub vault: Account<'info, VaultState>,
}

#[derive(Accounts)]
pub struct CloseDlc<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [VAULT_SEED, authority.key().as_ref()], bump)]
    pub vault: Account<'info, VaultState>,
}

#[derive(Accounts)]
pub struct EnterGracePeriod<'info> {
    #[account(mut)]
    pub protocol_admin: Signer<'info>,
    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump)]
    pub protocol_config: Account<'info, ProtocolConfig>,
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
}

// ADR-007: Context for permissionless crank function
#[derive(Accounts)]
pub struct UpdateVaultHealth<'info> {
    /// CHECK: Any account can trigger the crank
    pub caller: Signer<'info>,
    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump)]
    pub protocol_config: Account<'info, ProtocolConfig>,
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    /// CHECK: Receiver-program ownership and PriceUpdateV2 layout are validated manually.
    #[account(address = protocol_config.oracle_price_feed_id)]
    pub oracle_price_feed: UncheckedAccount<'info>,
}

#[event]
pub struct VaultHealthUpdatedEvent {
    pub owner: Pubkey,
    pub collateral_btc: u64,
    pub zkusd_minted: u64,
    pub required_collateral: u64,
    pub btc_price: u64,
    pub new_status: u8,
    pub timestamp: i64,
}

#[derive(Accounts)]
pub struct LiquidateVaultCpi<'info> {
    #[account(mut)]
    pub liquidator: Signer<'info>,
    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump)]
    pub protocol_config: Account<'info, ProtocolConfig>,
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    /// CHECK: validated against protocol_config.liquidation_program_id
    pub liquidation_program: UncheckedAccount<'info>,
    // ADR-006: Liquidator repays debt in zkUSD, then the protocol burns it.
    pub token_program: Program<'info, Token>,
    #[account(mut)]
    pub zkusd_mint: Account<'info, Mint>,
    #[account(mut)]
    pub liquidator_zkusd_token_account: Account<'info, TokenAccount>,
}

#[account]
pub struct NullifierAccount {
    pub owner: Pubkey,
    pub nullifier_hash: [u8; 32],
    pub created_at: i64,
}

impl NullifierAccount {
    pub const LEN: usize = 32 + 32 + 8;
}

#[account]
pub struct ProtocolConfig {
    pub protocol_admin: Pubkey,
    pub compliance_admin: Pubkey,
    pub groth16_verifier_program_id: Pubkey,
    pub oracle_price_feed_id: Pubkey,
    pub liquidation_program_id: Pubkey,
    pub authorized_relayer_pubkey_x: [u8; 32],
    pub authorized_relayer_pubkey_y: [u8; 32],
    pub collateral_ratio_bps: u64,
    pub oracle_max_staleness_seconds: u64,
    pub protocol_paused: bool,
    pub updated_at: i64,
}

impl ProtocolConfig {
    pub const LEN: usize = 32 + 32 + 32 + 32 + 32 + 32 + 32 + 8 + 8 + 1 + 8;
}

#[account]
pub struct VerificationPayload {
    pub authority: Pubkey,
    pub nullifier_hash: [u8; 32],
    pub max_proof_len: u32,
    pub max_public_inputs_len: u32,
    pub proof: Vec<u8>,
    pub public_inputs: Vec<u8>,
}

impl VerificationPayload {
    pub const fn base_len() -> usize {
        32 + 32 + 4 + 4 + 4 + 4
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct LegacyProtocolConfigV1 {
    pub admin: Pubkey,
    pub groth16_verifier_program_id: Pubkey,
    pub oracle_price_feed_id: Pubkey,
    pub updated_at: i64,
}

impl LegacyProtocolConfigV1 {
    pub const LEN: usize = 32 + 32 + 32 + 8;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct LegacyProtocolConfigV2 {
    pub admin: Pubkey,
    pub groth16_verifier_program_id: Pubkey,
    pub oracle_price_feed_id: Pubkey,
    pub liquidation_program_id: Pubkey,
    pub authorized_relayer_pubkey_x: [u8; 32],
    pub authorized_relayer_pubkey_y: [u8; 32],
    pub updated_at: i64,
}

impl LegacyProtocolConfigV2 {
    pub const LEN: usize = 32 + 32 + 32 + 32 + 32 + 32 + 8;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct LegacyProtocolConfigV3 {
    pub admin: Pubkey,
    pub groth16_verifier_program_id: Pubkey,
    pub oracle_price_feed_id: Pubkey,
    pub liquidation_program_id: Pubkey,
    pub authorized_relayer_pubkey_x: [u8; 32],
    pub authorized_relayer_pubkey_y: [u8; 32],
    pub collateral_ratio_bps: u64,
    pub updated_at: i64,
}

impl LegacyProtocolConfigV3 {
    pub const LEN: usize = 32 + 32 + 32 + 32 + 32 + 32 + 8 + 8;
}

#[account]
pub struct InstitutionAccount {
    pub institution_id_hash: [u8; 32],
    pub approved_operator: Pubkey,
    pub status: u8,
    pub risk_tier: u8,
    pub daily_mint_cap: u64,
    pub lifetime_mint_cap: u64,
    pub minted_total: u64,
    pub current_period_start: i64,
    pub current_period_minted: u64,
    pub kyb_ref_hash: [u8; 32],
    pub travel_rule_required: bool,
    pub updated_at: i64,
}

impl InstitutionAccount {
    pub const LEN: usize = 32 + 32 + 1 + 1 + 8 + 8 + 8 + 8 + 8 + 32 + 1 + 8;
}

#[account]
pub struct CompliancePermit {
    pub institution_id_hash: [u8; 32],
    pub operator: Pubkey,
    pub nullifier_hash: [u8; 32],
    pub max_amount: u64,
    pub expires_at: i64,
    pub kyt_score: u16,
    pub kyb_ref_hash: [u8; 32],
    pub travel_rule_ref_hash: [u8; 32],
    pub issued_by: Pubkey,
    pub issued_at: i64,
    // 0 = unused, positive = consumed at unix timestamp, negative = revoked at unix timestamp.
    pub used_at: i64,
}

impl CompliancePermit {
    pub const LEN: usize = 32 + 32 + 32 + 8 + 8 + 2 + 32 + 32 + 32 + 8 + 8;
}

#[account]
pub struct VaultState {
    pub owner: Pubkey,
    pub collateral_btc: u64,
    pub zkusd_minted: u64,
    pub last_update: i64,
    pub status: u8,
    pub liquidation_price: Option<u64>,
    pub grace_period_end: Option<i64>,
    pub dlc_contract_id: Option<[u8; 32]>,
    pub dlc_close_deadline: Option<i64>,
    pub l1_refund_timelock: i64, // Bitcoin L1 refund timelock timestamp
}

impl VaultState {
    pub const MIN_LEN: usize = 32 + 8 + 8 + 8 + 1 + 9 + 9 + 33 + 9 + 8;
    pub const LEN: usize = 176; // Matches the deployed vault allocation on devnet.
}

impl Default for VaultState {
    fn default() -> Self {
        Self {
            owner: Pubkey::default(),
            collateral_btc: 0,
            zkusd_minted: 0,
            last_update: 0,
            status: VaultStatus::Initialized as u8,
            liquidation_price: None,
            grace_period_end: None,
            dlc_contract_id: None,
            dlc_close_deadline: None,
            l1_refund_timelock: 0,
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum VaultStatus {
    Initialized = 0,
    Healthy = 1,
    AtRisk = 2,
    Unhealthy = 3,
    GracePeriod = 4,
    Liquidated = 5,
    Closed = 6,
    PendingBtcRelease = 7,
    DlcTimeoutPending = 8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum InstitutionStatus {
    Uninitialized = 0,
    Active = 1,
    Suspended = 2,
    Terminated = 3,
}

#[event]
pub struct MintZkUsdEvent {
    pub owner: Pubkey,
    pub nullifier_hash: [u8; 32],
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct BurnZkUsdEvent {
    pub owner: Pubkey,
    pub amount: u64,
    pub dlc_contract_id: [u8; 32],
    pub timestamp: i64,
    pub recipient_btc: [u8; 32],
}

#[event]
pub struct DlcTimeoutClaimedEvent {
    pub owner: Pubkey,
    pub claimed_at: i64,
    pub deadline: i64,
}

#[event]
pub struct DlcClosedEvent {
    pub owner: Pubkey,
    pub closed_at: i64,
}

#[event]
pub struct InstitutionUpsertedEvent {
    pub institution_id_hash: [u8; 32],
    pub approved_operator: Pubkey,
    pub risk_tier: u8,
    pub daily_mint_cap: u64,
    pub lifetime_mint_cap: u64,
    pub kyb_ref_hash: [u8; 32],
    pub travel_rule_required: bool,
    pub timestamp: i64,
}

#[event]
pub struct CompliancePermitIssuedEvent {
    pub institution_id_hash: [u8; 32],
    pub operator: Pubkey,
    pub nullifier_hash: [u8; 32],
    pub max_amount: u64,
    pub expires_at: i64,
    pub kyt_score: u16,
    pub travel_rule_ref_hash: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct InstitutionalMintAuthorizedEvent {
    pub institution_id_hash: [u8; 32],
    pub operator: Pubkey,
    pub nullifier_hash: [u8; 32],
    pub amount: u64,
    pub kyt_score: u16,
    pub travel_rule_ref_hash: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct InstitutionStatusChangedEvent {
    pub institution_id_hash: [u8; 32],
    pub status: u8,
    pub timestamp: i64,
}

#[event]
pub struct CompliancePermitRevokedEvent {
    pub institution_id_hash: [u8; 32],
    pub nullifier_hash: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct ProtocolConfigUpdatedEvent {
    pub protocol_admin: Pubkey,
    pub compliance_admin: Pubkey,
    pub groth16_verifier_program_id: Pubkey,
    pub oracle_price_feed_id: Pubkey,
    pub liquidation_program_id: Pubkey,
    pub collateral_ratio_bps: u64,
    pub oracle_max_staleness_seconds: u64,
    pub protocol_paused: bool,
    pub updated_at: i64,
    pub authorized_relayer_pubkey_x: [u8; 32],
    pub authorized_relayer_pubkey_y: [u8; 32],
}

#[event]
pub struct ProtocolPauseChangedEvent {
    pub protocol_admin: Pubkey,
    pub paused: bool,
    pub updated_at: i64,
}

#[event]
pub struct ProtocolConfigMigratedEvent {
    pub legacy_data_len: u32,
    pub protocol_admin: Pubkey,
    pub compliance_admin: Pubkey,
    pub updated_at: i64,
}

#[event]
pub struct VaultLiquidatedByProtocolEvent {
    pub vault_owner: Pubkey,
    pub liquidator: Pubkey,
    pub collateral_seized: u64,
    pub liquidator_reward: u64,
    pub timestamp: i64,
}

#[error_code]
pub enum SolvusError {
    #[msg("Invalid ZK proof: verification failed")]
    InvalidProof,
    #[msg("Invalid public_inputs: expected canonical Groth16 byte layout")]
    InvalidPublicInputs,
    #[msg("public_inputs do not bind the provided nullifier_hash")]
    PublicInputsNullifierMismatch,
    #[msg("Invalid token program")]
    InvalidTokenProgram,
    #[msg("Invalid zkUSD token account for liquidation")]
    InvalidZkUsdTokenAccount,
    #[msg("Invalid verifier program")]
    InvalidVerifierProgram,
    #[msg("Verifier program is not configured")]
    VerifierProgramNotConfigured,
    #[msg("Oracle price feed is not configured")]
    OraclePriceFeedNotConfigured,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Insufficient balance")]
    InsufficientBalance,
    #[msg("Cannot burn zkUSD while vault is in grace period")]
    BurnInGracePeriod,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Burn is not allowed in the current vault state")]
    BurnNotAllowedInCurrentState,
    #[msg("Vault is not in PendingBtcRelease state")]
    VaultNotPendingBtcRelease,
    #[msg("DLC close deadline not reached")]
    DlcDeadlineNotReached,
    #[msg("Outstanding zkUSD debt remains")]
    OutstandingDebt,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Relayer public key is not authorized by protocol config")]
    UnauthorizedRelayer,
    #[msg("Insufficient BTC collateral for requested sum")]
    InsufficientCollateral,
    #[msg("Vault is not in a liquidatable state")]
    VaultNotLiquidatable,
    #[msg("Caller is not an authorized liquidator")]
    UnauthorizedLiquidator,
    #[msg("Liquidation amount exceeds collateral")]
    InvalidLiquidationAmount,
    #[msg("Address is sanctioned")]
    AddressSanctioned,
    #[msg("Invalid oracle price")]
    InvalidOraclePrice,
    #[msg("Oracle price is stale")]
    StaleOraclePrice,
    #[msg("Vault is healthy, cannot liquidate")]
    VaultHealthy,
    #[msg("Vault already liquidated")]
    AlreadyLiquidated,
    #[msg("Invalid Bitcoin address")]
    InvalidBtcAddress,
    #[msg("Relayer signature invalid or expired")]
    RelayerSignatureInvalid,
    #[msg("Oracle price is stale")]
    OraclePriceStale,
    #[msg("Oracle prices diverge too much")]
    OraclePriceDivergence,
    #[msg("BTC address is already locked in an active DLC")]
    BtcAlreadyLockedInDlc,
    #[msg("Vault is in terminal state and cannot accept new operations")]
    VaultInTerminalState,
    #[msg("Vault is not in PendingBtcRelease state")]
    VaultNotPendingBtcReleaseAlt,
    #[msg("Proof generation timed out")]
    ProofServerTimeout,
    #[msg("Invalid protocol config account")]
    InvalidProtocolConfig,
    #[msg("Invalid verification payload account")]
    InvalidVerificationPayload,
    #[msg("Invalid vault account")]
    InvalidVaultAccount,
    #[msg("Invalid institution account")]
    InvalidInstitutionAccount,
    #[msg("Institution is not active")]
    InstitutionInactive,
    #[msg("Minting operator is not approved for this institution")]
    OperatorNotApproved,
    #[msg("Institution mint cap exceeded")]
    InstitutionMintCapExceeded,
    #[msg("Invalid compliance permit")]
    InvalidCompliancePermit,
    #[msg("Compliance permit has expired")]
    CompliancePermitExpired,
    #[msg("Compliance permit has already been consumed")]
    CompliancePermitAlreadyUsed,
    #[msg("Requested amount exceeds the compliance permit")]
    CompliancePermitAmountExceeded,
    #[msg("Travel Rule reference is required")]
    TravelRuleRequired,
    #[msg("Invalid institution status")]
    InvalidInstitutionStatus,
    #[msg("Compliance permit has been revoked")]
    CompliancePermitRevoked,
    #[msg("Collateral ratio is below the minimum allowed value")]
    InvalidCollateralRatio,
    #[msg("Oracle staleness threshold is below the minimum allowed value")]
    InvalidOracleStaleness,
    #[msg("Protocol is paused")]
    ProtocolPaused,
    #[msg("Legacy protocol config must use migrate_protocol_config")]
    ProtocolConfigMigrationRequired,
    #[msg("Protocol config is already in the current format")]
    ProtocolConfigAlreadyMigrated,
    #[msg("Institution is in a terminal state")]
    InstitutionInTerminalState,
}

fn authorize_permissioned_mint(
    institution: &mut Account<'_, InstitutionAccount>,
    compliance_permit: &mut Account<'_, CompliancePermit>,
    institution_key: Pubkey,
    permit_key: Pubkey,
    owner: Pubkey,
    nullifier_hash: [u8; 32],
    zkusd_amount: u64,
    now: i64,
) -> Result<()> {
    require!(
        institution.status == InstitutionStatus::Active as u8,
        SolvusError::InstitutionInactive
    );
    require_keys_eq!(
        institution.approved_operator,
        owner,
        SolvusError::OperatorNotApproved
    );

    let (expected_institution_pda, _) = Pubkey::find_program_address(
        &[INSTITUTION_ACCOUNT_SEED, institution.institution_id_hash.as_ref()],
        &crate::ID,
    );
    require_keys_eq!(
        expected_institution_pda,
        institution_key,
        SolvusError::InvalidInstitutionAccount
    );

    let (expected_permit_pda, _) = Pubkey::find_program_address(
        &[
            COMPLIANCE_PERMIT_SEED,
            institution.institution_id_hash.as_ref(),
            nullifier_hash.as_ref(),
        ],
        &crate::ID,
    );
    require_keys_eq!(
        expected_permit_pda,
        permit_key,
        SolvusError::InvalidCompliancePermit
    );
    require!(
        compliance_permit.institution_id_hash == institution.institution_id_hash,
        SolvusError::InvalidCompliancePermit
    );
    require!(
        compliance_permit.nullifier_hash == nullifier_hash,
        SolvusError::InvalidCompliancePermit
    );
    require_keys_eq!(
        compliance_permit.operator,
        owner,
        SolvusError::OperatorNotApproved
    );
    require!(
        compliance_permit.kyb_ref_hash == institution.kyb_ref_hash,
        SolvusError::InvalidCompliancePermit
    );
    if institution.travel_rule_required {
        require!(
            compliance_permit.travel_rule_ref_hash != [0u8; 32],
            SolvusError::TravelRuleRequired
        );
    }
    require!(
        compliance_permit.used_at >= 0,
        SolvusError::CompliancePermitRevoked
    );
    require!(
        compliance_permit.used_at == 0,
        SolvusError::CompliancePermitAlreadyUsed
    );
    require!(
        compliance_permit.expires_at >= now,
        SolvusError::CompliancePermitExpired
    );
    require!(
        compliance_permit.max_amount >= zkusd_amount,
        SolvusError::CompliancePermitAmountExceeded
    );

    if institution.current_period_start == 0
        || now.saturating_sub(institution.current_period_start) >= INSTITUTION_MINT_WINDOW_SECONDS
    {
        institution.current_period_start = now;
        institution.current_period_minted = 0;
    }

    institution.current_period_minted = institution
        .current_period_minted
        .checked_add(zkusd_amount)
        .ok_or(SolvusError::MathOverflow)?;
    institution.minted_total = institution
        .minted_total
        .checked_add(zkusd_amount)
        .ok_or(SolvusError::MathOverflow)?;
    require!(
        institution.current_period_minted <= institution.daily_mint_cap,
        SolvusError::InstitutionMintCapExceeded
    );
    require!(
        institution.minted_total <= institution.lifetime_mint_cap,
        SolvusError::InstitutionMintCapExceeded
    );

    institution.updated_at = now;
    compliance_permit.used_at = now;
    Ok(())
}

fn load_protocol_config_roles(protocol_config_info: &AccountInfo<'_>) -> Result<(Pubkey, Pubkey, bool)> {
    let data = protocol_config_info.try_borrow_data()?;
    require!(data.len() >= 8, SolvusError::InvalidProtocolConfig);
    require!(
        &data[..8] == ProtocolConfig::DISCRIMINATOR,
        SolvusError::InvalidProtocolConfig
    );

    let mut payload: &[u8] = &data[8..];
    if data.len() == 8 + ProtocolConfig::LEN {
        let config = ProtocolConfig::deserialize(&mut payload)?;
        Ok((config.protocol_admin, config.compliance_admin, config.protocol_paused))
    } else if data.len() == 8 + LegacyProtocolConfigV3::LEN {
        let config = LegacyProtocolConfigV3::deserialize(&mut payload)?;
        Ok((config.admin, config.admin, false))
    } else if data.len() == 8 + LegacyProtocolConfigV2::LEN {
        let config = LegacyProtocolConfigV2::deserialize(&mut payload)?;
        Ok((config.admin, config.admin, false))
    } else if data.len() == 8 + LegacyProtocolConfigV1::LEN {
        let config = LegacyProtocolConfigV1::deserialize(&mut payload)?;
        Ok((config.admin, config.admin, false))
    } else {
        err!(SolvusError::InvalidProtocolConfig)
    }
}

fn store_protocol_config(protocol_config_info: &AccountInfo<'_>, config: &ProtocolConfig) -> Result<()> {
    let mut data = protocol_config_info.try_borrow_mut_data()?;
    require!(
        data.len() == 8 + ProtocolConfig::LEN,
        SolvusError::InvalidProtocolConfig
    );
    data[..8].copy_from_slice(&ProtocolConfig::DISCRIMINATOR);
    let mut payload = &mut data[8..];
    config.serialize(&mut payload)?;
    Ok(())
}

fn required_collateral_from_price(
    zkusd_amount: u64,
    btc_price: u64,
    collateral_ratio_bps: u64,
) -> Result<u64> {
    require!(
        collateral_ratio_bps >= DEFAULT_COLLATERAL_RATIO_BPS,
        SolvusError::InvalidCollateralRatio
    );

    let numerator = (zkusd_amount as u128)
        .checked_mul(collateral_ratio_bps as u128)
        .ok_or(SolvusError::MathOverflow)?
        .checked_mul(COLLATERAL_RATIO_PRECISION)
        .ok_or(SolvusError::MathOverflow)?;
    let denominator = (btc_price as u128)
        .checked_mul(BPS_DENOMINATOR)
        .ok_or(SolvusError::MathOverflow)?;

    let value = numerator
        .checked_div(denominator)
        .ok_or(SolvusError::MathOverflow)?;
    u64::try_from(value).map_err(|_| error!(SolvusError::MathOverflow))
}

fn scaled_collateral_threshold(
    required_collateral: u64,
    threshold_bps: u64,
    collateral_ratio_bps: u64,
) -> Result<u64> {
    let value = (required_collateral as u128)
        .checked_mul(threshold_bps as u128)
        .ok_or(SolvusError::MathOverflow)?
        .checked_div(collateral_ratio_bps as u128)
        .ok_or(SolvusError::MathOverflow)?;
    u64::try_from(value).map_err(|_| error!(SolvusError::MathOverflow))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scaled_collateral_threshold_uses_bps_relative_to_target_ratio() {
        let required_collateral = 230_769u64;

        let liquidation = scaled_collateral_threshold(
            required_collateral,
            LIQUIDATION_THRESHOLD_BPS,
            DEFAULT_COLLATERAL_RATIO_BPS,
        )
        .expect("liquidation threshold");
        let at_risk = scaled_collateral_threshold(
            required_collateral,
            AT_RISK_THRESHOLD_BPS,
            DEFAULT_COLLATERAL_RATIO_BPS,
        )
        .expect("at-risk threshold");

        assert_eq!(liquidation, 184_615);
        assert_eq!(at_risk, 199_999);
        assert!(liquidation < at_risk);
        assert!(at_risk < required_collateral);
    }

    #[test]
    fn revocation_timestamp_is_strictly_negative_even_at_epoch() {
        let now = 0i64;
        let revoked = -std::cmp::max(now, 1);

        assert_eq!(revoked, -1);
        assert!(revoked < 0);
    }
}
