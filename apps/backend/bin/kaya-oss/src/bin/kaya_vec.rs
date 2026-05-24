//! kaya-vec — inspect and re-index the Kaya Suites vector database.
//!
//! # Usage
//!
//! ```text
//! # Show embedding coverage for all documents
//! kaya-vec inspect
//!
//! # Re-embed every document (incremental — only changed paragraphs)
//! kaya-vec reindex
//!
//! # Re-embed one specific document
//! kaya-vec reindex --doc <UUID>
//! ```
//!
//! Both subcommands read DATABASE_URL and KAYA_CONFIG from the environment
//! (or from a .env file). `reindex` also requires a configured embedding
//! model in kaya.yaml.
//!
//! Only SQLite databases are supported by this tool. For Postgres/MySQL
//! deployments use the kaya-cloud binary or a direct DB client.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{Context, bail};
use clap::{Parser, Subcommand};
use sqlx::Row;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use uuid::Uuid;

use kaya_core::model_router::ModelRouter;
use kaya_core::{StorageAdapter, retrieval};
use kaya_storage::SqliteAdapter;

// ── CLI definition ────────────────────────────────────────────────────────────

#[derive(Parser)]
#[command(
    name = "kaya-vec",
    about = "Inspect and re-index the Kaya Suites vector database",
    long_about = None,
)]
struct Cli {
    /// SQLite database URL (e.g. sqlite:kaya.db or sqlite:///abs/path/kaya.db).
    /// Falls back to DATABASE_URL env var.
    #[arg(long, env = "DATABASE_URL")]
    database_url: String,

    /// Path to kaya.yaml LLM router config. Required for `reindex`.
    #[arg(long, env = "KAYA_CONFIG", default_value = "kaya.yaml")]
    config: PathBuf,

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Print chunk and embedding coverage for every document.
    Inspect,

    /// Re-embed all documents (or a single document).
    ///
    /// Incremental: only paragraphs whose content has changed since the last
    /// index run will trigger a new embedding API call.
    Reindex {
        /// Limit reindexing to this document UUID.
        #[arg(long)]
        doc: Option<String>,
    },
}

// ── Entry point ───────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    let cli = Cli::parse();

    // Only SQLite is supported.
    if !cli.database_url.starts_with("sqlite") {
        bail!(
            "kaya-vec only supports SQLite databases.\n\
             DATABASE_URL must start with 'sqlite:' but got: {}",
            cli.database_url
        );
    }

    let db_file = cli
        .database_url
        .trim_start_matches("sqlite:///")
        .trim_start_matches("sqlite://")
        .trim_start_matches("sqlite:");

    let opts = SqliteConnectOptions::new()
        .filename(db_file)
        .create_if_missing(false)
        .journal_mode(SqliteJournalMode::Wal);

    let pool = SqlitePoolOptions::new()
        .connect_with(opts)
        .await
        .with_context(|| format!("failed to open SQLite database: {db_file}"))?;

    match cli.command {
        Command::Inspect => run_inspect(&pool).await,
        Command::Reindex { doc } => {
            let router = load_router(&cli.config)?;
            let storage = SqliteAdapter::from_pool(pool.clone())
                .await
                .context("failed to create storage adapter")?;
            run_reindex(Arc::new(storage), Arc::new(router), doc).await
        }
    }
}

// ── inspect ───────────────────────────────────────────────────────────────────

