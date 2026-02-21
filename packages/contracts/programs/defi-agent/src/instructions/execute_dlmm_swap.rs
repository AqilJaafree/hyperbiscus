use anchor_lang::prelude::*;
use crate::dlmm;
use crate::state::AgentSession;
use crate::errors::AgentError;

/// Called by the ESP32 on the EPHEMERAL ROLLUP using the session key.
///
/// Validates the session scope (active, not expired, session key matches,
/// LP strategy enabled, exposure within cap) then CPIs into the Meteora DLMM
/// program to execute the swap on-chain. Updates session accounting after.
///
/// Bin arrays for the pool must be passed in `remaining_accounts` (1–2 accounts
/// depending on the pool's active bin range). The TypeScript client fetches
/// these via the `@meteora-ag/dlmm` SDK before building the transaction.
pub fn handler<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, ExecuteDlmmSwap<'info>>,
    amount_in: u64,
    min_amount_out: u64,
) -> Result<()> {
    let session = &mut ctx.accounts.session;
    let clock = Clock::get()?;

    // ── Session validation ────────────────────────────────────────────────────
    session.validate_lp_session(ctx.accounts.session_key.key(), clock.unix_timestamp)?;
    let new_spent = session
        .spent_lamports
        .checked_add(amount_in)
        .ok_or(AgentError::Overflow)?;
    require!(new_spent <= session.max_lamports, AgentError::ExposureLimitExceeded);

    // ── CPI to Meteora DLMM swap ─────────────────────────────────────────────
    let cpi_accounts = dlmm::cpi::accounts::Swap {
        lb_pair: ctx.accounts.lb_pair.to_account_info(),
        bin_array_bitmap_extension: ctx
            .accounts
            .bin_array_bitmap_extension
            .as_ref()
            .map(|a| a.to_account_info()),
        reserve_x: ctx.accounts.reserve_x.to_account_info(),
        reserve_y: ctx.accounts.reserve_y.to_account_info(),
        user_token_in: ctx.accounts.user_token_in.to_account_info(),
        user_token_out: ctx.accounts.user_token_out.to_account_info(),
        token_x_mint: ctx.accounts.token_x_mint.to_account_info(),
        token_y_mint: ctx.accounts.token_y_mint.to_account_info(),
        oracle: ctx.accounts.oracle.to_account_info(),
        host_fee_in: None,
        user: ctx.accounts.session_key.to_account_info(),
        token_x_program: ctx.accounts.token_x_program.to_account_info(),
        token_y_program: ctx.accounts.token_y_program.to_account_info(),
        event_authority: ctx.accounts.event_authority.to_account_info(),
        program: ctx.accounts.dlmm_program.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(
        ctx.accounts.dlmm_program.to_account_info(),
        cpi_accounts,
    )
    .with_remaining_accounts(ctx.remaining_accounts.to_vec());

    dlmm::cpi::swap(cpi_ctx, amount_in, min_amount_out)?;

    // ── Update session accounting ────────────────────────────────────────────
    session.spent_lamports = new_spent;
    session.bump_actions()?;
    session.last_action_at = clock.unix_timestamp;

    msg!(
        "DLMM swap executed: amount_in={}, min_out={}, total_spent={}/{}",
        amount_in,
        min_amount_out,
        session.spent_lamports,
        session.max_lamports,
    );

    Ok(())
}

#[derive(Accounts)]
pub struct ExecuteDlmmSwap<'info> {
    /// The ESP32 session key — must sign this transaction (also the DLMM `user`)
    pub session_key: Signer<'info>,

    /// Scoped session PDA — validated and updated here
    #[account(mut)]
    pub session: Account<'info, AgentSession>,

    // ── Meteora DLMM accounts ────────────────────────────────────────────────

    #[account(mut)]
    /// CHECK: Meteora DLMM LB pair pool
    pub lb_pair: UncheckedAccount<'info>,

    /// CHECK: Optional bin array bitmap extension (pass if pool uses extended bitmap)
    pub bin_array_bitmap_extension: Option<UncheckedAccount<'info>>,

    #[account(mut)]
    /// CHECK: Token X reserve account of the pool
    pub reserve_x: UncheckedAccount<'info>,

    #[account(mut)]
    /// CHECK: Token Y reserve account of the pool
    pub reserve_y: UncheckedAccount<'info>,

    #[account(mut)]
    /// CHECK: User's (session key) input token ATA
    pub user_token_in: UncheckedAccount<'info>,

    #[account(mut)]
    /// CHECK: User's (session key) output token ATA
    pub user_token_out: UncheckedAccount<'info>,

    /// CHECK: Token X mint
    pub token_x_mint: UncheckedAccount<'info>,

    /// CHECK: Token Y mint
    pub token_y_mint: UncheckedAccount<'info>,

    #[account(mut)]
    /// CHECK: Oracle account for the pool
    pub oracle: UncheckedAccount<'info>,

    #[account(address = dlmm::ID)]
    /// CHECK: Meteora DLMM program
    pub dlmm_program: UncheckedAccount<'info>,

    /// CHECK: DLMM CPI event authority (PDA of DLMM program)
    pub event_authority: UncheckedAccount<'info>,

    /// CHECK: Token program for token X (SPL Token or Token-2022)
    pub token_x_program: UncheckedAccount<'info>,

    /// CHECK: Token program for token Y (SPL Token or Token-2022)
    pub token_y_program: UncheckedAccount<'info>,
    // Bin arrays → ctx.remaining_accounts (1–2 accounts, fetched via SDK)
}
