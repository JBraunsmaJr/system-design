/**
 * The workspace index (WS9-R1, R3, R5).
 *
 * The index is sealed with the workspace key before it leaves the browser,
 * so this suite builds a real one with src/crypto: listing is one fetch and
 * one decrypt, the store holds ciphertext it cannot read, and two clients
 * editing at once cannot overwrite each other.
 */
import type { AddressInfo } from "net";
import { createMemoryBlobStore, type MemoryTx } from "../store/src/blobStore.ts";
import { createDocumentService } from "../store/src/documentService.ts";
import { createHttpService, type StoreBackend } from "../store/src/httpService.ts";
import { createMemoryWorkspaceIndex, type WorkspaceIndexStore } from "../store/src/workspaceIndex.ts";
import { createPostgresStore, createPostgresWorkspaceIndex } from "../store/src/postgresStore.ts";
import { createWebCryptoStorage } from "../src/crypto/storageCrypto.ts";
import { generateWorkspaceKey, exportSymmetricKey } from "../src/crypto/keys.ts";
import type { BlobContext } from "../src/crypto/envelope.ts";

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const WORKSPACE = "workspace-1";
const CONTEXT: BlobContext = { docId: WORKSPACE, kind: "index", version: 1 };
const crypto = createWebCryptoStorage();

interface IndexEntry {
  docId: string;
  wrappedDocKey: string;
  title: string;
  updatedAt: string;
}

function memoryStore(): StoreBackend {
  const blobs = createMemoryBlobStore();
  return createDocumentService<MemoryTx>({
    blobs,
    begin: () => blobs.begin(),
    commit: (tx) => blobs.commit(tx),
    rollback: (tx) => blobs.rollback(tx),
  }) as unknown as StoreBackend;
}

async function run(name: string, workspaceIndex: WorkspaceIndexStore) {
  console.log(`\n########## ${name} ##########`);
  const server = createHttpService({ store: memoryStore(), workspaceIndex, allowUnauthenticated: true });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const workspaceKey = await generateWorkspaceKey();
  // The index is sealed with a key derived for it; the workspace key wraps
  // document keys, so a separate content key is used for the blob itself.
  const indexKey = await crypto.generateContentKey();

  const seal = async (entries: IndexEntry[]) =>
    Buffer.from(await crypto.seal(CONTEXT, new TextEncoder().encode(JSON.stringify(entries)), indexKey)).toString("base64");
  const open = async (sealed: string): Promise<IndexEntry[]> =>
    JSON.parse(new TextDecoder().decode(await crypto.open(CONTEXT, Uint8Array.from(Buffer.from(sealed, "base64")), indexKey)));

  const get = async () => (await (await fetch(`${origin}/v1/workspaces/${WORKSPACE}/index`)).json()) as { index: string | null; version: number | null };
  const put = (sealed: string, expectedVersion: number | null) =>
    fetch(`${origin}/v1/workspaces/${WORKSPACE}/index`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ index: sealed, expectedVersion }),
    });

  try {
    console.log("  -- an empty workspace");
    const empty = await get();
    check(empty.index === null && empty.version === null, "has no index yet, and says so rather than failing");

    console.log("  -- creating and listing (WS9-R1)");
    const entries: IndexEntry[] = [
      { docId: "doc-a", wrappedDocKey: "d3JhcHBlZC1h", title: "Payments platform", updatedAt: "2026-09-17T10:00:00Z" },
      { docId: "doc-b", wrappedDocKey: "d3JhcHBlZC1i", title: "Fraud review", updatedAt: "2026-09-17T11:00:00Z" },
    ];
    const created = await put(await seal(entries), null);
    check(created.status === 200, "the first write creates it");
    const fetched = await get();
    check(fetched.version === 1, "at version 1");
    const listed = await open(fetched.index!);
    check(listed.length === 2 && listed[0].title === "Payments platform", "listing the workspace is one fetch and one decrypt");
    check(listed[0].wrappedDocKey === entries[0].wrappedDocKey, "and it carries each document's wrapped key, so no per-document unwrap is needed");

    console.log("  -- the store cannot read it (WS9-R5)");
    check(!fetched.index!.includes(Buffer.from("Payments platform").toString("base64")), "the sealed blob does not contain a title");
    const asText = Buffer.from(fetched.index!, "base64").toString("latin1");
    check(!asText.includes("Payments platform") && !asText.includes("Fraud review"), "no title appears anywhere in the bytes the store holds");
    check(!asText.includes(Buffer.from(await exportSymmetricKey(workspaceKey)).toString("latin1")), "and no key does either");

    console.log("  -- conditional writes (WS9-R3)");
    const conflictOnCreate = await put(await seal(entries), null);
    check(conflictOnCreate.status === 409, "creating an index that already exists is a conflict, not an overwrite");

    // Two clients read the same version and both add a document.
    const before = await get();
    const alice = [...(await open(before.index!)), { docId: "doc-c", wrappedDocKey: "Yw==", title: "Alice's diagram", updatedAt: "2026-09-17T12:00:00Z" }];
    const bob = [...(await open(before.index!)), { docId: "doc-d", wrappedDocKey: "ZA==", title: "Bob's diagram", updatedAt: "2026-09-17T12:00:01Z" }];
    const aliceWrote = await put(await seal(alice), before.version);
    const bobWrote = await put(await seal(bob), before.version);
    check(aliceWrote.status === 200, "the first writer succeeds");
    check(bobWrote.status === 409, "and the second is refused rather than silently overwriting the first");
    const conflictBody = (await bobWrote.json()) as { error: { message: string } };
    check(/re-read/i.test(conflictBody.error.message), "with a message saying what to do");

    // Bob re-reads and applies his change on top, which is the whole point.
    const after = await get();
    const merged = [...(await open(after.index!)), bob[bob.length - 1]];
    const bobRetried = await put(await seal(merged), after.version);
    check(bobRetried.status === 200, "re-reading and retrying succeeds");
    const finalEntries = await open((await get()).index!);
    check(
      finalEntries.some((entry) => entry.docId === "doc-c") && finalEntries.some((entry) => entry.docId === "doc-d"),
      "and both documents are in the index: neither client's change was lost"
    );

    console.log("  -- bad requests");
    check((await put(await seal(entries), 999)).status === 409, "a write against a version that never existed is refused");
    const malformed = await fetch(`${origin}/v1/workspaces/${WORKSPACE}/index`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: 1 }),
    });
    check(malformed.status === 400, "a write with no index blob is refused");
    check((await fetch(`${origin}/v1/workspaces/${WORKSPACE}/index`, { method: "DELETE" })).status === 405, "an unsupported method is 405");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

await run("memory", createMemoryWorkspaceIndex());

if (DATABASE_URL) {
  const store = createPostgresStore({ connectionString: DATABASE_URL });
  await store.migrate();
  const pg = (await import("pg")).default;
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  await pool.query("DELETE FROM workspace_index");
  await run("postgres", createPostgresWorkspaceIndex(pool));
  await pool.query("DELETE FROM workspace_index");
  await pool.end();
  await store.close();
} else {
  console.log("\n(DATABASE_URL is not set: PostgreSQL is not covered by this run)");
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll workspace index checks passed.");
