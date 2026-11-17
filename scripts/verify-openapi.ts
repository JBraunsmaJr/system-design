/**
 * store/openapi.json, checked against the store.
 *
 * A description nobody checks goes stale, and a stale one is worse than
 * none: the last one described routes that no longer existed. So this
 * holds it to the store three ways:
 *
 *   1. it is well formed, and every operation says what role it needs;
 *   2. it lists exactly the routes the source files list in their headers,
 *      which is where a route is written down when it is added;
 *   3. every operation is called against a running store, and the reply's
 *      status and shape are ones the description gives for it.
 *
 * Who is refused what is not covered here: verify-store-v2.ts does that,
 * route by route.
 *
 * Run with: npx tsx scripts/verify-openapi.ts
 */
import { readFileSync } from 'fs';
import type { AddressInfo } from 'net';
import { createMemoryBlobStore, type MemoryTx } from '../store/src/blobStore.ts';
import { createDocumentService } from '../store/src/documentService.ts';
import { createHttpService, type StoreBackend } from '../store/src/httpService.ts';
import { createMemoryUserDirectory } from '../store/src/userDirectory.ts';
import { createMemoryWorkspaceStore } from '../store/src/workspaces.ts';
import { createMemoryDocumentCatalog } from '../store/src/documentCatalog.ts';
import { createV2Api } from '../store/src/v2/api.ts';

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

type Json = Record<string, unknown>;
interface Operation {
  operationId: string;
  'x-required-role'?: string;
  responses: Record<string, Json>;
  requestBody?: Json;
}
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const spec = JSON.parse(readFileSync('store/openapi.json', 'utf8')) as {
  openapi: string;
  paths: Record<string, Record<string, unknown>>;
  components: Record<string, Record<string, Json>>;
};
const operations: { method: string; path: string; operation: Operation }[] = [];
for (const [path, item] of Object.entries(spec.paths)) {
  for (const method of METHODS) {
    if (item[method]) operations.push({ method, path, operation: item[method] as Operation });
  }
}

/** Follows a `#/components/...` reference. */
function resolve(node: Json): Json {
  let current = node;
  while (typeof current.$ref === 'string') {
    const [, , section, name] = current.$ref.split('/');
    const target = spec.components[section]?.[name];
    if (!target) throw new Error(`Dangling reference ${current.$ref}`);
    current = target;
  }
  return current;
}

console.log('=== The description is well formed ===');
{
  check(spec.openapi.startsWith('3.1'), `it is OpenAPI ${spec.openapi}`);
  const ids = operations.map((entry) => entry.operation.operationId);
  check(
    ids.every(Boolean) && new Set(ids).size === ids.length,
    `each of its ${operations.length} operations has its own id`,
  );
  const roleless = operations.filter((entry) => !entry.operation['x-required-role']);
  check(
    roleless.length === 0,
    `each says what role it needs${roleless.length ? `: missing on ${roleless.map((e) => e.operation.operationId).join(', ')}` : ''}`,
  );
  let dangling = '';
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === 'object') {
      if (typeof (node as Json).$ref === 'string') {
        try {
          resolve(node as Json);
        } catch (error) {
          dangling = String(error);
        }
      }
      Object.values(node).forEach(walk);
    }
  };
  walk(spec);
  check(dangling === '', `every reference resolves${dangling ? ` (${dangling})` : ''}`);
  const params = operations.filter(({ path, operation }) => {
    const item = spec.paths[path];
    const declared = [
      ...((item.parameters as Json[] | undefined) ?? []),
      ...(((operation as unknown as Json).parameters as Json[] | undefined) ?? []),
    ]
      .map(resolve)
      .filter((parameter) => parameter.in === 'path')
      .map((parameter) => parameter.name);
    const used = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
    return used.some((name) => !declared.includes(name)) || declared.length !== used.length;
  });
  check(
    params.length === 0,
    `every path parameter is declared${params.length ? `: ${params.map((e) => e.path).join(', ')}` : ''}`,
  );
}

