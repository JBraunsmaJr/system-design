/**
 * Two people editing one workspace document (WS8-R2, WS8-R4, WS8-R15).
 *
 * The point of holding CRDT updates rather than snapshots: concurrent
 * edits merge instead of overwriting each other. Two Yjs documents, two
 * clients, one real store, and no coordination between them beyond what
 * the store provides.
 */
import type { AddressInfo } from "net";
import * as Y from "yjs";
import { createMemoryBlobStore, type MemoryTx } from "../store/src/blobStore.ts";
import { createDocumentService } from "../store/src/documentService.ts";
import { createHttpService, type StoreBackend } from "../store/src/httpService.ts";
import { createMemoryWorkspaceIndex } from "../store/src/workspaceIndex.ts";
import { createPostgresStore, createPostgresWorkspaceIndex } from "../store/src/postgresStore.ts";
import { createStoreClient } from "../src/collab/storeClient.ts";
import { createDocumentSync } from "../src/collab/documentSync.ts";
import { escrowDocumentKey } from "../src/collab/workspaceDocuments.ts";
import { exportPublicKey, generateWrappingKeyPair } from "../src/crypto/keys.ts";
import { toPem } from "../src/crypto/documentPackage.ts";
import { generateSessionKey } from "../src/domain/sessionLink.ts";

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const DATABASE_URL = process.env.DATABASE_URL ?? "";

/** The shape the editor keeps its diagram in: a map of nodes. */
const nodesOf = (doc: Y.Doc) => doc.getMap<{ label: string }>("nodes");
const titleOf = (doc: Y.Doc) => doc.getMap<string>("meta");

