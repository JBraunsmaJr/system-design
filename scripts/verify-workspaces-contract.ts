/**
 * The workspace store's contract, against both implementations.
 *
 * store/src/workspaces.ts (in memory) and store/src/postgresWorkspaces.ts
 * must behave the same, because tests and demonstrations run on the first
 * and deployments on the second. One suite runs against each: memory always,
 * PostgreSQL when DATABASE_URL is set.
 *
 * It covers the storage rules - names, ordering, upserts, what a failed
 * operation leaves behind - and that `grantsFor` and `listAccessible` feed
 * permissions.ts what it needs. The permission rules themselves are in
 * store/src/permissions.verify.ts.
 */
import {
  WorkspaceError,
  createMemoryWorkspaceStore,
  type WorkspaceStore,
} from '../store/src/workspaces.ts';
import { createPostgresWorkspaceStore } from '../store/src/postgresWorkspaces.ts';
import { createPostgresStore } from '../store/src/postgresStore.ts';
import { createPostgresUserDirectory } from '../store/src/postgresUserDirectory.ts';
import { canInWorkspace, type Principal } from '../store/src/permissions.ts';
import {
  CatalogError,
  createMemoryDocumentCatalog,
  type DocumentCatalog,
} from '../store/src/documentCatalog.ts';
import { createPostgresDocumentCatalog } from '../store/src/postgresDocumentCatalog.ts';

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

const DATABASE_URL = process.env.DATABASE_URL ?? '';

/** Runs `fn` and returns the WorkspaceError reason it failed with, or
 * 'no-error' / 'other' so a wrong outcome reads clearly in the output. */
async function reasonOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'no-error';
  } catch (error) {
    return error instanceof WorkspaceError || error instanceof CatalogError
      ? error.reason
      : `other (${String(error)})`;
  }
}

interface Users {
  ada: string;
  ben: string;
  cy: string;
  /** An id that names nobody. */
  nobody: string;
}

const person = (userId: string, overrides: Partial<Principal> = {}): Principal => ({
  userId,
  groups: [],
  isAdmin: false,
  ...overrides,
});

/**
 * The document catalog. `createDocument` makes the document the catalog row
 * will point at: PostgreSQL requires it to exist, memory does not care.
 */
async function runCatalog(
  label: string,
  store: WorkspaceStore,
  catalog: DocumentCatalog,
  users: Users,
  createDocument: (docId: string) => Promise<void>,
) {
  console.log(`\n=== ${label}: document catalog ===`);
  const { ada, ben } = users;
  const one = await store.createWorkspace({ name: 'Catalog one', createdBy: ada });
  const two = await store.createWorkspace({ name: 'Catalog two', createdBy: ben });
  for (const id of ['doc-a', 'doc-b', 'doc-c']) await createDocument(id);

  const a = await catalog.add({
    docId: 'doc-a',
    workspaceId: one.workspaceId,
    title: '  Northwind   Commerce ',
    createdBy: ada,
  });
  check(a.title === 'Northwind Commerce', 'a title is trimmed and its inner spaces collapsed');
  check(
    a.workspaceId === one.workspaceId && a.createdBy === ada,
    'a document is added to a workspace',
  );
  const b = await catalog.add({
    docId: 'doc-b',
    workspaceId: one.workspaceId,
    title: '   ',
    createdBy: ada,
  });
  check(b.title === 'Untitled', 'a blank title becomes Untitled');
  await catalog.add({
    docId: 'doc-c',
    workspaceId: two.workspaceId,
    title: 'Elsewhere',
    createdBy: ben,
  });

  check(
    (await reasonOf(() =>
      catalog.add({ docId: 'doc-a', workspaceId: two.workspaceId, title: 'Again', createdBy: ben }),
    )) === 'conflict',
    'an id already in the catalog is refused, even for another workspace',
  );
  check(
    (await catalog.get('doc-a'))?.workspaceId === one.workspaceId,
    'and the refused attempt did not move the original',
  );
  for (const bad of ['', 'has space', '../etc', 'x'.repeat(129), '-leading']) {
    check(
      (await reasonOf(() =>
        catalog.add({ docId: bad, workspaceId: one.workspaceId, title: 'x', createdBy: ada }),
      )) === 'invalid',
      `the id ${JSON.stringify(bad.length > 20 ? `${bad.slice(0, 8)}...` : bad)} is refused`,
    );
  }
  check(
    (await reasonOf(() =>
      catalog.add({
        docId: 'doc-a',
        workspaceId: one.workspaceId,
        title: 'x'.repeat(201),
        createdBy: ada,
      }),
    )) === 'invalid',
    'a title over 200 characters is refused',
  );

  check(
    (await catalog.listByWorkspace(one.workspaceId)).map((e) => e.docId).join(',') ===
      'doc-a,doc-b',
    'a workspace lists its own documents, in the order they were added',
  );
  check(
    (await catalog.listByWorkspace(two.workspaceId)).map((e) => e.docId).join(',') === 'doc-c',
    "and not another workspace's",
  );
  check(
    (await catalog.listByWorkspace('ws_missing')).length === 0,
    'an unknown workspace lists none',
  );
  check((await catalog.get('doc-missing')) === null, 'an unknown document finds nothing');

  const retitled = await catalog.setTitle('doc-b', 'Checkout review');
  check(
    retitled.title === 'Checkout review' && retitled.createdAt === b.createdAt,
    'a title can be changed, and nothing else changes',
  );
  check(
    (await reasonOf(() => catalog.setTitle('doc-missing', 'x'))) === 'not-found',
    'retitling an unknown document is refused',
  );

  const moved = await catalog.move('doc-b', two.workspaceId);
  check(
    moved.workspaceId === two.workspaceId && moved.title === 'Checkout review',
    'a document can be moved',
  );
  check(
    (await catalog.listByWorkspace(one.workspaceId)).map((e) => e.docId).join(',') === 'doc-a' &&
      (await catalog.listByWorkspace(two.workspaceId)).map((e) => e.docId).join(',') ===
        'doc-b,doc-c',
    'and is then listed by the new workspace only, still in the order it was added',
  );
  check(
    (await reasonOf(() => catalog.move('doc-b', 'ws_missing'))) === 'not-found',
    'a document cannot be moved to a workspace that does not exist',
  );
  check((await catalog.get('doc-b'))?.workspaceId === two.workspaceId, 'and stays where it was');
  check(
    (await reasonOf(() => catalog.move('doc-missing', one.workspaceId))) === 'not-found',
    'moving an unknown document is refused',
  );

  check(
    (await catalog.remove('doc-c')) === true && (await catalog.remove('doc-c')) === false,
    'a document is removed from the catalog once',
  );
  check((await catalog.get('doc-c')) === null, 'and is then gone');
}

