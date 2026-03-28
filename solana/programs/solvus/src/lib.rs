use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::solana_program::program::invoke;
use anchor_lang::solana_program::pubkey;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount};
use pyth_sdk_solana::{load_price_feed_from_account_info, PriceFeed, PriceStatus};

declare_id!("Cik3PiifeUrKrWcAFsHM5R7ckQVkWAc9M9THrXVfanVR");

const ZKUSD_MINT_AUTHORITY_SEED: &[u8] = b"zkusd_mint_authority";
const PDA_NULLIFIER_SEED: &[u8] = b"nullifier_account";
const PROTOCOL_CONFIG_SEED: &[u8] = b"protocol_config";
const VAULT_SEED: &[u8] = b"vault";
const DLC_CLOSE_TIMEOUT: i64 = 3600;
const GRACE_PERIOD_DURATION: i64 = 3600;
const L1_PREEMPTION_WINDOW: i64 = 86400;
const MAX_MINT_ZKUSD_AMOUNT: u64 = 1_000_000_000;
const MAX_LIQUIDATOR_REWARD_BPS: u64 = 1000;
const SPL_TOKEN_PROGRAM_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const GROTH16_PUBLIC_INPUT_FIELD_COUNT: usize = 69;
const GROTH16_PUBLIC_INPUT_HEADER_BYTES: usize = 12;
const GROTH16_PUBLIC_INPUT_BYTES: usize =
    GROTH16_PUBLIC_INPUT_HEADER_BYTES + GROTH16_PUBLIC_INPUT_FIELD_COUNT * 32;
const PYTH_STALENESS_SECONDS: i64 = 60;

#[program]
pub mod solvus {
    use super::*;

    pub fn initialize_protocol_config(
        ctx: Context<InitializeProtocolConfig>,
        groth16_verifier_program_id: Pubkey,
        oracle_price_feed_id: Pubkey,
        liquidation_program_id: Pubkey,
        authorized_relayer_pubkey_x: [u8; 32],
        authorized_relayer_pubkey_y: [u8; 32],
    ) -> Result<()> {
        require!(
            groth16_verifier_program_id != Pubkey::default(),
            SolvusError::VerifierProgramNotConfigured
        );
        require!(
            oracle_price_feed_id != Pubkey::default(),
            SolvusError::OraclePriceFeedNotConfigured
        );

        let now = Clock::get()?.unix_timestamp;
        let protocol_config = &mut ctx.accounts.protocol_config;
        protocol_config.admin = ctx.accounts.admin.key();
        protocol_config.groth16_verifier_program_id = groth16_verifier_program_id;
        protocol_config.oracle_price_feed_id = oracle_price_feed_id;
        protocol_config.liquidation_program_id = liquidation_program_id;
        protocol_config.authorized_relayer_pubkey_x = authorized_relayer_pubkey_x;
        protocol_config.authorized_relayer_pubkey_y = authorized_relayer_pubkey_y;
        protocol_config.updated_at = now;

        emit!(ProtocolConfigUpdatedEvent {
            admin: ctx.accounts.admin.key(),
            groth16_verifier_program_id,
            oracle_price_feed_id,
            liquidation_program_id,
            updated_at: now,
            authorized_relayer_pubkey_x,
            authorized_relayer_pubkey_y,
        });

        Ok(())
    }

    pub fn update_protocol_config(
        ctx: Context<UpdateProtocolConfig>,
        groth16_verifier_program_id: Pubkey,
        oracle_price_feed_id: Pubkey,
        liquidation_program_id: Pubkey,
        authorized_relayer_pubkey_x: [u8; 32],
        authorized_relayer_pubkey_y: [u8; 32],
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.protocol_config.admin,
            ctx.accounts.admin.key(),
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

        let now = Clock::get()?.unix_timestamp;
        let protocol_config = &mut ctx.accounts.protocol_config;
        protocol_config.groth16_verifier_program_id = groth16_verifier_program_id;
        protocol_config.oracle_price_feed_id = oracle_price_feed_id;
        protocol_config.liquidation_program_id = liquidation_program_id;
        protocol_config.authorized_relayer_pubkey_x = authorized_relayer_pubkey_x;
        protocol_config.authorized_relayer_pubkey_y = authorized_relayer_pubkey_y;
        protocol_config.updated_at = now;

        emit!(ProtocolConfigUpdatedEvent {
            admin: ctx.accounts.admin.key(),
            groth16_verifier_program_id,
            oracle_price_feed_id,
            liquidation_program_id,
            updated_at: now,
            authorized_relayer_pubkey_x,
            authorized_relayer_pubkey_y,
        });

        Ok(())
    }

