/**
 * The browser's store client, against the real service (WS6, WS7-R1,
 * WS8-R15, WS9-R3).
 *
 * The store here is the actual HTTP service, not a stub, so this exercises
 * the whole path: a diagram sealed in the client, stored, fetched, and
 * opened again. What the store keeps is inspected directly, to confirm it
 * holds nothing it can read.
 */
import type { AddressInfo } from "net";
import { createMemoryBlobStore, type MemoryTx } from "../store/src/blobStore.ts";
import { createDocumentService } from "../store/src/documentService.ts";
import { createHttpService, type StoreBackend } from "../store/src/httpService.ts";
import { createMemoryWorkspaceIndex } from "../store/src/workspaceIndex.ts";
import { createPostgresStore, createPostgresWorkspaceIndex } from "../store/src/postgresStore.ts";
import { createStoreClient, StoreClientError } from "../src/collab/storeClient.ts";
import { escrowDocumentKey } from "../src/collab/workspaceDocuments.ts";
import { recoverDocumentPackage, toPem, type DocumentPackage } from "../src/crypto/documentPackage.ts";
import { exportPrivateKey, exportPublicKey, generateWrappingKeyPair, importRecoveryPrivateKey } from "../src/crypto/keys.ts";
import { createWebCryptoStorage } from "../src/crypto/storageCrypto.ts";
import { deriveStorageKey, exportSymmetricKey, generateWorkspaceKey, wrapKey } from "../src/crypto/keys.ts";
import { generateSessionKey } from "../src/domain/sessionLink.ts";
import type { DiagramFile } from "../src/domain/serialization.ts";

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}
async function rejects(work: () => Promise<unknown>, reason: string, message: string) {
  try {
    await work();
    failures++;
    console.error(`  FAIL: ${message} (it succeeded)`);
  } catch (error) {
    const actual = error instanceof StoreClientError ? error.reason : `other: ${String(error).slice(0, 60)}`;
    if (actual !== reason) {
      failures++;
      console.error(`  FAIL: ${message} (expected ${reason}, got ${actual})`);
    } else console.log(`  ✓ ${message}`);
  }
}

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const DOCUMENT: DiagramFile = {
  schemaVersion: "0.7",
  title: "Payments platform",
  nodes: [{ id: "n1", type: "typed", position: { x: 0, y: 0 }, data: { nodeType: "service", label: "Gateway" } }],
  edges: [],
  scenarios: [],
  requirements: { itemTypes: [], categories: [], items: [], relationshipTypes: [], relationships: [], nextSequence: {} },
  programIncrements: [],
  team: { members: [], settings: {} },
  milestones: [],
  metadata: { updatedAt: "2026-09-17T00:00:00.000Z" },
} as unknown as DiagramFile;

