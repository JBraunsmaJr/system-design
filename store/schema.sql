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
    -- WS9-R1: sealed per-document metadata (the title among it). The store
    -- cannot enumerate titles; this is ciphertext to it.
    sealed_meta             BYTEA
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
    -- WS7-R8: the member's public user key, so an administrator or another
    -- member can wrap the workspace key to them. Public by nature.
    user_public_key BYTEA,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    disabled_at  TIMESTAMPTZ,
    UNIQUE (issuer, subject)
);

CREATE TABLE IF NOT EXISTS devices (
    device_id      TEXT PRIMARY KEY,
    user_id        TEXT        NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    label          TEXT,
    public_key     BYTEA       NOT NULL,
    -- The user's private key, wrapped to this device (WS7-R8): the sealed
    -- body and the one-off key wrapped to this device's public key. Present
    -- only once another device has approved this one (WS7-R11).
    wrapped_user_key_body BYTEA,
    wrapped_user_key_wrap BYTEA,
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

-- WS9-R1: one sealed index blob per workspace, holding {docId,
-- wrappedDocKey, encryptedTitle, updatedAt} per document. Ciphertext to the
-- store, which is why it cannot enumerate titles (WS9-R5). `version` makes
-- writes conditional, so two clients cannot silently overwrite each other
-- (WS9-R3).
CREATE TABLE IF NOT EXISTS workspace_index (
    workspace_id TEXT PRIMARY KEY,
    sealed       BYTEA       NOT NULL,
    version      BIGINT      NOT NULL DEFAULT 1,
    -- Which workspace key generation sealed this index (WS7-R7). A reader
    -- that holds an older generation knows to fetch the newer key rather
    -- than conclude the index is corrupt.
    generation   INTEGER     NOT NULL DEFAULT 1,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- WS7-R12: the user's private key, sealed under a key derived from their
-- recovery code. The code itself is never stored, in any form.
CREATE TABLE IF NOT EXISTS user_recovery (
    user_id         TEXT PRIMARY KEY REFERENCES users (user_id) ON DELETE CASCADE,
    salt            BYTEA       NOT NULL,
    sealed_user_key BYTEA       NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- WS10-R1: sessions, so a restart does not sign everyone out and a second
-- instance behind a load balancer sees the same ones. The cookie is an
-- opaque id; nothing here is a credential a browser holds.
CREATE TABLE IF NOT EXISTS sessions (
    session_id   TEXT PRIMARY KEY,
    issuer       TEXT        NOT NULL,
    subject      TEXT        NOT NULL,
    display_name TEXT,
    user_id      TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (expires_at);

-- Sign-ins that have started and not come back yet. Single use, and swept
-- once they expire: a state that returns twice is a replay.
CREATE TABLE IF NOT EXISTS pending_logins (
    state         TEXT PRIMARY KEY,
    provider      TEXT        NOT NULL,
    nonce         TEXT        NOT NULL,
    code_verifier TEXT        NOT NULL,
    redirect_uri  TEXT        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
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

-- Columns added after a deployment may already have created these tables.
-- Applied every startup, so an existing database catches up without a
-- separate migration step. A real migration tool arrives with WS8-R9.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS sealed_meta BYTEA;
ALTER TABLE documents DROP COLUMN IF EXISTS sealed_title;
ALTER TABLE devices   ADD COLUMN IF NOT EXISTS wrapped_user_key_body BYTEA;
ALTER TABLE devices   ADD COLUMN IF NOT EXISTS wrapped_user_key_wrap BYTEA;
ALTER TABLE devices   DROP COLUMN IF EXISTS wrapped_user_key;
ALTER TABLE users     ADD COLUMN IF NOT EXISTS user_public_key BYTEA;
ALTER TABLE workspace_index ADD COLUMN IF NOT EXISTS generation INTEGER NOT NULL DEFAULT 1;
