//! Chat [`SessionStorage`] implementations for each database backend.

use kaya_core::ProposalLookup;
use uuid::Uuid;

pub mod mysql;
pub mod sqlite;

#[cfg(feature = "postgres")]
pub mod postgres;

pub use mysql::MySqlSessionStorage;
pub use sqlite::SqliteSessionStorage;

#[cfg(feature = "postgres")]
pub use postgres::PostgresSessionStorage;

/// Given (`message_id`, `session_id`, `proposals_json`) tuples from a
/// substring search for an edit_id, return the first proposal that matches
/// `edit_id` AND is still `pending`. Returns `None` if no candidate matches
/// (e.g. an incidental substring hit in unrelated text, or the proposal has
/// already been approved/rejected).
pub(crate) fn extract_proposal_lookup(
    rows: Vec<(String, String, String)>,
    edit_id: Uuid,
) -> Option<ProposalLookup> {
    let target = edit_id.to_string();
    for (message_id, session_id_str, proposals) in rows {
        let arr: Vec<serde_json::Value> =
            serde_json::from_str(&proposals).unwrap_or_default();
        for item in &arr {
            let matches_id =
                item.get("id").and_then(|v| v.as_str()) == Some(target.as_str());
            if !matches_id {
                continue;
            }
            let status = item
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("pending");
            if status != "pending" {
                return None;
            }
            let session_id = Uuid::parse_str(&session_id_str).ok()?;
            return Some(ProposalLookup {
                session_id,
                message_id,
                proposal_json: serde_json::to_string(item).ok()?,
            });
        }
    }
    None
}
