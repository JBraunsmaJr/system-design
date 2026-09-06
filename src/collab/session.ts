import { WebrtcProvider } from "y-webrtc";
import type * as Y from "yjs";

/**
 * Wires a Y.Doc to a WebRTC-based collaborative session. This is the
 * transport layer the plan called for: actual document sync happens
 * peer-to-peer over WebRTC data channels, so no third party ever sees
 * workbook content - the only thing that touches outside infrastructure
 * is the signaling handshake (opaque connection-setup metadata,
 * meaningless without the data channel it's establishing), and even
 * that goes to a self-hosted relay, never y-webrtc's own public default
 * signaling servers.
 *
 * y-webrtc ships its own signaling server as a bin script
 * (node_modules/y-webrtc/bin/server.js, published as the
 * `y-webrtc-signaling` command) - confirmed by reading its actual
 * source before depending on it: it's a genuinely stateless relay (an
 * in-memory Map from room name to the set of subscribed connections,
 * nothing persisted), and its `publish` handler forwards whatever
 * message object it's given to a room's other subscribers without ever
 * inspecting its content - exactly the "small, generic, self-hostable"
 * signaling piece the plan described, already built and maintained
 * upstream rather than something to hand-roll here. Its rendezvous
 * protocol (subscribe/publish by topic) was verified directly with real
 * WebSocket clients - start the server, connect two independent
 * clients, confirm a published message reaches a subscriber and not a
 * non-subscriber - before writing this integration.
 *
 * What ISN'T verified here, and can't be from this environment: actual
 * WebRTC peer-to-peer data flow between two browser tabs. WebRTC is a
 * browser API (RTCPeerConnection and friends) with no equivalent in
 * plain Node without a heavy, non-production native dependency (`wrtc`)
 * that wouldn't reflect real browser behavior anyway - so this specific
 * piece needs manual verification in an actual browser (two tabs, or
 * two machines) before being treated as proven. Everything that
 * genuinely IS testable without a browser - the signaling server's own
 * protocol, and this module's own construction/lifecycle logic - has
 * been.
 *
 * A room name IS the whole "who's in this session" mechanism - anyone
 * with the exact room name (and, if set, the password) can join.
 * There's no separate access-control layer here; choosing a
 * hard-to-guess room name (e.g. a generated id, not "team-standup") is
 * what actually keeps a session private, the same way an unlisted
 * shared-link URL does.
 */
export interface LocalPresenceInfo {
  name: string;
  color: string;
  /** This peer's cursor position in FLOW coordinates (the diagram's own
   * coordinate space, not screen pixels) - null when their cursor isn't
   * currently over the canvas at all (they're interacting with a
   * different panel, or haven't moved their mouse over the canvas yet
   * this session). Flow coordinates, not screen ones, because each
   * peer's own viewport (pan/zoom) is independent - a screen-pixel
   * position would only be meaningful on the sender's own screen. */
  cursor: { x: number; y: number } | null;
  /** ids of nodes/edges this peer currently has selected - used to show
   * a "someone else is looking at/editing this" indicator, distinct
   * from this person's own selection. */
  selectedNodeIds: string[];
  selectedEdgeIds: string[];
}

/** What you observe about ANOTHER peer - everything they set about
 * themselves, plus Awareness's own per-connection identifier. clientId
 * only makes sense on this read side: it's intrinsic to a peer's
 * connection, assigned by the Awareness protocol itself, never
 * something the application sets about its own local presence. */
export interface PresenceInfo extends LocalPresenceInfo {
  /** Stable for the lifetime of this peer's connection, and (unlike
   * name) guaranteed unique, since two peers could otherwise
   * coincidentally share a display name. Exists specifically so callers
   * have something safe to use as a React key when rendering a list of
   * peers. */
  clientId: number;
}

export interface CollabSession {
  provider: WebrtcProvider;
  /** True once at least one other peer (or, on the same machine, another
   * browser tab via BroadcastChannel) has been found and initial sync
   * has completed - not the same as "actively connected right now",
   * since WebRTC connections can drop and reform without a fresh sync
   * being needed. */
  isSynced(): boolean;
  disconnect(): void;
  /** Sets this peer's own presence info (name, color, cursor position,
   * current selection), visible to
   * everyone else in the session. Safe to call again later to update it
   * - e.g. if the person changes their display name mid-session - each
   * call fully replaces whatever was set before, matching Awareness's
   * own setLocalState semantics (see y-protocols' own awareness.js: a
   * client overrides its own state wholesale, not by patching fields).
   * This is presence, not document data - never touches the Y.Doc
   * itself, and disappears the moment this peer disconnects (Awareness
   * is explicitly "non-persistent data" - see y-protocols' own doc
   * comment on the class). */
  setLocalPresence(info: LocalPresenceInfo): void;
  /** Subscribes to the current set of OTHER peers' presence info - never
   * includes this peer's own (seeing yourself in a "who else is here"
   * list would be redundant, and every caller of this wants "who am I
   * sharing this session with", not "everyone including me"). Fires
   * immediately with whatever's already known, then again on every
   * change (a peer joining, updating their info, or disconnecting).
   * Returns an unsubscribe function. Peers who haven't called
   * setLocalPresence yet (or ever) are silently skipped rather than
   * appearing as a blank entry - Awareness tracks connection-level
   * presence for anyone in the room, but this session's own notion of
   * presence is specifically "peers who identified themselves". */
  subscribeToPresence(callback: (peers: PresenceInfo[]) => void): () => void;
}

