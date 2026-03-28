use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::solana_program::program::invoke;
use anchor_lang::solana_program::pubkey;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount};

declare_id!("Cik3PiifeUrKrWcAFsHM5R7ckQVkWAc9M9THrXVfanVR");

const ZKUSD_MINT_AUTHORITY_SEED: &[u8] = b"zkusd_mint_authority";
const PDA_NULLIFIER_SEED: &[u8] = b"nullifier_account";
const PROTOCOL_CONFIG_SEED: &[u8] = b"protocol_config";
const VAULT_SEED: &[u8] = b"vault";
const DLC_CLOSE_TIMEOUT: i64 = 3600;
const GRACE_PERIOD_DURATION: i64 = 3600;
const SPL_TOKEN_PROGRAM_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const GROTH16_PUBLIC_INPUT_FIELD_COUNT: usize = 1;
const GROTH16_PUBLIC_INPUT_HEADER_BYTES: usize = 12;
const GROTH16_PUBLIC_INPUT_BYTES: usize =
    GROTH16_PUBLIC_INPUT_HEADER_BYTES + GROTH16_PUBLIC_INPUT_FIELD_COUNT * 32;

#[program]
pub mod solvus {
    use super::*;

    pub fn initialize_protocol_config(
        ctx: Context<InitializeProtocolConfig>,
        groth16_verifier_program_id: Pubkey,
        oracle_price_feed_id: Pubkey,
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
        protocol_config.updated_at = now;

        emit!(ProtocolConfigUpdatedEvent {
            admin: ctx.accounts.admin.key(),
            groth16_verifier_program_id,
            oracle_price_feed_id,
            updated_at: now,
        });

        Ok(())
    }

    pub fn update_protocol_config(
        ctx: Context<UpdateProtocolConfig>,
        groth16_verifier_program_id: Pubkey,
        oracle_price_feed_id: Pubkey,
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
        protocol_config.updated_at = now;

        emit!(ProtocolConfigUpdatedEvent {
            admin: ctx.accounts.admin.key(),
            groth16_verifier_program_id,
            oracle_price_feed_id,
            updated_at: now,
        });

        Ok(())
    }

    pub fn mint_zkusd(
        ctx: Context<MintZkUsd>,
        nullifier_hash: [u8; 32],
        zkusd_amount: u64,
        proof: Vec<u8>,
        public_inputs: Vec<u8>,
    ) -> Result<()> {
        require!(zkusd_amount > 0, SolvusError::InvalidAmount);
        require!(!proof.is_empty(), SolvusError::InvalidProof);
        assert_canonical_public_inputs(&nullifier_hash, &public_inputs)?;
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

        verify_groth16_proof(
            &ctx.accounts.verifier_program.to_account_info(),
            proof.clone(),
            public_inputs.clone(),
        )?;

        let now = Clock::get()?.unix_timestamp;
        let vault = &mut ctx.accounts.vault;
        if vault.owner == Pubkey::default() {
            vault.owner = ctx.accounts.owner.key();
            vault.collateral_btc = 0;
            vault.zkusd_minted = 0;
            vault.status = VaultStatus::Initialized as u8;
        }

        vault.zkusd_minted = vault
            .zkusd_minted
            .checked_add(zkusd_amount)
            .ok_or(SolvusError::MathOverflow)?;
        vault.last_update = now;
        vault.status = VaultStatus::Healthy as u8;
        vault.grace_period_end = None;
        vault.dlc_close_deadline = None;

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
        require!(zkusd_amount > 0, SolvusError::InvalidAmount);

        let vault = &mut ctx.accounts.vault;
        require_keys_eq!(vault.owner, ctx.accounts.owner.key(), SolvusError::Unauthorized);
        require!(
            vault.status != VaultStatus::GracePeriod as u8,
            SolvusError::BurnInGracePeriod
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
        vault.zkusd_minted = vault
            .zkusd_minted
            .checked_sub(zkusd_amount)
            .ok_or(SolvusError::MathOverflow)?;
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
        let now = Clock::get()?.unix_timestamp;
        let vault = &mut ctx.accounts.vault;
        vault.status = VaultStatus::GracePeriod as u8;
        vault.grace_period_end = Some(now + GRACE_PERIOD_DURATION);
        vault.last_update = now;
        Ok(())
    }
}

fn assert_canonical_public_inputs(nullifier_hash: &[u8; 32], public_inputs: &[u8]) -> Result<()> {
    require!(
        public_inputs.len() == GROTH16_PUBLIC_INPUT_BYTES,
        SolvusError::InvalidPublicInputs
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
    require!(
        &public_inputs[(GROTH16_PUBLIC_INPUT_BYTES - 32)..] == nullifier_hash.as_ref(),
        SolvusError::PublicInputsNullifierMismatch
    );
    Ok(())
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

    let mut instruction_data = Vec::with_capacity(proof.len() + public_inputs.len());
    instruction_data.extend_from_slice(&proof);
    instruction_data.extend_from_slice(&public_inputs);

    let instruction = Instruction {
        program_id: verifier_program.key(),
        accounts: vec![],
        data: instruction_data,
    };

    invoke(&instruction, &[verifier_program.clone()]).map_err(|_| error!(SolvusError::InvalidProof))
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
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimDlcTimeout<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
}

#[derive(Accounts)]
pub struct CloseDlc<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
}

#[derive(Accounts)]
pub struct EnterGracePeriod<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
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
    pub updated_at: i64,
}

impl ProtocolConfig {
    pub const LEN: usize = 32 + 32 + 32 + 8;
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
}

impl VaultState {
    pub const LEN: usize = 160;
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
    pub updated_at: i64,
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
    #[msg("Vault is not in PendingBtcRelease state")]
    VaultNotPendingBtcRelease,
    #[msg("DLC close deadline not reached")]
    DlcDeadlineNotReached,
    #[msg("Outstanding zkUSD debt remains")]
    OutstandingDebt,
    #[msg("Unauthorized")]
    Unauthorized,
}
