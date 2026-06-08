// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//! Kaya MCP — exposes the agent Read/Write tools over the Model Context Protocol.
//!
//! Two transports share the same `Registry`: the `kaya-mcp` stdio binary, and
//! the `/mcp` route in `kaya-server`. Auth is handled by [`kaya_oauth`] —
//! callers resolve a bearer token into a user before constructing the
//! [`KayaService`].
//!
//! Write tools follow a propose-then-commit flow: each `propose_*` tool emits a
//! [`kaya_core::edit::ProposedEdit`] which is stashed in [`PendingEditStore`]
//! under a fresh `edit_id`. Claude returns a preview to the user; on confirm
//! the model calls `commit_edit { edit_id }`, on reject `reject_edit`.

pub mod pending;
pub mod preview;
pub mod registry;
pub mod service;

pub use pending::PendingEditStore;
pub use registry::build_tool_router;
pub use service::KayaService;
