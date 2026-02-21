use anchor_lang::prelude::*;

#[error_code]
pub enum AgentError {
    #[msg("Session has expired")]
    SessionExpired,

    #[msg("Session is not active")]
    SessionInactive,

    #[msg("Unauthorized: signer is not the registered session key")]
    UnauthorizedSessionKey,

    #[msg("Action amount exceeds max lamport exposure for this session")]
    ExposureLimitExceeded,

    #[msg("Strategy not enabled for this session")]
    StrategyNotEnabled,

    #[msg("Arithmetic overflow")]
    Overflow,

    #[msg("min_bin_id must be <= max_bin_id")]
    InvalidBinRange,
}
