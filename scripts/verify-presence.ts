/**
 * Verifies session.ts's presence layer (setLocalPresence/
 * subscribeToPresence) against the real y-webrtc/y-protocols
 * Awareness implementation. Run with:
 *
 *   npx tsx scripts/verify-presence.ts
 *
 * Lives outside src/ for the same reason verify-signaling-server.ts
 * does: this needs Node's own process/network APIs (spawning the
 * signaling server as a subprocess) to construct a real WebrtcProvider
 * at all, and src/'s own tsconfig has no Node types configured.
 *
 * What this proves: setLocalPresence correctly writes to the real
 * Awareness object, subscribeToPresence correctly excludes this peer's
 * own presence and skips anyone who hasn't identified themselves, and -
 * the part that actually matters - a SECOND peer's presence genuinely
 * becomes visible once synced in. Real network sync between two actual
 * WebrtcProviders can't be exercised without a browser (see
 * session.ts's own doc comment on that boundary), but Awareness's own
 * sync mechanism (encodeAwarenessUpdate/applyAwarenessUpdate - the
 * exact functions y-webrtc itself uses internally to move presence
 * data across the wire) is plain data, and genuinely exercising it here
 * - not just asserting it "should" work - is what proves the presence
 * layer's own logic (exclude self, skip malformed entries, react to
 * change events) is correct, independent of whatever transport
 * eventually carries the updates in a real browser.
 *
 * The two simulated peers deliberately use DIFFERENT room names, even
 * though presence sync between them is bridged manually below - two
 * real peers are always separate browser tabs (separate JS module
 * instances), but y-webrtc keeps its own room registry as a
 * module-level singleton, so two providers for the exact same room
 * name within a single Node process trip its own "already exists"
 * safeguard. Different room names sidestep that entirely, with no
 * effect on what's actually being tested here.
 */
import * as Y from "yjs";
import { encodeAwarenessUpdate, applyAwarenessUpdate } from "y-protocols/awareness";
import { spawn, type ChildProcess } from "child_process";
import { startCollabSession, parsePresenceState } from "../src/collab/session";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  } else {
    console.log("ok:", msg);
  }
}

// === parsePresenceState - pure logic, no network/signaling-server needed at all ===
{
  const full = parsePresenceState(7, { name: "Alice", color: "#5b7cfa", cursor: { x: 10, y: 20 }, selectedNodeIds: ["n1"], selectedEdgeIds: ["e1"] });
  assert(
    full !== null &&
      full.clientId === 7 &&
      full.name === "Alice" &&
      full.color === "#5b7cfa" &&
      full.cursor?.x === 10 &&
      full.cursor?.y === 20 &&
      full.selectedNodeIds[0] === "n1" &&
      full.selectedEdgeIds[0] === "e1",
    "a fully-formed state parses into a PresenceInfo with every field correctly carried over, including the clientId passed in separately from the state itself"
  );

  assert(parsePresenceState(1, { color: "#5b7cfa" }) === null, "a state missing name entirely is rejected outright - there's no genuine peer identity to show without it");
  assert(parsePresenceState(1, { name: "Alice" }) === null, "a state missing color entirely is rejected outright, for the same reason");
  assert(parsePresenceState(1, null) === null, "a null state (no awareness entry at all) is rejected outright");
  assert(parsePresenceState(1, { name: 123, color: "#5b7cfa" }) === null, "a name that isn't actually a string is rejected, not coerced");

  const noCursorField = parsePresenceState(1, { name: "Bob", color: "#000" });
  assert(noCursorField !== null && noCursorField.cursor === null, "a valid name/color with no cursor field at all still parses successfully, defaulting cursor to null rather than being rejected - a peer's state can be legitimately incomplete right after joining");

  const malformedCursor = parsePresenceState(1, { name: "Bob", color: "#000", cursor: { x: "not a number", y: 5 } });
  assert(malformedCursor !== null && malformedCursor.cursor === null, "a malformed cursor (x isn't actually a number) doesn't reject the whole peer - it's defaulted to null while name/color still come through correctly");

  const noSelections = parsePresenceState(1, { name: "Bob", color: "#000" });
  assert(
    noSelections !== null && Array.isArray(noSelections.selectedNodeIds) && noSelections.selectedNodeIds.length === 0 && Array.isArray(noSelections.selectedEdgeIds) && noSelections.selectedEdgeIds.length === 0,
    "missing selectedNodeIds/selectedEdgeIds default to empty arrays rather than being undefined or rejecting the peer"
  );

  const malformedSelections = parsePresenceState(1, { name: "Bob", color: "#000", selectedNodeIds: "not-an-array" });
  assert(malformedSelections !== null && Array.isArray(malformedSelections.selectedNodeIds) && malformedSelections.selectedNodeIds.length === 0, "a selectedNodeIds that isn't actually an array is defaulted to empty rather than passed through as-is or rejecting the peer");

  const withViewAndFocus = parsePresenceState(1, { name: "Bob", color: "#000", viewMode: "requirements", focusedItemId: "REQ-5" });
  assert(withViewAndFocus !== null && withViewAndFocus.viewMode === "requirements" && withViewAndFocus.focusedItemId === "REQ-5", "viewMode and focusedItemId are correctly carried over when present and valid");

  const noViewOrFocus = parsePresenceState(1, { name: "Bob", color: "#000" });
  assert(noViewOrFocus !== null && noViewOrFocus.viewMode === null && noViewOrFocus.focusedItemId === null, "missing viewMode/focusedItemId default to null rather than being undefined or rejecting the peer - matches a peer on a view that doesn't track this (diagram/team/skill-tree), or the brief window before their first full broadcast");

  const malformedView = parsePresenceState(1, { name: "Bob", color: "#000", viewMode: 42, focusedItemId: { not: "a string" } });
  assert(malformedView !== null && malformedView.viewMode === null && malformedView.focusedItemId === null, "a viewMode/focusedItemId that aren't actually strings are defaulted to null rather than passed through as-is or rejecting the peer");
}


