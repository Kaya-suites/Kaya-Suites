// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//! Integration tests for `kaya-mcp`.
//!
//! Token auth is now owned by `kaya-oauth` (see its own integration tests).
//! This crate's responsibility is the propose-then-commit pending-edit store
//! and the tool registry's static shape.

use kaya_core::{ProposedEdit, ProposedEditKind};
use kaya_mcp::{PendingEditStore, build_tool_router};
use uuid::Uuid;

#[tokio::test]
async fn pending_edit_take_is_one_shot() {
    let store = PendingEditStore::new();
    let edit = ProposedEdit {
        id: Uuid::new_v4(),
        kind: ProposedEditKind::Create {
            title: "t".into(),
            body: "b".into(),
            folder_id: None,
        },
    };
    let id = edit.id;
    store.insert(edit).await;
    assert!(store.take(id).await.is_some());
    assert!(store.take(id).await.is_none(), "take consumes the entry");
}

#[test]
fn registry_exposes_expected_tools() {
    let router = build_tool_router();
    let names: Vec<String> = router
        .list_all()
        .iter()
        .map(|t| t.name.to_string())
        .collect();

    for must in [
        "search_documents",
        "search_directories",
        "read_document",
        "list_documents",
        "find_stale_references",
        "propose_create_document",
        "propose_update_document",
        "propose_modify_document",
        "propose_delete_document",
        "propose_create_folder",
        "commit_edit",
        "reject_edit",
    ] {
        assert!(
            names.iter().any(|n| n == must),
            "tool {must} not registered (have: {names:?})"
        );
    }

    for forbidden in ["create_document", "update_document", "delete_document"] {
        assert!(
            !names.iter().any(|n| n == forbidden),
            "raw write tool '{forbidden}' must be renamed to propose_*"
        );
    }
}
