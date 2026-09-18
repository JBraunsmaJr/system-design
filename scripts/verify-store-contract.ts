/**
 * The store's contract (WS12-R4, in part) and its measurements (WS8-R17).
 *
 * Runs against the in-memory blob store here. The PostgreSQL implementation
 * must satisfy the same contract; when DATABASE_URL is set (CI), the same
 * suite will be run against it, which is why every check below goes through
 * the service interface rather than reaching into storage.
 *
 * What it covers today, before any HTTP or authentication exists:
 *
 *  - blobs are opaque and come back byte for byte (WS8-R1)
 *  - every accepted write moves the version forward, and a client that has
 *    seen a version is never handed an older one (WS8-R15)
 *  - a failure at any point in a write leaves nothing behind (WS8-R16)
 *  - compaction replaces the log without changing identity (WS8-R5)
 *  - soft delete, restore, and purge (WS10-R4)
 *  - the size and latency profile the storage decision rests on (WS8-R17)
 */
import { createMemoryBlobStore, type MemoryTx } from "../store/src/blobStore.ts";
import { createDocumentService, StoreError } from "../store/src/documentService.ts";

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
    const actual = error instanceof StoreError ? error.reason : `other: ${String(error).slice(0, 60)}`;
    if (actual !== reason) {
      failures++;
      console.error(`  FAIL: ${message} (expected ${reason}, got ${actual})`);
    } else {
      console.log(`  ✓ ${message}`);
    }
  }
}

const bytes = (value: string) => new TextEncoder().encode(value);
const readable = (value: Uint8Array) => new TextDecoder().decode(value);
const KEYS = { wrappedForWorkspace: "d29ya3NwYWNl", wrappedForRecovery: "cmVjb3Zlcnk=" };

function newService() {
  const blobs = createMemoryBlobStore();
  const service = createDocumentService<MemoryTx>({
    blobs,
    begin: () => blobs.begin(),
    commit: (tx) => blobs.commit(tx),
    rollback: (tx) => blobs.rollback(tx),
  });
  return { blobs, service };
}

console.log("=== Documents and opaque blobs (WS8-R1) ===");
{
  const { service } = newService();
  const created = await service.create({ docId: "doc-a", keys: KEYS });
  check(created.version === 1 && created.blobs.length === 0, "a new document starts at version 1 with no blobs");
  await rejects(() => service.create({ docId: "doc-a", keys: KEYS }), "conflict", "creating it twice is a conflict");
  await rejects(() => service.head("doc-missing"), "not-found", "an unknown document is not found");

  const sealed = new Uint8Array([0, 1, 2, 250, 251, 255]);
  await service.append({ docId: "doc-a", kind: "update", bytes: sealed });
  const read = await service.read("doc-a");
  check(
    read.blobs.length === 1 && read.blobs[0].bytes.every((b, i) => b === sealed[i]) && read.blobs[0].bytes.length === sealed.length,
    "a blob comes back byte for byte, including bytes that are not valid text"
  );
  check(read.record.keys.wrappedForRecovery === KEYS.wrappedForRecovery, "the wrapped keys are stored and returned unchanged");
}

console.log("\n=== Versions only ever move forward (WS8-R15) ===");
{
  const { service } = newService();
  await service.create({ docId: "doc-v", keys: KEYS });
  const first = await service.append({ docId: "doc-v", kind: "update", bytes: bytes("one") });
  const second = await service.append({ docId: "doc-v", kind: "update", bytes: bytes("two") });
  check(second.version > first.version, `each write moves the version forward (${first.version} -> ${second.version})`);

  const current = await service.head("doc-v", { seenVersion: second.version });
  check(current.version === second.version, "reading at the version already seen is fine");
  await rejects(
    () => service.head("doc-v", { seenVersion: second.version + 5 }),
    "stale-version",
    "a response older than what the client has seen is refused, not applied"
  );
  await rejects(
    () => service.append({ docId: "doc-v", kind: "update", bytes: bytes("three"), expectedVersion: first.version }),
    "conflict",
    "a write built on a stale version is refused"
  );
  const deleted = await service.softDelete("doc-v");
  check(deleted.version > second.version, "deleting moves the version too, so a rolled-back deletion is detectable");
  const restored = await service.restore("doc-v");
  check(restored.version > deleted.version, "and so does restoring");
}

console.log("\n=== A failed write leaves nothing behind (WS8-R16) ===");
{
  const { blobs, service } = newService();
  await service.create({ docId: "doc-f", keys: KEYS });
  await service.append({ docId: "doc-f", kind: "update", bytes: bytes("kept") });
  const before = await service.head("doc-f");
  const blobCountBefore = blobs.size();

  for (const failAt of ["put", "commit"] as const) {
    const original = failAt === "put" ? blobs.put : blobs.commit;
    // Injects a failure at each step of the write, in turn.
    if (failAt === "put") blobs.put = async () => { throw new Error("storage unavailable"); };
    else blobs.commit = () => { throw new Error("transaction failed"); };

    let threw = false;
    try {
      await service.append({ docId: "doc-f", kind: "update", bytes: bytes("lost") });
    } catch {
      threw = true;
    }
    if (failAt === "put") blobs.put = original as typeof blobs.put;
    else blobs.commit = original as typeof blobs.commit;

    const after = await service.head("doc-f");
    check(threw, `a failure during ${failAt} is reported to the caller`);
    check(after.version === before.version, `and the version does not move (${after.version})`);
    check(blobs.size() === blobCountBefore, "and no blob is left behind");
    check(after.blobs.length === before.blobs.length, "and no metadata points at a blob that was never written");
  }
  const stillThere = await service.read("doc-f");
  check(readable(stillThere.blobs[0].bytes) === "kept", "the document is unharmed");
}

