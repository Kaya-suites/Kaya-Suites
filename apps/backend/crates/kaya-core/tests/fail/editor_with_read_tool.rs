//! Failing case: `Editor::new` only accepts `Arc<dyn WriteTool>`.
//! Passing a read tool must be rejected by the compiler.

fn main() {
    // ERROR: the trait `WriteTool` is not implemented for `SearchDocuments`
    let _e = kaya_core::agent::Editor::new(vec![
        std::sync::Arc::new(kaya_core::agent::tools::SearchDocuments)
            as std::sync::Arc<dyn kaya_core::agent::WriteTool>,
    ]);
}
