/**
 * Upgrading a database that held the encrypted workspace.
 *
 * The schema is applied in full at every startup and must bring an older
 * database up to date without touching what is in it. The risk is specific:
 * that database required every document to carry a wrapped key, has
 * columns and tables this version no longer knows about, and holds
 * documents nobody has exported yet. This builds one in a scratch schema,
 * shaped as the last version with encryption left it, and checks that the
 * current store starts on it, works, and leaves the old data alone.
 *
 * PostgreSQL only: run with DATABASE_URL set.
 *   DATABASE_URL=postgresql://... npx tsx scripts/verify-store-upgrade.ts
 */
import pg from 'pg';
import { createPostgresStore } from '../store/src/postgresStore.ts';
import { createPostgresSessionStore } from '../store/src/auth/postgresSessions.ts';
import { createPostgresUserDirectory } from '../store/src/postgresUserDirectory.ts';
import { createPostgresWorkspaceStore } from '../store/src/postgresWorkspaces.ts';
import { createPostgresDocumentCatalog } from '../store/src/postgresDocumentCatalog.ts';

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.log('(DATABASE_URL is not set: the upgrade is not covered by this run)');
  process.exit(0);
}

const SCHEMA = 'upgrade_from_encrypted';

/**
 * The tables as the encrypted workspace's last schema created them, cut
 * down to the columns that matter here: the ones this version still uses,
 * and the ones that could trip it up.
 */
const OLD_SCHEMA = `
CREATE TABLE documents (
    doc_id                TEXT PRIMARY KEY,
    version               BIGINT      NOT NULL DEFAULT 1,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at            TIMESTAMPTZ,
    purge_after           TIMESTAMPTZ,
    legal_hold            BOOLEAN     NOT NULL DEFAULT FALSE,
    legal_hold_reason     TEXT,
    wrapped_for_workspace BYTEA       NOT NULL,
    wrapped_for_recovery  BYTEA,
    sealed_meta           BYTEA
);
CREATE TABLE blobs (
    doc_id      TEXT        NOT NULL REFERENCES documents (doc_id) ON DELETE CASCADE,
    blob_id     TEXT        NOT NULL,
    kind        TEXT        NOT NULL,
    version     BIGINT      NOT NULL,
    byte_length INTEGER     NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    superseded  BOOLEAN     NOT NULL DEFAULT FALSE,
    PRIMARY KEY (doc_id, blob_id)
);
CREATE TABLE blob_data (
    doc_id  TEXT  NOT NULL,
    blob_id TEXT  NOT NULL,
    bytes   BYTEA NOT NULL,
    PRIMARY KEY (doc_id, blob_id),
    FOREIGN KEY (doc_id, blob_id) REFERENCES blobs (doc_id, blob_id) ON DELETE CASCADE
);
CREATE TABLE users (
    user_id         TEXT PRIMARY KEY,
    issuer          TEXT        NOT NULL,
    subject         TEXT        NOT NULL,
    display_name    TEXT,
    user_public_key BYTEA,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    disabled_at     TIMESTAMPTZ,
    last_groups     TEXT[],
    last_groups_at  TIMESTAMPTZ,
    UNIQUE (issuer, subject)
);
CREATE TABLE devices (
    device_id  TEXT PRIMARY KEY,
    user_id    TEXT  NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    public_key BYTEA NOT NULL
);
CREATE TABLE workspace_keys (
    user_id     TEXT    NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    generation  INTEGER NOT NULL,
    wrapped_key BYTEA   NOT NULL,
    PRIMARY KEY (user_id, generation)
);
CREATE TABLE workspace_index (
    workspace_id TEXT PRIMARY KEY,
    version      BIGINT NOT NULL DEFAULT 0,
    sealed       BYTEA
);
CREATE TABLE sessions (
    session_id     TEXT PRIMARY KEY,
    issuer         TEXT        NOT NULL,
    subject        TEXT        NOT NULL,
    display_name   TEXT,
    user_id        TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at     TIMESTAMPTZ NOT NULL,
    id_token       TEXT,
    commitment     TEXT,
    evidence_iat   BIGINT
);
CREATE TABLE pending_logins (
    state          TEXT PRIMARY KEY,
    provider       TEXT        NOT NULL,
    nonce          TEXT        NOT NULL,
    code_verifier  TEXT        NOT NULL,
    redirect_uri   TEXT        NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    has_commitment BOOLEAN     NOT NULL DEFAULT FALSE
);
CREATE TABLE audit_log (
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

INSERT INTO users (user_id, issuer, subject, display_name, user_public_key, last_groups)
VALUES ('u-old', 'https://idp.example', 'old-ada', 'Ada', 'public-key', ARRAY['/design-team-a']);
INSERT INTO devices (device_id, user_id, public_key) VALUES ('d-old', 'u-old', 'device-key');
INSERT INTO workspace_keys (user_id, generation, wrapped_key) VALUES ('u-old', 1, 'wrapped');
INSERT INTO workspace_index (workspace_id, version, sealed) VALUES ('default', 3, 'sealed-index');
INSERT INTO documents (doc_id, version, wrapped_for_workspace, wrapped_for_recovery, sealed_meta)
VALUES ('old-encrypted-doc', 2, 'wrapped-doc-key', 'escrowed', 'sealed-title');
INSERT INTO blobs (doc_id, blob_id, kind, version, byte_length)
VALUES ('old-encrypted-doc', 'b1', 'update', 2, 10);
INSERT INTO blob_data (doc_id, blob_id, bytes) VALUES ('old-encrypted-doc', 'b1', 'ciphertext');
INSERT INTO documents (doc_id, version, wrapped_for_workspace, deleted_at, purge_after)
VALUES ('old-deleted-doc', 3, 'wrapped-doc-key', now() - interval '1 day', now() + interval '20 days');
INSERT INTO sessions (session_id, issuer, subject, user_id, expires_at, id_token, commitment, evidence_iat)
VALUES ('old-session', 'https://idp.example', 'old-ada', 'u-old', now() + interval '1 hour', 'raw.id.token', 'c', 1);
INSERT INTO audit_log (subject, doc_id, operation, outcome)
VALUES ('https://idp.example#old-ada', 'old-encrypted-doc', 'append', 'ok');
`;

