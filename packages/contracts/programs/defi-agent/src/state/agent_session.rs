use anchor_lang::prelude::*;
use crate::errors::AgentError;

/// Strategy bitmask flags — combine with bitwise OR to enable multiple
pub const STRATEGY_LP: u8 = 1 << 0;             // Concentrated LP rebalancing
pub const STRATEGY_YIELD: u8 = 1 << 1;          // Lending yield switching
pub const STRATEGY_LIQUIDATION: u8 = 1 << 2;    // Leveraged position protection
pub const STRATEGY_ALL: u8 = STRATEGY_LP | STRATEGY_YIELD | STRATEGY_LIQUIDATION;

/// Action type indices (used as array index into strategy bitmask)
pub const ACTION_LP_REBALANCE: u8 = 0;
pub const ACTION_YIELD_SWITCH: u8 = 1;
pub const ACTION_LIQUIDATION_PROTECT: u8 = 2;

#[account]
pub struct AgentSession {
    /// The user wallet that owns and created this session (32)
    pub owner: Pubkey,

    /// Pubkey of the ESP32 session key authorized to sign actions (32)
    pub session_key: Pubkey,

    /// Unix timestamp when this session expires (8)
    pub expires_at: i64,

    /// Maximum cumulative lamports the agent is allowed to move (8)
    pub max_lamports: u64,

    /// Running total of lamports spent across all actions this session (8)
    pub spent_lamports: u64,

    /// Whether this session is still active (1)
    pub is_active: bool,

    /// PDA bump seed (1)
    pub bump: u8,

    /// Bitmask of enabled strategies: bit0=LP, bit1=yield, bit2=liquidation (1)
    pub strategy_mask: u8,

    /// Total number of actions executed (8)
    pub total_actions: u64,

    /// Unix timestamp of the last executed action (8)
    pub last_action_at: i64,
}

impl AgentSession {
    pub const LEN: usize = 8   // discriminator
        + 32  // owner
        + 32  // session_key
        + 8   // expires_at
        + 8   // max_lamports
        + 8   // spent_lamports
        + 1   // is_active
        + 1   // bump
        + 1   // strategy_mask
        + 8   // total_actions
        + 8;  // last_action_at

    pub fn is_expired(&self, now: i64) -> bool {
        now >= self.expires_at
    }

    /// Returns true if the given action type's strategy bit is enabled
    pub fn has_strategy(&self, action_type: u8) -> bool {
        let bit = 1u8 << action_type;
        self.strategy_mask & bit != 0
    }

    /// Validate session state for any LP DLMM instruction (active, not expired,
    /// correct session key, LP strategy enabled). Consolidates the repeated
    /// 4-line validation block across execute_dlmm_swap/add_liquidity/close_position.
    pub fn validate_lp_session(&self, session_key: Pubkey, timestamp: i64) -> Result<()> {
        require!(self.is_active, AgentError::SessionInactive);
        require!(!self.is_expired(timestamp), AgentError::SessionExpired);
        require_keys_eq!(session_key, self.session_key, AgentError::UnauthorizedSessionKey);
        require!(self.has_strategy(ACTION_LP_REBALANCE), AgentError::StrategyNotEnabled);
        Ok(())
    }

    /// Increment total_actions with overflow protection.
    pub fn bump_actions(&mut self) -> Result<()> {
        self.total_actions = self
            .total_actions
            .checked_add(1)
            .ok_or(AgentError::Overflow)?;
        Ok(())
    }
}