async function run(label: string, store: WorkspaceStore, users: Users) {
  console.log(`\n=== ${label} ===`);
  const { ada, ben, cy, nobody } = users;

  // --- Creating ------------------------------------------------------------
  const platform = await store.createWorkspace({ name: '  Platform   Team ', createdBy: ada });
  check(platform.name === 'Platform Team', 'a name is trimmed and its inner spaces collapsed');
  check(platform.createdBy === ada && platform.archivedAt === null, 'a new workspace is open');
  check(platform.workspaceId.length > 0, 'and has an id');

  const firstMembers = await store.listMembers(platform.workspaceId);
  check(
    firstMembers.length === 1 &&
      firstMembers[0].userId === ada &&
      firstMembers[0].role === 'owner' &&
      firstMembers[0].addedBy === null,
    'its creator is its first owner, added by the store itself',
  );

  check(
    (await reasonOf(() => store.createWorkspace({ name: 'platform team', createdBy: ben }))) ===
      'name-taken',
    'a second workspace with the same name, ignoring case, is refused',
  );
  check(
    (await store.listWorkspaces()).length === 1,
    'and the refused workspace left nothing behind',
  );
  for (const bad of ['', '   ', 'x'.repeat(121)]) {
    check(
      (await reasonOf(() => store.createWorkspace({ name: bad, createdBy: ada }))) === 'invalid',
      `a name of ${bad.length} character(s)${bad.trim() === '' ? ' (blank)' : ''} is refused`,
    );
  }
  check(
    (await reasonOf(() => store.createWorkspace({ name: 'Ghosts', createdBy: nobody }))) ===
      'not-found',
    'a workspace cannot be created by a user who does not exist',
  );
  check(
    (await store.listWorkspaces()).length === 1,
    'and that attempt left no ownerless workspace behind',
  );

  const payments = await store.createWorkspace({ name: 'payments', createdBy: ben });
  const arch = await store.createWorkspace({ name: 'Architecture Review', createdBy: ada });

  // --- Reading and ordering --------------------------------------------------
  check(
    (await store.listWorkspaces()).map((w) => w.name).join(' | ') ===
      'Architecture Review | payments | Platform Team',
    'workspaces list in name order, ignoring case',
  );
  check(
    (await store.getWorkspace(platform.workspaceId))?.name === 'Platform Team',
    'a workspace is found by its id',
  );
  check((await store.getWorkspace('ws_missing')) === null, 'an unknown id finds nothing');

  // --- Renaming --------------------------------------------------------------
  const renamed = await store.renameWorkspace(payments.workspaceId, 'Payments');
  check(renamed.name === 'Payments', 'a workspace can change only the case of its own name');
  check(
    (await reasonOf(() => store.renameWorkspace(payments.workspaceId, 'PLATFORM TEAM'))) ===
      'name-taken',
    "but cannot take another workspace's name",
  );
  check(
    (await reasonOf(() => store.renameWorkspace('ws_missing', 'Anything'))) === 'not-found',
    'renaming an unknown workspace is refused',
  );
  check(
    (await reasonOf(() => store.renameWorkspace(payments.workspaceId, ' '))) === 'invalid',
    'renaming to a blank name is refused',
  );

  // --- Members ---------------------------------------------------------------
  const added = await store.putMember({
    workspaceId: platform.workspaceId,
    userId: ben,
    role: 'viewer',
    addedBy: ada,
  });
  check(added.role === 'viewer' && added.addedBy === ada, 'a member is added with a role');
  const promoted = await store.putMember({
    workspaceId: platform.workspaceId,
    userId: ben,
    role: 'editor',
    addedBy: cy,
  });
  check(promoted.role === 'editor', 'adding them again changes their role');
  check(
    promoted.addedBy === ada && promoted.addedAt === added.addedAt,
    'and keeps who first added them, and when',
  );
  check(
    (await store.listMembers(platform.workspaceId)).map((m) => m.userId).join(',') ===
      [ada, ben].join(','),
    'members list in the order they were added, each once',
  );
  check(
    (await reasonOf(() =>
      store.putMember({
        workspaceId: platform.workspaceId,
        userId: nobody,
        role: 'viewer',
        addedBy: ada,
      }),
    )) === 'not-found',
    'a user who does not exist cannot be added',
  );
  check(
    (await reasonOf(() =>
      store.putMember({
        workspaceId: 'ws_missing',
        userId: ben,
        role: 'viewer',
        addedBy: ada,
      }),
    )) === 'not-found',
    'nobody can be added to a workspace that does not exist',
  );
  check(
    (await reasonOf(() =>
      store.putMember({
        workspaceId: platform.workspaceId,
        userId: cy,
        role: 'admin' as never,
        addedBy: ada,
      }),
    )) === 'invalid',
    'a role that is not viewer, editor or owner is refused',
  );
  check(
    (await store.listMembers(platform.workspaceId)).length === 2,
    'and none of those refusals changed the member list',
  );
  check(
    (await store.removeMember(platform.workspaceId, ben)) === true,
    'removing a member reports that it did',
  );
  check(
    (await store.removeMember(platform.workspaceId, ben)) === false,
    'removing them again reports that there was nothing to remove',
  );
  check(
    (await reasonOf(() => store.listMembers('ws_missing'))) === 'not-found',
    'listing the members of an unknown workspace is refused, not empty',
  );

  // --- Group mappings --------------------------------------------------------
  await store.putGroupMapping({
    workspaceId: platform.workspaceId,
    group: ' platform-eng ',
    role: 'editor',
    addedBy: ada,
  });
  await store.putGroupMapping({
    workspaceId: platform.workspaceId,
    group: 'arch-review-board',
    role: 'viewer',
    addedBy: ada,
  });
  const remapped = await store.putGroupMapping({
    workspaceId: platform.workspaceId,
    group: 'platform-eng',
    role: 'owner',
    addedBy: cy,
  });
  check(
    remapped.role === 'owner' && remapped.addedBy === ada,
    'mapping a group again changes its role and keeps who first mapped it',
  );
  check(
    (await store.listGroupMappings(platform.workspaceId))
      .map((m) => `${m.group}=${m.role}`)
      .join(',') === 'arch-review-board=viewer,platform-eng=owner',
    'mappings list in group order, with surrounding spaces removed from the name',
  );
  await store.putGroupMapping({
    workspaceId: platform.workspaceId,
    group: 'Platform-Eng',
    role: 'viewer',
    addedBy: ada,
  });
  check(
    (await store.listGroupMappings(platform.workspaceId)).length === 3,
    'group names differing only in case are different groups',
  );
  check(
    (await reasonOf(() =>
      store.putGroupMapping({
        workspaceId: platform.workspaceId,
        group: '  ',
        role: 'viewer',
        addedBy: ada,
      }),
    )) === 'invalid',
    'a blank group name is refused',
  );
  check(
    (await store.removeGroupMapping(platform.workspaceId, 'Platform-Eng')) === true &&
      (await store.removeGroupMapping(platform.workspaceId, 'Platform-Eng')) === false,
    'a mapping is removed once',
  );
  await store.putGroupMapping({
    workspaceId: platform.workspaceId,
    group: 'platform-eng',
    role: 'editor',
    addedBy: ada,
  });

  // --- What permissions.ts is given ------------------------------------------
  const forAda = await store.grantsFor(platform.workspaceId, ada);
  check(
    forAda?.grants.memberRole === 'owner' && forAda.grants.groupRoles.length === 2,
    "grantsFor returns a member's own role and every group mapping",
  );
  const forCy = await store.grantsFor(platform.workspaceId, cy);
  check(
    forCy?.grants.memberRole === null && forCy.workspace.workspaceId === platform.workspaceId,
    'for someone who was never added, it returns no individual role',
  );
  check(
    (await store.grantsFor('ws_missing', ada)) === null,
    'for an unknown workspace it returns nothing',
  );
  check(
    forCy !== null &&
      !canInWorkspace(person(cy), forCy.grants, { archived: false }, 'document.read') &&
      canInWorkspace(
        person(cy, { groups: ['platform-eng'] }),
        forCy.grants,
        { archived: false },
        'document.write',
      ) &&
      !canInWorkspace(
        person(cy, { groups: ['arch-review-board'] }),
        forCy.grants,
        { archived: false },
        'document.write',
      ),
    'and those grants decide access: none without a group, write through an editor group, read-only through a viewer group',
  );

  // --- The workspaces one person can reach -----------------------------------
  const names = async (principal: Principal, includeArchived = false) =>
    (await store.listAccessible(principal, { includeArchived }))
      .map((a) => `${a.workspace.name}:${a.role}:${a.source.kind}`)
      .join(' | ');

  check(
    (await names(person(ada))) === 'Architecture Review:owner:member | Platform Team:owner:member',
    'a member sees the workspaces they were added to, in name order',
  );
  check((await names(person(cy))) === '', 'someone in no workspace and no group sees none');
  check(
    (await names(person(cy, { groups: ['platform-eng', 'unrelated'] }))) ===
      'Platform Team:editor:group',
    'someone in a mapped group sees that workspace, as the mapped role',
  );
  check(
    (await names(person(ben, { groups: ['arch-review-board'] }))) ===
      'Payments:owner:member | Platform Team:viewer:group',
    'individual and group access combine across workspaces',
  );
  check(
    (await names(person(cy, { isAdmin: true }))) ===
      'Architecture Review:owner:admin | Payments:owner:admin | Platform Team:owner:admin',
    'an administrator sees every workspace, as an owner',
  );

  // --- Archiving -------------------------------------------------------------
  const archived = await store.setArchived(arch.workspaceId, true);
  check(archived.archivedAt !== null, 'archiving records when');
  const again = await store.setArchived(arch.workspaceId, true);
  check(again.archivedAt === archived.archivedAt, 'archiving twice keeps the original time');
  check(
    (await store.listWorkspaces()).every((w) => w.workspaceId !== arch.workspaceId),
    'an archived workspace is left out of the default list',
  );
  check(
    (await store.listWorkspaces({ includeArchived: true })).some(
      (w) => w.workspaceId === arch.workspaceId,
    ),
    'and included when asked for',
  );
  check(
    (await names(person(ada))) === 'Platform Team:owner:member',
    'its own owner no longer sees it',
  );
  check(
    (await names(person(ada), true)) === 'Platform Team:owner:member',
    'even when asking for archived workspaces, because they are not an administrator',
  );
  check(
    (await names(person(cy, { isAdmin: true }), true)).startsWith(
      'Architecture Review:owner:admin',
    ),
    'an administrator asking for archived workspaces sees it',
  );
  check(
    (await store.grantsFor(arch.workspaceId, ada))?.workspace.archivedAt !== null,
    'grantsFor still returns it, marked archived, so the caller can refuse',
  );
  const restored = await store.setArchived(arch.workspaceId, false);
  check(restored.archivedAt === null, 'restoring clears it');
  check(
    (await store.setArchived(arch.workspaceId, false)).archivedAt === null,
    'restoring a workspace that is not archived changes nothing',
  );
  check(
    (await reasonOf(() => store.setArchived('ws_missing', true))) === 'not-found',
    'archiving an unknown workspace is refused',
  );
  check(
    (await reasonOf(() =>
      store.createWorkspace({ name: 'architecture review', createdBy: ben }),
    )) === 'name-taken',
    'a name stays taken through archiving and restoring',
  );
}