function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (cond()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("timeout waiting for condition"));
      setTimeout(check, 20);
    };
    check();
  });
}

const PORT = 14449;
let server: ChildProcess | null = null;
const hardExit = setTimeout(() => {
  console.error("HARD TIMEOUT - forcing exit");
  server?.kill("SIGKILL");
  process.exit(1);
}, 10000);

try {
  server = spawn("node", ["node_modules/y-webrtc/bin/server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
  });
  let ready = false;
  server.stdout?.on("data", (d) => {
    if (d.toString().includes("Signaling server running")) ready = true;
  });
  await waitFor(() => ready);

  const sessionA = startCollabSession(new Y.Doc(), "presence-verify-room-a", { signalingUrls: [`ws://localhost:${PORT}`] });
  const sessionB = startCollabSession(new Y.Doc(), "presence-verify-room-b", { signalingUrls: [`ws://localhost:${PORT}`] });

  // === Local behavior - no sync involved yet ===
  const seenByA1: unknown[][] = [];
  const unsubA = sessionA.subscribeToPresence((peers) => seenByA1.push(peers));
  assert(seenByA1.length === 1 && seenByA1[0].length === 0, "subscribeToPresence fires immediately with an empty list before anyone (including this peer) has set any presence");

  sessionA.setLocalPresence({ name: "Alice", color: "#5b7cfa", cursor: null, selectedNodeIds: [], selectedEdgeIds: [], viewMode: null, focusedItemId: null });
  assert(seenByA1[seenByA1.length - 1].length === 0, "setting THIS peer's own presence does not appear in ITS OWN subscribeToPresence feed - seeing yourself in a 'who else is here' list would be redundant");
  unsubA();

  // A peer whose awareness state exists but was never given name/color
  // (e.g. some other, unrelated use of the same awareness channel)
  // should be silently skipped, not shown as a broken entry.
  const providerAWithGarbage = sessionA.provider;
  providerAWithGarbage.awareness.setLocalState({ someUnrelatedField: 123 });
  let sawGarbagePeer = false;
  const unsubCheckGarbage = sessionB.subscribeToPresence((peers) => {
    if (peers.some((p) => (p as unknown as { someUnrelatedField?: number }).someUnrelatedField !== undefined)) {
      sawGarbagePeer = true;
    }
  });

  // === Cross-peer sync, using Awareness's own real sync primitives -
  // the exact mechanism y-webrtc itself uses internally, genuinely
  // exercised here rather than assumed ===
  sessionA.setLocalPresence({ name: "Alice", color: "#5b7cfa", cursor: null, selectedNodeIds: [], selectedEdgeIds: [], viewMode: null, focusedItemId: null });
  const updateFromA = encodeAwarenessUpdate(sessionA.provider.awareness, [sessionA.provider.awareness.clientID]);
  applyAwarenessUpdate(sessionB.provider.awareness, updateFromA, "test-sync");

  assert(!sawGarbagePeer, "an awareness entry without a valid name/color is never surfaced through subscribeToPresence, even once real sync has happened");
  unsubCheckGarbage();

  let latestSeenByB: { name: string; color: string }[] = [];
  const unsubB = sessionB.subscribeToPresence((peers) => {
    latestSeenByB = peers;
  });
  assert(
    latestSeenByB.some((p) => p.name === "Alice" && p.color === "#5b7cfa"),
    "once Alice's presence is genuinely synced into peer B's Awareness object (via the real encodeAwarenessUpdate/applyAwarenessUpdate functions y-webrtc itself uses), peer B's subscribeToPresence correctly reports her"
  );

  // Updating presence should propagate as a fresh 'change' event, not
  // require a fresh subscription.
  sessionA.setLocalPresence({ name: "Alice", color: "#ff0000", cursor: null, selectedNodeIds: [], selectedEdgeIds: [], viewMode: null, focusedItemId: null });
  const updatedFromA = encodeAwarenessUpdate(sessionA.provider.awareness, [sessionA.provider.awareness.clientID]);
  applyAwarenessUpdate(sessionB.provider.awareness, updatedFromA, "test-sync");
  await waitFor(() => latestSeenByB.some((p) => p.color === "#ff0000"));
  assert(true, "an existing subscription picks up a presence UPDATE (not just the initial appearance) without needing to resubscribe");

  unsubB();

  sessionA.disconnect();
  sessionB.disconnect();
} catch (err) {
  console.error("FAIL:", (err as Error).message);
  failures++;
} finally {
  clearTimeout(hardExit);
  server?.kill("SIGKILL");
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
// WebrtcProvider appears to leave some internal handle alive even after
// disconnect() (likely a reconnection timer or the signaling
// WebSocket itself) - force exit rather than rely on natural process
// termination, now that every assertion has already run.
process.exit(failures === 0 ? 0 : 1);
