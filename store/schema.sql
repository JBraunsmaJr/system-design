-- The store's schema (WS8-R16).
--
-- Everything the service reasons about is relational: document versions,
-- wrapped keys, retention state, and audit. Blob bytes live in `blob_data`
-- for now; an object-store implementation would replace that one table with a
-- pointer column and leave the rest untouched (WS8-R17 decides when).
--
-- The service never reads blob contents. Every `bytea` here is ciphertext or
-- a wrapped key, opaque to PostgreSQL and to anyone with a database dump.

CREATE TABLE IF NOT EXISTS documents (
    doc_id                  TEXT PRIMARY KEY,
    -- WS8-R15: increases on every accepted write, and on delete and restore.
    -- Clients refuse a response older than the newest they have seen.
    version                 BIGINT      NOT NULL DEFAULT 1,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- WS10-R4: soft deletion. Rows and blobs stay until purge.
    deleted_at              TIMESTAMPTZ,
    purge_after             TIMESTAMPTZ,
    -- WS10-R8: a hold prevents purge in every retention mode.
    legal_hold              BOOLEAN     NOT NULL DEFAULT FALSE,
    legal_hold_reason       TEXT,
    -- WS7-R3 and R4, opaque to the store.
    wrapped_for_workspace   BYTEA       NOT NULL,
    wrapped_for_recovery    BYTEA,
    -- WS9-R1: the title is sealed; the store cannot enumerate titles.
    sealed_title            BYTEA
);

-- Purge sweeps and the deleted-items view (WS9-R6) both read this.
CREATE INDEX IF NOT EXISTS documents_purge_idx
    ON documents (purge_after)
    WHERE deleted_at IS NOT NULL AND legal_hold = FALSE;

CREATE INDEX IF NOT EXISTS documents_live_idx
    ON documents (updated_at DESC)
    WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS blobs (
    doc_id      TEXT        NOT NULL REFERENCES documents (doc_id) ON DELETE CASCADE,
    blob_id     TEXT        NOT NULL,
    kind        TEXT        NOT NULL,
    -- The document version this blob was written at; bound into its envelope
    -- (WS6-R4), so a blob cannot be replayed at another version.
    version     BIGINT      NOT NULL,
    byte_length INTEGER     NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    superseded  BOOLEAN     NOT NULL DEFAULT FALSE,
    PRIMARY KEY (doc_id, blob_id)
);

CREATE INDEX IF NOT EXISTS blobs_doc_idx ON blobs (doc_id, created_at);

-- Separate from `blobs` so an object-store implementation can drop this table
-- and add a pointer column, without touching metadata or its indexes.
CREATE TABLE IF NOT EXISTS blob_data (
    doc_id  TEXT  NOT NULL,
    blob_id TEXT  NOT NULL,
    bytes   BYTEA NOT NULL,
    PRIMARY KEY (doc_id, blob_id),
    FOREIGN KEY (doc_id, blob_id) REFERENCES blobs (doc_id, blob_id) ON DELETE CASCADE
);

-- WS7-R8: the workspace key, wrapped once per member; and each member's user
-- key, wrapped once per device. The store holds only wraps.
CREATE TABLE IF NOT EXISTS users (
    user_id      TEXT PRIMARY KEY,
    -- WS10-R1: identity is (issuer, subject), never an email address.
    issuer       TEXT        NOT NULL,
    subject      TEXT        NOT NULL,
    display_name TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    disabled_at  TIMESTAMPTZ,
    UNIQUE (issuer, subject)
);

CREATE TABLE IF NOT EXISTS devices (
    device_id      TEXT PRIMARY KEY,
    user_id        TEXT        NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    label          TEXT,
    public_key     BYTEA       NOT NULL,
    -- The user's private key, wrapped to this device (WS7-R8).
    wrapped_user_key BYTEA,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_at    TIMESTAMPTZ,
    revoked_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS devices_user_idx ON devices (user_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS workspace_keys (
    user_id     TEXT        NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    generation  INTEGER     NOT NULL,
    wrapped_key BYTEA       NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, generation)
);

-- WS10-R3: every request, for forwarding to a SIEM. Append-only by
-- convention; a deployment that needs it enforced can revoke UPDATE/DELETE.
CREATE TABLE IF NOT EXISTS audit_log (
    id         BIGSERIAL PRIMARY KEY,
    at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    issuer     TEXT,
    subject    TEXT,
    user_id    TEXT,
    device_id  TEXT,
    doc_id     TEXT,
    operation  TEXT        NOT NULL,
    outcome    TEXT        NOT NULL,
    detail     JSONB
);

CREATE INDEX IF NOT EXISTS audit_at_idx ON audit_log (at DESC);
CREATE INDEX IF NOT EXISTS audit_doc_idx ON audit_log (doc_id, at DESC);
