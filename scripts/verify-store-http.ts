/**
 * The store's HTTP routes (WS8-R2), over both backends.
 *
 * Every route, including its error paths: what status a client gets, what it
 * can branch on, and that a rolled-back response is refused rather than
 * served (WS8-R15). Set DATABASE_URL to include PostgreSQL, as CI does.
 */
import { createMemoryBlobStore, type MemoryTx } from "../store/src/blobStore.ts";
import { createDocumentService } from "../store/src/documentService.ts";
import { createPostgresStore } from "../store/src/postgresStore.ts";
import { createHttpService, createMemoryAuditSink, type StoreBackend } from "../store/src/httpService.ts";
import type { AddressInfo } from "net";

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

const base64 = (value: string) => Buffer.from(value).toString("base64");
const KEYS = { wrappedForWorkspace: base64("workspace"), wrappedForRecovery: base64("recovery") };
const DATABASE_URL = process.env.DATABASE_URL ?? "";

interface Backend {
  name: string;
  store: StoreBackend;
  /** The backend's own audit sink, where it has one, so audit rows are
   * exercised against the real table rather than only in memory. */
  auditRows?: () => Promise<unknown[]>;
  persistAudit?: { record(entry: { at: string; subject: string | null; docId: string | null; operation: string; outcome: string; detail?: Record<string, unknown> }): Promise<void> };
  reset(): Promise<void>;
  dispose(): Promise<void>;
}

async function memoryBackend(): Promise<Backend> {
  let blobs = createMemoryBlobStore();
  let service = createDocumentService<MemoryTx>({
    blobs,
    begin: () => blobs.begin(),
    commit: (tx) => blobs.commit(tx),
    rollback: (tx) => blobs.rollback(tx),
  });
  const backend: Backend = {
    name: "memory",
    get store() {
      return service as unknown as StoreBackend;
    },
    async reset() {
      blobs = createMemoryBlobStore();
      service = createDocumentService<MemoryTx>({
        blobs,
        begin: () => blobs.begin(),
        commit: (tx) => blobs.commit(tx),
        rollback: (tx) => blobs.rollback(tx),
      });
    },
    async dispose() {},
  };
  return backend;
}

async function postgresBackend(): Promise<Backend> {
  const store = createPostgresStore({ connectionString: DATABASE_URL });
  await store.migrate();
  const clear = async () => {
    for (const record of await store.list({ includeDeleted: true })) await store.purge(record.docId);
  };
  await clear();
  return {
    name: "postgres",
    store: store as unknown as StoreBackend,
    persistAudit: store.audit,
    auditRows: () => store.audit.recent(200),
    reset: clear,
    async dispose() {
      await clear();
      await store.close();
    },
  };
}

interface Response {
  status: number;
  version: number | null;
  body: Record<string, never> & { error?: { reason: string; message: string }; [key: string]: unknown };
}