// An advancing clock, so "in the order they were added" is unambiguous.
function clock() {
  let at = Date.parse('2026-11-01T00:00:00Z');
  return () => new Date((at += 1000));
}

{
  const users: Users = { ada: 'u-ada', ben: 'u-ben', cy: 'u-cy', nobody: 'u-nobody' };
  const known = new Set([users.ada, users.ben, users.cy]);
  const store = createMemoryWorkspaceStore({ now: clock(), userExists: (id) => known.has(id) });
  await run('memory', store, users);
  await runCatalog(
    'memory',
    store,
    createMemoryDocumentCatalog({
      now: clock(),
      workspaceExists: async (id) => (await store.getWorkspace(id)) !== null,
    }),
    users,
    async () => {},
  );
}

if (DATABASE_URL) {
  const documents = createPostgresStore({ connectionString: DATABASE_URL });
  await documents.migrate();
  const pg = (await import('pg')).default;
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const ISSUER = 'https://workspaces-contract.test';
  const cleanUp = async () => {
    await pool.query(`DELETE FROM documents WHERE doc_id IN ('doc-a', 'doc-b', 'doc-c')`);
    await pool.query('DELETE FROM workspace_documents');
    await pool.query('DELETE FROM workspaces');
    await pool.query('DELETE FROM users WHERE issuer = $1', [ISSUER]);
  };
  try {
    await cleanUp();
    const directory = createPostgresUserDirectory(pool);
    const make = async (subject: string) =>
      (await directory.upsertUser({ issuer: ISSUER, subject, displayName: subject })).userId;
    const users: Users = {
      ada: await make('ada'),
      ben: await make('ben'),
      cy: await make('cy'),
      nobody: 'u-nobody',
    };
    const contractStore = createPostgresWorkspaceStore(pool, { now: clock() });
    await run('postgres', contractStore, users);
    await runCatalog(
      'postgres',
      contractStore,
      createPostgresDocumentCatalog(pool, { now: clock() }),
      users,
      async (docId) => {
        await documents.create({ docId, keys: { wrappedForWorkspace: '' } });
      },
    );

    console.log('\n=== postgres: what the database enforces for the catalog ===');
    const catalog = createPostgresDocumentCatalog(pool, { now: clock() });
    const anyWorkspaceId = (await contractStore.listWorkspaces())[0].workspaceId;
    check(
      (await reasonOf(() =>
        catalog.add({
          docId: 'doc-never-created',
          workspaceId: anyWorkspaceId,
          title: 'x',
          createdBy: users.ada,
        }),
      )) === 'not-found',
      'a catalog row cannot be added for a document the document service does not have',
    );
    await documents.purge('doc-a');
    check(
      (await catalog.get('doc-a')) === null,
      'purging a document removes its catalog row with it',
    );
    const occupiedWorkspaceId = (await catalog.get('doc-b'))?.workspaceId;
    check(
      occupiedWorkspaceId !== undefined &&
        (await reasonOf(() =>
          pool.query('DELETE FROM workspaces WHERE workspace_id = $1', [occupiedWorkspaceId]),
        )) !== 'no-error',
      'a workspace that still holds documents cannot be deleted from under them',
    );

    console.log('\n=== postgres: what the database itself enforces ===');
    const store = createPostgresWorkspaceStore(pool, { now: clock() });
    const doomed = await store.createWorkspace({ name: 'Short lived', createdBy: users.cy });
    await store.putMember({
      workspaceId: doomed.workspaceId,
      userId: users.ben,
      role: 'editor',
      addedBy: users.cy,
    });
    await pool.query('DELETE FROM users WHERE user_id = $1', [users.cy]);
    const after = await store.getWorkspace(doomed.workspaceId);
    check(
      after !== null && after.createdBy === null,
      'a workspace outlives the account that created it',
    );
    const remaining = await store.listMembers(doomed.workspaceId);
    check(
      remaining.length === 1 && remaining[0].userId === users.ben && remaining[0].addedBy === null,
      "removing an account removes its memberships and clears it from others' records",
    );
    check(
      (await reasonOf(() =>
        pool.query(
          `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'admin')`,
          [doomed.workspaceId, users.ada],
        ),
      )) !== 'no-error',
      'the database refuses a role outside viewer, editor and owner, even written directly',
    );
  } finally {
    await cleanUp();
    await pool.end();
    await documents.close();
  }
} else {
  console.log('\n(DATABASE_URL is not set: PostgreSQL is not covered by this run)');
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll workspace contract checks passed.');