console.log("\n=== Compaction, delete, restore, purge ===");
{
  const { blobs, service } = newService();
  await service.create({ docId: "doc-c", keys: KEYS });
  for (let i = 0; i < 20; i++) await service.append({ docId: "doc-c", kind: "update", bytes: bytes(`update ${i}`) });
  const before = await service.head("doc-c");
  const compacted = await service.compact("doc-c", { kind: "snapshot", bytes: bytes("the whole document") });
  check(compacted.blobs.length === 1 && compacted.blobs[0].kind === "snapshot", "compaction leaves one snapshot");
  check(compacted.docId === before.docId && compacted.version > before.version, "the document keeps its identity, and its version moves on (WS8-R5)");
  check((await blobs.totalBytes("doc-c")) === bytes("the whole document").length, "and the superseded blobs are gone");

  const deleted = await service.softDelete("doc-c");
  check(deleted.deletedAt !== null, "deleting marks the document");
  await rejects(() => service.read("doc-c"), "deleted", "an ordinary read no longer returns it");
  check((await service.list()).length === 0 && (await service.list({ includeDeleted: true })).length === 1, "it is absent from listings but present for an administrator (WS9-R6)");
  check((await blobs.totalBytes("doc-c")) > 0, "its content is retained, because deletion is soft (WS10-R4)");
  await service.restore("doc-c");
  check((await service.read("doc-c")).blobs.length === 1, "restoring returns it with its content intact");

  await service.softDelete("doc-c");
  await service.purge("doc-c");
  check((await blobs.totalBytes("doc-c")) === 0 && (await service.list({ includeDeleted: true })).length === 0, "purging removes everything, irreversibly");
  await rejects(() => service.head("doc-c", { includeDeleted: true }), "not-found", "and the document is gone");
}

console.log("\n=== Size and latency (WS8-R17) ===");
{
  // The numbers the storage decision rests on. Reported, not asserted, except
  // for the budget below: adding an object store (WS8-R16) is decided from
  // these rather than from expectation.
  const BUDGET_MS = Number(process.env.STORE_OPEN_BUDGET_MS ?? 1500);
  const sealedUpdate = new Uint8Array(400); // a typical sealed CRDT update
  const snapshot = new Uint8Array(6_500); // a 50-node diagram after patch 36
  // A warm-up pass, so the first measurement is not the one paying for
  // first-call costs: it made listing 10 documents look slower than 500.
  {
    const { service } = newService();
    await service.create({ docId: "warm", keys: KEYS });
    await service.append({ docId: "warm", kind: "update", bytes: sealedUpdate });
    await service.read("warm");
    await service.list();
  }
  /** The median of three, so one unlucky pause does not become the number a
   * storage decision is made from. */
  const timed = async <T,>(work: () => Promise<T>, runs = 3): Promise<[T, number]> => {
    const samples: number[] = [];
    let value!: T;
    for (let run = 0; run < runs; run++) {
      const started = performance.now();
      value = await work();
      samples.push(performance.now() - started);
    }
    samples.sort((a, b) => a - b);
    return [value, samples[Math.floor(samples.length / 2)]];
  };

  const rows: string[] = [];
  let openWorst = 0;
  for (const blobCount of [10, 100, 1000]) {
    const { blobs, service } = newService();
    await service.create({ docId: "doc-n", keys: KEYS });
    let appendTotal = 0;
    for (let i = 0; i < blobCount; i++) {
      const [, ms] = await timed(() => service.append({ docId: "doc-n", kind: "update", bytes: sealedUpdate }), 1);
      appendTotal += ms;
    }
    const [, openMs] = await timed(() => service.read("doc-n"));
    const [, compactMs] = await timed(() => service.compact("doc-n", { kind: "snapshot", bytes: snapshot }), 1);
    const stored = await blobs.totalBytes("doc-n");
    openWorst = Math.max(openWorst, blobCount === 1000 ? openMs : 0);
    rows.push(
      `  ${String(blobCount).padStart(5)} blobs | open ${openMs.toFixed(1).padStart(7)} ms | append ${(appendTotal / blobCount).toFixed(3).padStart(6)} ms each | compact ${compactMs.toFixed(1).padStart(6)} ms | ${(stored / 1024).toFixed(1).padStart(7)} KB after compaction`
    );
  }
  for (const documentCount of [10, 500]) {
    const { service } = newService();
    for (let i = 0; i < documentCount; i++) {
      await service.create({ docId: `doc-${i}`, keys: KEYS });
      await service.append({ docId: `doc-${i}`, kind: "snapshot", bytes: snapshot });
    }
    const [listed, listMs] = await timed(() => service.list());
    rows.push(`  ${String(documentCount).padStart(5)} docs  | list ${listMs.toFixed(1).padStart(7)} ms | ${listed.length} entries`);
  }
  console.log(`  [memory blob store]`);
  for (const row of rows) console.log(row);
  check(openWorst < BUDGET_MS, `opening a 1,000-blob document stays within ${BUDGET_MS} ms (${openWorst.toFixed(1)} ms)`);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll store contract checks passed.");
