-- One-time rollover of the legacy `mcp_tokens` table into `oauth_access_tokens`.
-- No-op on fresh databases (mcp_tokens never existed). The PAT client itself is
-- seeded lazily by kaya_oauth::clients::ensure_pat_client on first use, so we
-- only need to migrate the token rows here.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = 'mcp_tokens'
    ) THEN
        INSERT INTO oauth_clients
            (id, name, secret_hash, redirect_uris, client_type, registration_kind,
             owner_user_id, registration_access_token_hash, created_at, updated_at)
        VALUES (
            '00000000-0000-0000-0000-0000000a7100',
            'Personal access tokens',
            NULL,
            '["urn:kaya:pat"]',
            'public',
            'manual',
            NULL,
            NULL,
            (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT,
            (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT
        )
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO oauth_access_tokens
            (id, token_hash, client_id, user_id, scope, kind, name,
             created_at, last_used_at)
        SELECT
            mt.id,
            mt.token_hash,
            '00000000-0000-0000-0000-0000000a7100',
            mt.user_id,
            'mcp',
            'pat',
            mt.name,
            mt.created_at,
            mt.last_used_at
        FROM mcp_tokens mt
        WHERE NOT EXISTS (
            SELECT 1 FROM oauth_access_tokens t WHERE t.token_hash = mt.token_hash
        );

        DROP TABLE mcp_tokens;
    END IF;
END $$;
