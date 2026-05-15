//! Local token counting using cached BPE encoders.
//!
//! `CoreBPE` is `Send + Sync`, so the static encoders are initialized once
//! and shared across threads with no lock contention after the first call.

use std::sync::OnceLock;
use tiktoken_rs::{CoreBPE, get_bpe_from_model};

static O200K: OnceLock<CoreBPE> = OnceLock::new();
static CL100K: OnceLock<CoreBPE> = OnceLock::new();

fn o200k() -> &'static CoreBPE {
    O200K.get_or_init(|| get_bpe_from_model("gpt-4o").expect("o200k_base encoder"))
}

fn cl100k() -> &'static CoreBPE {
    CL100K.get_or_init(|| get_bpe_from_model("gpt-4").expect("cl100k_base encoder"))
}

/// Count tokens in `text` for the given `model`.
///
/// - GPT-4o family → o200k_base
/// - Everything else (Claude, GPT-4, GPT-4o-mini) → cl100k_base
///
/// Safe to call from many threads in parallel.
pub fn count_tokens(text: &str, model: &str) -> u32 {
    let bpe = if model.starts_with("gpt-4o") || model.starts_with("o1") || model.starts_with("o3") {
        o200k()
    } else {
        cl100k()
    };
    bpe.encode_with_special_tokens(text).len() as u32
}
