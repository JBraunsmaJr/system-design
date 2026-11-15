/**
 * The workspace API (/v2), over HTTP, against both backends.
 *
 * The server decides access in this API, so the most important thing to
 * check is refusal. The first half is a table of every route with the least
 * a caller needs for it; each route is then called by everyone who has less
 * than that, and must refuse them - without changing anything. The second
 * half checks that each route does its job for someone who is allowed.
 *
 * Refusals come in two kinds, deliberately:
 *   404 for someone with no role in the workspace - the same reply as for a
 *       workspace or document that does not exist;
 *   403 for someone who is in the workspace but whose role is not enough.
 *
 * Memory always; PostgreSQL when DATABASE_URL is set.
 */
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { createMemoryBlobStore, type MemoryTx } from '../store/src/blobStore.ts';
import { createDocumentService } from '../store/src/documentService.ts';
import {
  createHttpService,
  createMemoryAuditSink,
  type StoreBackend,
} from '../store/src/httpService.ts';
import { createMemoryUserDirectory, type UserDirectory } from '../store/src/userDirectory.ts';
import { createSessionStore, SESSION_COOKIE } from '../store/src/auth/sessions.ts';
import type { Provider } from '../store/src/auth/providers.ts';
import { createMemoryWorkspaceStore, type WorkspaceStore } from '../store/src/workspaces.ts';
import { createMemoryDocumentCatalog, type DocumentCatalog } from '../store/src/documentCatalog.ts';
import { createPostgresStore } from '../store/src/postgresStore.ts';
import { createPostgresUserDirectory } from '../store/src/postgresUserDirectory.ts';
import { createPostgresWorkspaceStore } from '../store/src/postgresWorkspaces.ts';
import { createPostgresDocumentCatalog } from '../store/src/postgresDocumentCatalog.ts';
import { createV2Api } from '../store/src/v2/api.ts';

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const ISSUER = 'https://store-v2.test';
const ADMIN_GROUP = 'notebook-admin';
const EDITOR_ORIGIN = 'https://editor.example';

/** Sign-in is not under test here; sessions are made directly. */
const noProvider: Provider = {
  id: 'test',
  begin: async () => {
    throw new Error('not used');
  },
  complete: async () => {
    throw new Error('not used');
  },
  describe: () => ({ kind: 'oidc', clientId: 'test' }),
};

interface Backend {
  documents: StoreBackend;
  directory: UserDirectory;
  workspaces: WorkspaceStore;
  catalog: DocumentCatalog;
  dispose(): Promise<void>;
}

function memoryBackend(): Backend {
  const blobs = createMemoryBlobStore();
  const documents = createDocumentService<MemoryTx>({
    blobs,
    begin: () => blobs.begin(),
    commit: (tx) => blobs.commit(tx),
    rollback: (tx) => blobs.rollback(tx),
  }) as unknown as StoreBackend;
  const directory = createMemoryUserDirectory();
  const workspaces = createMemoryWorkspaceStore({
    userExists: (userId) =>
      directory.getUser(userId).then(
        () => true,
        () => false,
      ),
  });
  const catalog = createMemoryDocumentCatalog({
    workspaceExists: async (id) => (await workspaces.getWorkspace(id)) !== null,
  });
  return { documents, directory, workspaces, catalog, dispose: async () => {} };
}

async function postgresBackend(): Promise<Backend> {
  const store = createPostgresStore({ connectionString: DATABASE_URL });
  await store.migrate();
  const pg = (await import('pg')).default;
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const cleanUp = async () => {
    await pool.query(`UPDATE documents SET legal_hold = FALSE WHERE doc_id LIKE 'v2t-%'`);
    await pool.query(`DELETE FROM documents WHERE doc_id LIKE 'v2t-%'`);
    await pool.query(
      `DELETE FROM workspace_documents WHERE workspace_id IN
         (SELECT workspace_id FROM workspaces WHERE name LIKE 'V2T %')`,
    );
    await pool.query(`DELETE FROM workspaces WHERE name LIKE 'V2T %'`);
    await pool.query('DELETE FROM users WHERE issuer = $1', [ISSUER]);
  };
  await cleanUp();
  return {
    documents: store as unknown as StoreBackend,
    directory: createPostgresUserDirectory(pool),
    workspaces: createPostgresWorkspaceStore(pool),
    catalog: createPostgresDocumentCatalog(pool),
    async dispose() {
      await cleanUp();
      await pool.end();
      await store.close();
    },
  };
}

