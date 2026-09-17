/**
 * WS2-R3, R4, R6 and WS5-R8.
 *
 * Runs the same suite against the in-memory backend and against a real
 * IndexedDB (via fake-indexeddb in Node), so the thin IDB adapter is exercised
 * rather than assumed.
 */
import "fake-indexeddb/auto";
import {
  createDocumentStore,
  createMemoryBackend,
  classifyStorageError,
  newDocumentId,
  requestPersistentStorage,
  type DocumentBackend,
  type DocumentStore,
} from "./documentStore.ts";
import { createIndexedDbBackend } from "./indexedDbBackend.ts";
import { SCHEMA_VERSION, type DiagramFile } from "./serialization.ts";
import { EMPTY_REQUIREMENTS_DOCUMENT } from "./requirementsTypes.ts";
import { EMPTY_TEAM_DOCUMENT } from "./teamTypes.ts";
import { SchemaVersionError } from "./schemaMigrations.ts";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

function makeFile(title: string): DiagramFile {
  return {
    schemaVersion: SCHEMA_VERSION,
    title,
    nodes: [],
    edges: [],
    scenarios: [],
    requirements: EMPTY_REQUIREMENTS_DOCUMENT,
    programIncrements: [],
    team: EMPTY_TEAM_DOCUMENT,
    milestones: [],
    metadata: { updatedAt: "2026-01-01T00:00:00.000Z" },
  };
}

async function runSuite(label: string, store: DocumentStore) {
  console.log(`=== ${label}: documents are independent ===`);
  const idA = newDocumentId();
  const idB = newDocumentId();

  const wroteA = await store.writeDocument(idA, makeFile("Diagram A"));
  const wroteB = await store.writeDocument(idB, makeFile("Diagram B"));
  assert(wroteA.ok && wroteB.ok, "two documents write successfully");

  const listed = await store.listDocuments();
  assert(
    listed.ok && listed.value.length === 2,
    "both appear in the index - the old single-slot behaviour would have lost one",
  );
  assert(
    listed.ok && listed.value.every((e) => e.sizeBytes > 0),
    "index entries carry a size for surfacing storage pressure",
  );

  const readBack = await store.readDocument(idA);
  assert(
    readBack.ok && readBack.value.title === "Diagram A",
    "a document reads back with its own content, not the other's",
  );

  console.log(`=== ${label}: missing and damaged documents ===`);
  const missing = await store.readDocument("does-not-exist");
  assert(
    !missing.ok && missing.reason === "not-found",
    "a missing document reports not-found rather than throwing",
  );

  console.log(`=== ${label}: rename and delete ===`);
  const renamed = await store.renameDocument(idA, "Renamed");
  assert(renamed.ok && renamed.value.title === "Renamed", "rename updates the index");
  const contentAfterRename = await store.readDocument(idA);
  assert(contentAfterRename.ok, "rename leaves the document readable");

  const deleted = await store.deleteDocument(idB);
  assert(deleted.ok, "delete reports success");
  const afterDelete = await store.listDocuments();
  assert(
    afterDelete.ok && afterDelete.value.length === 1,
    "deleted document leaves the index",
  );
  const goneContent = await store.readDocument(idB);
  assert(
    !goneContent.ok && goneContent.reason === "not-found",
    "delete removes content as well as the index entry (WS2-R6)",
  );

  console.log(`=== ${label}: reconciliation ===`);
  const reconciled = await store.reconcile();
  assert(
    reconciled.ok &&
      reconciled.value.danglingEntries.length === 0 &&
      reconciled.value.orphanedDocuments.length === 0,
    "a healthy store reports no dangling entries or orphans",
  );

  console.log(`=== ${label}: legacy autosave import (WS5-R8) ===`);
  {
    let legacy: string | null = JSON.stringify(makeFile("Work in progress"));
    const imported = await store.importLegacyAutosave(
      () => legacy,
      () => {
        legacy = null;
      },
    );
    assert(
      imported.ok && imported.value?.title === "Work in progress",
      "the legacy draft becomes a real document",
    );
    assert(legacy === null, "the legacy key is cleared after a successful import");

    const second = await store.importLegacyAutosave(
      () => legacy,
      () => {},
    );
    assert(
      second.ok && second.value === null,
      "a second run finds nothing and does nothing",
    );
  }

  console.log(`=== ${label}: an unreadable legacy draft is left alone ===`);
  {
    let legacy: string | null = JSON.stringify({
      ...makeFile("From the future"),
      schemaVersion: "99.0",
    });
    let cleared = false;
    const result = await store.importLegacyAutosave(
      () => legacy,
      () => {
        cleared = true;
        legacy = null;
      },
    );
    assert(
      !result.ok && result.reason === "version",
      "a newer-version draft reports a version failure",
    );
    assert(
      !cleared && legacy !== null,
      "a draft this build cannot read is NOT deleted - it is intact work, not corruption",
    );
  }
}