function memoryBackend(): { store: StoreBackend; index: ReturnType<typeof createMemoryWorkspaceIndex> } {
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

async function run(name: string, backend: { store: StoreBackend; index: ReturnType<typeof createMemoryWorkspaceIndex> }) {
  console.log(`\n########## ${name} ##########`);
  // The organization's recovery keypair, as first-run setup produces it.
  const recoveryPair = await generateWrappingKeyPair("recovery");
  const recoveryPublicPem = toPem(await exportPublicKey(recoveryPair.publicKey), "PUBLIC KEY");
  const server = createHttpService({
    store: backend.store,
    workspaceIndex: backend.index,
    allowUnauthenticated: true,
    recoveryPublicKeyPem: recoveryPublicPem,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const client = createStoreClient({ baseUrl: origin });

  // What a share link carries, and the keys a workspace holds.
  const documentKey = generateSessionKey();
  const workspaceKey = await generateWorkspaceKey();
  const wrappedDocKey = Buffer.from(await wrapKey(await deriveStorageKey(documentKey), workspaceKey)).toString("base64");
  const indexKey = await createWebCryptoStorage().generateContentKey();
  const docId = "doc-payments";

  try {
    console.log("  -- escrow is required (WS7-R4)");
    const published = await client.recoveryPublicKey();
    check(published === recoveryPublicPem, "the store publishes its recovery public key, so clients can wrap to it");
    await rejects(
      () => client.putDocument("doc-unescrowed", documentKey, DOCUMENT, { wrappedForWorkspace: wrappedDocKey }),
      "store-error",
      "a document offered with no recovery wrap is refused"
    );
    const escrowed = await escrowDocumentKey(documentKey, published!);

    console.log("  -- a document goes out sealed and comes back");
    const version = await client.putDocument(docId, documentKey, DOCUMENT, {
      wrappedForWorkspace: wrappedDocKey,
      wrappedForRecovery: escrowed,
    });
    check(version > 1, `uploading returns the new version (${version})`);
    const fetched = await client.getDocument(docId, documentKey);
    check(JSON.stringify(fetched.file) === JSON.stringify(DOCUMENT), "and it comes back byte for byte");
    check(fetched.version === version, "at the version it was written at");

    console.log("  -- what the store actually holds");
    const raw = await fetch(`${origin}/v1/docs/${docId}`);
    const stored = JSON.stringify(await raw.json());
    check(!stored.includes("Payments platform") && !stored.includes("Gateway"), "no title and no node label appears in what the store serves");
    check(!stored.includes(documentKey), "and neither does the document key");
    const storedBytes = Buffer.from(JSON.parse(stored).blobs[0].bytes, "base64").toString("latin1");
    check(!storedBytes.includes("Payments platform"), "nor in the blob itself");

    console.log("  -- a wrong key cannot open it");
    await rejects(() => client.getDocument(docId, generateSessionKey()), "unreadable", "another link's key is refused, and says so plainly");

    console.log("  -- updates and versions (WS8-R15)");
    const edited = { ...DOCUMENT, title: "Payments platform v2" };
    const second = await client.putDocument(docId, documentKey, edited, { wrappedForWorkspace: wrappedDocKey });
    check(second > version, `a second upload moves the version on (${version} -> ${second})`);
    check((await client.getDocument(docId, documentKey)).file.title === "Payments platform v2", "and reading returns the newer document");
    check(client.versionOf(docId) === second, "the client tracks the highest version it has seen");

    console.log("  -- a store that serves an older version is refused (WS8-R15)");
    {
      // One client, one store, and a store that starts replaying an earlier
      // state part-way through - the case encryption cannot detect.
      let rollBack = false;
      const wary = createStoreClient({
        baseUrl: origin,
        fetch: async (input, init) => {
          const response = await fetch(input as string, init);
          if (!rollBack) return response;
          const headers = new Headers(response.headers);
          if (headers.has("x-document-version")) headers.set("x-document-version", "1");
          return new Response(await response.text(), { status: response.status, headers });
        },
      });
      const honest = await wary.getDocument(docId, documentKey);
      check(honest.version === second, "the client reads the current version");
      rollBack = true;
      await rejects(
        () => wary.getDocument(docId, documentKey),
        "rolled-back",
        "and then refuses a response claiming to be older than what it has seen"
      );
    }

    console.log("  -- the workspace index (WS9)");
    const entry = { docId, wrappedDocKey, title: DOCUMENT.title, updatedAt: new Date().toISOString() };
    await client.updateIndex("workspace-1", indexKey, (entries) => [...entries.filter((e) => e.docId !== docId), entry]);
    const listed = await client.readIndex("workspace-1", indexKey);
    check(listed.entries.length === 1 && listed.entries[0].title === "Payments platform", "the index lists the document by title");
    const sealedIndex = await (await fetch(`${origin}/v1/workspaces/workspace-1/index`)).json();
    check(
      !Buffer.from((sealedIndex as { index: string }).index, "base64").toString("latin1").includes("Payments platform"),
      "and the store holds it sealed: no title in the bytes (WS9-R5)"
    );

    console.log("  -- two clients editing the index at once (WS9-R3)");
    {
      const other = createStoreClient({ baseUrl: origin });
      const theirs = { ...entry, docId: "doc-theirs", title: "Their diagram" };
      const mine = { ...entry, docId: "doc-mine", title: "My diagram" };

      // A genuine collision: the other client writes in the gap between
      // this one's read and its write, so the first attempt is stale and
      // the client must re-read and re-apply.
      let interposed = false;
      let collisions = 0;
      const racing = createStoreClient({
        baseUrl: origin,
        fetch: async (input, init) => {
          const isIndexWrite = init?.method === "PUT" && String(input).includes("/index");
          if (isIndexWrite && !interposed) {
            interposed = true;
            await other.updateIndex("workspace-1", indexKey, (entries) => [...entries, theirs]);
          }
          const response = await fetch(input as string, init);
          if (isIndexWrite && response.status === 409) collisions++;
          return response;
        },
      });

      const before = await client.readIndex("workspace-1", indexKey);
      const result = await racing.updateIndex("workspace-1", indexKey, (entries) => [...entries, mine]);
      check(collisions === 1, `the first write collides with the other client (${collisions})`);
      check(result.some((e) => e.docId === "doc-mine"), "and the retry succeeds");
      const after = await client.readIndex("workspace-1", indexKey);
      check(after.version! > before.version! + 1, "both writes landed");
      check(
        after.entries.some((e) => e.docId === "doc-theirs") && after.entries.some((e) => e.docId === "doc-mine"),
        "and neither client's document is lost"
      );
    }

    console.log("  -- the organization can recover it with nothing else (WS7-R4, R6)");
    {
      // Everything the store holds for this document, and the offline key:
      // no workspace key, no session, no client.
      const raw = (await (await fetch(`${origin}/v1/docs/${docId}`)).json()) as {
        document: { version: number; keys: { wrappedForWorkspace: string; wrappedForRecovery?: string } };
        blobs: { kind: string; bytes: string }[];
      };
      check(!!raw.document.keys.wrappedForRecovery, "the store kept the recovery wrap alongside the document");
      const pkg: DocumentPackage = {
        packageVersion: 1,
        docId,
        version: raw.document.version,
        keys: raw.document.keys,
        blobs: raw.blobs.map((blob) => ({ kind: blob.kind as "snapshot", sealed: blob.bytes })),
      };
      const recovered = await recoverDocumentPackage(pkg, await importRecoveryPrivateKey(await exportPrivateKey(recoveryPair.privateKey)));
      const file = JSON.parse(new TextDecoder().decode(recovered[0].data)) as { title: string };
      check(file.title === "Payments platform v2", "and the offline recovery key alone opens what the workspace saved");
    }

    console.log("  -- deletion and absence");
    await client.deleteDocument(docId);
    await rejects(() => client.getDocument(docId, documentKey), "deleted", "a deleted document reads as deleted, distinct from missing");
    await rejects(() => client.getDocument("doc-never", documentKey), "not-found", "and a document that never existed is not found");

    console.log("  -- the store being unreachable is ordinary");
    const offline = createStoreClient({ baseUrl: "http://127.0.0.1:9" });
    await rejects(() => offline.session(), "offline", "an unreachable store is reported as offline, not as a crash");

    console.log("  -- keys never leave the client");
    const exported = Buffer.from(await exportSymmetricKey(workspaceKey)).toString("base64");
    const everything = JSON.stringify(await (await fetch(`${origin}/v1/docs?includeDeleted=true`)).json());
    check(!everything.includes(exported), "the workspace key appears nowhere in what the store serves");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

await run("memory", memoryBackend());

if (DATABASE_URL) {
  const store = createPostgresStore({ connectionString: DATABASE_URL });
  await store.migrate();
  const pg = (await import("pg")).default;
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const clear = async () => {
    for (const record of await store.list({ includeDeleted: true })) {
      if (record.legalHold) await store.setLegalHold(record.docId, null);
      await store.purge(record.docId);
    }
    await pool.query("DELETE FROM workspace_index");
  };
  await clear();
  await run("postgres", { store: store as unknown as StoreBackend, index: createPostgresWorkspaceIndex(pool) as never });
  await clear();
  await pool.end();
  await store.close();
} else {
  console.log("\n(DATABASE_URL is not set: PostgreSQL is not covered by this run)");
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll store client checks passed.");