async fn run_inspect(pool: &sqlx::SqlitePool) -> anyhow::Result<()> {
    // Load all non-deleted documents.
    let docs = sqlx::query(
        "SELECT id, title FROM documents WHERE deleted_at IS NULL ORDER BY updated_at DESC",
    )
    .fetch_all(pool)
    .await
    .context("failed to query documents")?;

    if docs.is_empty() {
        println!("No documents found.");
        return Ok(());
    }

    // Chunk counts keyed by document_id.
    let chunk_rows =
        sqlx::query("SELECT document_id, COUNT(*) as cnt FROM chunks GROUP BY document_id")
            .fetch_all(pool)
            .await
            .context("failed to query chunk counts")?;

    let mut chunk_counts: HashMap<String, i64> = HashMap::new();
    for row in &chunk_rows {
        let doc_id: String = row.try_get("document_id")?;
        let cnt: i64 = row.try_get("cnt")?;
        chunk_counts.insert(doc_id, cnt);
    }

    // Embedding counts keyed by document_id.
    let emb_rows = sqlx::query(
        "SELECT document_id, COUNT(*) as cnt FROM chunk_embeddings GROUP BY document_id",
    )
    .fetch_all(pool)
    .await
    .context("failed to query embedding counts")?;

    let mut emb_counts: HashMap<String, i64> = HashMap::new();
    for row in &emb_rows {
        let doc_id: String = row.try_get("document_id")?;
        let cnt: i64 = row.try_get("cnt")?;
        emb_counts.insert(doc_id, cnt);
    }

    // Totals for summary line.
    let total_chunks: i64 = chunk_counts.values().sum();
    let total_embeds: i64 = emb_counts.values().sum();
    let coverage_pct = if total_chunks == 0 {
        0
    } else {
        (total_embeds * 100) / total_chunks
    };

    // Column width for title truncation.
    const TITLE_W: usize = 48;

    let sep = "─".repeat(72);
    println!("{sep}");
    println!(
        "  {} documents  ·  {} chunks  ·  {} embeddings  ({}% coverage)",
        docs.len(),
        total_chunks,
        total_embeds,
        coverage_pct,
    );
    println!("{sep}");

    for row in &docs {
        let id: String = row.try_get("id")?;
        let title: String = row.try_get("title").unwrap_or_else(|_| "(untitled)".into());

        let chunks = *chunk_counts.get(&id).unwrap_or(&0);
        let embeds = *emb_counts.get(&id).unwrap_or(&0);
        let covered = chunks > 0 && embeds == chunks;
        let partial = embeds > 0 && embeds < chunks;

        let status = if covered {
            "✓"
        } else if partial {
            "~"
        } else {
            "✗"
        };

        let truncated = truncate(&title, TITLE_W);
        let note = if chunks == 0 {
            "  (no chunks — not indexed)".into()
        } else if embeds < chunks {
            format!("  ← needs reindex ({} missing)", chunks - embeds)
        } else {
            String::new()
        };

        println!(
            "  {}  {:<width$}  chunks: {:>3}  embeds: {:>3}{}",
            status,
            truncated,
            chunks,
            embeds,
            note,
            width = TITLE_W,
        );
    }

    println!("{sep}");

    if total_chunks > total_embeds {
        println!(
            "  Run `kaya-vec reindex` to embed {} unindexed chunk(s).",
            total_chunks - total_embeds
        );
        println!("{sep}");
    }

    Ok(())
}

// ── reindex ───────────────────────────────────────────────────────────────────

async fn run_reindex(
    storage: Arc<dyn StorageAdapter>,
    router: Arc<ModelRouter>,
    filter_doc: Option<String>,
) -> anyhow::Result<()> {
    let docs = storage
        .list_documents()
        .await
        .context("failed to list documents")?;

    let targets: Vec<_> = match &filter_doc {
        None => docs.iter().collect(),
        Some(raw_id) => {
            let target_id = Uuid::parse_str(raw_id)
                .with_context(|| format!("invalid document UUID: {raw_id}"))?;
            let found: Vec<_> = docs.iter().filter(|d| d.id == target_id).collect();
            if found.is_empty() {
                bail!("document {target_id} not found");
            }
            found
        }
    };

    if targets.is_empty() {
        println!("No documents to index.");
        return Ok(());
    }

    let sep = "─".repeat(72);
    println!("{sep}");
    println!("  Reindexing {} document(s)…", targets.len(),);
    println!("{sep}");

    let mut total_calls = 0usize;
    let mut total_errors = 0usize;

    for (i, doc) in targets.iter().enumerate() {
        let prefix = format!("  [{}/{}]", i + 1, targets.len());
        let title = truncate(&doc.title, 44);
        print!("{prefix}  {title:<44}  … ");

        match retrieval::index_document_chunks(doc, &storage, &router, None, None).await {
            Ok(n) => {
                total_calls += n;
                if n == 0 {
                    println!("up to date");
                } else {
                    println!("{n} embedding(s) updated");
                }
            }
            Err(e) => {
                total_errors += 1;
                println!("ERROR: {e}");
            }
        }
    }

    println!("{sep}");
    println!(
        "  Done.  {} embedding call(s) made.  {} error(s).",
        total_calls, total_errors,
    );
    println!("{sep}");

    if total_errors > 0 {
        bail!("{total_errors} document(s) failed to index");
    }

    Ok(())
}

// ── helpers ───────────────────────────────────────────────────────────────────

fn load_router(config: &PathBuf) -> anyhow::Result<ModelRouter> {
    ModelRouter::from_yaml(config)
        .with_context(|| format!("failed to load LLM config from {}", config.display()))
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_owned()
    } else {
        let t: String = s.chars().take(max.saturating_sub(1)).collect();
        format!("{t}…")
    }
}