    pub fn mint_zkusd(
        ctx: Context<MintZkUsd>,
        nullifier_hash: [u8; 32],
        zkusd_amount: u64,
        proof: Vec<u8>,
        public_inputs: Vec<u8>,
        l1_refund_timelock: i64,
    ) -> Result<()> {
        require!(!is_sanctioned(&ctx.accounts.owner.key()), SolvusError::AddressSanctioned);
        require!(zkusd_amount > 0, SolvusError::InvalidAmount);
        require!(zkusd_amount <= MAX_MINT_ZKUSD_AMOUNT, SolvusError::InvalidAmount);
        require!(!proof.is_empty(), SolvusError::InvalidProof);
        
        // Use Pyth SDK for safe price reading with staleness check
        let price_feed = load_price_feed_from_account_info(&ctx.accounts.oracle_price_feed)
            .map_err(|_| error!(SolvusError::OraclePriceFeedNotConfigured))?;
        let clock = Clock::get()?;
        let price = price_feed
            .get_price_no_older_than(clock.unix_timestamp, PYTH_STALENESS_SECONDS)
            .ok_or(SolvusError::StaleOraclePrice)?;
        require!(price.status == PriceStatus::Trading, SolvusError::InvalidOraclePrice);
        let btc_price = price.val as u64;
        require!(btc_price > 0, SolvusError::InvalidOraclePrice);

        let (btc_data, dlc_contract_id) = assert_canonical_public_inputs(
            &nullifier_hash,
            &public_inputs,
            &ctx.accounts.protocol_config.authorized_relayer_pubkey_x,
            &ctx.accounts.protocol_config.authorized_relayer_pubkey_y,
            &ctx.accounts.owner.key(),
        )?;

        // Dynamic collateral check based on BTC price (150% CR)
        // btc_price expected in USD with 8 decimals (e.g. 65000.00000000)
        // zkusd_amount expected with 6 decimals (e.g. 100.000000)
        // btc_data in satoshis (8 decimals)
        let required_collateral = zkusd_amount
            .checked_mul(15000)
            .ok_or(SolvusError::MathOverflow)?
            .checked_div(btc_price)
            .ok_or(SolvusError::MathOverflow)?;

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

        // Verify ZK proof - always required on mainnet
        // Only bypassable via compile-time feature flag for devnet
        #[cfg(not(feature = "devnet"))]
        {
            verify_groth16_proof(
                &ctx.accounts.verifier_program.to_account_info(),
                proof.clone(),
                public_inputs.clone(),
            )?;
        }

        let now = Clock::get()?.unix_timestamp;
        let vault = &mut ctx.accounts.vault;
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

        emit!(MintZkUsdEvent {
            owner: ctx.accounts.owner.key(),
            nullifier_hash,
            amount: zkusd_amount,
            timestamp: now,
        });

        Ok(())
    }