async function run(name: string, backend: { store: StoreBackend; index: ReturnType<typeof createMemoryWorkspaceIndex> }) {
  console.log(`\n########## ${name} ##########`);
  const recovery = await generateWrappingKeyPair("recovery");
  const recoveryPem = toPem(await exportPublicKey(recovery.publicKey), "PUBLIC KEY");
  const server = createHttpService({
    store: backend.store,
    workspaceIndex: backend.index,
    allowUnauthenticated: true,
    recoveryPublicKeyPem: recoveryPem,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const documentKey = generateSessionKey();
  const docId = "doc-merge";

  try {
    // The document exists, created by whoever first saved it.
    const creator = createStoreClient({ baseUrl: origin });
    const firstDoc = new Y.Doc();
    nodesOf(firstDoc).set("n1", { label: "Gateway" });
    await fetch(`${origin}/v1/docs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        docId,
        keys: { wrappedForWorkspace: "d3JhcA==", wrappedForRecovery: await escrowDocumentKey(documentKey, recoveryPem) },
      }),
    });

    console.log("  -- two browsers open it");
    const alice = createStoreClient({ baseUrl: origin });
    const bob = createStoreClient({ baseUrl: origin });
    const aliceDoc = new Y.Doc();
    const bobDoc = new Y.Doc();
    const aliceSync = createDocumentSync({ client: alice, docId, documentKey, doc: aliceDoc, pollMs: 300, debounceMs: 50 });
    const bobSync = createDocumentSync({ client: bob, docId, documentKey, doc: bobDoc, pollMs: 300, debounceMs: 50 });
    await aliceSync.start();
    await bobSync.start();
    void creator;
    void firstDoc;

    nodesOf(aliceDoc).set("n1", { label: "Gateway" });
    await aliceSync.flush();
    await sleep(600);
    check(nodesOf(bobDoc).get("n1")?.label === "Gateway", "what one saves, the other sees");

    console.log("  -- both edit at once (WS8-R2, WS8-R4)");
    // Neither knows about the other's change when they make their own.
    nodesOf(aliceDoc).set("alice", { label: "Ledger" });
    nodesOf(bobDoc).set("bob", { label: "Fraud checks" });
    await Promise.all([aliceSync.flush(), bobSync.flush()]);
    await sleep(900);
    await Promise.all([aliceSync.flush(), bobSync.flush()]);
    await sleep(900);

    check(nodesOf(aliceDoc).has("bob"), "Alice ends up with Bob's node");
    check(nodesOf(bobDoc).has("alice"), "and Bob with Alice's");
    check(
      JSON.stringify([...nodesOf(aliceDoc).keys()].sort()) === JSON.stringify([...nodesOf(bobDoc).keys()].sort()),
      `both documents hold the same thing (${[...nodesOf(aliceDoc).keys()].sort().join(", ")})`
    );

    console.log("  -- a third browser opens it afterwards");
    const carol = createStoreClient({ baseUrl: origin });
    const carolDoc = new Y.Doc();
    const carolSync = createDocumentSync({ client: carol, docId, documentKey, doc: carolDoc, pollMs: 300, debounceMs: 50 });
    await carolSync.start();
    check(
      JSON.stringify([...nodesOf(carolDoc).keys()].sort()) === JSON.stringify([...nodesOf(aliceDoc).keys()].sort()),
      "and sees everything both of them did"
    );

    console.log("  -- one of them works offline for a while");
    bobSync.stop();
    nodesOf(aliceDoc).set("while-away", { label: "Added while Bob was away" });
    await aliceSync.flush();
    nodesOf(bobDoc).set("bob-offline", { label: "Bob kept working" });
    // Bob comes back: his own work is still there, and he catches up.
    const bobAgain = createDocumentSync({ client: bob, docId, documentKey, doc: bobDoc, pollMs: 300, debounceMs: 50 });
    await bobAgain.start();
    await bobAgain.flush();
    await sleep(900);
    await aliceSync.flush();
    await sleep(600);
    check(nodesOf(bobDoc).has("while-away"), "he receives what he missed");
    check(nodesOf(aliceDoc).has("bob-offline"), "and what he did while away is not lost");

    console.log("  -- the log is collapsed when it grows (WS8-R5)");
    const compacting = createDocumentSync({
      client: alice,
      docId,
      documentKey,
      doc: aliceDoc,
      pollMs: 10_000,
      debounceMs: 10,
      compactAfterBlobs: 3,
    });
    await compacting.start();
    for (let i = 0; i < 5; i++) {
      nodesOf(aliceDoc).set(`extra-${i}`, { label: `Node ${i}` });
      await compacting.flush();
    }
    const held = (await alice.allUpdates(docId, documentKey)).blobs;
    check(held.length <= 3, `the store holds a short log rather than every edit ever (${held.length} blobs)`);
    const afterCompaction = new Y.Doc();
    const reader = createDocumentSync({ client: createStoreClient({ baseUrl: origin }), docId, documentKey, doc: afterCompaction, pollMs: 10_000 });
    await reader.start();
    check(nodesOf(afterCompaction).has("alice") && nodesOf(afterCompaction).has("bob-offline") && nodesOf(afterCompaction).has("extra-4"), "and a browser opening it afterwards still sees everything");
    compacting.stop();
    reader.stop();

    console.log("  -- what the store saw");
    const served = JSON.stringify(await (await fetch(`${origin}/v1/docs/${docId}`)).json());
    check(!served.includes("Ledger") && !served.includes("Fraud checks"), "none of it in the clear");

    aliceSync.stop();
    bobAgain.stop();
    carolSync.stop();
    void titleOf;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function memoryBackend() {
  const blobs = createMemoryBlobStore();
  return {
    store: createDocumentService<MemoryTx>({
      blobs,
      begin: () => blobs.begin(),
      commit: (tx) => blobs.commit(tx),
      rollback: (tx) => blobs.rollback(tx),
    }) as unknown as StoreBackend,
    index: createMemoryWorkspaceIndex(),
  };
}

await run("memory", memoryBackend());

if (DATABASE_URL) {
  const store = createPostgresStore({ connectionString: DATABASE_URL });
  await store.migrate();
  const pg = (await import("pg")).default;
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  for (const record of await store.list({ includeDeleted: true })) await store.purge(record.docId);
  await run("postgres", { store: store as unknown as StoreBackend, index: createPostgresWorkspaceIndex(pool) as never });
  for (const record of await store.list({ includeDeleted: true })) await store.purge(record.docId);
  await pool.end();
  await store.close();
} else {
  console.log("\n(DATABASE_URL is not set: PostgreSQL is not covered by this run)");
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll workspace merge checks passed.");
