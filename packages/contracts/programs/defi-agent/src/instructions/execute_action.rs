use anchor_lang::prelude::*;
use crate::state::AgentSession;
use crate::errors::AgentError;

/// Called by the ESP32 on the EPHEMERAL ROLLUP using the session key.
///
/// Validates:
/// - session is active and not expired
/// - signer is the registered session key
/// - requested strategy is enabled in the session's strategy_mask
/// - cumulative spend stays within max_lamports cap
///
/// `action_type`: 0 = LP rebalance, 1 = yield switch, 2 = liquidation protect
/// `amount_lamports`: notional lamport exposure of this specific action
pub fn handler(
    ctx: Context<ExecuteAction>,
    action_type: u8,
    amount_lamports: u64,
) -> Result<()> {
    let session = &mut ctx.accounts.session;
    let clock = Clock::get()?;

    require!(session.is_active, AgentError::SessionInactive);
    require!(!session.is_expired(clock.unix_timestamp), AgentError::SessionExpired);

    require_keys_eq!(
        ctx.accounts.session_key.key(),
        session.session_key,
        AgentError::UnauthorizedSessionKey,
    );

    require!(session.has_strategy(action_type), AgentError::StrategyNotEnabled);

    let new_spent = session
        .spent_lamports
        .checked_add(amount_lamports)
        .ok_or(AgentError::Overflow)?;
    require!(new_spent <= session.max_lamports, AgentError::ExposureLimitExceeded);

    session.spent_lamports = new_spent;
    session.bump_actions()?;
    session.last_action_at = clock.unix_timestamp;

    msg!(
        "Action executed: type={}, amount={}, total_spent={}/{}",
        action_type,
        amount_lamports,
        session.spent_lamports,
        session.max_lamports,
    );

    Ok(())
}

#[derive(Accounts)]
pub struct ExecuteAction<'info> {
    /// The ESP32 session key — must sign this transaction
    pub session_key: Signer<'info>,

    #[account(mut)]
    pub session: Account<'info, AgentSession>,
}
