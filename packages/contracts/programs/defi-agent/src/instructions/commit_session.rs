use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::commit;
use ephemeral_rollups_sdk::ephem::commit_accounts;
use crate::state::AgentSession;

/// Commits the current session state from the ER back to Solana mainnet
/// WITHOUT undelegating. The session stays active on the ER.
///
/// Must be sent to the EPHEMERAL ROLLUP.
/// Use this periodically to checkpoint state (e.g. after large actions).
pub fn handler(ctx: Context<CommitSession>) -> Result<()> {
    commit_accounts(
        &ctx.accounts.payer,
        vec![&ctx.accounts.session.to_account_info()],
        &ctx.accounts.magic_context,
        &ctx.accounts.magic_program,
    )?;
    Ok(())
}

#[commit]
#[derive(Accounts)]
pub struct CommitSession<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut)]
    pub session: Account<'info, AgentSession>,
}
