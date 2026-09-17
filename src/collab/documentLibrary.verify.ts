/**
 * WS2-R3 / WS2-R6 - operating on stored documents that are not open.
 */
import "fake-indexeddb/auto";
import { createDocumentStore, type DocumentIndexEntry } from "../domain/documentStore.ts";
import { createIndexedDbBackend } from "../domain/indexedDbBackend.ts";
import { SCHEMA_VERSION, type DiagramFile } from "../domain/serialization.ts";
import { EMPTY_REQUIREMENTS_DOCUMENT } from "../domain/requirementsTypes.ts";
import { EMPTY_TEAM_DOCUMENT } from "../domain/teamTypes.ts";
import { openDocument, persistenceKeyForDocument } from "./localDocument.ts";
import { persistenceKeyForRoom } from "./persistence.ts";
import { createDocumentLibrary, contentDatabaseFor, isLocallyOpenable, type DeleteOutcome } from "./documentLibrary.ts";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

function makeFile(title: string): DiagramFile {
  return {
    schemaVersion: SCHEMA_VERSION,
    title,
    nodes: [
      {
        id: "outer",
        type: "typed",
        position: { x: 0, y: 0 },
        data: {
          nodeType: "service",
          label: "Outer",
          subDiagram: {
            nodes: [{ id: "inner", type: "typed", position: { x: 1, y: 1 }, data: { nodeType: "service", label: "Inner" } }],
            edges: [],
          },
        },
      },
      { id: "second", type: "typed", position: { x: 5, y: 5 }, data: { nodeType: "service", label: "Second" } },
    ],
    edges: [],
    scenarios: [{ id: "sc", title: "Flow", steps: [] }],
    requirements: EMPTY_REQUIREMENTS_DOCUMENT,
    programIncrements: [],
    team: EMPTY_TEAM_DOCUMENT,
    milestones: [],
    metadata: { updatedAt: "2026-01-01T00:00:00.000Z" },
  } as unknown as DiagramFile;
}

const deleted: string[] = [];
let nextOutcome: DeleteOutcome = "deleted";
const store = createDocumentStore(createIndexedDbBackend());
const library = createDocumentLibrary({
  store,
  deleteDatabase: async (name) => {
    deleted.push(name);
    await new Promise<void>((res, rej) => {
      const r = indexedDB.deleteDatabase(name);
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    });
    return nextOutcome;
  },
});

async function storeLocal(docId: string, title: string): Promise<DocumentIndexEntry> {
  const opened = await openDocument({ docId, initial: makeFile(title) });
  await opened.close();
  const written = await store.writeDocument(docId, makeFile(title));
  if (!written.ok) throw new Error(written.message);
  return written.value;
}

async function contentOf(docId: string) {
  const opened = await openDocument({ docId });
  const result = {
    title: opened.stores.meta.getSnapshot().title,
    nodes: opened.stores.diagram.getSnapshot().nodes.length,
    scenarios: opened.stores.meta.getSnapshot().scenarios.length,
  };
  await opened.close();
  return result;
}

console.log("=== Content database and openability ===");
assert(contentDatabaseFor({ docId: "abc", origin: "local" }) === persistenceKeyForDocument("abc"), "a local document lives under its document key");
assert(
  contentDatabaseFor({ docId: "hosted", origin: "session", sessionRoom: "r1" }) === persistenceKeyForDocument("hosted"),
  "a local document that was shared still lives under its document key"
);
assert(
  contentDatabaseFor({ docId: "session:r1", origin: "session", sessionRoom: "r1" }) === persistenceKeyForRoom("r1"),
  "a joined session's replica lives under its room key"
);
assert(
  isLocallyOpenable({ docId: "hosted", origin: "session" }) && !isLocallyOpenable({ docId: "session:r1", origin: "session" }),
  "only a joined session's replica is copy-only"
);

console.log("\n=== Rename a closed document ===");
const alpha = await storeLocal("alpha", "Alpha");
const renamed = await library.rename(alpha, "  Alpha renamed ");
assert(renamed.ok && renamed.value.title === "Alpha renamed", "the index shows the new (trimmed) name");
assert((await contentOf("alpha")).title === "Alpha renamed", "and so does the document itself, so the next save keeps it");
const blank = await library.rename(alpha, "   ");
assert(!blank.ok, "a blank name is refused");

console.log("\n=== Duplicate ===");
const dup = await library.duplicate({ ...alpha, title: "Alpha renamed" });
assert(dup.ok && dup.value.docId !== "alpha" && dup.value.title === "Copy of Alpha renamed", "a new entry named as a copy");
if (dup.ok) {
  const copy = await contentOf(dup.value.docId);
  assert(copy.nodes === 3 && copy.scenarios === 1, `the copy has all content, nested levels included (${copy.nodes} nodes)`);
  const edit = await openDocument({ docId: dup.value.docId });
  edit.stores.meta.setTitle("Edited copy");
  edit.stores.diagram.deleteNode("second");
  await edit.close();
  const original = await contentOf("alpha");
  assert(original.title === "Alpha renamed" && original.nodes === 3, "editing the copy leaves the original untouched");
}

console.log("\n=== Joined session replicas ===");
const sessionEntry = await store.writeDocument("session:room-7", makeFile("Team diagram"), {
  origin: "session",
  sessionRoom: "room-7",
});
if (!sessionEntry.ok) throw new Error(sessionEntry.message);
const sessionRename = await library.rename(sessionEntry.value, "Team (copy source)");
assert(sessionRename.ok && sessionRename.value.title === "Team (copy source)", "renaming a session replica renames its entry only");
const sessionCopy = await library.duplicate(sessionEntry.value);
assert(sessionCopy.ok && sessionCopy.value.origin === "local", "a session replica can be copied into a local document");
if (sessionCopy.ok) assert((await contentOf(sessionCopy.value.docId)).nodes === 3, "from its stored snapshot");

console.log("\n=== Forget (WS2-R6) ===");
if (dup.ok) {
  deleted.length = 0;
  const forgotten = await library.forget(dup.value);
  assert(forgotten.ok && forgotten.value === "deleted", "forgetting succeeds");
  const listedAfter = await library.list();
  assert(listedAfter.ok && !listedAfter.value.some((e) => e.docId === dup.value.docId), "the entry is gone from the list");
  assert(deleted.includes(persistenceKeyForDocument(dup.value.docId)), "its content database is deleted (WS2-R3)");
  assert((await contentOf(dup.value.docId)).nodes === 0, "reopening the id finds nothing");
  assert((await contentOf("alpha")).nodes === 3, "other documents are untouched");
}
deleted.length = 0;
const forgottenSession = await library.forget(sessionEntry.value);
assert(forgottenSession.ok && deleted.includes(persistenceKeyForRoom("room-7")), "forgetting a session replica deletes the room database");
nextOutcome = "blocked";
const blocked = await library.forget(alpha);
assert(blocked.ok && blocked.value === "blocked", "a deletion held up by another tab is reported as blocked, not failed");

console.log("\n=== Listing order ===");
const listed = await library.list();
if (listed.ok) {
  const times = listed.value.map((e) => e.updatedAt);
  assert(times.every((t, i) => i === 0 || times[i - 1] >= t), "most recently updated first");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
} else {
  console.log("\nAll document library checks passed.");
}
