use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::commit;
use ephemeral_rollups_sdk::ephem::commit_and_undelegate_accounts;
use crate::state::AgentSession;

/// Commits final state and returns the AgentSession account to Solana mainnet.
/// Must be sent to the EPHEMERAL ROLLUP.
///
/// After this, the session is no longer active and the account owner reverts
/// to our program. The user must call initialize_session + delegate_session
/// again to start a new session.
pub fn handler(ctx: Context<UndelegateSession>) -> Result<()> {
    // Deactivate before undelegating so the final committed state reflects this
    ctx.accounts.session.is_active = false;

    commit_and_undelegate_accounts(
        &ctx.accounts.payer,
        vec![&ctx.accounts.session.to_account_info()],
        &ctx.accounts.magic_context,
        &ctx.accounts.magic_program,
    )?;

    msg!("Session undelegated and closed");
    Ok(())
}

#[commit]
#[derive(Accounts)]
pub struct UndelegateSession<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut)]
    pub session: Account<'info, AgentSession>,
}
