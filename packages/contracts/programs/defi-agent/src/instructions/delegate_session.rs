use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::delegate;
use ephemeral_rollups_sdk::cpi::DelegateConfig;

/// Delegates the AgentSession PDA to the MagicBlock Ephemeral Rollup.
/// Must be sent to the BASE LAYER.
///
/// After this, the ESP32 can execute actions at sub-100ms latency on the ER
/// without requiring user approval on every transaction.
pub fn handler(ctx: Context<DelegateSession>, owner: Pubkey) -> Result<()> {
    // Method name is auto-generated as `delegate_<field_name>` by #[delegate] macro
    ctx.accounts.delegate_agent_session(
        &ctx.accounts.payer,
        &[b"session", owner.as_ref()],
        DelegateConfig::default(),
    )?;
    Ok(())
}

#[delegate]
#[derive(Accounts)]
#[instruction(owner: Pubkey)]
pub struct DelegateSession<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: PDA to delegate — must use AccountInfo with `del` constraint
    #[account(mut, del, seeds = [b"session", owner.as_ref()], bump)]
    pub agent_session: AccountInfo<'info>,
}
