# Agent Architecture

## Overview

Kaya Suites uses a staged agent pipeline for chat and document maintenance:

1. The web app proxies chat requests to the Rust backend.
2. The backend `Orchestrator` classifies the turn as either research-only or research-then-edit.
3. The `Researcher` runs read-only tools to gather evidence and synthesize context.
4. If the turn requires changes, the `Editor` runs write-only tools and emits a proposed edit.
5. Proposed edits are reviewed and explicitly approved before they are committed to storage.

This architecture keeps retrieval, editing, transport, and approval concerns separated while still streaming a single conversational experience to the UI.

## Request Flow

### 1. Frontend proxy

The Next.js route at `apps/web/app/api/chat/route.ts` proxies the browser request to the backend `POST /sessions/:id/chat` endpoint and forwards the server-sent event (SSE) stream unchanged. This avoids direct cross-origin streaming in the browser and preserves session cookies.

### 2. Backend chat route

The backend chat handler lives at `apps/backend/crates/kaya-server/src/routes/chat.rs`. For each turn it:

- loads prior session messages
- saves the current user message
- builds an `OrchestratorContext`
- starts `orchestrate(&message, ctx)`
- converts agent events into SSE messages for the frontend

The route also extracts citation markers from the final assistant text, stores the assistant message in session history, and emits a `Done` event when the turn finishes.

## Core Agents

### Orchestrator

The orchestrator entry point is `apps/backend/crates/kaya-core/src/agent/orchestrator.rs`.

Its responsibilities are:

- classify the user message with `OperationType::IntentClassification`
- produce an `AgentPlan`
- run the `Researcher`
- optionally hand the `ResearchResult` to the `Editor`
- re-tag all emitted events with their source agent for transparency

The current plan types are:

- `ResearchOnly { query }`
- `ResearchThenEdit { query, instruction }`

The orchestrator itself does not invoke domain tools directly.

### Researcher

The researcher implementation lives at `apps/backend/crates/kaya-core/src/agent/researcher.rs`.

It runs an inner loop with read-only tools:

- `search_documents`
- `read_document`
- `list_documents`
- `find_stale_references`

During execution it emits standard `AgentEvent`s such as `ToolCall`, `ToolResult`, `Usage`, and `FinalMessage`. It also accumulates a `ResearchResult` containing:

- retrieved chunks
- cited document ids
- stale-reference candidates
- a synthesized `summary_context`

That `summary_context` is the grounding payload passed into the editor stage.

### Editor

The editor implementation lives at `apps/backend/crates/kaya-core/src/agent/editor.rs`.

It only runs for `ResearchThenEdit` plans. The editor receives the `ResearchResult` and injects the research summary into its system prompt, then uses write-only tools:

- `create_document`
- `delete_document`
- `propose_edit`
- `update_document`

When a tool returns a pending change, the editor emits `AgentEvent::ProposedEditEmitted` instead of mutating storage directly.

## Tool Isolation

The tool contract is defined in `apps/backend/crates/kaya-core/src/agent/tool.rs`.

- `Tool` is the base trait for callable agent capabilities.
- `ReadTool` marks retrieval-only tools.
- `WriteTool` marks proposal/mutation tools.

Tool registration lives in `apps/backend/crates/kaya-core/src/agent/tools/mod.rs`, which exposes:

- `read_tools()`
- `write_tools()`
- `default_tools()` for the older single-loop path

The separation is enforced at compile time:

- `Researcher::new(Vec<Arc<dyn ReadTool>>)`
- `Editor::new(Vec<Arc<dyn WriteTool>>)`

Compile-fail tests under `apps/backend/crates/kaya-core/tests/fail/` verify that write tools cannot be passed to the `Researcher` and read tools cannot be passed to the `Editor`.

## Proposal And Approval Boundary

Kaya does not let the agent apply document edits directly.

The invariant is documented in `apps/backend/crates/kaya-core/src/agent/mod.rs`:

- write tools can return a `ProposedEdit`
- the agent surfaces it as `AgentEvent::ProposedEditEmitted`
- the edit is not committed until code obtains an `ApprovalToken`
- `ApprovalToken` is only created through `UserSession::approve_edit`
- storage mutation happens later through `commit_edit`

On the server side, `apps/backend/crates/kaya-server/src/routes/chat.rs` converts proposed edits into SSE payloads and stores them in the in-memory `pending_edits` map. Approval is handled by `apps/backend/crates/kaya-server/src/routes/edits.rs`, which:

1. loads the pending edit
2. optionally applies user-modified final text
3. creates an approval token via `UserSession::approve_edit`
4. commits the edit with `commit_edit`
5. reindexes document chunks after approval when an LLM router is available

This is the main safety boundary in the architecture.

## Streaming Contract

The browser-side event types are defined in `apps/web/types/chat.ts`, and `apps/web/components/shared/ChatPanel.tsx` consumes them.

The main SSE messages are:

- `TextChunk`
- `CitationFound`
- `ProposedEditEmitted`
- `ProposedDeleteEmitted`
- `SessionRenamed`
- `Done`
- `Error`

The backend streams text incrementally, emits citations as they are resolved from the final message, buffers proposed edits for approval, and only finalizes the turn on `Done`.

## Logging And Observability

Each tool invocation is recorded in `apps/backend/crates/kaya-core/src/agent/log.rs` as a `ToolInvocation` with:

- tool name
- JSON input
- JSON output or error string
- latency
- timestamp
- turn id

The backend chat route also logs sourced agent events, which makes it possible to distinguish researcher activity from editor activity in server logs.

## High-Level Diagram

```text
Browser UI
  -> Next.js /api/chat proxy
  -> Rust /sessions/:id/chat route
  -> Orchestrator
       -> classify intent
       -> Researcher (read tools only)
            -> search/read/list/stale-ref tools
            -> ResearchResult
       -> Editor (write tools only, optional)
            -> create/delete/propose/update tools
            -> ProposedEditEmitted
  -> SSE back to UI
  -> user review / approve
  -> commit_edit + reindex
```

## Relevant Files

- `apps/backend/crates/kaya-core/src/agent/mod.rs`
- `apps/backend/crates/kaya-core/src/agent/orchestrator.rs`
- `apps/backend/crates/kaya-core/src/agent/researcher.rs`
- `apps/backend/crates/kaya-core/src/agent/editor.rs`
- `apps/backend/crates/kaya-core/src/agent/tool.rs`
- `apps/backend/crates/kaya-core/src/agent/tools/mod.rs`
- `apps/backend/crates/kaya-core/src/agent/log.rs`
- `apps/backend/crates/kaya-server/src/routes/chat.rs`
- `apps/backend/crates/kaya-server/src/routes/edits.rs`
- `apps/web/app/api/chat/route.ts`
- `apps/web/components/shared/ChatPanel.tsx`
- `apps/web/types/chat.ts`
