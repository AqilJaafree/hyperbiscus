use anchor_lang::prelude::*;
use crate::state::{AgentSession, LpPositionMonitor};
use crate::errors::AgentError;

/// [Base Layer] Checkpoint the current LP position status on-chain.
///
/// Called by the ESP32 session key after reading the DLMM pool state off-chain.
/// The caller passes the current `active_bin` (from `getActiveBin()`) and
/// unclaimed fee amounts (from `getPositionsByUserAndLbPair()`).
///
/// Updates:
///   • `last_active_bin` — what the pool's active bin was
///   • `is_in_range`     — whether active_bin ∈ [min_bin_id, max_bin_id]
///   • `fee_x_snapshot` / `fee_y_snapshot` — current unclaimed fees
///   • `last_checked_at` — current slot timestamp
///
/// Logs a warning when the position transitions out of range, giving the
/// agent an on-chain signal it can relay to the mobile app.
pub fn handler(
    ctx: Context<UpdateLpStatus>,
    active_bin: i32,
    fee_x: u64,
    fee_y: u64,
) -> Result<()> {
    let session = &ctx.accounts.session;
    let clock = Clock::get()?;

    // Session must still be valid for the session key to act
    require!(session.is_active, AgentError::SessionInactive);
    require!(!session.is_expired(clock.unix_timestamp), AgentError::SessionExpired);
    require_keys_eq!(
        ctx.accounts.session_key.key(),
        session.session_key,
        AgentError::UnauthorizedSessionKey,
    );

    let monitor = &mut ctx.accounts.monitor;
    let was_in_range = monitor.is_in_range;
    let now_in_range = monitor.check_in_range(active_bin);

    monitor.last_active_bin = active_bin;
    monitor.is_in_range = now_in_range;
    monitor.fee_x_snapshot = fee_x;
    monitor.fee_y_snapshot = fee_y;
    monitor.last_checked_at = clock.unix_timestamp;

    if was_in_range && !now_in_range {
        msg!(
            "ALERT: LP position out of range! active_bin={}, range=[{}, {}]",
            active_bin,
            monitor.min_bin_id,
            monitor.max_bin_id,
        );
    }

    msg!(
        "LP status: active_bin={}, in_range={}, fee_x={}, fee_y={}",
        active_bin,
        now_in_range,
        fee_x,
        fee_y,
    );

    Ok(())
}

#[derive(Accounts)]
pub struct UpdateLpStatus<'info> {
    /// The ESP32 session key — must sign this checkpoint transaction
    pub session_key: Signer<'info>,

    /// The owning AgentSession — used to validate session_key and liveness
    pub session: Account<'info, AgentSession>,

    /// LpPositionMonitor PDA to update — must belong to `session`
    #[account(
        mut,
        seeds = [b"lp_monitor", session.key().as_ref()],
        bump = monitor.bump,
        constraint = monitor.session == session.key(),
    )]
    pub monitor: Account<'info, LpPositionMonitor>,
}
