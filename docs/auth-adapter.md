# AuthAdapter

**Trait location:** `apps/backend/crates/kaya-core/src/auth.rs`
**Scaffolds:** `apps/backend/crates/kaya-auth/src/{magic_link,password_auth}.rs`

## Purpose

`AuthAdapter` decouples authentication from business logic. The trait is small enough that a single-user binary can implement it with a constant, while a multi-user deployment can plug in magic-link or password auth without touching agent or storage code.

## Types

### `UserSession`

```rust
pub struct UserSession {
    pub user_id: Uuid,
}
```

Represents an authenticated user. Passed into business logic that needs an identity (e.g. metering, audit log).

### `UserContext`

```rust
pub struct UserContext {
    pub tenant_id: Uuid,
    pub user_id: Uuid,
}
```

Per-request tenant/user context threaded into storage adapters. Adapters that share a database between users filter every query by `user_id` (and `tenant_id`, where applicable) for isolation.

## Trait surface

```rust
#[async_trait]
pub trait AuthAdapter: Send + Sync {
    async fn current_user(&self) -> Result<Option<UserSession>, KayaError>;
    async fn require_auth(&self) -> Result<UserSession, KayaError>;
}
```

| Method | Behaviour |
|---|---|
| `current_user` | Returns the session if the request is authenticated, or `None`. Never errors for unauthenticated requests. |
| `require_auth` | Returns the session, or `Err(KayaError::Unauthenticated)` if no valid credentials are present. Use this in handlers that must be protected. |

## Adapters

The `kaya-auth` crate contains in-progress scaffolds for two adapter strategies:

| File | Strategy | Status |
|---|---|---|
| `kaya-auth/src/magic_link.rs` | Email magic-link sessions | Scaffold — not yet wired into `kaya-server` |
| `kaya-auth/src/password_auth.rs` | Username + password | Scaffold — not yet wired into `kaya-server` |

A minimal `LocalAuthAdapter` returning a fixed single-user session is the simplest possible implementation and is the recommended starting point for a self-hosted deployment that does not need multi-user auth.

## Usage pattern

```rust
async fn handle_edit(
    auth: Arc<dyn AuthAdapter>,
    storage: Arc<dyn StorageAdapter>,
    …
) -> Result<…> {
    let session = auth.require_auth().await?;
    // session.user_id is now available for metering / audit
}
```