interface Actor {
  name: string;
  userId: string;
  cookie: string;
}

interface Reply {
  status: number;
  body: Record<string, unknown>;
  version: string | null;
  reason: string;
  message: string;
}

const b64 = (text: string) => Buffer.from(text).toString('base64');

async function run(label: string, backend: Backend) {
  console.log(`\n=== ${label} ===`);
  const sessions = createSessionStore();
  const audit = createMemoryAuditSink();
  let origin = '';
  const server: Server = createHttpService({
    store: backend.documents,
    audit,
    providers: [noProvider],
    sessions,
    directory: backend.directory,
    publicUrl: () => origin,
    allowedOrigins: [EDITOR_ORIGIN],
    v2: createV2Api({
      workspaces: backend.workspaces,
      catalog: backend.catalog,
      documents: backend.documents,
      directory: backend.directory,
      isAdmin: ({ groups }) => groups.includes(ADMIN_GROUP),
      workspaceCreation: 'admins',
      publicUrl: () => origin,
      allowedOrigins: [EDITOR_ORIGIN],
    }),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function signIn(name: string, groups: string[] = []): Promise<Actor> {
    const user = await backend.directory.upsertUser({
      issuer: ISSUER,
      subject: name,
      displayName: name[0].toUpperCase() + name.slice(1),
    });
    const session = await sessions.create({
      issuer: ISSUER,
      subject: name,
      displayName: user.displayName,
      groups,
    });
    await sessions.setUserId(session.id, user.userId);
    return { name, userId: user.userId, cookie: `${SESSION_COOKIE}=${session.id}` };
  }

  async function call(
    actor: Actor | null,
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<Reply> {
    const response = await fetch(`${origin}/v2${path}`, {
      method,
      headers: {
        ...(actor ? { cookie: actor.cookie } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await response.text();
    const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    const error = (parsed.error ?? {}) as { reason?: string; message?: string };
    return {
      status: response.status,
      body: parsed,
      version: response.headers.get('x-document-version'),
      reason: error.reason ?? '',
      message: error.message ?? '',
    };
  }

  try {
    // --- The cast --------------------------------------------------------------
    const admin = await signIn('admin', [ADMIN_GROUP]);
    // A second administrator who creates nothing, so is in no workspace.
    const root = await signIn('root', [ADMIN_GROUP]);
    const olive = await signIn('olive'); // owner of A
    const ed = await signIn('ed'); // editor of A
    const vic = await signIn('vic'); // viewer of A
    const gil = await signIn('gil', ['platform-eng']); // editor of A through a group
    const mo = await signIn('mo'); // editor of A and of B
    const out = await signIn('out'); // editor of B only: an outsider to A

    // --- No sign-in needed -----------------------------------------------------
    const health = await call(null, 'GET', '/health');
    check(
      health.status === 200 && health.body.mode === 'trusted',
      'health needs no sign-in and says the server can read documents',
    );

    // --- Setting up: also the first checks that allowed things work ------------
    const createdA = await call(admin, 'POST', '/workspaces', { name: 'V2T Platform' });
    const A = (createdA.body.workspace as { workspaceId: string }).workspaceId;
    check(createdA.status === 201 && !!A, 'an administrator creates a workspace');
    const createdB = await call(admin, 'POST', '/workspaces', { name: 'V2T Payments' });
    const B = (createdB.body.workspace as { workspaceId: string }).workspaceId;

    const member = (workspace: string, who: Actor, role: string) =>
      call(admin, 'PUT', `/workspaces/${workspace}/members/${who.userId}`, { role });
    check((await member(A, olive, 'owner')).status === 200, 'and adds an owner');
    await member(A, ed, 'editor');
    await member(A, vic, 'viewer');
    await member(A, mo, 'editor');
    await member(B, mo, 'editor');
    await member(B, out, 'editor');
    check(
      (await call(olive, 'PUT', `/workspaces/${A}/groups/platform-eng`, { role: 'editor' }))
        .status === 200,
      'an owner maps a group to a role',
    );

    const D1 = 'v2t-d1';
    const createdDoc = await call(ed, 'POST', `/workspaces/${A}/documents`, {
      docId: D1,
      title: 'Northwind',
    });
    check(
      createdDoc.status === 201 && createdDoc.version === '1',
      'an editor creates a document, and the reply carries its version',
    );
    check(
      (await call(ed, 'POST', `/documents/${D1}/updates`, { bytes: b64('first') })).status === 201,
      'and appends an update to it',
    );

    // --- The refusal table -----------------------------------------------------
    // `needs` is the least a caller must be. Everyone below that is refused.
    type Needs = 'viewer' | 'editor' | 'owner' | 'admin' | 'signed-in';
    interface Route {
      method: string;
      path: string;
      body?: unknown;
      needs: Needs;
    }
    const routes: Route[] = [
      { method: 'GET', path: '/me', needs: 'signed-in' },
      { method: 'GET', path: '/workspaces', needs: 'signed-in' },
      { method: 'POST', path: '/workspaces', body: { name: 'V2T Sneaky' }, needs: 'admin' },
      { method: 'GET', path: `/workspaces/${A}`, needs: 'viewer' },
      { method: 'PATCH', path: `/workspaces/${A}`, body: { name: 'V2T Renamed' }, needs: 'owner' },
      { method: 'POST', path: `/workspaces/${A}/archive`, needs: 'admin' },
      { method: 'POST', path: `/workspaces/${A}/restore`, needs: 'admin' },
      { method: 'GET', path: `/workspaces/${A}/members`, needs: 'viewer' },
      {
        method: 'PUT',
        path: `/workspaces/${A}/members/${vic.userId}`,
        body: { role: 'owner' },
        needs: 'owner',
      },
      { method: 'DELETE', path: `/workspaces/${A}/members/${ed.userId}`, needs: 'owner' },
      {
        method: 'PUT',
        path: `/workspaces/${A}/groups/everyone`,
        body: { role: 'owner' },
        needs: 'owner',
      },
      { method: 'DELETE', path: `/workspaces/${A}/groups/platform-eng`, needs: 'owner' },
      { method: 'GET', path: `/workspaces/${A}/people?query=ol`, needs: 'owner' },
      { method: 'GET', path: `/workspaces/${A}/documents`, needs: 'viewer' },
      { method: 'GET', path: `/workspaces/${A}/documents?deleted=true`, needs: 'editor' },
      {
        method: 'POST',
        path: `/workspaces/${A}/documents`,
        body: { docId: 'v2t-sneaky', title: 'Sneaky' },
        needs: 'editor',
      },
      { method: 'GET', path: `/documents/${D1}`, needs: 'viewer' },
      { method: 'PATCH', path: `/documents/${D1}`, body: { title: 'Defaced' }, needs: 'editor' },
      { method: 'PATCH', path: `/documents/${D1}`, body: { workspaceId: B }, needs: 'editor' },
      { method: 'DELETE', path: `/documents/${D1}`, needs: 'editor' },
      { method: 'POST', path: `/documents/${D1}/restore`, needs: 'editor' },
      { method: 'GET', path: `/documents/${D1}/updates?since=0`, needs: 'viewer' },
      {
        method: 'POST',
        path: `/documents/${D1}/updates`,
        body: { bytes: b64('tamper') },
        needs: 'editor',
      },
      {
        method: 'POST',
        path: `/documents/${D1}/compact`,
        body: { bytes: b64('tamper') },
        needs: 'editor',
      },
      { method: 'PUT', path: `/documents/${D1}/hold`, body: { reason: 'x' }, needs: 'admin' },
      { method: 'DELETE', path: `/documents/${D1}/hold`, needs: 'admin' },
      { method: 'POST', path: `/documents/${D1}/purge`, needs: 'admin' },
    ];

    const RANK: Record<Needs, number> = {
      'signed-in': 0,
      viewer: 1,
      editor: 2,
      owner: 3,
      admin: 4,
    };
    // Each caller's standing in workspace A.
    const callers: { actor: Actor | null; label: string; rank: number; inA: boolean }[] = [
      { actor: null, label: 'nobody signed in', rank: -1, inA: false },
      { actor: out, label: 'an outsider', rank: 0, inA: false },
      { actor: vic, label: 'a viewer', rank: 1, inA: true },
      { actor: ed, label: 'an editor', rank: 2, inA: true },
      { actor: gil, label: 'an editor through a group', rank: 2, inA: true },
      { actor: olive, label: 'an owner', rank: 3, inA: true },
    ];

    console.log(`\n  -- refusals: ${routes.length} routes --`);
    for (const route of routes) {
      for (const caller of callers) {
        if (caller.rank >= RANK[route.needs]) continue;
        const reply = await call(caller.actor, route.method, route.path, route.body);
        // Not signed in: 401. Store-wide actions: 403 for everyone else.
        // Otherwise an outsider sees nothing (404) and a member whose role
        // is too low is told so (403).
        const expected =
          caller.actor === null ? 401 : route.needs === 'admin' || caller.inA ? 403 : 404;
        check(
          reply.status === expected,
          `${route.method} ${route.path
            .replace(A, 'A')
            .replace(B, 'B')
            .replace(
              /\/members\/[^/?]+/,
              '/members/:user',
            )} refuses ${caller.label} with ${expected}${reply.status === expected ? '' : ` (got ${reply.status} ${reply.reason})`}`,
        );
      }
    }

    // None of that changed anything.
    const afterRefusals = await call(admin, 'GET', `/workspaces/${A}`);
    check(
      (afterRefusals.body.workspace as { name: string; archivedAt: unknown }).name ===
        'V2T Platform' &&
        (afterRefusals.body.workspace as { archivedAt: unknown }).archivedAt === null,
      'after every refusal the workspace has its name and is not archived',
    );
    const membersAfter = await call(admin, 'GET', `/workspaces/${A}/members`);
    const roleOf = (reply: Reply, userId: string) =>
      (reply.body.members as { userId: string; role: string }[]).find((m) => m.userId === userId)
        ?.role;
    check(
      roleOf(membersAfter, vic.userId) === 'viewer' &&
        roleOf(membersAfter, ed.userId) === 'editor' &&
        (membersAfter.body.groups as { group: string }[]).map((g) => g.group).join(',') ===
          'platform-eng',
      'members and group mappings are as they were',
    );
    const docAfter = await call(admin, 'GET', `/documents/${D1}`);
    const docOf = (reply: Reply) =>
      reply.body.document as {
        title: string;
        version: number;
        workspaceId: string;
        deletedAt: string | null;
        legalHold: unknown;
      };
    check(
      docOf(docAfter).title === 'Northwind' &&
        docOf(docAfter).version === 2 &&
        docOf(docAfter).workspaceId === A &&
        docOf(docAfter).deletedAt === null &&
        docOf(docAfter).legalHold === null &&
        (docAfter.body.blobs as unknown[]).length === 1,
      'the document has its title, version, workspace and single update',
    );
    check(
      (await call(admin, 'GET', '/workspaces')).body.workspaces !== undefined &&
        ((await call(admin, 'GET', '/workspaces')).body.workspaces as { name: string }[]).every(
          (w) => w.name !== 'V2T Sneaky',
        ),
      'and no workspace was created',
    );
    const denied = audit.all().filter((entry) => entry.outcome === 'denied');
    check(
      denied.some((e) => e.operation === 'document.append' && e.docId === D1) &&
        denied.some((e) => e.operation === 'workspace.rename'),
      'refusals are in the audit trail, named by what was attempted',
    );

    // An outsider cannot tell a real workspace or document from a missing one.
    const realWs = await call(out, 'GET', `/workspaces/${A}`);
    const fakeWs = await call(out, 'GET', '/workspaces/ws_does-not-exist');
    check(
      realWs.status === 404 && fakeWs.status === 404 && realWs.message === fakeWs.message,
      'to an outsider a real workspace and a missing one give the same reply',
    );
    const realDoc = await call(out, 'GET', `/documents/${D1}`);
    const fakeDoc = await call(out, 'GET', '/documents/v2t-does-not-exist');
    check(
      realDoc.status === 404 && fakeDoc.status === 404 && realDoc.message === fakeDoc.message,
      'and so do a real document and a missing one',
    );

    // --- Who am I, and what can I see -------------------------------------------
    console.log('\n  -- allowed --');
    const meAdmin = await call(admin, 'GET', '/me');
    const meEd = await call(ed, 'GET', '/me');
    check(
      meAdmin.body.isAdmin === true &&
        meAdmin.body.canCreateWorkspaces === true &&
        meEd.body.isAdmin === false &&
        meEd.body.canCreateWorkspaces === false &&
        (meEd.body.user as { displayName: string }).displayName === 'Ed',
      '/me says who the caller is and what they may do store-wide',
    );
    const listFor = async (actor: Actor, query = '') =>
      ((await call(actor, 'GET', `/workspaces${query}`)).body.workspaces as {
        name: string;
        role: string;
        via: { kind: string; group?: string };
      }[]) ?? [];
    const summary = async (actor: Actor, query = '') =>
      (await listFor(actor, query))
        .filter((w) => w.name.startsWith('V2T '))
        .map((w) => `${w.name.slice(4)}:${w.role}:${w.via.kind}`)
        .join(' | ');
    check((await summary(vic)) === 'Platform:viewer:member', 'a viewer lists their one workspace');
    check(
      (await summary(mo)) === 'Payments:editor:member | Platform:editor:member',
      'a member of two lists both, in name order',
    );
    check((await summary(gil)) === 'Platform:editor:group', 'someone in a mapped group is in');
    check(
      (await summary(admin)) === 'Payments:owner:member | Platform:owner:member',
      'whoever creates a workspace is its first owner, as a member',
    );
    check(
      (await summary(root)) === 'Payments:owner:admin | Platform:owner:admin',
      'an administrator who was added to nothing still lists every workspace, as an owner',
    );

    // --- Workspaces --------------------------------------------------------------
    check(
      (await call(admin, 'POST', '/workspaces', { name: 'v2t platform' })).status === 409,
      'a workspace name already taken is refused with 409',
    );
    check(
      (await call(admin, 'POST', '/workspaces', { name: '  ' })).status === 400,
      'a blank name is refused with 400',
    );
    const renamed = await call(olive, 'PATCH', `/workspaces/${A}`, { name: 'V2T Platform Team' });
    check(
      renamed.status === 200 &&
        (renamed.body.workspace as { name: string }).name === 'V2T Platform Team',
      'an owner renames their workspace',
    );
    await call(olive, 'PATCH', `/workspaces/${A}`, { name: 'V2T Platform' });

    // --- Members and groups --------------------------------------------------------
    const promoted = await call(olive, 'PUT', `/workspaces/${A}/members/${vic.userId}`, {
      role: 'editor',
    });
    check(
      promoted.status === 200 && (promoted.body.member as { role: string }).role === 'editor',
      "an owner changes someone's role",
    );
    check(
      (await call(vic, 'POST', `/documents/${D1}/updates`, { bytes: b64('now allowed') }))
        .status === 201,
      'and the new role applies on their very next request',
    );
    await call(olive, 'PUT', `/workspaces/${A}/members/${vic.userId}`, { role: 'viewer' });
    check(
      (await call(olive, 'PUT', `/workspaces/${A}/members/u-nobody`, { role: 'viewer' })).status ===
        404,
      'adding a user who does not exist is 404',
    );
    check(
      (await call(olive, 'PUT', `/workspaces/${A}/members/${vic.userId}`, { role: 'admin' }))
        .status === 400,
      'a role that is not viewer, editor or owner is 400',
    );
    const people = await call(olive, 'GET', `/workspaces/${A}/people?query=ol`);
    check(
      people.status === 200 &&
        (people.body.people as { displayName: string }[]).some((p) => p.displayName === 'Olive'),
      'an owner can search for people to add, by name',
    );
    check(
      (await call(olive, 'GET', `/workspaces/${A}/people?query=o`)).status === 400,
      'but not with a single character',
    );

    const gilNoGroup = await signIn('gil', []);
    check(
      (await call(gilNoGroup, 'GET', `/workspaces/${A}`)).status === 404,
      'signing in without the group means no access: membership is read from the sign-in, not stored',
    );
    check(
      (await call(olive, 'DELETE', `/workspaces/${A}/groups/platform-eng`)).status === 200 &&
        (await call(gil, 'GET', `/documents/${D1}`)).status === 404,
      'removing a group mapping removes access for people who came in through it, at once',
    );
    check(
      (await call(olive, 'DELETE', `/workspaces/${A}/groups/platform-eng`)).status === 404,
      'removing a mapping that is not there is 404',
    );
    const removedEd = await call(olive, 'DELETE', `/workspaces/${A}/members/${ed.userId}`);
    check(
      removedEd.status === 200 && (await call(ed, 'GET', `/documents/${D1}`)).status === 404,
      'a removed member loses access at once',
    );
    await call(olive, 'PUT', `/workspaces/${A}/members/${ed.userId}`, { role: 'editor' });

    // --- Documents -------------------------------------------------------------------
    check(
      (await call(out, 'POST', `/workspaces/${B}/documents`, { docId: D1, title: 'Mine now' }))
        .status === 409,
      'a document id cannot be reused, even in another workspace by someone who cannot see the original',
    );
    check(
      (await call(admin, 'GET', `/documents/${D1}`)).body.document !== undefined &&
        docOf(await call(admin, 'GET', `/documents/${D1}`)).workspaceId === A,
      'and the original stays where it was',
    );
    for (const bad of ['has space', '../etc', '']) {
      check(
        (await call(ed, 'POST', `/workspaces/${A}/documents`, { docId: bad, title: 'x' }))
          .status === 400,
        `the document id ${JSON.stringify(bad)} is 400`,
      );
    }
    const read = await call(vic, 'GET', `/documents/${D1}`);
    check(
      read.status === 200 &&
        (read.body.blobs as { bytes: string }[]).map((b) => b.bytes).join(',') ===
          [b64('first'), b64('now allowed')].join(',') &&
        read.version === '3',
      'a viewer reads a document: every update, in order, with the version header',
    );
    const since = await call(vic, 'GET', `/documents/${D1}/updates?since=2`);
    check(
      (since.body.blobs as { bytes: string }[]).map((b) => b.bytes).join(',') ===
        b64('now allowed'),
      'and can ask for only the updates after a version',
    );
    check(
      (
        await call(ed, 'POST', `/documents/${D1}/updates`, {
          bytes: b64('stale'),
          expectedVersion: 1,
        })
      ).status === 409,
      'an append against a version that has moved on is 409',
    );
    const compacted = await call(ed, 'POST', `/documents/${D1}/compact`, {
      bytes: b64('snapshot'),
    });
    const afterCompact = await call(vic, 'GET', `/documents/${D1}`);
    check(
      compacted.status === 200 &&
        (afterCompact.body.blobs as { bytes: string }[]).map((b) => b.bytes).join(',') ===
          b64('snapshot'),
      'an editor compacts the log into one snapshot',
    );
    const retitled = await call(ed, 'PATCH', `/documents/${D1}`, { title: '  Northwind  v2 ' });
    check(
      retitled.status === 200 && docOf(retitled).title === 'Northwind v2',
      'an editor retitles a document',
    );
    check(
      (await call(ed, 'PATCH', `/documents/${D1}`, { title: 'x', workspaceId: B })).status ===
        400 && (await call(ed, 'PATCH', `/documents/${D1}`, {})).status === 400,
      'a change must be a title or a move, one at a time',
    );
    const listed = await call(vic, 'GET', `/workspaces/${A}/documents`);
    check(
      (listed.body.documents as { docId: string; title: string }[])
        .map((d) => `${d.docId}:${d.title}`)
        .join(',') === `${D1}:Northwind v2`,
      'a workspace lists its documents with their titles',
    );

    // Delete and restore.
    const deleted = await call(ed, 'DELETE', `/documents/${D1}`);
    check(
      deleted.status === 200 && docOf(deleted).deletedAt !== null,
      'an editor deletes a document',
    );
    check(
      ((await call(vic, 'GET', `/workspaces/${A}/documents`)).body.documents as unknown[])
        .length === 0,
      'it leaves the list',
    );
    check(
      (
        (await call(ed, 'GET', `/workspaces/${A}/documents?deleted=true`)).body
          .documents as unknown[]
      ).length === 1,
      'but an editor can still list it among the deleted',
    );
    check((await call(vic, 'GET', `/documents/${D1}`)).status === 410, 'reading it is 410, gone');
    check(
      (await call(ed, 'POST', `/documents/${D1}/restore`)).status === 200 &&
        (await call(vic, 'GET', `/documents/${D1}`)).status === 200,
      'and an editor restores it',
    );
    check(
      (await call(ed, 'POST', `/documents/${D1}/restore`)).status === 409,
      'restoring a document that is not deleted is 409',
    );

    // Moving.
    check(
      (await call(ed, 'PATCH', `/documents/${D1}`, { workspaceId: B })).status === 404,
      'an editor cannot move a document into a workspace they cannot see: 404, as if it did not exist',
    );
    check(
      (await call(olive, 'PUT', `/workspaces/${A}/members/${out.userId}`, { role: 'viewer' }))
        .status === 200 &&
        (await call(out, 'PATCH', `/documents/${D1}`, { workspaceId: B })).status === 403,
      'a viewer of the source cannot move a document out, even into a workspace they can edit',
    );
    await call(olive, 'DELETE', `/workspaces/${A}/members/${out.userId}`);
    const moved = await call(mo, 'PATCH', `/documents/${D1}`, { workspaceId: B });
    check(
      moved.status === 200 && docOf(moved).workspaceId === B,
      'an editor of both workspaces moves it',
    );
    check(
      (await call(vic, 'GET', `/documents/${D1}`)).status === 404 &&
        (await call(out, 'GET', `/documents/${D1}`)).status === 200,
      "access follows the document: the old workspace's viewer loses it, the new workspace's editor gains it",
    );
    await call(mo, 'PATCH', `/documents/${D1}`, { workspaceId: A });

    // Holds and purging.
    const held = await call(admin, 'PUT', `/documents/${D1}/hold`, { reason: 'litigation' });
    check(
      held.status === 200 &&
        (docOf(held).legalHold as { reason: string } | null)?.reason === 'litigation',
      'an administrator places a legal hold',
    );
    check(
      (await call(admin, 'PUT', `/documents/${D1}/hold`, { reason: ' ' })).status === 400,
      'a hold needs a reason',
    );
    check(
      (await call(admin, 'POST', `/documents/${D1}/purge`)).status === 409,
      'a held document cannot be purged',
    );
    check(
      (await call(admin, 'DELETE', `/documents/${D1}/hold`)).status === 200 &&
        (await call(admin, 'POST', `/documents/${D1}/purge`)).status === 200,
      'once released, an administrator purges it',
    );
    check(
      (await call(admin, 'GET', `/documents/${D1}`)).status === 404 &&
        (
          (await call(admin, 'GET', `/workspaces/${A}/documents?deleted=true`)).body
            .documents as unknown[]
        ).length === 0,
      'and it is gone from the store and from the workspace',
    );

    // --- Archiving ---------------------------------------------------------------------
    const D2 = 'v2t-d2';
    await call(ed, 'POST', `/workspaces/${A}/documents`, { docId: D2, title: 'Kept' });
    check(
      (await call(admin, 'POST', `/workspaces/${A}/archive`)).status === 200,
      'an administrator archives a workspace',
    );
    check(
      (await call(olive, 'GET', `/workspaces/${A}`)).status === 404 &&
        (await call(ed, 'GET', `/documents/${D2}`)).status === 404 &&
        (await summary(olive)) === '',
      'it and its documents disappear for its members, the owner included',
    );
    check(
      (await call(root, 'GET', `/documents/${D2}`)).status === 200 &&
        (await summary(root)) === 'Payments:owner:admin' &&
        (await summary(root, '?archived=true')) === 'Payments:owner:admin | Platform:owner:admin',
      'an administrator can still read it, and lists it only when asking for archived workspaces',
    );
    const archivedWrite = await call(root, 'POST', `/documents/${D2}/updates`, {
      bytes: b64('no'),
    });
    check(
      archivedWrite.status === 403 && /archived/i.test(archivedWrite.message),
      'nothing in it can be changed, even by an administrator, and the reply says why',
    );
    check(
      (await call(olive, 'GET', `/workspaces?archived=true`)).status === 200 &&
        (await summary(olive, '?archived=true')) === '',
      'asking for archived workspaces shows a non-administrator none',
    );
    check(
      (await call(admin, 'POST', `/workspaces/${A}/restore`)).status === 200 &&
        (await call(ed, 'GET', `/documents/${D2}`)).status === 200,
      'restoring brings it back for its members',
    );

    // --- Where a request may come from ---------------------------------------------------
    console.log('\n  -- request origin --');
    const foreign = await call(
      ed,
      'POST',
      `/documents/${D2}/updates`,
      { bytes: b64('forged') },
      { origin: 'https://evil.example' },
    );
    check(
      foreign.status === 403 && foreign.reason === 'forbidden-origin',
      "a change sent from another site's page is refused, session cookie or not",
    );
    check(
      (
        await call(
          ed,
          'POST',
          `/documents/${D2}/updates`,
          { bytes: b64('from the editor') },
          { origin: EDITOR_ORIGIN },
        )
      ).status === 201,
      "a change sent from the editor's origin is accepted",
    );
    check(
      (
        await call(
          ed,
          'POST',
          `/documents/${D2}/updates`,
          { bytes: b64('same origin') },
          { origin },
        )
      ).status === 201,
      "and so is one from the store's own origin",
    );
    check(
      (await call(ed, 'GET', `/documents/${D2}`, undefined, { origin: 'https://evil.example' }))
        .status === 200,
      'reads are not origin-checked here: the browser withholds the reply from a site CORS does not allow',
    );
    const form = await call(
      ed,
      'POST',
      `/documents/${D2}/updates`,
      JSON.stringify({ bytes: b64('form') }),
      { 'content-type': 'text/plain' },
    );
    check(
      form.status === 415,
      'a body that is not JSON is refused, which is what a cross-site form would send',
    );
    check(
      ((await call(ed, 'GET', `/documents/${D2}`)).body.blobs as unknown[]).length === 2,
      'and neither refused request added anything',
    );

    // --- The rest of the service is untouched ------------------------------------------------
    const v1 = await fetch(`${origin}/v1/health`);
    check(v1.status === 200, 'the existing /v1 API still answers');
    check(
      (await call(ed, 'GET', '/nothing-here')).status === 404 &&
        (await call(ed, 'PUT', '/me')).status === 405,
      'unknown /v2 paths are 404 and wrong methods 405',
    );
    const ok = audit.all().filter((entry) => entry.outcome === 'ok');
    check(
      ok.some((e) => e.operation === 'workspace.create') &&
        ok.some((e) => e.operation === 'document.move' && e.docId === D1) &&
        ok.some((e) => e.operation === 'workspace.member.put'),
      'changes are in the audit trail',
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/** A service built without the workspace API does not serve it. */
async function withoutV2() {
  console.log('\n=== a store without the workspace API ===');
  const backend = memoryBackend();
  const server = createHttpService({ store: backend.documents, allowUnauthenticated: true });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    check((await fetch(`${origin}/v2/health`)).status === 404, '/v2 answers 404');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/** Without sign-in there is one local administrator. */
async function withoutSignIn() {
  console.log('\n=== a store run without sign-in ===');
  const backend = memoryBackend();
  const server = createHttpService({
    store: backend.documents,
    allowUnauthenticated: true,
    directory: backend.directory,
    v2: createV2Api({
      workspaces: backend.workspaces,
      catalog: backend.catalog,
      documents: backend.documents,
      directory: backend.directory,
      isAdmin: () => false,
      workspaceCreation: 'admins',
      allowUnauthenticated: true,
      publicUrl: () => 'http://127.0.0.1',
      allowedOrigins: [],
    }),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const health = (await (await fetch(`${origin}/v2/health`)).json()) as {
      authentication: string;
    };
    check(health.authentication === 'none', 'health says there is no sign-in');
    const me = (await (await fetch(`${origin}/v2/me`)).json()) as { isAdmin: boolean };
    check(me.isAdmin === true, 'every request is the same local administrator');
    const created = await fetch(`${origin}/v2/workspaces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Local' }),
    });
    check(created.status === 201, 'who can create a workspace and use it');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

{
  const backend = memoryBackend();
  await run('memory', backend);
  await backend.dispose();
}
await withoutV2();
await withoutSignIn();

if (DATABASE_URL) {
  const backend = await postgresBackend();
  try {
    await run('postgres', backend);
  } finally {
    await backend.dispose();
  }
} else {
  console.log('\n(DATABASE_URL is not set: PostgreSQL is not covered by this run)');
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll workspace API checks passed.');
