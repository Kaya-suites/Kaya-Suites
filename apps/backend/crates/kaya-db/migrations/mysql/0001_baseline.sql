-- Baseline MySQL schema. Multi-user — every row carries user_id, same shape
-- as Postgres and SQLite. Idempotent so it applies cleanly to existing DBs.

CREATE TABLE IF NOT EXISTS users (
    id            VARCHAR(36)  NOT NULL,
    email         TEXT         NOT NULL,
    username      VARCHAR(255) UNIQUE,
    password_hash TEXT,
    is_superadmin TINYINT(1)   NOT NULL DEFAULT 0,
    created_at    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY users_email_uk (email(255))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Storage layer ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS folders (
    id         VARCHAR(36)  NOT NULL,
    user_id    VARCHAR(36)  NOT NULL,
    name       TEXT         NOT NULL,
    parent_id  VARCHAR(36),
    sort_order BIGINT       NOT NULL DEFAULT 0,
    created_at VARCHAR(32)  NOT NULL,
    updated_at VARCHAR(32)  NOT NULL,
    PRIMARY KEY (id),
    KEY folders_user_parent_idx (user_id, parent_id),
    KEY folders_user_parent_sort_idx (user_id, parent_id, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS documents (
    id               VARCHAR(36)  NOT NULL,
    user_id          VARCHAR(36)  NOT NULL,
    title            TEXT         NOT NULL,
    frontmatter_json MEDIUMTEXT   NOT NULL,
    content_hash     VARCHAR(64)  NOT NULL,
    updated_at       VARCHAR(32)  NOT NULL,
    deleted_at       VARCHAR(32),
    body             MEDIUMTEXT   NOT NULL,
    folder_id        VARCHAR(36),
    sort_order       BIGINT       NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    KEY documents_user_idx (user_id),
    KEY documents_user_folder_sort_idx (user_id, folder_id, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS chunks (
    user_id      VARCHAR(36)  NOT NULL,
    document_id  VARCHAR(36)  NOT NULL,
    paragraph_id VARCHAR(255) NOT NULL,
    ordinal      INT          NOT NULL,
    content      MEDIUMTEXT   NOT NULL,
    content_hash VARCHAR(64)  NOT NULL,
    PRIMARY KEY (user_id, document_id, paragraph_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS chunk_embeddings (
    user_id      VARCHAR(36)  NOT NULL,
    document_id  VARCHAR(36)  NOT NULL,
    paragraph_id VARCHAR(255) NOT NULL,
    vector       MEDIUMBLOB   NOT NULL,
    PRIMARY KEY (user_id, document_id, paragraph_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Session layer (chat, embeddings status, prefs) ────────────────────────────

CREATE TABLE IF NOT EXISTS chat_sessions (
    id                  VARCHAR(36)  NOT NULL,
    user_id             VARCHAR(36)  NOT NULL,
    title               TEXT         NOT NULL,
    created_at          BIGINT       NOT NULL,
    updated_at          BIGINT       NOT NULL,
    message_count       INT          NOT NULL DEFAULT 0,
    total_input_tokens  INT          NOT NULL DEFAULT 0,
    total_output_tokens INT          NOT NULL DEFAULT 0,
    pinned              TINYINT(1)   NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    KEY idx_chat_sessions_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS chat_messages (
    id            VARCHAR(36)  NOT NULL,
    session_id    VARCHAR(36)  NOT NULL,
    user_id       VARCHAR(36)  NOT NULL,
    role          VARCHAR(20)  NOT NULL,
    content       MEDIUMTEXT   NOT NULL,
    citations     JSON         NOT NULL,
    created_at    BIGINT       NOT NULL,
    input_tokens  INT          NOT NULL DEFAULT 0,
    output_tokens INT          NOT NULL DEFAULT 0,
    model         VARCHAR(200) NOT NULL DEFAULT '',
    proposals     JSON         NOT NULL,
    PRIMARY KEY (id),
    KEY idx_chat_messages_session (session_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS document_embedding_status (
    user_id         VARCHAR(36)  NOT NULL,
    document_id     VARCHAR(36)  NOT NULL,
    task_id         VARCHAR(64),
    status          VARCHAR(32)  NOT NULL DEFAULT 'pending',
    expected_chunks INT          NOT NULL DEFAULT 0,
    embedded_chunks INT          NOT NULL DEFAULT 0,
    last_error      TEXT,
    updated_at      BIGINT       NOT NULL,
    last_indexed_at BIGINT,
    PRIMARY KEY (user_id, document_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_ui_preferences (
    user_id          VARCHAR(36)  NOT NULL,
    preference_key   VARCHAR(120) NOT NULL,
    preference_value LONGTEXT     NOT NULL,
    updated_at       BIGINT       NOT NULL,
    PRIMARY KEY (user_id, preference_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Usage / metering / rate limits ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS usage_events (
    id            VARCHAR(36)    NOT NULL,
    user_id       VARCHAR(36)    NOT NULL,
    operation     VARCHAR(64)    NOT NULL,
    model         VARCHAR(128)   NOT NULL,
    input_tokens  INT            NOT NULL,
    output_tokens INT            NOT NULL,
    cost_usd      DOUBLE         NOT NULL,
    recorded_at   DATETIME(6)    NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY usage_events_user_period (user_id, recorded_at),
    KEY usage_events_daily (recorded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS usage_counters (
    id                VARCHAR(36) NOT NULL,
    user_id           VARCHAR(36) NOT NULL,
    period_start      DATE        NOT NULL,
    tokens_in         BIGINT      NOT NULL DEFAULT 0,
    tokens_out        BIGINT      NOT NULL DEFAULT 0,
    embed_calls       BIGINT      NOT NULL DEFAULT 0,
    agent_invocations BIGINT      NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uc_user_period (user_id, period_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rate_limit_windows (
    user_id      VARCHAR(36) NOT NULL,
    window_type  VARCHAR(16) NOT NULL,
    window_start DATETIME(6) NOT NULL,
    tokens_used  BIGINT      NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, window_type, window_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS system_flags (
    `key`      VARCHAR(128) NOT NULL PRIMARY KEY,
    value      TEXT         NOT NULL,
    updated_at DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS subscriptions (
    id                 VARCHAR(36)  NOT NULL,
    user_id            VARCHAR(36)  NOT NULL,
    status             VARCHAR(32)  NOT NULL DEFAULT 'trialing',
    current_period_end DATETIME(6),
    created_at         DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at         DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY subscriptions_user_uk (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS embedding_calls (
    id           VARCHAR(36)  NOT NULL,
    user_id      VARCHAR(36)  NOT NULL,
    model        VARCHAR(200) NOT NULL,
    tokens       INT          NOT NULL DEFAULT 0,
    task_id      VARCHAR(64),
    task_type    VARCHAR(64)  NOT NULL DEFAULT 'unknown',
    session_id   VARCHAR(36),
    document_id  VARCHAR(36),
    paragraph_id VARCHAR(255),
    created_at   BIGINT       NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    KEY embedding_calls_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── OAuth ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS oauth_clients (
    id                              VARCHAR(36)  NOT NULL,
    name                            TEXT         NOT NULL,
    secret_hash                     TEXT,
    redirect_uris                   TEXT         NOT NULL,
    client_type                     VARCHAR(16)  NOT NULL,
    registration_kind               VARCHAR(8)   NOT NULL,
    owner_user_id                   VARCHAR(36),
    registration_access_token_hash  VARCHAR(64),
    created_at                      BIGINT       NOT NULL,
    updated_at                      BIGINT       NOT NULL,
    PRIMARY KEY (id),
    INDEX oauth_clients_owner (owner_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
    code_hash             VARCHAR(64)  NOT NULL,
    client_id             VARCHAR(36)  NOT NULL,
    user_id               VARCHAR(36)  NOT NULL,
    redirect_uri          TEXT         NOT NULL,
    scope                 TEXT         NOT NULL,
    code_challenge        TEXT         NOT NULL,
    code_challenge_method VARCHAR(8)   NOT NULL,
    expires_at            BIGINT       NOT NULL,
    consumed_at           BIGINT,
    PRIMARY KEY (code_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS oauth_access_tokens (
    id           VARCHAR(36)  NOT NULL,
    token_hash   VARCHAR(64)  NOT NULL UNIQUE,
    client_id    VARCHAR(36)  NOT NULL,
    user_id      VARCHAR(36)  NOT NULL,
    scope        TEXT         NOT NULL,
    kind         VARCHAR(8)   NOT NULL,
    name         TEXT         NOT NULL DEFAULT '',
    created_at   BIGINT       NOT NULL,
    last_used_at BIGINT,
    revoked_at   BIGINT,
    PRIMARY KEY (id),
    INDEX oauth_access_tokens_user (user_id),
    INDEX oauth_access_tokens_client (client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pending_edits (
    id          VARCHAR(36) NOT NULL,
    payload     LONGTEXT    NOT NULL,
    created_at  BIGINT      NOT NULL,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
