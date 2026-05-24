//! `search_directories` — search the folder tree and nearby document titles.

use std::collections::HashMap;

use async_trait::async_trait;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::agent::{
    AgentContext,
    tool::{Tool, ToolOutput},
};
use crate::error::KayaError;
use crate::storage::Folder;

pub struct SearchDirectories;

#[async_trait]
impl Tool for SearchDirectories {
    fn name(&self) -> &'static str {
        "search_directories"
    }

    fn description(&self) -> &'static str {
        "Search the folder tree by folder name, full path, and nearby document titles. \
         Returns matching folders with stable IDs and paths so other agents can reason \
         about the current directory structure."
    }

    fn schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["query"],
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search text used to match folders and nearby document titles."
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of folders to return (default 10).",
                    "default": 10
                }
            }
        })
    }

    async fn invoke(&self, input: Value, ctx: &AgentContext) -> Result<ToolOutput, KayaError> {
        let query = input["query"]
            .as_str()
            .ok_or_else(|| KayaError::Internal("search_directories: missing 'query'".into()))?
            .trim()
            .to_owned();
        let limit = input["limit"].as_u64().unwrap_or(10) as usize;

        let folders = ctx.storage.list_folders().await?;
        let documents = ctx.storage.list_documents().await?;

        let folder_map: HashMap<Uuid, Folder> =
            folders.iter().cloned().map(|f| (f.id, f)).collect();
        let docs_by_folder: HashMap<Option<Uuid>, Vec<String>> =
            documents.into_iter().fold(HashMap::new(), |mut acc, doc| {
                acc.entry(doc.folder_id).or_default().push(doc.title);
                acc
            });

        let terms = extract_terms(&query);

        let mut scored: Vec<(i32, String, &Folder)> = folders
            .iter()
            .map(|folder| {
                let path = folder_path(folder.id, &folder_map);
                let doc_titles = docs_by_folder
                    .get(&Some(folder.id))
                    .cloned()
                    .unwrap_or_default();
                let score = folder_score(folder, &path, &doc_titles, &terms, &query);
                (score, path, folder)
            })
            .collect();

        scored.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));

        let folders_json: Vec<Value> = scored
            .into_iter()
            .filter(|(score, _, _)| *score > 0 || query.is_empty())
            .take(limit)
            .map(|(score, path, folder)| {
                let mut doc_titles = docs_by_folder
                    .get(&Some(folder.id))
                    .cloned()
                    .unwrap_or_default();
                doc_titles.sort();
                let matching_documents = doc_titles.into_iter().take(5).collect::<Vec<_>>();

                json!({
                    "id": folder.id,
                    "name": folder.name,
                    "parent_id": folder.parent_id,
                    "path": path,
                    "document_count": docs_by_folder.get(&Some(folder.id)).map(|docs| docs.len()).unwrap_or(0),
                    "matching_documents": matching_documents,
                    "match_score": score,
                })
            })
            .collect();

        Ok(ToolOutput::value(json!({
            "query": query,
            "folders": folders_json,
        })))
    }
}

fn extract_terms(query: &str) -> Vec<String> {
    const STOP_WORDS: &[&str] = &[
        "a",
        "an",
        "the",
        "and",
        "or",
        "to",
        "for",
        "in",
        "on",
        "at",
        "of",
        "new",
        "create",
        "folder",
        "directory",
        "under",
        "inside",
        "into",
        "called",
        "named",
        "please",
    ];

    let mut terms: Vec<String> = query
        .split(|c: char| !c.is_alphanumeric())
        .filter_map(|part| {
            let part = part.trim().to_lowercase();
            if part.len() < 2 || STOP_WORDS.contains(&part.as_str()) {
                None
            } else {
                Some(part)
            }
        })
        .collect();

    if terms.is_empty() && !query.trim().is_empty() {
        terms.push(query.trim().to_lowercase());
    }

    terms
}

fn folder_score(
    folder: &Folder,
    path: &str,
    doc_titles: &[String],
    terms: &[String],
    query: &str,
) -> i32 {
    if query.is_empty() {
        return 1;
    }

    let name = folder.name.to_lowercase();
    let path_lc = path.to_lowercase();
    let docs_blob = doc_titles.join(" ").to_lowercase();
    let query_lc = query.to_lowercase();

    let mut score = 0;

    if name.contains(&query_lc) {
        score += 8;
    }
    if path_lc.contains(&query_lc) {
        score += 10;
    }
    if docs_blob.contains(&query_lc) {
        score += 4;
    }

    for term in terms {
        if name.contains(term) {
            score += 5;
        }
        if path_lc.contains(term) {
            score += 6;
        }
        if docs_blob.contains(term) {
            score += 2;
        }
    }

    score
}

fn folder_path(folder_id: Uuid, folders: &HashMap<Uuid, Folder>) -> String {
    let mut parts = Vec::new();
    let mut current = Some(folder_id);
    let mut guard = 0usize;

    while let Some(id) = current {
        guard += 1;
        if guard > folders.len() + 1 {
            break;
        }

        let Some(folder) = folders.get(&id) else {
            break;
        };
        parts.push(folder.name.clone());
        current = folder.parent_id;
    }

    parts.reverse();
    parts.join(" / ")
}
