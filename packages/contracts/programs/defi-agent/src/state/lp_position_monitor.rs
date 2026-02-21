use anchor_lang::prelude::*;

/// On-chain record of a monitored Meteora DLMM LP position.
///
/// Created by `register_lp_monitor` (owner signs, base layer).
/// Updated by `update_lp_status` (session key signs, base layer) — the ESP32
/// calls this periodically after reading pool state off-chain to checkpoint:
///   • whether the active bin is still inside the position's bin range
///   • the current unclaimed fee balances
///
/// Seeds: [b"lp_monitor", session.key().as_ref()]
#[account]
pub struct LpPositionMonitor {
    /// The AgentSession that owns this monitor (32)
    pub session: Pubkey,

    /// Meteora DLMM pool (LbPair) being monitored (32)
    pub lb_pair: Pubkey,

    /// The DLMM position account to track (32)
    pub position: Pubkey,

    /// Position's lower bin boundary (inclusive) (4)
    pub min_bin_id: i32,

    /// Position's upper bin boundary (inclusive) (4)
    pub max_bin_id: i32,

    /// Pool active bin observed at the last update (4)
    pub last_active_bin: i32,

    /// True when last_active_bin ∈ [min_bin_id, max_bin_id] (1)
    pub is_in_range: bool,

    /// Unclaimed fee X amount at last checkpoint (8)
    pub fee_x_snapshot: u64,

    /// Unclaimed fee Y amount at last checkpoint (8)
    pub fee_y_snapshot: u64,

    /// Unix timestamp of the last status update (8)
    pub last_checked_at: i64,

    /// PDA bump seed (1)
    pub bump: u8,
}

impl LpPositionMonitor {
    pub const LEN: usize = 8   // discriminator
        + 32  // session
        + 32  // lb_pair
        + 32  // position
        + 4   // min_bin_id
        + 4   // max_bin_id
        + 4   // last_active_bin
        + 1   // is_in_range
        + 8   // fee_x_snapshot
        + 8   // fee_y_snapshot
        + 8   // last_checked_at
        + 1;  // bump

    /// Returns true when active_bin is within the registered position's range.
    pub fn check_in_range(&self, active_bin: i32) -> bool {
        active_bin >= self.min_bin_id && active_bin <= self.max_bin_id
    }
}
