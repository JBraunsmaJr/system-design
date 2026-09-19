/**
 * Retention, legal hold, and purge (WS10-R4, WS10-R8, §20 OQ-6).
 *
 * The three modes a deployment can be in, and the one rule that outranks all
 * of them: a document under legal hold is never purged, not by the sweep,
 * not by an explicit purge, and not by `immediate` deletion.
 */
import { createMemoryBlobStore, type MemoryTx } from "../store/src/blobStore.ts";
import { createDocumentService, StoreError } from "../store/src/documentService.ts";
import { createPostgresStore } from "../store/src/postgresStore.ts";
import { parseRetentionPeriod, type RetentionPeriod } from "../store/src/retention.ts";

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
    } else console.log(`  ✓ ${message}`);
  }
}

const bytes = new TextEncoder().encode("sealed content");
const KEYS = { wrappedForWorkspace: "d29ya3NwYWNl" };
const DATABASE_URL = process.env.DATABASE_URL ?? "";
const DAY = 86_400_000;

type Service = ReturnType<typeof createDocumentService>;

interface Backend {
  name: string;
  make(retention: RetentionPeriod, now: () => Date): Promise<Service>;
  dispose(): Promise<void>;
}

const memory: Backend = {
  name: "memory",
  async make(retention, now) {
    const blobs = createMemoryBlobStore();
    return createDocumentService<MemoryTx>({
      blobs,
      begin: () => blobs.begin(),
      commit: (tx) => blobs.commit(tx),
      rollback: (tx) => blobs.rollback(tx),
      retention,
      now,
    });
  },
  async dispose() {},
};

async function postgres(): Promise<Backend> {
  const stores: { close(): Promise<void> }[] = [];
  return {
    name: "postgres",
    async make(retention, now) {
      const store = createPostgresStore({ connectionString: DATABASE_URL, retention, now });
      await store.migrate();
      for (const record of await store.list({ includeDeleted: true })) {
        await store.setLegalHold(record.docId, null).catch(() => {});
        await store.purge(record.docId).catch(() => {});
      }
      stores.push(store);
      return store as unknown as Service;
    },
    async dispose() {
      for (const store of stores) await store.close();
    },
  };
}

async function run(backend: Backend) {
  console.log(`\n########## ${backend.name} ##########`);
  let clock = new Date("2026-09-17T12:00:00Z");
  const now = () => clock;
  const seed = async (service: Service, docId: string) => {
    await service.create({ docId, keys: KEYS });
    await service.append({ docId, kind: "snapshot", bytes });
  };

  console.log("  -- 30 days (the default)");
  {
    const service = await backend.make(parseRetentionPeriod("30d"), now);
    await seed(service, "doc-30d");
    const deleted = await service.softDelete("doc-30d");
    check(deleted.deletedAt !== null && deleted.purgeAfter !== null, "deleting sets a purge date");
    check(
      new Date(deleted.purgeAfter!).getTime() - new Date(deleted.deletedAt!).getTime() === 30 * DAY,
      "thirty days after the deletion"
    );
    check((await service.list()).length === 0 && (await service.list({ includeDeleted: true })).length === 1, "hidden from ordinary listings, present in the deleted view (WS9-R6)");
    check((await service.read("doc-30d", { includeDeleted: true })).blobs.length === 1, "its content is retained");

    clock = new Date(clock.getTime() + 29 * DAY);
    check((await service.purgeDue(clock)).length === 0, "the sweep leaves it alone on day 29");
    const restored = await service.restore("doc-30d");
    check(restored.deletedAt === null && restored.purgeAfter === null, "restoring clears the deletion and its purge date");
    check((await service.read("doc-30d")).blobs.length === 1, "and the content is there");

    await service.softDelete("doc-30d");
    clock = new Date(clock.getTime() + 31 * DAY);
    check((await service.purgeDue(clock)).includes("doc-30d"), "once the period has passed, the sweep purges it");
    check((await service.list({ includeDeleted: true })).length === 0, "and nothing remains");
    clock = new Date("2026-09-17T12:00:00Z");
  }

  console.log("  -- immediate");
  {
    const service = await backend.make(parseRetentionPeriod("immediate"), now);
    await seed(service, "doc-now");
    const deleted = await service.softDelete("doc-now");
    check(deleted.deletedAt !== null, "the caller is told it was deleted");
    check((await service.list({ includeDeleted: true })).length === 0, "and nothing is retained, not even for an administrator");
    await rejects(() => service.restore("doc-now"), "not-found", "there is nothing to restore");
  }

  console.log("  -- indefinite");
  {
    const service = await backend.make(parseRetentionPeriod("indefinite"), now);
    await seed(service, "doc-forever");
    const deleted = await service.softDelete("doc-forever");
    check(deleted.purgeAfter === null, "deleting sets no purge date");
    clock = new Date(clock.getTime() + 3650 * DAY);
    check((await service.purgeDue(clock)).length === 0, "and ten years later the sweep still leaves it alone");
    await service.purge("doc-forever");
    check((await service.list({ includeDeleted: true })).length === 0, "an administrator can still purge it explicitly");
    clock = new Date("2026-09-17T12:00:00Z");
  }

  console.log("  -- legal hold outranks every mode (WS10-R8)");
  {
    const service = await backend.make(parseRetentionPeriod("30d"), now);
    await seed(service, "doc-held");
    const held = await service.setLegalHold("doc-held", { reason: "FOIA request 2026-114", placedBy: "admin@example.gov" });
    check(held.legalHold?.reason === "FOIA request 2026-114", "a hold records why it was placed");
    const deleted = await service.softDelete("doc-held");
    check(deleted.purgeAfter === null, "deleting a held document sets no purge date");
    clock = new Date(clock.getTime() + 400 * DAY);
    check((await service.purgeDue(clock)).length === 0, "the sweep never takes it, however long it has been");
    await rejects(() => service.purge("doc-held"), "conflict", "and an explicit purge is refused while the hold stands");
    check((await service.read("doc-held", { includeDeleted: true })).blobs.length === 1, "the content is still there");
    await service.setLegalHold("doc-held", null);
    const released = await service.head("doc-held", { includeDeleted: true });
    check(released.purgeAfter !== null, "releasing the hold restores its purge date");
    check((await service.purgeDue(clock)).includes("doc-held"), "and the next sweep takes it");
    clock = new Date("2026-09-17T12:00:00Z");
  }

  console.log("  -- a hold survives immediate deletion");
  {
    const service = await backend.make(parseRetentionPeriod("immediate"), now);
    await seed(service, "doc-held-now");
    await service.setLegalHold("doc-held-now", { reason: "litigation hold", placedBy: "admin@example.gov" });
    await service.softDelete("doc-held-now");
    check(
      (await service.list({ includeDeleted: true })).length === 1,
      "a held document is kept even where the deployment purges on delete"
    );
    check((await service.read("doc-held-now", { includeDeleted: true })).blobs.length === 1, "with its content intact");
  }
}

await run(memory);
if (DATABASE_URL) {
  const backend = await postgres();
  await run(backend);
  await backend.dispose();
} else {
  console.log("\n(DATABASE_URL is not set: PostgreSQL is not covered by this run)");
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll retention checks passed.");