console.log('\n=== It lists the routes the store has, and no others ===');
{
  // Where a route is written down when it is added: the header of the file
  // that serves it.
  const sources = [
    'store/src/httpService.ts',
    'store/src/v2/api.ts',
    'store/src/v2/workspaceRoutes.ts',
    'store/src/v2/documentRoutes.ts',
  ];
  const normal = (path: string) =>
    path
      .replace(/\?.*$/, '')
      .replace(/:[A-Za-z]+|\{[^}]+\}/g, '{}')
      .replace(/\/+$/, '');
  const inSource = new Set<string>();
  for (const file of sources) {
    for (const match of readFileSync(file, 'utf8').matchAll(
      /^\s*\*\s+(GET|POST|PUT|PATCH|DELETE)\s+(\/v[12]\/\S+)/gm,
    )) {
      inSource.add(`${match[1]} ${normal(match[2])}`);
    }
  }
  const inSpec = new Set(
    operations.map((entry) => `${entry.method.toUpperCase()} ${normal(entry.path)}`),
  );
  const undocumented = [...inSource].filter((route) => !inSpec.has(route));
  const imaginary = [...inSpec].filter((route) => !inSource.has(route));
  check(inSource.size >= 30, `the source files list ${inSource.size} routes`);
  check(
    undocumented.length === 0,
    `every one of them is described${undocumented.length ? `; missing: ${undocumented.join(', ')}` : ''}`,
  );
  check(
    imaginary.length === 0,
    `and nothing is described that they do not list${imaginary.length ? `: ${imaginary.join(', ')}` : ''}`,
  );
}

/** Whether `value` has the shape `schema` describes: required properties,
 * and the type of what is there. Enough to catch a renamed or missing
 * field, which is how a description drifts. */
function conforms(value: unknown, schemaNode: Json, at = 'reply'): string | null {
  const schema = resolve(schemaNode);
  if (Array.isArray(schema.oneOf)) {
    const problems = (schema.oneOf as Json[]).map((option) => conforms(value, option, at));
    return problems.some((problem) => problem === null)
      ? null
      : `${at}: matches none of the alternatives (${problems[0]})`;
  }
  if ('const' in schema)
    return value === schema.const ? null : `${at}: expected ${String(schema.const)}`;
  if (Array.isArray(schema.enum)) {
    return (schema.enum as unknown[]).includes(value)
      ? null
      : `${at}: ${String(value)} is not one of ${(schema.enum as unknown[]).join(', ')}`;
  }
  const types = ([] as unknown[]).concat(schema.type ?? []);
  const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  const matches = (type: unknown) =>
    type === actual || (type === 'integer' && actual === 'number' && Number.isInteger(value));
  if (types.length > 0 && !types.some(matches))
    return `${at}: is ${actual}, not ${types.join(' or ')}`;
  if (actual === 'object') {
    const record = value as Json;
    for (const name of (schema.required as string[] | undefined) ?? []) {
      if (!(name in record)) return `${at}: no "${name}"`;
    }
    const properties = (schema.properties as Record<string, Json> | undefined) ?? {};
    for (const [name, child] of Object.entries(properties)) {
      if (name in record) {
        const problem = conforms(record[name], child, `${at}.${name}`);
        if (problem) return problem;
      }
    }
    // A field the description does not mention is drift too.
    const extra = Object.keys(record).filter((name) => !(name in properties));
    if (schema.properties && extra.length > 0) return `${at}: undescribed "${extra.join('", "')}"`;
  }
  if (actual === 'array' && schema.items) {
    for (const [index, item] of (value as unknown[]).entries()) {
      const problem = conforms(item, schema.items as Json, `${at}[${index}]`);
      if (problem) return problem;
    }
  }
  return null;
}

