/**
 * WS4-R6, WS4-R7, WS4-R8.
 *
 * Two things under test: that a rebase preserves everything the user can see
 * while discarding everything they cannot, and that it refuses to run while
 * anyone might still hold the old document.
 */
import * as Y from "yjs";
import { rebaseDocument, readDocumentContents, canRebase } from "./rebase.ts";
import { seedYjsDiagramDoc, createYjsDiagramStore } from "./yjsDiagramStore.ts";
import { seedYjsRequirementsDoc } from "./yjsRequirementsStore.ts";
import { seedYjsMilestonesDoc } from "./yjsMilestonesStore.ts";
import { createYjsTeamStore } from "./yjsTeamStore.ts";
import { seedTeamStore } from "./teamStore.ts";
import type { SubDiagram } from "../domain/types";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

const root = {
  nodes: [
    {
      id: "n1",
      type: "typed",
      position: { x: 0, y: 0 },
      data: { nodeType: "service", label: "Gateway" },
    },
    {
      id: "n2",
      type: "typed",
      position: { x: 200, y: 0 },
      data: { nodeType: "database", label: "Postgres" },
    },
  ],
  edges: [
    { id: "e1", source: "n1", target: "n2", type: "typed", data: { label: "reads" } },
  ],
} as unknown as SubDiagram;

function buildChurnedDoc(): Y.Doc {
  const doc = new Y.Doc();
  seedYjsDiagramDoc(doc, root);
  seedYjsMilestonesDoc(doc, [
    { id: "ms1", type: "release", name: "GA", scheduledAt: "2026-03-31" },
  ] as never);
  seedYjsRequirementsDoc(doc, {
    itemTypes: [
      {
        id: "type-req",
        label: "Requirement",
        prefix: "REQ",
        color: "#7c3aed",
        isBuiltIn: true,
        isWorkable: false,
      },
    ],
    categories: [],
    items: [
      { id: "REQ-1", typeId: "type-req", title: "Auth", body: "" },
    ],
    relationshipTypes: [],
    relationships: [],
    nextSequence: { "type-req": 2 },
  } as never);
  seedTeamStore(createYjsTeamStore(doc), {
    members: [{ id: "m1", name: "Engineer", ptoSpans: [] }],
    settings: { defaultPointsPerDay: 1, excludeUsHolidays: true, extraDaysOff: [] },
  } as never);

  // The history a long-lived document accumulates: many overwrites across
  // interleaved keys, which is the pattern whose tombstones never merge.
  const store = createYjsDiagramStore(doc);
  const ids = store.getSnapshot().nodes.map((n) => n.id);
  for (let round = 0; round < 400; round++) {
    for (const id of ids) {
      store.updatePosition(id, { x: round, y: round });
    }
  }
  return doc;
}

console.log("=== A rebase reclaims history ===");
{
  const source = buildChurnedDoc();
  const result = rebaseDocument(source);

  assert(
    result.bytesAfter < result.bytesBefore / 2,
    `the rebased document is much smaller (${result.bytesBefore} -> ${result.bytesAfter} bytes)`,
  );
  assert(
    Y.encodeStateAsUpdate(source).byteLength === result.bytesBefore,
    "the source document is left untouched, so a failure mid-swap loses nothing",
  );
}

console.log("=== Everything the user can see survives ===");
{
  const source = buildChurnedDoc();
  const before = readDocumentContents(source);
  const { doc } = rebaseDocument(source);
  const after = readDocumentContents(doc);

  assert(
    JSON.stringify(after.root) === JSON.stringify(before.root),
    "the diagram is identical, including the final dragged positions",
  );
  assert(
    after.requirements.items.length === before.requirements.items.length,
    "requirements survive",
  );
  assert(
    after.milestones.length === before.milestones.length,
    "milestones survive",
  );
  assert(after.team.members.length === 1, "team members survive");
  assert(
    after.team.members.length === before.team.members.length,
    "and are not duplicated by the reseed",
  );
}

console.log("=== The rebased document has no shared history ===");
{
  const source = buildChurnedDoc();
  const { doc } = rebaseDocument(source);

  // Merging the two would union their contents rather than reconcile them,
  // which is exactly why a rebase forces every peer to reload.
  const merged = new Y.Doc();
  Y.applyUpdate(merged, Y.encodeStateAsUpdate(source));
  Y.applyUpdate(merged, Y.encodeStateAsUpdate(doc));
  const mergedNodes = createYjsDiagramStore(merged).getSnapshot().nodes.length;
  assert(
    mergedNodes > createYjsDiagramStore(doc).getSnapshot().nodes.length,
    "merging old and new duplicates content - documents must never be combined",
  );
}

console.log("=== Eligibility: connected peers block it (WS4-R7) ===");
{
  const blocked = canRebase({
    connectedPeerCount: 2,
    lastSyncedAt: [],
    reconciliationWindowMs: 30 * 86_400_000,
  });
  assert(!blocked.allowed, "peers in the session block a rebase");
  assert(
    blocked.reason?.includes("2 other people") === true,
    "and the reason names how many, not just that it failed",
  );

  const singular = canRebase({
    connectedPeerCount: 1,
    lastSyncedAt: [],
    reconciliationWindowMs: 30 * 86_400_000,
  });
  assert(
    singular.reason?.includes("1 other person is") === true,
    "one peer is described in the singular",
  );
}

console.log("=== Eligibility: the reconciliation window blocks it (WS4-R8) ===");
{
  const now = Date.parse("2026-06-01T00:00:00Z");
  const window = 30 * 86_400_000;

  const recent = canRebase({
    connectedPeerCount: 0,
    lastSyncedAt: [now - 5 * 86_400_000],
    reconciliationWindowMs: window,
    now,
  });
  assert(
    !recent.allowed,
    "a device that synced five days ago blocks it - it may be offline, not gone",
  );
  assert(
    recent.reason?.includes("30 days") === true,
    "the reason names the window so the wait is predictable",
  );

  const stale = canRebase({
    connectedPeerCount: 0,
    lastSyncedAt: [now - 60 * 86_400_000],
    reconciliationWindowMs: window,
    now,
  });
  assert(stale.allowed, "a device last seen sixty days ago does not block it");

  const boundary = canRebase({
    connectedPeerCount: 0,
    lastSyncedAt: [now - window],
    reconciliationWindowMs: window,
    now,
  });
  assert(
    boundary.allowed,
    "exactly at the window boundary is outside it, so the window has a definite end",
  );

  assert(
    canRebase({
      connectedPeerCount: 0,
      lastSyncedAt: [],
      reconciliationWindowMs: window,
      now,
    }).allowed,
    "a document nobody else has touched can be rebased",
  );
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  throw new Error(`${failures} rebase check(s) failed`);
}
console.log("\nAll rebase checks passed.");
