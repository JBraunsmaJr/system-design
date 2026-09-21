/**
 * The administration guide, performed (docs-site/docs/deployment/
 * administration.md).
 *
 * Administrators act through the API in this release, so the guide is the
 * interface. Each call it documents is made here, against the real store,
 * with the request and response shapes the guide shows - so a change to
 * the API that would make the guide wrong fails here first.
 */
import type { AddressInfo } from 'net';
import { createMemoryBlobStore, type MemoryTx } from '../store/src/blobStore.ts';
import { createDocumentService } from '../store/src/documentService.ts';
import { createHttpService, type StoreBackend } from '../store/src/httpService.ts';
import { createMemoryUserDirectory } from '../store/src/userDirectory.ts';
import { createSessionStore } from '../store/src/auth/sessions.ts';
import { createProvider } from '../store/src/auth/providers.ts';
import { parseRetentionPeriod } from '../store/src/retention.ts';
import { startTestOidcProvider } from './lib/testIdentityProviders.ts';

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

const idp = await startTestOidcProvider({ subject: 'admin-person' });
const blobs = createMemoryBlobStore();
const store = createDocumentService<MemoryTx>({
  blobs,
  begin: () => blobs.begin(),
  commit: (tx) => blobs.commit(tx),
  rollback: (tx) => blobs.rollback(tx),
  retention: parseRetentionPeriod('30d'),
});
const directory = createMemoryUserDirectory();
const admins = new Set<string>();
let origin = '';
const server = createHttpService({
  store: store as unknown as StoreBackend,
  directory,
  sessions: createSessionStore(),
  providers: [
    createProvider({
      id: 'oidc',
      kind: 'oidc',
      issuer: idp.issuer,
      clientId: idp.clientId,
      clientSecret: idp.clientSecret,
    }),
  ],
  publicUrl: () => origin,
  isAdmin: (subject) => admins.has(subject),
  recoveryPublicKeyPem: '-----BEGIN PUBLIC KEY-----\nx\n-----END PUBLIC KEY-----',
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

async function signInAs(subject: string): Promise<string> {
  idp.setSubject(subject);
  const start = await fetch(`${origin}/v1/auth/oidc/start`, { redirect: 'manual' });
  const atProvider = await fetch(start.headers.get('location') ?? '', { redirect: 'manual' });
  const callback = await fetch(atProvider.headers.get('location') ?? '', { redirect: 'manual' });
  return (callback.headers.get('set-cookie') ?? '').split(';')[0];
}
/** The guide's `api` helper, over curl's cookie rather than a browser's. */
const apiAs = (cookie: string) => async (method: string, path: string, body?: unknown) => {
  const response = await fetch(origin + path, {
    method,
    headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

try {
  console.log('=== Becoming an administrator ===');
  const adminCookie = await signInAs('admin-person');
  const admin = apiAs(adminCookie);
  const session = (await admin('GET', '/v1/auth/session')).body.session as {
    issuer: string;
    subject: string;
  };
  check(
    !!session.issuer && !!session.subject,
    '/v1/auth/session gives the issuer and subject the guide says to copy',
  );
  const beforeListed = await admin('POST', '/v1/admin/purge-due');
  check(
    beforeListed.status === 403,
    'before being listed, administrator actions are refused (403)',
  );
  admins.add(`${session.issuer}#${session.subject}`);
  check(
    (await admin('POST', '/v1/admin/purge-due')).status === 200,
    'listed as issuer#subject, they are allowed',
  );

  const member = apiAs(await signInAs('ordinary-member'));
  check(
    (await member('PUT', '/v1/docs/any/hold', { reason: 'x' })).status === 403,
    'an ordinary member is refused a hold (403)',
  );

  // A document to act on.
  await admin('POST', '/v1/docs', {
    docId: 'doc-1',
    keys: { wrappedForWorkspace: 'AA==', wrappedForRecovery: 'AA==' },
  });

  console.log('\n=== Deleted documents ===');
  await member('DELETE', '/v1/docs/doc-1');
  const listed = await member('GET', '/v1/docs?includeDeleted=true');
  const entry = (
    listed.body.documents as {
      docId: string;
      deletedAt: string | null;
      purgeAfter: string | null;
    }[]
  ).find((d) => d.docId === 'doc-1');
  check(
    !!entry?.deletedAt && !!entry?.purgeAfter,
    'includeDeleted lists it, with deletedAt and purgeAfter as the guide says',
  );
  check(
    (await member('GET', '/v1/docs/doc-1')).status === 410,
    'reading a deleted document is 410, as the responses table says',
  );
  check(
    (await member('POST', '/v1/docs/doc-1/restore')).status === 200,
    'any member can restore it - not an administrator action',
  );

  console.log('\n=== Legal hold ===');
  const held = await admin('PUT', '/v1/docs/doc-1/hold', { reason: 'FOIA request 2026-114' });
  check(held.status === 200, 'PUT /hold with a reason places a hold');
  const refused = await admin('POST', '/v1/docs/doc-1/purge');
  check(refused.status === 409, 'purging a held document is 409, as the responses table says');
  check((await admin('DELETE', '/v1/docs/doc-1/hold')).status === 200, 'DELETE /hold releases it');

  console.log('\n=== Purging ===');
  const swept = await admin('POST', '/v1/admin/purge-due');
  check(Array.isArray(swept.body.purged), 'purge-due answers { purged: [...] }');
  check(
    (await admin('POST', '/v1/docs/doc-1/purge')).status === 204,
    'purging one document works once it is not held',
  );
  check((await admin('GET', '/v1/docs/doc-1')).status === 404, 'and it is gone for good');

  console.log("\n=== Restoring someone's access ===");
  const users = (await admin('GET', '/v1/admin/users')).body.users as {
    userId: string;
    workspaceKeyGenerations?: unknown;
  }[];
  check(
    users.length >= 2 && users.every((user) => Array.isArray(user.workspaceKeyGenerations)),
    'the user list carries each person and their key generations',
  );
  const lost = users.find((user) => user.userId !== undefined)!;
  const regranted = await admin('POST', `/v1/admin/users/${lost.userId}/regrant`);
  check(
    regranted.status === 200 && !!regranted.body.user,
    'regrant resets their keys, answering { user }',
  );
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await idp.close();
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll administration guide checks passed.');
