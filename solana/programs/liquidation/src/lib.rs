use anchor_lang::prelude::*;

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
        require!(collateral_seized > 0, LiquidationError::InvalidLiquidationAmount);

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
    pub liquidator: Signer<'info>,
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
