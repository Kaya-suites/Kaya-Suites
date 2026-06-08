//! SQLite, MySQL, and Postgres storage adapters for Kaya Suites (Apache 2.0).
//!
//! # BRD note
//! The `StorageAdapter` trait was moved to `kaya-core` (rather than living here
//! as the BRD originally specified) to avoid a circular dependency with
//! `commit_edit`. TODO: flag in BRD §8 revision.
//!
//! Enable the `postgres` feature to include `PostgresAdapter` and
//! `PostgresSessionStorage` (requires pgvector).

pub mod backend;
pub mod document;
pub mod mysql;
pub mod session;
pub mod sqlite;

pub use backend::{DbBackend, build_user_adapters};

#[cfg(feature = "postgres")]
pub mod postgres;

// Re-export the trait so callers can depend on only this crate.
pub use kaya_core::StorageAdapter;
pub use mysql::{MYSQL_MIGRATOR, MySqlAdapter};
pub use session::{MySqlSessionStorage, SqliteSessionStorage};
pub use sqlite::{SQLITE_MIGRATOR, SqliteAdapter};

#[cfg(feature = "postgres")]
pub use postgres::{MIGRATOR as POSTGRES_MIGRATOR, PostgresAdapter};
#[cfg(feature = "postgres")]
pub use session::PostgresSessionStorage;
