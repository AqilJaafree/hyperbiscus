use anchor_lang::prelude::*;
use crate::state::AgentSession;

/// Creates a new AgentSession PDA on the BASE LAYER.
///
/// The owner specifies:
/// - which ESP32 session key is authorized to sign actions
/// - how long the session lasts (duration_secs)
/// - maximum cumulative lamport exposure
/// - which DeFi strategies are enabled (strategy_mask bitmask)
pub fn handler(
    ctx: Context<InitializeSession>,
    session_key: Pubkey,
    duration_secs: i64,
    max_lamports: u64,
    strategy_mask: u8,
) -> Result<()> {
    let clock = Clock::get()?;
    let session = &mut ctx.accounts.session;

    session.owner = ctx.accounts.owner.key();
    session.session_key = session_key;
    session.expires_at = clock.unix_timestamp + duration_secs;
    session.max_lamports = max_lamports;
    session.spent_lamports = 0;
    session.is_active = true;
    session.bump = ctx.bumps.session;
    session.strategy_mask = strategy_mask;
    session.total_actions = 0;
    session.last_action_at = clock.unix_timestamp;

    msg!(
        "Session initialized: owner={}, session_key={}, expires_at={}, max_lamports={}",
        session.owner,
        session.session_key,
        session.expires_at,
        session.max_lamports,
    );

    Ok(())
}

#[derive(Accounts)]
pub struct InitializeSession<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = AgentSession::LEN,
        seeds = [b"session", owner.key().as_ref()],
        bump,
    )]
    pub session: Account<'info, AgentSession>,

    pub system_program: Program<'info, System>,
}