async function run(backend: Backend) {
  await backend.reset();
  const audit = createMemoryAuditSink();
  const sink = backend.persistAudit
    ? { record: async (entry: Parameters<typeof audit.record>[0]) => { audit.record(entry); await backend.persistAudit!.record(entry); } }
    : audit;
  const server = createHttpService({ store: backend.store, audit: sink, allowUnauthenticated: true });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;

  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> => {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await response.text();
    const versionHeader = response.headers.get("x-document-version");
    return {
      status: response.status,
      version: versionHeader === null ? null : Number(versionHeader),
      body: text ? JSON.parse(text) : {},
    };
  };

  try {
    console.log("  -- documents");
    check((await call("GET", "/v1/health")).status === 200, "health answers");
    const created = await call("POST", "/v1/docs", { docId: "doc-http", keys: KEYS });
    check(created.status === 201 && created.version === 1, `creating a document returns 201 and its version (${created.status}, v${created.version})`);
    check((await call("POST", "/v1/docs", { docId: "doc-http", keys: KEYS })).status === 409, "creating it again is 409");
    check((await call("POST", "/v1/docs", { docId: "x" })).status === 400, "a document without wrapped keys is 400");
    check((await call("GET", "/v1/docs")).status === 200, "listing works");

    console.log("  -- updates");
    const appended = await call("POST", "/v1/docs/doc-http/updates", { kind: "update", bytes: base64("first") });
    check(appended.status === 201 && appended.version === 2, `appending returns 201 and the new version (v${appended.version})`);
    await call("POST", "/v1/docs/doc-http/updates", { kind: "update", bytes: base64("second") });
    const read = await call("GET", "/v1/docs/doc-http");
    const blobs = (read.body.blobs as { bytes: string }[]) ?? [];
    check(read.status === 200 && blobs.length === 2, "reading returns every blob");
    check(
      Buffer.from(blobs[0].bytes, "base64").toString() === "first" && Buffer.from(blobs[1].bytes, "base64").toString() === "second",
      "blobs come back byte for byte, in order"
    );
    const since = await call("GET", "/v1/docs/doc-http/updates?since=2");
    check(((since.body.blobs as unknown[]) ?? []).length === 1, "?since= returns only what the client has not seen");
    check((await call("GET", "/v1/docs/doc-http/updates?since=-1")).status === 400, "a nonsense ?since= is 400");
    check((await call("POST", "/v1/docs/doc-http/updates", { bytes: "not base64!" })).status === 400, "a body that is not base64 is 400");
    check((await call("POST", "/v1/docs/doc-http/updates", "{ broken")).status === 400, "a body that is not JSON is 400");
    check(
      (await call("POST", "/v1/docs/doc-http/updates", { bytes: base64("x"), expectedVersion: 1 })).status === 409,
      "appending against a stale version is 409"
    );

    console.log("  -- versions never go backwards (WS8-R15)");
    const current = (await call("GET", "/v1/docs/doc-http")).version ?? 0;
    check((await call("GET", "/v1/docs/doc-http", undefined, { "if-document-version": String(current) })).status === 200, "a read at the version already seen is served");
    const rolledBack = await call("GET", "/v1/docs/doc-http", undefined, { "if-document-version": String(current + 5) });
    check(rolledBack.status === 409 && rolledBack.body.error?.reason === "stale-version", "a response older than the client has seen is refused with a reason it can act on");
    check((await call("GET", "/v1/docs/doc-http", undefined, { "if-document-version": "soon" })).status === 400, "a malformed version header is 400");

    console.log("  -- metadata, compaction, deletion");
    check((await call("PUT", "/v1/docs/doc-http/meta", { meta: base64("sealed title") })).status === 200, "sealed metadata is stored");
    const meta = await call("GET", "/v1/docs/doc-http/meta");
    check(Buffer.from(meta.body.meta as string, "base64").toString() === "sealed title", "and returned unchanged");
    const compacted = await call("POST", "/v1/docs/doc-http/compact", { bytes: base64("snapshot") });
    check(compacted.status === 200 && ((await call("GET", "/v1/docs/doc-http")).body.blobs as unknown[]).length === 1, "compaction leaves one blob");
    check((await call("DELETE", "/v1/docs/doc-http")).status === 200, "deleting succeeds");
    const afterDelete = await call("GET", "/v1/docs/doc-http");
    check(afterDelete.status === 410 && afterDelete.body.error?.reason === "deleted", "a deleted document reads as 410 gone, distinct from 404");
    check(((await call("GET", "/v1/docs")).body.documents as unknown[]).length === 0, "and is absent from the list");
    check(((await call("GET", "/v1/docs?includeDeleted=true")).body.documents as unknown[]).length === 1, "but present for an administrator");
    check((await call("POST", "/v1/docs/doc-http/restore")).status === 200, "restoring succeeds");
    check((await call("GET", "/v1/docs/doc-http")).status === 200, "and the document reads again");

    console.log("  -- unknown things");
    check((await call("GET", "/v1/docs/nope")).status === 404, "an unknown document is 404");
    check((await call("GET", "/v1/nonsense")).status === 404, "an unknown route is 404");
    check((await call("PATCH", "/v1/docs/doc-http")).status === 405, "an unsupported method is 405");

    console.log("  -- the audit trail (WS10-R3)");
    const entries = audit.all();
    check(entries.length > 0 && entries.every((entry) => entry.at && entry.operation && entry.outcome), "every request is recorded with an operation and an outcome");
    check(entries.some((entry) => entry.operation === "append" && entry.docId === "doc-http"), "including which document was written");
    check(entries.some((entry) => entry.outcome === "denied"), "and refusals, not only successes");
    if (backend.auditRows) {
      const rows = await backend.auditRows();
      check(rows.length >= entries.length, `and they are written to audit_log, not only held in memory (${rows.length} rows)`);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

console.log("=== Refusing to start without authentication ===");
{
  const backend = await memoryBackend();
  let threw = false;
  try {
    createHttpService({ store: backend.store, allowUnauthenticated: false });
  } catch {
    threw = true;
  }
  check(threw, "the service refuses to start unauthenticated unless the caller says so explicitly");
}

const backends: Backend[] = [await memoryBackend()];
if (DATABASE_URL) backends.push(await postgresBackend());
else console.log("\n(DATABASE_URL is not set: PostgreSQL is not covered by this run)");

for (const backend of backends) {
  console.log(`\n########## ${backend.name} ##########`);
  await run(backend);
}
for (const backend of backends) await backend.dispose();

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll store HTTP checks passed.");