const memory = createMemoryBackend();
await runSuite("memory", createDocumentStore(memory));
await runSuite("indexeddb", createDocumentStore(createIndexedDbBackend()));

console.log("=== Atomicity: a failed write leaves no dangling index entry ===");
{
  // Fails only on the document body, never on the index, so a non-atomic
  // implementation would leave an entry pointing at nothing.
  const quotaError = () => {
    const error = new Error("simulated full disk");
    error.name = "QuotaExceededError";
    return error;
  };
  // Both write paths: the atomic modify() the real backends use, and the
  // read-then-writeAll fallback for a backend without it.
  const withModify: DocumentBackend = {
    ...createMemoryBackend(),
    async modify(_key, mutate) {
      // Computes the change, then fails before applying any of it - which is
      // what an aborted IndexedDB transaction does.
      const result = mutate(null);
      if ((result.also ?? []).some((e) => e.key.startsWith("doc:"))) throw quotaError();
    },
  };
  const fallback: DocumentBackend = { ...createMemoryBackend() };
  delete fallback.modify;
  fallback.writeAll = async (entries) => {
    if (entries.some((e) => e.key.startsWith("doc:"))) throw quotaError();
  };
  for (const [label, backend] of [["atomic modify", withModify], ["writeAll fallback", fallback]] as const) {
    const store = createDocumentStore(backend);
    const result = await store.writeDocument(newDocumentId(), makeFile("Doomed"));
    assert(!result.ok && result.reason === "quota", `${label}: a quota failure is reported as quota`);
    assert(
      !result.ok && /no space left/i.test(result.message),
      `${label}: the message tells the user what to do, rather than being generic (WS2-R4)`,
    );
    const listed = await store.listDocuments();
    assert(
      listed.ok && listed.value.length === 0,
      `${label}: no index entry is left pointing at a document that was never written`,
    );
  }
}

console.log("=== Concurrent saves of different documents keep both entries (WS2-R3) ===");
{
  // Two tabs share one database. Each save reads the index and writes it
  // back; done as two separate steps, the later write drops the earlier
  // entry. Both stores here share a single backend, as two tabs do.
  for (const [label, backend] of [
    ["memory", createMemoryBackend()],
    ["indexeddb", createIndexedDbBackend()],
  ] as const) {
    const tabA = createDocumentStore(backend);
    const tabB = createDocumentStore(backend);
    const ids = Array.from({ length: 20 }, () => newDocumentId());
    await Promise.all(ids.map((id, i) => (i % 2 ? tabA : tabB).writeDocument(id, makeFile(`Doc ${i}`))));
    const listed = await tabA.listDocuments();
    const found = listed.ok ? ids.filter((id) => listed.value.some((e) => e.docId === id)).length : 0;
    assert(found === ids.length, `${label}: all ${ids.length} concurrently saved documents are indexed (found ${found})`);
  }
}

console.log("=== Error classification ===");
{
  const quota = new Error("full");
  quota.name = "QuotaExceededError";
  assert(classifyStorageError(quota) === "quota", "QuotaExceededError maps to quota");

  const firefox = new Error("full");
  firefox.name = "NS_ERROR_DOM_QUOTA_REACHED";
  assert(
    classifyStorageError(firefox) === "quota",
    "Firefox's quota error name is recognised too",
  );

  const legacyCode = Object.assign(new Error("full"), { name: "Whatever", code: 22 });
  assert(
    classifyStorageError(legacyCode) === "quota",
    "the legacy numeric quota code is recognised",
  );

  const security = new Error("blocked");
  security.name = "SecurityError";
  assert(
    classifyStorageError(security) === "unavailable",
    "SecurityError means storage is unavailable, not full",
  );

  assert(
    classifyStorageError(new SyntaxError("bad json")) === "corrupt",
    "a JSON parse failure is corruption",
  );
  assert(
    classifyStorageError(new SchemaVersionError("newer", "9.9", SCHEMA_VERSION)) ===
      "version",
    "a schema version error is distinguished from corruption",
  );
}

console.log("=== Storage health degrades quietly ===");
{
  const health = await requestPersistentStorage();
  assert(
    typeof health.persisted === "boolean",
    "reports a persisted flag even where the Storage API is absent",
  );
}

console.log("=== Document ids are unique ===");
{
  const ids = new Set(Array.from({ length: 1000 }, () => newDocumentId()));
  assert(ids.size === 1000, "1000 generated ids are all distinct");
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  throw new Error(`${failures} document store check(s) failed`);
}
console.log("\nAll document store checks passed.");
