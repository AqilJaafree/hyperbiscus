use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::{commit_accounts, commit_and_undelegate_accounts};

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

// Replace with actual program ID after `anchor build && anchor keys list`
declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

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
}
