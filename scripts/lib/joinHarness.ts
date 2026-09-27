/**
 * A shared harness for WS14's end-to-end suites: a store over either
 * backend, a provider that really signs tokens, and "browsers" built from
 * the editor's own modules, each with its own cookie jar.
 */
import type { AddressInfo } from 'net';
import pg from 'pg';
import { createMemoryBlobStore, type MemoryTx } from '../../store/src/blobStore.ts';
import { createDocumentService } from '../../store/src/documentService.ts';
import {
  createHttpService,
  createMemoryAuditSink,
  type StoreBackend,
} from '../../store/src/httpService.ts';
import { createProvider } from '../../store/src/auth/providers.ts';
import { createSessionStore, type SessionStore } from '../../store/src/auth/sessions.ts';
import { createPostgresSessionStore } from '../../store/src/auth/postgresSessions.ts';
import { createMemoryUserDirectory, type UserDirectory } from '../../store/src/userDirectory.ts';
import { createPostgresUserDirectory } from '../../store/src/postgresUserDirectory.ts';
import {
  createMemoryWorkspaceIndex,
  type WorkspaceIndexStore,
} from '../../store/src/workspaceIndex.ts';
import {
  createPostgresStore,
  createPostgresWorkspaceIndex,
} from '../../store/src/postgresStore.ts';
import { createMemoryAccessStore, type AccessStore } from '../../store/src/access.ts';
import { createPostgresAccessStore } from '../../store/src/postgresAccess.ts';
import { startTestOidcProvider, type TestOidcProvider } from './testIdentityProviders.ts';
import { createStoreClient, type StoreClient } from '../../src/collab/storeClient.ts';
import {
  createMemoryDeviceKeyStorage,
  type DeviceKeyStorage,
  type EnrollmentApi,
} from '../../src/collab/deviceIdentity.ts';
import {
  createMemoryPendingJoinStorage,
  signInUrlFor,
  type PendingJoinStorage,
} from '../../src/collab/joinFlow.ts';

export const WORKSPACE = 'default';

export interface Backend {
  store: StoreBackend;
  directory: UserDirectory;
  index: WorkspaceIndexStore;
  access: AccessStore;
  sessions: SessionStore;
}

export function memoryBackend(): Backend {
  const blobs = createMemoryBlobStore();
  return {
    store: createDocumentService<MemoryTx>({
      blobs,
      begin: () => blobs.begin(),
      commit: (tx) => blobs.commit(tx),
      rollback: (tx) => blobs.rollback(tx),
    }) as unknown as StoreBackend,
    directory: createMemoryUserDirectory(),
    index: createMemoryWorkspaceIndex(),
    access: createMemoryAccessStore(),
    sessions: createSessionStore(),
  };
}

/** One browser: a cookie jar, the editor's client, and its local storage. */
export interface Browser {
  client: StoreClient;
  devices: DeviceKeyStorage;
  pending: PendingJoinStorage;
  api: EnrollmentApi;
  /** The sign-in URL the editor would use, commitment and all. */
  url(provider?: string): Promise<string>;
  /** Follows a sign-in from that URL through the provider and back. */
  signInAt(start: string): Promise<string>;
  signIn(provider?: string): Promise<string>;
}

export function makeBrowser(
  origin: string,
  idp: TestOidcProvider,
  subject: string,
  /** Groups, or a whole set of extra claims (to act like overage). */
  groups: string[] | Record<string, unknown>,
): Browser {
  let cookie = '';
  const jarFetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const response = await fetch(input, {
      ...init,
      redirect: 'manual',
      headers: { ...(init.headers as Record<string, string>), ...(cookie ? { cookie } : {}) },
    });
    const set = response.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return response;
  }) as typeof fetch;
  const client = createStoreClient({ baseUrl: origin, fetch: jarFetch });
  const devices = createMemoryDeviceKeyStorage();
  const pending = createMemoryPendingJoinStorage();
  const api: EnrollmentApi = {
    registerDevice: (publicKey, label) => client.registerDevice(publicKey, label),
    keysForDevice: (deviceId) => client.keysForDevice(deviceId),
    publishUserPublicKey: (publicKey) => client.publishUserPublicKey(publicKey),
    putWorkspaceKey: (generation, wrappedKey) => client.putWorkspaceKey(generation, wrappedKey),
    listDevices: () => client.listDevices(),
    approveDevice: (deviceId, code, wrapped, from) =>
      client.approveDevice(deviceId, code, wrapped, from),
    setOwnUserKey: (deviceId, wrapped) => client.setOwnUserKey(deviceId, wrapped),
    workspaceExists: () => client.workspaceExists(WORKSPACE),
  };
  const browser: Browser = {
    client,
    devices,
    pending,
    api,
    url: (provider = 'oidc') => signInUrlFor({ client, provider, storage: pending }),
    async signInAt(start) {
      idp.setSubject(subject, subject);
      idp.setClaims(Array.isArray(groups) ? { groups } : groups);
      const atStore = await jarFetch(start);
      const atProvider = await fetch(atStore.headers.get('location') ?? '', { redirect: 'manual' });
      await jarFetch(atProvider.headers.get('location') ?? '');
      return start;
    },
    async signIn(provider = 'oidc') {
      return browser.signInAt(await browser.url(provider));
    },
  };
  return browser;
}

/** A running store with a test provider in front of it. */
export async function startStore(
  backend: Backend,
  /** Extra provider settings, such as groupsClaimAbsent. */
  providerOptions: { groupsClaimAbsent?: 'no-groups' | 'unknown' } = {},
) {
  const idp = await startTestOidcProvider();
  const audit = createMemoryAuditSink();
  let origin = '';
  const server = createHttpService({
    store: backend.store,
    audit,
    sessions: backend.sessions,
    providers: [
      createProvider({
        id: 'oidc',
        kind: 'oidc',
        issuer: idp.issuer,
        clientId: idp.clientId,
        clientSecret: idp.clientSecret,
        ...providerOptions,
      }),
    ],
    directory: backend.directory,
    workspaceIndex: backend.index,
    access: backend.access,
    publicUrl: () => origin,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    idp,
    audit,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idp.close();
    },
  };
}

/** Runs a suite over memory, then PostgreSQL when DATABASE_URL is set,
 * starting each PostgreSQL run from empty tables. */
export async function forEachBackend(run: (name: string, backend: Backend) => Promise<void>) {
  await run('in memory', memoryBackend());
  const databaseUrl = process.env.DATABASE_URL ?? '';
  if (!databaseUrl) {
    console.log('\n(DATABASE_URL is not set: PostgreSQL is not covered by this run)');
    return;
  }
  const postgres = createPostgresStore({ connectionString: databaseUrl });
  await postgres.migrate();
  const pool = new pg.Pool({ connectionString: databaseUrl });
  await pool.query(
    `TRUNCATE join_requests, workspace_memberships, workspace_access_rules, workspace_keys, workspace_index, devices, users, sessions, pending_logins CASCADE`,
  );
  try {
    await run('PostgreSQL', {
      store: postgres as unknown as StoreBackend,
      directory: createPostgresUserDirectory(pool),
      index: createPostgresWorkspaceIndex(pool),
      access: createPostgresAccessStore(pool),
      sessions: createPostgresSessionStore(pool),
    });
  } finally {
    await pool.end();
    await postgres.close();
  }
}
