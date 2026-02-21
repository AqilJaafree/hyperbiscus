use anchor_lang::prelude::*;
use crate::state::{AgentSession, LpPositionMonitor};
use crate::errors::AgentError;

/// [Base Layer] Register a Meteora DLMM position for on-chain status monitoring.
///
/// Creates an `LpPositionMonitor` PDA tied to the caller's `AgentSession`.
/// Called once by the wallet owner after opening a position; after this the
/// ESP32 calls `update_lp_status` periodically to checkpoint the position's
/// in-range status and fee accrual.
pub fn handler(
    ctx: Context<RegisterLpMonitor>,
    lb_pair: Pubkey,
    position: Pubkey,
    min_bin_id: i32,
    max_bin_id: i32,
) -> Result<()> {
    require!(min_bin_id <= max_bin_id, AgentError::InvalidBinRange);

    let session = &ctx.accounts.session;
    require!(session.is_active, AgentError::SessionInactive);

    let monitor = &mut ctx.accounts.monitor;
    monitor.session = ctx.accounts.session.key();
    monitor.lb_pair = lb_pair;
    monitor.position = position;
    monitor.min_bin_id = min_bin_id;
    monitor.max_bin_id = max_bin_id;
    monitor.last_active_bin = 0;
    monitor.is_in_range = true; // optimistic default — first update will correct
    monitor.fee_x_snapshot = 0;
    monitor.fee_y_snapshot = 0;
    monitor.last_checked_at = 0;
    monitor.bump = ctx.bumps.monitor;

    msg!(
        "LP monitor registered: position={}, range=[{}, {}]",
        position,
        min_bin_id,
        max_bin_id,
    );

    Ok(())
}

#[derive(Accounts)]
pub struct RegisterLpMonitor<'info> {
    /// The wallet owner of the session — must sign and pay for the PDA rent
    #[account(mut)]
    pub owner: Signer<'info>,

    /// The owning AgentSession — validated to belong to `owner`
    #[account(constraint = session.owner == owner.key())]
    pub session: Account<'info, AgentSession>,

    /// LpPositionMonitor PDA — created here
    #[account(
        init,
        payer = owner,
        space = LpPositionMonitor::LEN,
        seeds = [b"lp_monitor", session.key().as_ref()],
        bump,
    )]
    pub monitor: Account<'info, LpPositionMonitor>,

    pub system_program: Program<'info, System>,
}
