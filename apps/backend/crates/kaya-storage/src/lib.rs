//! SQLite and MySQL storage adapters for Kaya Suites OSS (Apache 2.0).
//!
//! # BRD note
//! The `StorageAdapter` trait was moved to `kaya-core` (rather than living here
//! as the BRD originally specified) to avoid a circular dependency with
//! `commit_edit`. TODO: flag in BRD §8 revision.

pub mod document;
pub mod mysql;
pub mod session;
pub mod sqlite;

// Re-export the trait so callers can depend on only this crate.
pub use kaya_core::StorageAdapter;
pub use mysql::MySqlAdapter;
pub use session::SqliteSessionStorage;
pub use sqlite::SqliteAdapter;
