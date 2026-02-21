use anchor_lang::prelude::*;
use crate::dlmm;
use crate::state::AgentSession;
use crate::errors::AgentError;

/// Called by the ESP32 on the BASE LAYER using the session key.
///
/// Validates the session scope (active, not expired, session key matches,
/// LP strategy enabled, combined exposure within cap) then CPIs into the
/// Meteora DLMM program to add liquidity to an existing position.
/// Updates session accounting after.
///
/// The position must already exist and be owned by the session key.
/// `bin_array_lower` and `bin_array_upper` must cover the position's
/// full bin range — derive their PDAs via `deriveBinArray` + `binIdToBinArrayIndex`
/// from the `@meteora-ag/dlmm` SDK before building the transaction.
pub fn handler<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, ExecuteDlmmAddLiquidity<'info>>,
    liquidity_parameter: dlmm::types::LiquidityParameterByStrategy,
) -> Result<()> {
    let session = &mut ctx.accounts.session;
    let clock = Clock::get()?;

    // ── Session validation ──────────────────────────────────────────────────
    session.validate_lp_session(ctx.accounts.session_key.key(), clock.unix_timestamp)?;

    // Track total exposure as amount_x + amount_y
    let total_in = liquidity_parameter
        .amount_x
        .checked_add(liquidity_parameter.amount_y)
        .ok_or(AgentError::Overflow)?;
    let new_spent = session
        .spent_lamports
        .checked_add(total_in)
        .ok_or(AgentError::Overflow)?;
    require!(new_spent <= session.max_lamports, AgentError::ExposureLimitExceeded);

    // ── CPI to Meteora DLMM add_liquidity_by_strategy ──────────────────────
    let cpi_accounts = dlmm::cpi::accounts::AddLiquidityByStrategy {
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
        program: ctx.accounts.dlmm_program.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(
        ctx.accounts.dlmm_program.to_account_info(),
        cpi_accounts,
    );

    dlmm::cpi::add_liquidity_by_strategy(cpi_ctx, liquidity_parameter)?;

    // ── Update session accounting ──────────────────────────────────────────
    session.spent_lamports = new_spent;
    session.bump_actions()?;
    session.last_action_at = clock.unix_timestamp;

    msg!(
        "DLMM add liquidity: total_in={}, total_spent={}/{}",
        total_in,
        session.spent_lamports,
        session.max_lamports,
    );

    Ok(())
}

#[derive(Accounts)]
pub struct ExecuteDlmmAddLiquidity<'info> {
    /// The ESP32 session key — must sign this transaction (also the DLMM `sender`)
    pub session_key: Signer<'info>,

    /// Scoped session PDA — validated and updated here
    #[account(mut)]
    pub session: Account<'info, AgentSession>,

    // ── Meteora DLMM accounts ──────────────────────────────────────────────

    #[account(mut)]
    /// CHECK: LP position account — must be owned by session_key
    pub position: UncheckedAccount<'info>,

    #[account(mut)]
    /// CHECK: Meteora DLMM LB pair pool
    pub lb_pair: UncheckedAccount<'info>,

    #[account(mut)]
    /// CHECK: Optional bin array bitmap extension (null for pools near bin 0)
    pub bin_array_bitmap_extension: Option<UncheckedAccount<'info>>,

    #[account(mut)]
    /// CHECK: Session key's token X ATA (source of X tokens)
    pub user_token_x: UncheckedAccount<'info>,

    #[account(mut)]
    /// CHECK: Session key's token Y ATA (source of Y tokens)
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
