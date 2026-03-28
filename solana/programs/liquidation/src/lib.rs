use anchor_lang::prelude::*;
use solvus::cpi::accounts::LiquidateVaultCpi;
use solvus::program::Solvus;
use solvus::{ProtocolConfig, VaultState};

declare_id!("FuNY9NZLWdegyDQHJiGjzsWcSeYG8s7nsAvaqUrk8HZt");

#[program]
pub mod liquidation {
    use super::*;

    pub fn liquidate_vault(
        ctx: Context<LiquidateVault>,
        vault_owner: Pubkey,
        collateral_seized: u64,
        liquidator_reward: u64,
    ) -> Result<()> {
        require!(
            collateral_seized > 0,
            LiquidationError::InvalidLiquidationAmount
        );

        let cpi_program = ctx.accounts.solvus_program.to_account_info();
        let cpi_accounts = LiquidateVaultCpi {
            liquidator: ctx.accounts.liquidator.to_account_info(),
            protocol_config: ctx.accounts.protocol_config.to_account_info(),
            vault: ctx.accounts.vault.to_account_info(),
            liquidation_program: ctx.accounts.liquidation_program.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        solvus::cpi::liquidate_vault_cpi(cpi_ctx, collateral_seized, liquidator_reward)?;

        emit!(VaultLiquidatedEvent {
            vault_owner,
            liquidator: ctx.accounts.liquidator.key(),
            collateral_seized,
            liquidator_reward,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }
}

#[derive(Accounts)]
pub struct LiquidateVault<'info> {
    #[account(mut)]
    pub liquidator: Signer<'info>,
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    pub protocol_config: Account<'info, ProtocolConfig>,
    pub solvus_program: Program<'info, Solvus>,
    /// CHECK: the self program info for authorization in solvus
    pub liquidation_program: AccountInfo<'info>,
}

#[event]
pub struct VaultLiquidatedEvent {
    pub vault_owner: Pubkey,
    pub liquidator: Pubkey,
    pub collateral_seized: u64,
    pub liquidator_reward: u64,
    pub timestamp: i64,
}

#[error_code]
pub enum LiquidationError {
    #[msg("Invalid liquidation amount")]
    InvalidLiquidationAmount,
}