    pub fn burn_zkusd(
        ctx: Context<BurnZkUsd>,
        zkusd_amount: u64,
        recipient_btc: Option<[u8; 32]>,
    ) -> Result<()> {
        require!(!is_sanctioned(&ctx.accounts.owner.key()), SolvusError::AddressSanctioned);
        require!(zkusd_amount > 0, SolvusError::InvalidAmount);

        let vault = &mut ctx.accounts.vault;
        require_keys_eq!(vault.owner, ctx.accounts.owner.key(), SolvusError::Unauthorized);
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
            let price_feed = load_price_feed_from_account_info(&ctx.accounts.oracle_price_feed)
                .map_err(|_| error!(SolvusError::OraclePriceFeedNotConfigured))?;
            let clock = Clock::get()?;
            let price = price_feed
                .get_price_no_older_than(clock.unix_timestamp, PYTH_STALENESS_SECONDS)
                .ok_or(SolvusError::StaleOraclePrice)?;
            require!(price.status == PriceStatus::Trading, SolvusError::InvalidOraclePrice);
            let btc_price = price.val as u64;
            require!(btc_price > 0, SolvusError::InvalidOraclePrice);

            // Check remaining collateral >= 150% of remaining zkusd
            let required_collateral = remaining_zkusd
                .checked_mul(15000)
                .ok_or(SolvusError::MathOverflow)?
                .checked_div(btc_price)
                .ok_or(SolvusError::MathOverflow)?;

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
            ctx.accounts.protocol_config.admin,
            ctx.accounts.authority.key(),
            SolvusError::Unauthorized
        );
        let now = Clock::get()?.unix_timestamp;
        let vault = &mut ctx.accounts.vault;
        vault.status = VaultStatus::GracePeriod as u8;
        vault.grace_period_end = Some(now + GRACE_PERIOD_DURATION);
        vault.last_update = now;
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

fn is_sanctioned(pubkey: &Pubkey) -> bool {
    // Placeholder for future on-chain registry or token2022 transfer-hook check
    false
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
    proof: Vec<u8>,
    public_inputs: Vec<u8>,
) -> Result<()> {
    require!(
        verifier_program.key() != Pubkey::default(),
        SolvusError::VerifierProgramNotConfigured
    );

    // Build length-prefixed payload: [u32LE proof_len][proof][u32LE pi_len][public_inputs]
    let proof_len = (proof.len() as u32).to_le_bytes();
    let pi_len = (public_inputs.len() as u32).to_le_bytes();

    let mut instruction_data =
        Vec::with_capacity(4 + proof.len() + 4 + public_inputs.len());
    instruction_data.extend_from_slice(&proof_len);
    instruction_data.extend_from_slice(&proof);
    instruction_data.extend_from_slice(&pi_len);
    instruction_data.extend_from_slice(&public_inputs);

    let instruction = Instruction {
        program_id: verifier_program.key(),
        accounts: vec![],
        data: instruction_data,
    };

    invoke(&instruction, &[verifier_program.clone()])
        .map_err(|_| error!(SolvusError::InvalidProof))
}

#[derive(Accounts)]
pub struct InitializeProtocolConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
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
    pub admin: Signer<'info>,
    #[account(mut, seeds = [PROTOCOL_CONFIG_SEED], bump)]
    pub protocol_config: Account<'info, ProtocolConfig>,
}

#[derive(Accounts)]
#[instruction(nullifier_hash: [u8; 32], zkusd_amount: u64, proof: Vec<u8>, public_inputs: Vec<u8>)]
pub struct MintZkUsd<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut)]
    pub fee_payer: Signer<'info>,
    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump)]
    pub protocol_config: Account<'info, ProtocolConfig>,
    /// CHECK: Validated manually against protocol_config
    #[account(address = protocol_config.oracle_price_feed_id)]
    pub oracle_price_feed: AccountInfo<'info>,
    #[account(
        init_if_needed,
        payer = fee_payer,
        space = 8 + VaultState::LEN,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, VaultState>,
    #[account(
        init,
        payer = fee_payer,
        space = 8 + NullifierAccount::LEN,
        seeds = [PDA_NULLIFIER_SEED, nullifier_hash.as_ref()],
        bump
    )]
    pub nullifier_account: Account<'info, NullifierAccount>,
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
    /// CHECK: Validated manually against protocol_config
    #[account(address = protocol_config.oracle_price_feed_id)]
    pub oracle_price_feed: AccountInfo<'info>,
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
    pub authority: Signer<'info>,
    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump)]
    pub protocol_config: Account<'info, ProtocolConfig>,
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
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
    pub admin: Pubkey,
    pub groth16_verifier_program_id: Pubkey,
    pub oracle_price_feed_id: Pubkey,
    pub liquidation_program_id: Pubkey,
    pub authorized_relayer_pubkey_x: [u8; 32],
    pub authorized_relayer_pubkey_y: [u8; 32],
    pub updated_at: i64,
}

impl ProtocolConfig {
    pub const LEN: usize = 32 + 32 + 32 + 32 + 32 + 32 + 8;
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
    pub const LEN: usize = 168; // 160 + 8 for l1_refund_timelock
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
pub struct ProtocolConfigUpdatedEvent {
    pub admin: Pubkey,
    pub groth16_verifier_program_id: Pubkey,
    pub oracle_price_feed_id: Pubkey,
    pub liquidation_program_id: Pubkey,
    pub updated_at: i64,
    pub authorized_relayer_pubkey_x: [u8; 32],
    pub authorized_relayer_pubkey_y: [u8; 32],
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
}