const admin = new pg.Pool({ connectionString: DATABASE_URL });
// Everything below runs with the scratch schema as the only one in view, as
// a deployment's database is.
const scoped = new URL(DATABASE_URL);
scoped.searchParams.set('options', `-c search_path=${SCHEMA}`);
const connectionString = scoped.toString();

try {
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  const setup = await admin.connect();
  try {
    await setup.query(`SET search_path TO ${SCHEMA}`);
    await setup.query(OLD_SCHEMA);
  } finally {
    await setup.query('RESET search_path');
    setup.release();
  }

  const pool = new pg.Pool({ connectionString });
  const store = createPostgresStore({ connectionString });
  const one = async <T = unknown>(sql: string): Promise<T | undefined> =>
    (await pool.query(sql)).rows[0]?.value as T | undefined;

  try {
    console.log('=== The current store starts on it ===');
    let migrated = true;
    try {
      await store.migrate();
      // Every startup applies it again.
      await store.migrate();
    } catch (error) {
      migrated = false;
      console.error(error);
    }
    check(migrated, 'the schema applies to a database from the encrypted workspace, twice over');

    console.log('\n=== And works ===');
    let created = '';
    try {
      const record = await store.create({ docId: 'new-doc' });
      await store.append({ docId: 'new-doc', kind: 'update', bytes: new Uint8Array([1, 2, 3]) });
      created = `version ${record.version}`;
    } catch (error) {
      created = `refused: ${String(error)}`;
    }
    check(
      created === 'version 1',
      `a document is created without a wrapped key, which that database used to require (${created})`,
    );
    check(
      ((await store.read('new-doc')).blobs[0]?.bytes ?? []).length === 3,
      'and its updates are stored and read back',
    );

    const directory = createPostgresUserDirectory(pool);
    const returning = await directory.upsertUser({
      issuer: 'https://idp.example',
      subject: 'old-ada',
      displayName: 'Ada Lovelace',
    });
    check(
      returning.userId === 'u-old' && returning.displayName === 'Ada Lovelace',
      'someone who signed in before is the same person afterwards',
    );

    const sessions = createPostgresSessionStore(pool);
    const session = await sessions.create({
      issuer: 'https://idp.example',
      subject: 'old-ada',
      groups: ['/design-team-a'],
    });
    check(
      (await sessions.get(session.id))?.groups?.[0] === '/design-team-a',
      'a new sign-in is recorded, with its groups',
    );
    const carried = await sessions.get('old-session');
    check(
      carried?.subject === 'old-ada' && !('evidence' in (carried ?? {})),
      'a session from before the upgrade still works, and its stored ID token is not read',
    );
    await sessions.remember({
      provider: 'oidc',
      state: 'state-after-upgrade',
      nonce: 'n',
      codeVerifier: 'v',
      redirectUri: 'https://store.example/v1/auth/callback',
      createdAt: Date.now(),
      returnTo: 'https://editor.example/?doc=a',
    });
    check(
      (await sessions.take('state-after-upgrade'))?.returnTo === 'https://editor.example/?doc=a',
      'a sign-in can be started and completed',
    );

    const workspaces = createPostgresWorkspaceStore(pool);
    const catalog = createPostgresDocumentCatalog(pool);
    const workspace = await workspaces.createWorkspace({
      name: 'After upgrade',
      createdBy: 'u-old',
    });
    const entry = await catalog.add({
      docId: 'new-doc',
      workspaceId: workspace.workspaceId,
      title: 'First',
      createdBy: 'u-old',
    });
    check(
      entry.workspaceId === workspace.workspaceId &&
        (await workspaces.listMembers(workspace.workspaceId))[0]?.userId === 'u-old',
      'a workspace is created by a person from before, and a document put in it',
    );

    console.log('\n=== What was there is left alone ===');
    const oldDoc = (
      await pool.query(
        `SELECT version, encode(wrapped_for_workspace, 'escape') AS key,
                encode(sealed_meta, 'escape') AS meta
           FROM documents WHERE doc_id = 'old-encrypted-doc'`,
      )
    ).rows[0] as { version: string; key: string; meta: string } | undefined;
    check(
      oldDoc?.version === '2' && oldDoc.key === 'wrapped-doc-key' && oldDoc.meta === 'sealed-title',
      'a document of the encrypted workspace is still there, with its key and metadata',
    );
    check(
      (await one<string>(
        `SELECT encode(bytes, 'escape') AS value FROM blob_data WHERE doc_id = 'old-encrypted-doc'`,
      )) === 'ciphertext',
      'and so is its content',
    );
    const swept = await store.purgeDue();
    check(
      !swept.includes('old-encrypted-doc') &&
        !swept.includes('old-deleted-doc') &&
        (await one<string>(`SELECT count(*)::text AS value FROM documents`)) === '3',
      'the retention sweep removes neither it nor a deleted one still inside its retention',
    );
    const stillThere: string[] = [];
    for (const table of ['devices', 'workspace_keys', 'workspace_index']) {
      const count = await one<string>(`SELECT count(*)::text AS value FROM ${table}`);
      if (count === '1') stillThere.push(table);
    }
    check(
      stillThere.length === 3,
      `the tables this version no longer uses keep their rows (${stillThere.join(', ')})`,
    );
    check(
      (await one<string>(
        `SELECT encode(user_public_key, 'escape') AS value FROM users WHERE user_id = 'u-old'`,
      )) === 'public-key',
      'as do the columns it no longer reads',
    );
    check(
      (await one<string>(`SELECT count(*)::text AS value FROM audit_log`)) === '1',
      'and the audit trail from before is intact',
    );
    check(
      (await workspaces.listAccessible({ userId: 'u-old', groups: [], isAdmin: true })).every(
        (access) => access.workspace.name === 'After upgrade',
      ) && (await catalog.listByWorkspace(workspace.workspaceId)).length === 1,
      'the old documents are in no workspace, so nobody is shown them',
    );
  } finally {
    await store.close();
    await pool.end();
  }
} finally {
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.end();
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll store upgrade checks passed.');
