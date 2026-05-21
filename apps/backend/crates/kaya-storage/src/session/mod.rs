//! Chat [`SessionStorage`] implementations for each database backend.

pub mod mysql;
pub mod sqlite;

#[cfg(feature = "postgres")]
pub mod postgres;

pub use mysql::MySqlSessionStorage;
pub use sqlite::SqliteSessionStorage;

#[cfg(feature = "postgres")]
pub use postgres::PostgresSessionStorage;