console.log('\n=== A running store answers as described ===');
{
  const RELAY_SECRET = 'verify-openapi-relay-secret-0123456789abcdef';
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
  let origin = '';
  // With no sign-in, every request is one local administrator, who may
  // call everything.
  const server = createHttpService({
    allowUnauthenticated: true,
    directory,
    relayTokenSecret: RELAY_SECRET,
    v2: createV2Api({
      workspaces,
      catalog,
      documents,
      directory,
      isAdmin: () => true,
      workspaceCreation: 'admins',
      allowUnauthenticated: true,
      relayTokenSecret: RELAY_SECRET,
      publicUrl: () => origin,
      allowedOrigins: [],
    }),
  });
  await new Promise<void>((resolveListening) => server.listen(0, '127.0.0.1', resolveListening));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${origin}${path}`, {
      method: method.toUpperCase(),
      redirect: 'manual',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? (JSON.parse(text) as Json) : null, response };
  };
  const b64 = (text: string) => Buffer.from(text).toString('base64');

  try {
    // Someone to add, who has signed in before.
    const dee = await directory.upsertUser({
      issuer: 'https://idp.example',
      subject: 'dee',
      displayName: 'Dee Okafor',
    });
    const seen = new Map<string, { status: number; body: Json | null; response: Response }>();
    const ids = { workspaceId: '', docId: 'openapi-doc', userId: dee.userId, room: 'session-abc' };
    const fill = (path: string) =>
      path.replace(/\{([^}]+)\}/g, (_all, name: string) =>
        encodeURIComponent((ids as Record<string, string>)[name] ?? name),
      );
    const run = async (operationId: string, options: { query?: string; body?: unknown } = {}) => {
      const entry = operations.find((candidate) => candidate.operation.operationId === operationId);
      if (!entry) throw new Error(`The description has no operation ${operationId}.`);
      const reply = await call(
        entry.method,
        `${fill(entry.path)}${options.query ?? ''}`,
        options.body,
      );
      seen.set(operationId, reply);
      return reply;
    };

    // In an order in which each has what it needs.
    await run('health');
    await run('listProviders');
    await run('signOut');
    await run('roomToken');
    await run('workspaceHealth');
    await run('me');
    const created = await run('createWorkspace', { body: { name: 'OpenAPI check' } });
    ids.workspaceId = ((created.body?.workspace as Json | undefined)?.workspaceId as string) ?? '';
    await run('listWorkspaces', { query: '?archived=true' });
    await run('getWorkspace');
    await run('renameWorkspace', { body: { name: 'OpenAPI check, renamed' } });
    await run('putMember', { body: { role: 'editor' } });
    await run('putGroup', { body: { group: '/platform-eng', role: 'viewer' } });
    await run('listMembers');
    await run('findPeople', { query: '?query=de' });
    await run('createDocument', { body: { docId: ids.docId, title: 'First' } });
    await run('appendUpdate', { body: { bytes: b64('one'), expectedVersion: 1 } });
    await run('readDocument');
    await run('readUpdates', { query: '?since=1' });
    await run('compactDocument', { body: { bytes: b64('all'), expectedVersion: 2 } });
    await run('updateDocument', { body: { title: 'Renamed' } });
    await run('documentSession');
    await run('listDocuments', { query: '?deleted=true' });
    await run('deleteDocument');
    await run('placeHold', { body: { reason: 'Review' } });
    await run('releaseHold');
    await run('restoreDocument');
    await run('deleteDocument');
    await run('purgeDocument');
    await run('removeGroup', { query: `?group=${encodeURIComponent('/platform-eng')}` });
    await run('removeMember');
    await run('archiveWorkspace');
    await run('restoreWorkspace');

    // A browser's journey through the identity provider, not a call: it
    // needs a provider, and verify-store-auth.ts walks it.
    const NOT_CALLED = new Set(['startSignIn', 'signInCallback', 'getSession']);
    const uncalled = operations
      .map((entry) => entry.operation.operationId)
      .filter((id) => !seen.has(id) && !NOT_CALLED.has(id));
    check(
      uncalled.length === 0,
      `every operation but sign-in itself was called${uncalled.length ? `; not called: ${uncalled.join(', ')}` : ''}`,
    );

    const wrongStatus: string[] = [];
    const notSuccess: string[] = [];
    const wrongShape: string[] = [];
    const versionless: string[] = [];
    for (const [operationId, reply] of seen) {
      const { operation } = operations.find(
        (entry) => entry.operation.operationId === operationId,
      )!;
      const documented = operation.responses[String(reply.status)];
      if (!documented) {
        wrongStatus.push(
          `${operationId} answered ${reply.status}, described: ${Object.keys(operation.responses).join(', ')}`,
        );
        continue;
      }
      if (reply.status >= 300) {
        notSuccess.push(`${operationId} (${reply.status}: ${JSON.stringify(reply.body)})`);
        continue;
      }
      const described = resolve(documented);
      const schema = (
        (described.content as Json | undefined)?.['application/json'] as Json | undefined
      )?.schema as Json | undefined;
      if (schema) {
        const problem = conforms(reply.body, schema, operationId);
        if (problem) wrongShape.push(problem);
      } else if (reply.body !== null && Object.keys(reply.body).length > 0) {
        wrongShape.push(`${operationId}: a body is returned but none is described`);
      }
      if (described.headers && reply.response.headers.get('x-document-version') === null) {
        versionless.push(operationId);
      }
    }
    check(
      wrongStatus.length === 0,
      `each answered with a status the description gives for it${wrongStatus.length ? `:\n      ${wrongStatus.join('\n      ')}` : ''}`,
    );
    check(
      notSuccess.length === 0,
      `and, called as described, each succeeded${notSuccess.length ? `; refused: ${notSuccess.join(', ')}` : ''}`,
    );
    check(
      wrongShape.length === 0,
      `every reply has the fields described, of the types described, and no others${wrongShape.length ? `:\n      ${wrongShape.join('\n      ')}` : ''}`,
    );
    check(
      versionless.length === 0,
      `replies described as carrying X-Document-Version do${versionless.length ? `; missing on ${versionless.join(', ')}` : ''}`,
    );

    // The description's errors, too.
    const missing = await call('get', '/v2/documents/no-such-document');
    check(
      missing.status === 404 &&
        conforms(missing.body, spec.components.schemas.Error, 'error') === null,
      'an error has the shape described',
    );
  } finally {
    await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()));
  }
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll OpenAPI checks passed.');
