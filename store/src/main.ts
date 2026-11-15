/**
 * The store, as a process (WS8-R9).
 *
 *   node --experimental-strip-types store/src/main.ts
 *
 * Reads its configuration from the environment, prints what it is, applies
 * the schema, and serves. Without DATABASE_URL it runs in memory, which is
 * useful for a demonstration and says so at startup and in /v1/health.
 */
import { createMemoryBlobStore, type MemoryTx } from './blobStore.ts';
import { createDocumentService } from './documentService.ts';
import { createPostgresStore, createPostgresWorkspaceIndex } from './postgresStore.ts';
import { createPostgresUserDirectory } from './postgresUserDirectory.ts';
import { createMemoryUserDirectory } from './userDirectory.ts';
import { createMemoryWorkspaceIndex } from './workspaceIndex.ts';
import { createMemoryAccessStore, type AccessStore } from './access.ts';
import { createPostgresAccessStore } from './postgresAccess.ts';
import { createHttpService, createMemoryAuditSink, type StoreBackend } from './httpService.ts';
import { createSessionStore } from './auth/sessions.ts';
import { createPostgresSessionStore } from './auth/postgresSessions.ts';
import { createProvider } from './auth/providers.ts';
import { ConfigError, describeConfig, loadStoreConfig } from './config.ts';
import { createMemoryWorkspaceStore, type WorkspaceStore } from './workspaces.ts';
import { createPostgresWorkspaceStore } from './postgresWorkspaces.ts';
import { createMemoryDocumentCatalog, type DocumentCatalog } from './documentCatalog.ts';
import { createPostgresDocumentCatalog } from './postgresDocumentCatalog.ts';
import { createV2Api } from './v2/api.ts';
import pg from 'pg';

async function main() {
  let config;
  try {
    config = loadStoreConfig();
  } catch (error) {
    // Configuration problems are the operator's to fix, so they get a
    // sentence rather than a stack trace.
    console.error(
      `\nThe store cannot start:\n\n  ${error instanceof ConfigError ? error.message : String(error)}\n`,
    );
    process.exit(2);
  }

  console.log('system-design store');
  for (const line of describeConfig(config)) console.log(`  ${line}`);

  let store: StoreBackend;
  let directory;
  let index;
  let audit;
  let sessions;
  let access: AccessStore;
  // The workspace API (docs/trusted-store.md).
  let workspaces: WorkspaceStore;
  let catalog: DocumentCatalog;
  let close = async () => {};

  if (config.databaseUrl) {
    const postgres = createPostgresStore({
      connectionString: config.databaseUrl,
      retention: config.retention,
      maxBlobBytes: config.maxBlobBytes,
      maxBlobsPerDocument: config.maxBlobsPerDocument,
      maxTotalBytes: config.maxTotalBytes,
    });
    await postgres.migrate();
    const pool = new pg.Pool({ connectionString: config.databaseUrl });
    store = postgres as unknown as StoreBackend;
    directory = createPostgresUserDirectory(pool);
    index = createPostgresWorkspaceIndex(pool);
    audit = postgres.audit;
    // Sessions in the database, so a restart or a second instance does not
    // sign everyone out (WS10-R1).
    sessions = createPostgresSessionStore(pool);
    access = createPostgresAccessStore(pool);
    workspaces = createPostgresWorkspaceStore(pool);
    catalog = createPostgresDocumentCatalog(pool);
    close = async () => {
      await pool.end();
      await postgres.close();
    };
  } else {
    const blobs = createMemoryBlobStore();
    store = createDocumentService<MemoryTx>({
      blobs,
      begin: () => blobs.begin(),
      commit: (tx) => blobs.commit(tx),
      rollback: (tx) => blobs.rollback(tx),
      retention: config.retention,
      maxBlobBytes: config.maxBlobBytes,
      maxBlobsPerDocument: config.maxBlobsPerDocument,
      maxTotalBytes: config.maxTotalBytes,
    }) as unknown as StoreBackend;
    directory = createMemoryUserDirectory();
    index = createMemoryWorkspaceIndex();
    audit = createMemoryAuditSink();
    sessions = createSessionStore();
    access = createMemoryAccessStore();
    // PostgreSQL enforces these two with foreign keys; in memory they are
    // checked against the directory and the workspace store.
    const memoryDirectory = directory;
    const memoryWorkspaces = createMemoryWorkspaceStore({
      userExists: (userId) =>
        memoryDirectory.getUser(userId).then(
          () => true,
          () => false,
        ),
    });
    workspaces = memoryWorkspaces;
    catalog = createMemoryDocumentCatalog({
      workspaceExists: async (id) => (await memoryWorkspaces.getWorkspace(id)) !== null,
    });
  }

  const admins = new Set(config.admins);
  const adminGroups = new Set(config.adminGroups);
  const server = createHttpService({
    store,
    directory,
    workspaceIndex: index,
    audit,
    sessions,
    providers: config.providers.map((provider) => createProvider(provider)),
    publicUrl: config.publicUrl,
    allowedOrigins: config.allowedOrigins,
    afterLoginUrl: config.afterLoginUrl,
    allowUnauthenticated: config.allowUnauthenticated,
    cryptoMode: config.cryptoMode,
    recoveryPublicKeyPem: config.recoveryPublicKeyPem,
    relayTokenSecret: config.relayTokenSecret,
    isAdmin: (subject) => admins.has(subject),
    access,
    autoAccess: config.autoAccess,
    v2: createV2Api({
      workspaces,
      catalog,
      documents: store,
      directory,
      // An administrator is someone listed in ADMIN_SUBJECTS, or in one of
      // ADMIN_GROUPS at their last sign-in.
      isAdmin: ({ issuer, subject, groups }) =>
        admins.has(`${issuer}#${subject}`) || groups.some((group) => adminGroups.has(group)),
      workspaceCreation: config.workspaceCreation,
      allowUnauthenticated: config.allowUnauthenticated,
      publicUrl: () => config.publicUrl,
      allowedOrigins: config.allowedOrigins,
    }),
  });

  // The purge sweep (WS10-R4). Held documents and anything still inside its
  // retention are left alone; see WS10-R8.
  const sweep = setInterval(() => {
    void (store as unknown as { purgeDue?: () => Promise<string[]> })
      .purgeDue?.()
      .then((purged) => {
        if (purged.length > 0)
          console.log(`Purged ${purged.length} document(s) past their retention.`);
      })
      .catch((error) => console.error('Purge sweep failed:', error));
    // WS14-R18: raw ID tokens are dropped once past their retention.
    void access
      .expireEvidence(new Date(Date.now() - config.joinEvidenceRetentionMs))
      .then((expired) => {
        if (expired > 0) console.log(`Dropped sign-in evidence from ${expired} join request(s).`);
      })
      .catch((error) => console.error('Evidence sweep failed:', error));
  }, config.purgeIntervalMs);

  server.listen(config.port, () => console.log(`Ready on port ${config.port}.`));

  const shutdown = async (signal: string) => {
    console.log(`\n${signal}: shutting down.`);
    clearInterval(sweep);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('message', (msg) => {
    if (msg === 'SIGTERM' || msg === 'SIGINT' || msg === 'shutdown') {
      void shutdown(typeof msg === 'string' && msg.startsWith('SIG') ? msg : 'SIGTERM');
    }
  });
}

void main();
