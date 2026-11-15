-- The store's schema.
--
-- Everything the service reasons about is relational: workspaces and who is
-- in them, which document is where, document versions, retention state, and
-- audit. Blob bytes live in `blob_data` for now; an object-store
-- implementation would replace that one table with a pointer column and
-- leave the rest untouched.
--
-- Document content is stored as the editor sends it. Anyone with this
-- database, or a dump of it, can read every document: protect it as you
-- would the documents themselves.
--
-- Applied in full at every startup, so every statement must be safe to
-- repeat. Tables that an earlier version created for the encrypted
-- workspace (devices, workspace_keys, workspace_index, user_recovery,
-- workspace_access_rules, join_requests, workspace_memberships) are neither
-- created nor touched here. An existing database keeps them until they are
-- dropped by hand; see docs/trusted-store.md.

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
    legal_hold_reason       TEXT
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

-- Everyone who has signed in. A person is (issuer, subject), never an
-- email address.
CREATE TABLE IF NOT EXISTS users (
    user_id      TEXT PRIMARY KEY,
    issuer       TEXT        NOT NULL,
    subject      TEXT        NOT NULL,
    display_name TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    disabled_at  TIMESTAMPTZ,
    UNIQUE (issuer, subject)
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

-- Changes for a database that an earlier version created. Applied at every
-- startup, so an existing database catches up without a separate migration
-- step; every statement is safe to repeat and does nothing to a new one.

-- The groups a sign-in carried, for workspace roles.
ALTER TABLE sessions       ADD COLUMN IF NOT EXISTS groups         TEXT[];
ALTER TABLE sessions       ADD COLUMN IF NOT EXISTS groups_overage BOOLEAN NOT NULL DEFAULT FALSE;

-- A database from the encrypted workspace required every document to carry
-- a wrapped key. Documents no longer have one, so the column - where it
-- exists - must accept nothing. It is otherwise left alone, with the other
-- columns of that time (documents.wrapped_for_recovery and sealed_meta,
-- sessions.id_token, commitment and evidence_iat, and
-- pending_logins.has_commitment): nothing reads or writes them.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'documents'
       AND column_name = 'wrapped_for_workspace'
       AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE documents ALTER COLUMN wrapped_for_workspace DROP NOT NULL;
  END IF;
END
$$;

-- Where the editor asked to be sent after signing in, when it is not the
-- configured address. Checked against the trusted origins before it is kept.
ALTER TABLE pending_logins ADD COLUMN IF NOT EXISTS return_to TEXT;

-- ---------------------------------------------------------------------------
-- Workspaces, members and group mappings.
--
-- The server decides access (store/src/permissions.ts). A person's role in
-- a workspace is the highest of their individual role here, the role of any
-- identity-provider group of theirs mapped here, and owner if they are a
-- store administrator. Group membership itself is never stored: it is read
-- from each sign-in.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS workspaces (
    workspace_id TEXT PRIMARY KEY,
    name         TEXT        NOT NULL,
    -- Kept when the creator's account is removed; the workspace outlives them.
    created_by   TEXT        REFERENCES users (user_id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Hidden from members and read-only while set.
    archived_at  TIMESTAMPTZ
);

-- Two workspaces must not look the same in a list.
CREATE UNIQUE INDEX IF NOT EXISTS workspaces_name_idx ON workspaces (lower(name));

-- People added individually. Someone who is in only through a group has no
-- row here.
CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id TEXT        NOT NULL REFERENCES workspaces (workspace_id) ON DELETE CASCADE,
    user_id      TEXT        NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    role         TEXT        NOT NULL CHECK (role IN ('viewer', 'editor', 'owner')),
    -- NULL when the store added them itself (the creator of a workspace).
    added_by     TEXT        REFERENCES users (user_id) ON DELETE SET NULL,
    added_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS workspace_members_user_idx ON workspace_members (user_id);

-- Identity-provider group -> role. The group is stored exactly as the
-- provider issues it and matched exactly, case included.
CREATE TABLE IF NOT EXISTS workspace_group_roles (
    workspace_id TEXT        NOT NULL REFERENCES workspaces (workspace_id) ON DELETE CASCADE,
    group_name   TEXT        NOT NULL,
    role         TEXT        NOT NULL CHECK (role IN ('viewer', 'editor', 'owner')),
    added_by     TEXT        REFERENCES users (user_id) ON DELETE SET NULL,
    added_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, group_name)
);

-- Which workspace each document is in, and its title (documentCatalog.ts).
-- The workspace decides who may touch the document; the title is plain text
-- so a workspace's documents can be listed without opening them. A document
-- with no row here is not reachable through the workspace API.
CREATE TABLE IF NOT EXISTS workspace_documents (
    -- Purging a document removes its catalog row with it.
    doc_id       TEXT PRIMARY KEY REFERENCES documents (doc_id) ON DELETE CASCADE,
    -- Workspaces are archived, never deleted, so a document cannot lose its
    -- workspace from under it.
    workspace_id TEXT        NOT NULL REFERENCES workspaces (workspace_id) ON DELETE RESTRICT,
    title        TEXT        NOT NULL,
    created_by   TEXT        REFERENCES users (user_id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- What a document's live session (its relay room and the key that encrypts
-- it between browsers) is derived from. Made the first time an editor asks.
ALTER TABLE workspace_documents ADD COLUMN IF NOT EXISTS session_secret TEXT;

CREATE INDEX IF NOT EXISTS workspace_documents_workspace_idx
    ON workspace_documents (workspace_id);
