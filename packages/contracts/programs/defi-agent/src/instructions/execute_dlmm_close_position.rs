use anchor_lang::prelude::*;
use crate::dlmm;
use crate::state::AgentSession;

/// Called by the ESP32 on the BASE LAYER using the session key.
///
/// Combines two DLMM CPIs in sequence:
///   1. `remove_all_liquidity` — withdraws all tokens from the position back
///      to the session key's ATAs (also claims any pending fees).
///   2. `close_position2` — closes the now-empty position account and returns
///      the rent lamports to `rent_receiver` (typically the session key).
///
/// The position must be owned by the session key. Bin arrays must cover the
/// position's full range; derive their PDAs via `deriveBinArray` +
/// `binIdToBinArrayIndex` from the `@meteora-ag/dlmm` SDK.
///
/// `spent_lamports` is NOT updated here since tokens are returned, not spent.
/// `total_actions` is still incremented so the session log is accurate.
pub fn handler<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, ExecuteDlmmClosePosition<'info>>,
) -> Result<()> {
    let session = &mut ctx.accounts.session;
    let clock = Clock::get()?;

    // ── Session validation ──────────────────────────────────────────────────
    session.validate_lp_session(ctx.accounts.session_key.key(), clock.unix_timestamp)?;

    let dlmm_prog = ctx.accounts.dlmm_program.to_account_info();

    // ── Step 1: Remove all liquidity → tokens return to session key's ATAs ──
    let remove_accounts = dlmm::cpi::accounts::RemoveAllLiquidity {
        position: ctx.accounts.position.to_account_info(),
        lb_pair: ctx.accounts.lb_pair.to_account_info(),
        bin_array_bitmap_extension: ctx
            .accounts
            .bin_array_bitmap_extension
            .as_ref()
            .map(|a| a.to_account_info()),
        user_token_x: ctx.accounts.user_token_x.to_account_info(),
        user_token_y: ctx.accounts.user_token_y.to_account_info(),
        reserve_x: ctx.accounts.reserve_x.to_account_info(),
        reserve_y: ctx.accounts.reserve_y.to_account_info(),
        token_x_mint: ctx.accounts.token_x_mint.to_account_info(),
        token_y_mint: ctx.accounts.token_y_mint.to_account_info(),
        bin_array_lower: ctx.accounts.bin_array_lower.to_account_info(),
        bin_array_upper: ctx.accounts.bin_array_upper.to_account_info(),
        sender: ctx.accounts.session_key.to_account_info(),
        token_x_program: ctx.accounts.token_x_program.to_account_info(),
        token_y_program: ctx.accounts.token_y_program.to_account_info(),
        event_authority: ctx.accounts.event_authority.to_account_info(),
        program: dlmm_prog.clone(),
    };
    dlmm::cpi::remove_all_liquidity(CpiContext::new(dlmm_prog.clone(), remove_accounts))?;

    // ── Step 2: Close the now-empty position → rent reclaimed ──────────────
    let close_accounts = dlmm::cpi::accounts::ClosePosition2 {
        position: ctx.accounts.position.to_account_info(),
        sender: ctx.accounts.session_key.to_account_info(),
        rent_receiver: ctx.accounts.rent_receiver.to_account_info(),
        event_authority: ctx.accounts.event_authority.to_account_info(),
        program: dlmm_prog.clone(),
    };
    dlmm::cpi::close_position2(CpiContext::new(dlmm_prog, close_accounts))?;

    // ── Update session accounting ──────────────────────────────────────────
    // No spent_lamports update — tokens are returned, not consumed.
    session.bump_actions()?;
    session.last_action_at = clock.unix_timestamp;

    msg!(
        "DLMM position closed: total_actions={}",
        session.total_actions,
    );

    Ok(())
}

#[derive(Accounts)]
pub struct ExecuteDlmmClosePosition<'info> {
    /// The ESP32 session key — must sign this transaction (also the DLMM `sender`)
    pub session_key: Signer<'info>,

    /// Scoped session PDA — validated and updated here
    #[account(mut)]
    pub session: Account<'info, AgentSession>,

    // ── Shared by remove_all_liquidity + close_position2 ──────────────────

    #[account(mut)]
    /// CHECK: LP position account — must be owned by session_key; closed at end
    pub position: UncheckedAccount<'info>,

    #[account(mut)]
    /// CHECK: Meteora DLMM LB pair pool
    pub lb_pair: UncheckedAccount<'info>,

    // ── remove_all_liquidity-only accounts ────────────────────────────────

    #[account(mut)]
    /// CHECK: Optional bin array bitmap extension (null for pools near bin 0)
    pub bin_array_bitmap_extension: Option<UncheckedAccount<'info>>,

    #[account(mut)]
    /// CHECK: Session key's token X ATA (receives withdrawn X tokens)
    pub user_token_x: UncheckedAccount<'info>,

    #[account(mut)]
    /// CHECK: Session key's token Y ATA (receives withdrawn Y tokens)
    pub user_token_y: UncheckedAccount<'info>,

    #[account(mut)]
    /// CHECK: Pool token X reserve
    pub reserve_x: UncheckedAccount<'info>,

    #[account(mut)]
    /// CHECK: Pool token Y reserve
    pub reserve_y: UncheckedAccount<'info>,

    /// CHECK: Token X mint
    pub token_x_mint: UncheckedAccount<'info>,

    /// CHECK: Token Y mint
    pub token_y_mint: UncheckedAccount<'info>,

    #[account(mut)]
    /// CHECK: Lower bin array covering the position's range
    pub bin_array_lower: UncheckedAccount<'info>,

    #[account(mut)]
    /// CHECK: Upper bin array covering the position's range
    pub bin_array_upper: UncheckedAccount<'info>,

    // ── close_position2-only accounts ─────────────────────────────────────

    #[account(mut)]
    /// CHECK: Receives the position account's rent lamports (typically session_key)
    pub rent_receiver: UncheckedAccount<'info>,

    // ── Programs ──────────────────────────────────────────────────────────

    #[account(address = dlmm::ID)]
    /// CHECK: Meteora DLMM program
    pub dlmm_program: UncheckedAccount<'info>,

    /// CHECK: DLMM CPI event authority (PDA of DLMM program)
    pub event_authority: UncheckedAccount<'info>,

    /// CHECK: Token program for token X (SPL Token or Token-2022)
    pub token_x_program: UncheckedAccount<'info>,

    /// CHECK: Token program for token Y (SPL Token or Token-2022)
    pub token_y_program: UncheckedAccount<'info>,
}
