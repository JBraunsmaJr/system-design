/**
 * Verification for endpoint reconnection.
 *
 * The case worth caring about here is inversion. Every node in this app
 * stacks a source-type and a target-type handle at each position, and
 * React Flow decides which end of a resulting Connection is "source"
 * from the handle types it landed on - not from which end the person
 * dragged. Canvas.tsx already carries a fix for that on edge CREATION;
 * these tests cover the equivalent on reconnection, where getting it
 * wrong silently reverses an edge's direction as a side effect of moving
 * one of its ends.
 *
 * Run with: npx tsx --tsconfig tsconfig.app.json src/domain/edgeReconnect.verify.ts
 */
import {
  normalizeReconnection,
  validateReconnection,
  isSameEndpoints,
  type EdgeEndpoints,
} from "./edgeReconnect";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

function describe(e: EdgeEndpoints): string {
  return `${e.source}:${e.sourceHandle ?? "-"} -> ${e.target}:${e.targetHandle ?? "-"}`;
}

const original: EdgeEndpoints = {
  source: "api",
  sourceHandle: "right",
  target: "db",
  targetHandle: "left",
};

// === Part 1: the ordinary case, dragging the target end onto a new node ===
{
  const next = normalizeReconnection(
    original,
    { source: "api", sourceHandle: "right", target: "cache", targetHandle: "left" },
    "target"
  );
  assert(
    next.source === "api" && next.sourceHandle === "right",
    "dragging the target end leaves the source end exactly as it was"
  );
  assert(
    next.target === "cache" && next.targetHandle === "left",
    `and moves the target onto the new node and handle (${describe(next)})`
  );
}

// === Part 2: the same, for the source end ===
{
  const next = normalizeReconnection(
    original,
    { source: "gateway", sourceHandle: "bottom", target: "db", targetHandle: "left" },
    "source"
  );
  assert(
    next.target === "db" && next.targetHandle === "left",
    "dragging the source end leaves the target end exactly as it was"
  );
  assert(
    next.source === "gateway" && next.sourceHandle === "bottom",
    `and moves the source onto the new node and handle (${describe(next)})`
  );
}

// === Part 3: an inverted Connection does not reverse the edge ===
// This is the whole reason this module exists. React Flow has reported
// the dragged end as the Connection's SOURCE and the anchored end as its
// TARGET - the opposite way round from the edge as drawn. Taken at face
// value the edge would silently flip direction, changing which way its
// arrowhead points and what the diagram claims about the traffic.
{
  const next = normalizeReconnection(
    original,
    // dragged (new) end reported first, anchored end second
    { source: "cache", sourceHandle: "top", target: "api", targetHandle: "right" },
    "target"
  );
  assert(
    next.source === "api" && next.sourceHandle === "right",
    "with an inverted Connection, the anchored end is still recognised as the source"
  );
  assert(
    next.target === "cache" && next.targetHandle === "top",
    `and the dragged end becomes the target rather than the edge flipping round (${describe(next)})`
  );
}

// === Part 4: the same inversion, dragging the source end ===
{
  const next = normalizeReconnection(
    original,
    { source: "db", sourceHandle: "left", target: "gateway", targetHandle: "bottom" },
    "source"
  );
  assert(
    next.source === "gateway" && next.target === "db",
    `an inverted Connection while dragging the source end also keeps the edge's direction (${describe(next)})`
  );
}

// === Part 5: self-loops resolve by handle, not by node ===
// Both ends are the same node, so matching on node id alone can't tell
// which end of the Connection is the anchored one - the handle is the
// only thing that distinguishes them.
{
  const selfLoop: EdgeEndpoints = { source: "cache", sourceHandle: "top", target: "cache", targetHandle: "bottom" };
  const next = normalizeReconnection(
    selfLoop,
    { source: "cache", sourceHandle: "top", target: "cache", targetHandle: "right" },
    "target"
  );
  assert(
    next.sourceHandle === "top" && next.targetHandle === "right",
    `dragging one end of a self-loop onto a different handle of the same node moves only that end (${describe(next)})`
  );
}

// === Part 6: reconnecting onto a node's default (unnamed) handle ===
// Handles arrive as string, null or undefined depending on who produced
// them, and null/undefined both mean "the default handle". Matching has
// to treat them as equal or the anchored end stops being recognised.
{
  const edge: EdgeEndpoints = { source: "api", sourceHandle: null, target: "db", targetHandle: null };
  const next = normalizeReconnection(
    edge,
    { source: "api", sourceHandle: undefined, target: "cache", targetHandle: null },
    "target"
  );
  assert(
    next.source === "api" && next.target === "cache",
    `null and undefined handles are treated as the same "default handle" rather than failing to match (${describe(next)})`
  );
}

// === Part 7: a Connection that matches neither end ===
// Shouldn't happen. Guessing wrong would reverse an edge, so the
// fallback trusts React Flow's own orientation rather than assuming
// whichever end happens to be listed first is the anchored one.
{
  const next = normalizeReconnection(
    original,
    { source: "unrelated-a", sourceHandle: "x", target: "unrelated-b", targetHandle: "y" },
    "target"
  );
  assert(
    next.source === "api" && next.target === "unrelated-b",
    `a Connection matching neither end falls back to React Flow's orientation instead of producing something arbitrary (${describe(next)})`
  );
}

// === Part 8: both ends have to be at the edge's own diagram level ===
// An edge and its endpoints share a parentPath in the flattened schema.
// An edge pointing one level down would filter out of getEdgesAtPath at
// BOTH levels - visible from neither, but still there, and still caught
// by the delete cascade later.
{
  const atLevel = new Set(["api", "db", "cache"]);

  assert(
    validateReconnection({ source: "api", target: "cache" }, atLevel).ok,
    "a reconnection between two nodes at this level is allowed"
  );

  const offLevel = validateReconnection({ source: "api", target: "nested-worker" }, atLevel);
  assert(
    !offLevel.ok,
    "a reconnection onto a node that isn't at this level is rejected rather than silently creating an edge nobody can see"
  );
  assert(
    !offLevel.ok && offLevel.reason.includes("nested-worker"),
    `and the rejection names the offending node (${!offLevel.ok ? offLevel.reason : ""})`
  );

  assert(
    validateReconnection({ source: "cache", target: "cache" }, atLevel).ok,
    "self-loops are allowed - the app already lets you draw one, so moving an end shouldn't be stricter than drawing a new edge"
  );
}

// === Part 9: recognising a no-op ===
// A reconnect drag that ends where it started still fires onReconnect.
// Writing that to the store would sync a change to every peer, and land
// an entry in undo history, for a gesture that changed nothing.
{
  assert(
    isSameEndpoints(original, { source: "api", sourceHandle: "right", target: "db", targetHandle: "left" }),
    "endpoints identical in every field compare equal"
  );
  assert(
    isSameEndpoints(
      { source: "api", target: "db", sourceHandle: null },
      { source: "api", target: "db", sourceHandle: undefined }
    ),
    "and null/undefined handles don't count as a difference here either"
  );
  assert(
    !isSameEndpoints(original, { ...original, targetHandle: "top" }),
    "while a genuinely different handle does"
  );
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
// scripts/run-tests.ts decides pass/fail from the process exit status, so
// a failed assertion has to actually set one - printing FAIL and exiting
// 0 would report the suite as passing. Reached through globalThis
// because tsconfig.app.json doesn't include node's type definitions.
if (failures > 0) {
  (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
}
