pub mod initialize_session;
pub mod delegate_session;
pub mod execute_action;
pub mod commit_session;
pub mod undelegate_session;

// Anchor's #[program] macro needs `__client_accounts_*` types from each module
// to be in the crate root scope. The `handler` name appears in all five modules
// which triggers a glob re-export ambiguity warning — suppressed here since
// lib.rs calls handlers as `instructions::module::handler(...)`, not `handler`.
#[allow(ambiguous_glob_reexports)]
pub use initialize_session::*;
#[allow(ambiguous_glob_reexports)]
pub use delegate_session::*;
#[allow(ambiguous_glob_reexports)]
pub use execute_action::*;
#[allow(ambiguous_glob_reexports)]
pub use commit_session::*;
#[allow(ambiguous_glob_reexports)]
pub use undelegate_session::*;
