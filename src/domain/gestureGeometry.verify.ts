/**
 * WS4-R1..R3 - the rules for in-flight gesture geometry, without a browser.
 */
import {
  mergeInFlight,
  applyInFlight,
  toBroadcast,
  parseGestureBroadcast,
  remoteInFlight,
  NO_IN_FLIGHT,
  MAX_BROADCAST_NODES,
  type GestureBroadcast,
} from "./gestureGeometry.ts";
import { classifyNodeChanges, type PendingNodeUpdate } from "./nodeChangeBatching.ts";
import type { NodeChange } from "@xyflow/react";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

console.log("=== Merging frames ===");
{
  const frame1 = new Map<string, PendingNodeUpdate>([["a", { type: "position", position: { x: 1, y: 1 } }]]);
  const frame2 = new Map<string, PendingNodeUpdate>([["a", { type: "dimensions", width: 50, height: 20 }]]);
  const frame3 = new Map<string, PendingNodeUpdate>([
    ["a", { type: "position", position: { x: 5, y: 5 } }],
    ["b", { type: "position", position: { x: 9, y: 9 } }],
  ]);
  const one = mergeInFlight(NO_IN_FLIGHT, frame1);
  const two = mergeInFlight(one, frame2);
  const three = mergeInFlight(two, frame3);
  assert(JSON.stringify(three.get("a")) === JSON.stringify({ position: { x: 5, y: 5 }, width: 50, height: 20 }), "a corner resize keeps both its position and its size across frames");
  assert(three.get("b")?.position?.x === 9 && three.size === 2, "each node is one entry, however many frames moved it");
  assert(one.get("a")?.width === undefined && NO_IN_FLIGHT.size === 0, "merging never mutates the previous overlay");
}

console.log("\n=== Applying the overlay ===");
{
  const node = { id: "a", position: { x: 0, y: 0 }, width: 10, height: 10, data: {} };
  assert(applyInFlight(node, undefined) === node, "no geometry, same object - so the node does not re-render");
  const moved = applyInFlight(node, { position: { x: 3, y: 4 } });
  assert(moved !== node && moved.position.x === 3 && moved.width === 10, "a move replaces only the position");
  assert(node.position.x === 0, "the document's node is untouched");
}

console.log("\n=== Broadcast and validation ===");
{
  const overlay = mergeInFlight(NO_IN_FLIGHT, new Map([["a", { type: "position", position: { x: 1, y: 2 } } as PendingNodeUpdate]]));
  const b = toBroadcast("root/a", overlay);
  assert(b?.path === "root/a" && b.nodes.a.position?.y === 2, "the overlay broadcasts with its level");
  assert(toBroadcast("", NO_IN_FLIGHT) === null, "an empty overlay broadcasts null, clearing the peer's view");
  assert(JSON.stringify(parseGestureBroadcast(JSON.parse(JSON.stringify(b)))) === JSON.stringify(b), "a valid broadcast survives the wire unchanged");
  assert(parseGestureBroadcast(null) === null && parseGestureBroadcast({ path: 1, nodes: {} }) === null, "malformed broadcasts are dropped");
  const hostile = parseGestureBroadcast({
    path: "",
    nodes: { nan: { position: { x: NaN, y: 0 } }, neg: { width: -5 }, str: { position: { x: "1", y: 2 } }, ok: { position: { x: 1, y: 2 } } },
  });
  assert(hostile !== null && Object.keys(hostile.nodes).join() === "ok", "non-finite, negative and non-numeric geometry is discarded");
  const flood = parseGestureBroadcast({
    path: "",
    nodes: Object.fromEntries(Array.from({ length: MAX_BROADCAST_NODES + 50 }, (_, i) => [`n${i}`, { position: { x: i, y: i } }])),
  });
  assert(Object.keys(flood?.nodes ?? {}).length === MAX_BROADCAST_NODES, "a broadcast is capped at MAX_BROADCAST_NODES");
}

console.log("\n=== Peer overlays by level ===");
{
  const peers: Array<{ gesture?: GestureBroadcast | null }> = [
    { gesture: { path: "", nodes: { a: { position: { x: 1, y: 1 } } } } },
    { gesture: { path: "x", nodes: { b: { position: { x: 2, y: 2 } } } } },
    { gesture: null },
    {},
  ];
  const root = remoteInFlight(peers, "");
  assert(root.size === 1 && root.has("a"), "only gestures at the viewed level apply");
  assert(remoteInFlight([{ gesture: null }], "") === NO_IN_FLIGHT, "no gestures, the shared empty overlay (stable identity)");
}

console.log("\n=== Recognising the release (WS4-R2) ===");
{
  const geometry = new Map([["a", { position: { x: 10, y: 10 }, isAutoSized: true }]]);
  const pending = new Map<string, PendingNodeUpdate>();
  const during = classifyNodeChanges(
    [{ type: "position", id: "a", position: { x: 11, y: 10 }, dragging: true } as NodeChange],
    pending,
    geometry
  );
  assert(during.isActiveGesture && !during.gestureEnded, "a drag frame is active, not ended");
  const release = classifyNodeChanges(
    [{ type: "position", id: "a", position: { x: 10, y: 10 }, dragging: false } as NodeChange],
    new Map(),
    geometry
  );
  assert(release.gestureEnded && !release.isActiveGesture, "a release where the node already is still ends the gesture");
  const stray = classifyNodeChanges([{ type: "select", id: "a", selected: true } as NodeChange], new Map(), geometry);
  assert(!stray.gestureEnded && !stray.isActiveGesture, "a selection change mid-drag neither continues nor ends it");
  const resizeEnd = classifyNodeChanges(
    [{ type: "dimensions", id: "a", dimensions: { width: 5, height: 5 }, resizing: false } as NodeChange],
    new Map(),
    geometry
  );
  assert(resizeEnd.gestureEnded, "a resize release ends the gesture too");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
} else {
  console.log("\nAll gesture geometry checks passed.");
}
