# Kaya Suites — Engineering TODOs

Items deferred from in-flight work. Each entry lists context, design sketch, and
acceptance criteria so the work can be picked up cold.

---

## Prompt caching for agent doc context

**Status:** deferred. Structural prerequisite landed (split `TurnContext` into
`document` + `chat`; doc body removed from Orchestrator classifier; doc body
now sits at a stable position in Researcher synthesis and Editor system
prompts).

### Why this matters

The Researcher (`crates/kaya-core/src/agent/researcher.rs`) and Editor
(`crates/kaya-core/src/agent/editor.rs`) ship the full open document body on
every chat turn via `AgentContext.turn.document.body`. At ~5–20k tokens per
doc this is the dominant per-turn input cost and the highest-leverage caching
target.

### Goal: model-agnostic `CacheHint` on `ChatMessage`

Add a cache hint to the message type so the prompt-builder can mark cache
breakpoints without referencing vendor SDKs.

```rust
// crates/kaya-core/src/model_router/mod.rs
pub enum CacheHint {
    None,
    /// Mark this message as a cache breakpoint — content up to and including
    /// this message becomes the cached prefix.
    Breakpoint,
}

pub enum ChatMessage {
    System { content: String, cache_hint: CacheHint },
    User { content: String, cache_hint: CacheHint },
    Assistant { content: String, cache_hint: CacheHint },
}
```

Keep current `ChatMessage::system / user / assistant` constructors defaulting
`cache_hint = None` so existing call sites compile unchanged. Add
`with_cache_breakpoint()` builder method.

### Per-provider behaviour

- **`AnthropicProvider`** (`crates/kaya-core/src/model_router/providers/anthropic.rs`):
  translate `Breakpoint` into Rig 0.37's `cache_control: ephemeral` on the
  last content block of the marked message. Verify the exact rig API at
  implementation time — `rig-core::providers::anthropic` may expose this
  through a builder method on `CompletionRequest`. If rig 0.37 lacks a direct
  hook, escape into the raw request shape (last resort).
- **`OpenAIProvider`**: no-op. OpenAI auto-caches prefixes ≥1024 tokens; the
  hint is informational.
- **`GeminiProvider`**: no-op for v1. Full support requires stateful
  `cachedContent` resources (separate REST endpoint, TTL management,
  per-tenant cache-key bookkeeping). Track as its own follow-up.
- **`MockProvider`**: record breakpoints on a per-message basis so unit tests
  can assert the prompt-builder marked the right boundary.

### Where to mark the breakpoint

Mark the document block as a cache breakpoint in two places (identical
formatting so Anthropic's prefix cache hits across both agents):

- `researcher.rs::build_synthesis_messages` — breakpoint after the
  `## Open document` block, before the chat block and query.
- `editor.rs::build_editor_system_prompt` — the system prompt is one
  `ChatMessage`, so emit it as two `ChatMessage::system` messages:
  doc-block (Breakpoint) + remainder (None). Verify this still produces a
  single coherent system context in rig's preamble translation.

### Acceptance

- Two consecutive chat turns on the same doc within 5 minutes show
  `cache_read_input_tokens > 0` in the Anthropic usage block.
- Switching to a different doc invalidates the cache (cache_read = 0 on the
  first turn after switch).
- OpenAI and Gemini turns still succeed (no-op path); `MockProvider` tests
  assert the breakpoint was emitted at the expected message index.
- No behavioural change for callers that don't set `cache_hint`.
