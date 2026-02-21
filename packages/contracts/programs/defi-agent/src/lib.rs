use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::ephemeral;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_program!(dlmm);

// Replace with actual program ID after `anchor build && anchor keys list`
declare_id!("8reNvTG6PLT4sf4nGbT7VjZ1YqEGXzASkjcSQmQTkJPT");

#[ephemeral]
#[program]
pub mod defi_agent {
    use super::*;

    /// [Base Layer] Create an AgentSession PDA, registering the ESP32 session key
    /// with its scope: duration, max lamport exposure, and enabled strategies.
    pub fn initialize_session(
        ctx: Context<InitializeSession>,
        session_key: Pubkey,
        duration_secs: i64,
        max_lamports: u64,
        strategy_mask: u8,
    ) -> Result<()> {
        instructions::initialize_session::handler(
            ctx,
            session_key,
            duration_secs,
            max_lamports,
            strategy_mask,
        )
    }

    /// [Base Layer] Delegate the AgentSession PDA to the MagicBlock Ephemeral Rollup.
    /// After this, the ESP32 can execute at sub-100ms without user approval per tx.
    pub fn delegate_session(ctx: Context<DelegateSession>, owner: Pubkey) -> Result<()> {
        instructions::delegate_session::handler(ctx, owner)
    }

    /// [Ephemeral Rollup] Execute a DeFi strategy action.
    /// Signed by the ESP32 session key. Validates scope before updating state.
    pub fn execute_action(
        ctx: Context<ExecuteAction>,
        action_type: u8,
        amount_lamports: u64,
    ) -> Result<()> {
        instructions::execute_action::handler(ctx, action_type, amount_lamports)
    }

    /// [Ephemeral Rollup] Checkpoint session state to Solana mainnet without undelegating.
    pub fn commit_session(ctx: Context<CommitSession>) -> Result<()> {
        instructions::commit_session::handler(ctx)
    }

    /// [Ephemeral Rollup] Commit final state and return the account to Solana mainnet.
    pub fn undelegate_session(ctx: Context<UndelegateSession>) -> Result<()> {
        instructions::undelegate_session::handler(ctx)
    }

    /// [Base Layer] Execute a real Meteora DLMM swap via CPI.
    /// Signed by the ESP32 session key. Validates LP strategy scope then CPIs into
    /// the Meteora DLMM program to perform the swap on-chain.
    pub fn execute_dlmm_swap<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, ExecuteDlmmSwap<'info>>,
        amount_in: u64,
        min_amount_out: u64,
    ) -> Result<()> {
        instructions::execute_dlmm_swap::handler(ctx, amount_in, min_amount_out)
    }

    /// [Base Layer] Remove all liquidity from a Meteora DLMM position and close it via CPI.
    /// Signed by the ESP32 session key. Calls `remove_all_liquidity` then `close_position2`
    /// in sequence — tokens return to the session key's ATAs, rent goes to `rent_receiver`.
    pub fn execute_dlmm_close_position<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, ExecuteDlmmClosePosition<'info>>,
    ) -> Result<()> {
        instructions::execute_dlmm_close_position::handler(ctx)
    }

    /// [Base Layer] Add liquidity to an existing Meteora DLMM position via CPI.
    /// Signed by the ESP32 session key. Validates LP strategy scope then CPIs into
    /// the Meteora DLMM program to deposit tokens into the position on-chain.
    /// The position must be owned by the session key.
    pub fn execute_dlmm_add_liquidity<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, ExecuteDlmmAddLiquidity<'info>>,
        liquidity_parameter: dlmm::types::LiquidityParameterByStrategy,
    ) -> Result<()> {
        instructions::execute_dlmm_add_liquidity::handler(ctx, liquidity_parameter)
    }

    /// [Base Layer] Register a Meteora DLMM position for on-chain status monitoring.
    /// Signed by the session owner. Creates an LpPositionMonitor PDA that records
    /// the monitored position's bin range and is updated by the ESP32 periodically.
    pub fn register_lp_monitor(
        ctx: Context<RegisterLpMonitor>,
        lb_pair: Pubkey,
        position: Pubkey,
        min_bin_id: i32,
        max_bin_id: i32,
    ) -> Result<()> {
        instructions::register_lp_monitor::handler(ctx, lb_pair, position, min_bin_id, max_bin_id)
    }

    /// [Base Layer] Checkpoint the current LP position status on-chain.
    /// Signed by the ESP32 session key. Caller passes the current pool active bin
    /// and unclaimed fee amounts read off-chain — updates is_in_range and fee snapshots.
    pub fn update_lp_status(
        ctx: Context<UpdateLpStatus>,
        active_bin: i32,
        fee_x: u64,
        fee_y: u64,
    ) -> Result<()> {
        instructions::update_lp_status::handler(ctx, active_bin, fee_x, fee_y)
    }
}