export interface CollabSessionOptions {
  /** URLs of one or more self-hosted signaling servers, e.g.
   * ["wss://your-relay.example.com"]. Deliberately required, not
   * defaulted to y-webrtc's own public signaling servers - this app's
   * whole point is not routing data through infrastructure the person
   * running it doesn't control. */
  signalingUrls: string[];
  /** Optional shared password - if set, the room's traffic is
   * additionally encrypted with a key derived from it (see y-webrtc's
   * own `password` option), on top of WebRTC's own transport
   * encryption. Recommended for anything less private than "a
   * hard-to-guess generated room name is enough". */
  password?: string;
}

/**
 * Starts (or joins, if others are already there) a collaborative
 * session for the given Y.Doc under `roomName`. The returned session
 * stays live until `disconnect()` is called - this does not tie into
 * React's lifecycle itself; a caller (e.g. a hook) is responsible for
 * disconnecting when a session ends or a component unmounts.
 */
/**
 * Validates and normalizes one peer's raw Awareness state into a
 * PresenceInfo, or returns null if it doesn't even have the minimum
 * required fields (name, color) to be considered a genuine, identified
 * peer at all. Fields beyond name/color are defensively defaulted
 * rather than treated as disqualifying if missing or malformed - a
 * peer's state can be legitimately incomplete (the brief window right
 * after joining, before their first full setLocalPresence call
 * establishes everything at once), and a stale or malformed cursor
 * shouldn't hide an otherwise-valid peer's name/color/selection
 * entirely.
 *
 * Exported and kept pure (no Yjs/Awareness/browser dependency) so it's
 * directly testable - Awareness state is untyped, external input by
 * nature (anything a peer's own client chose to broadcast), and this is
 * the one place that decides what's trustworthy enough to surface.
 */
export function parsePresenceState(clientId: number, state: unknown): PresenceInfo | null {
  const candidate = state as Partial<LocalPresenceInfo> | null;
  if (!candidate || typeof candidate.name !== "string" || typeof candidate.color !== "string") return null;
  const cursor =
    candidate.cursor && typeof candidate.cursor.x === "number" && typeof candidate.cursor.y === "number"
      ? { x: candidate.cursor.x, y: candidate.cursor.y }
      : null;
  return {
    clientId,
    name: candidate.name,
    color: candidate.color,
    cursor,
    selectedNodeIds: Array.isArray(candidate.selectedNodeIds) ? candidate.selectedNodeIds : [],
    selectedEdgeIds: Array.isArray(candidate.selectedEdgeIds) ? candidate.selectedEdgeIds : [],
  };
}

export function startCollabSession(doc: Y.Doc, roomName: string, options: CollabSessionOptions): CollabSession {
  if (options.signalingUrls.length === 0) {
    throw new Error(
      "startCollabSession requires at least one self-hosted signaling server URL - refusing to silently fall back to y-webrtc's own public defaults."
    );
  }

  const provider = new WebrtcProvider(roomName, doc, {
    signaling: options.signalingUrls,
    password: options.password,
  });

  return {
    provider,
    isSynced: () => provider.room?.synced ?? false,
    disconnect: () => {
      provider.disconnect();
      provider.destroy();
    },
    setLocalPresence: (info) => {
      provider.awareness.setLocalState(info);
    },
    subscribeToPresence: (callback) => {
      const getOtherPeers = (): PresenceInfo[] => {
        const peers: PresenceInfo[] = [];
        provider.awareness.getStates().forEach((state: unknown, clientId: number) => {
          if (clientId === provider.awareness.clientID) return; // never include this peer's own presence
          const peer = parsePresenceState(clientId, state);
          if (peer) peers.push(peer);
        });
        return peers;
      };
      const handler = () => callback(getOtherPeers());
      provider.awareness.on("change", handler);
      callback(getOtherPeers()); // fire immediately with whatever's already known, not just on the next change
      return () => provider.awareness.off("change", handler);
    },
  };
}
