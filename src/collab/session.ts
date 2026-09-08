import { WebrtcProvider } from "y-webrtc";
import type * as Y from "yjs";

/**
 * Wires a Y.Doc to a WebRTC-based collaborative session. This is the
 * transport layer for how the actual document sync happens peer-to-peer over WebRTC data channels,
 * so no third party ever sees workbook content - the only thing that touches outside infrastructure
 * is the signaling handshake (opaque connection-setup metadata, meaningless without the data channel it's establishing),
 * and even that goes to a self-hosted relay, never y-webrtc's own public default signaling servers. Technically,
 * a user can configure y-webrtc to use the public signaling servers if desired.
 *
 * y-webrtc ships its own signaling server as a bin script
 * (node_modules/y-webrtc/bin/server.js, published as the
 * `y-webrtc-signaling` command) - it's a genuinely stateless relay (an
 * in-memory Map from room name to the set of subscribed connections,
 * nothing persisted), and its `publish` handler forwards whatever
 * message object it's given to a room's other subscribers without ever
 * inspecting its content.
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
  /** Which view this peer is currently in ("requirements", "timeline",
   * etc. - matches this app's own viewMode values) - lets a peer on a
   * DIFFERENT view be excluded from "who's looking at this item"
   * scoping, even if focusedItemId happens to still hold a stale value
   * from before they navigated away. Null covers both "on a view with
   * no presence support" and the brief window before a session's first
   * broadcast. */
  viewMode: string | null;
  /** id of the requirements item or timeline item this peer currently
   * has open/is actively editing, scoped by viewMode above - null when
   * nothing specific is focused (browsing a list, or on a view/domain
   * that doesn't track this). */
  focusedItemId: string | null;
  /** This peer's current position within the diagram's own sub-diagram
   * nesting - the same DiagramPath (array of node ids) App.tsx tracks
   * as `path`, joined into a single string for easy equality
   * comparison. Cursor coordinates are only meaningful within the
   * specific sub-diagram level they were reported from (a position
   * inside a sub-diagram means nothing on the parent level's own
   * canvas) - this is what lets a viewer correctly show only cursors
   * from peers actually on the SAME level they're looking at, rather
   * than a peer's cursor appearing to hover somewhere nonsensical on a
   * completely different diagram level. Empty string represents the
   * root level, matching an empty DiagramPath array. */
  diagramPath: string;
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
  /**
   * Subscribes to whether this browser currently has a live WebSocket to
   * at least one signaling relay. Fires immediately with the current
   * state, then on every connect/disconnect. Returns an unsubscribe
   * function.
   *
   * This is deliberately NOT the same question as isSynced(). A session
   * can be unsynced simply because nobody else has joined yet, which is
   * normal and fine. Being unable to reach the relay at all is a
   * configuration or infrastructure fault - a wrong URL, a DNS name
   * that doesn't resolve from this network, a TLS failure, a relay that
   * isn't running - and it needs to be distinguishable, because without
   * it every one of those looks identical to "waiting for someone to
   * join".
   */
  subscribeToRelayStatus(callback: (connected: boolean) => void): () => void;
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
  /**
   * ICE servers for the WebRTC peer connections themselves - STUN for
   * discovering how peers are reachable from each other, TURN for
   * relaying when a direct connection can't be made at all.
   *
   * Three states, deliberately distinct:
   *   undefined - leave simple-peer's own defaults in place, which are
   *               public STUN servers (Google's and Twilio's)
   *   []        - no ICE servers; host candidates only
   *   [...]     - use exactly these instead of the defaults
   *
   * The middle case is what an isolated network wants: the bundled
   * public STUN servers are unreachable there, so leaving them in place
   * means every connection stalls on them before falling back to the
   * host candidates that were sufficient all along.
   */
  iceServers?: RTCIceServer[];
}

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
    viewMode: typeof candidate.viewMode === "string" ? candidate.viewMode : null,
    focusedItemId: typeof candidate.focusedItemId === "string" ? candidate.focusedItemId : null,
    diagramPath: typeof candidate.diagramPath === "string" ? candidate.diagramPath : "",
  };
}

/**
 * Starts (or joins, if others are already there) a collaborative
 * session for the given Y.Doc under `roomName`. The returned session
 * stays live until `disconnect()` is called - this does not tie into
 * React's lifecycle itself; a caller (e.g. a hook) is responsible for
 * disconnecting when a session ends or a component unmounts.
 */
export function startCollabSession(doc: Y.Doc, roomName: string, options: CollabSessionOptions): CollabSession {
  if (options.signalingUrls.length === 0) {
    throw new Error(
      "startCollabSession requires at least one self-hosted signaling server URL - refusing to silently fall back to y-webrtc's own public defaults."
    );
  }

  const provider = new WebrtcProvider(roomName, doc, {
    signaling: options.signalingUrls,
    password: options.password,
    /**
     * Reaches the RTCPeerConnection via y-webrtc's peerOpts, which it
     * spreads into simple-peer's constructor. simple-peer merges this
     * with Object.assign({}, Peer.config, opts.config) - a SHALLOW
     * merge, so supplying iceServers replaces the default list outright
     * while leaving its sdpSemantics setting intact, which is exactly
     * the behavior wanted here.
     *
     * Omitted entirely when no servers are configured, rather than
     * passed as undefined: `config: { iceServers: undefined }` would
     * override the defaults with nothing, quietly turning "I didn't
     * configure this" into "use no ICE servers at all".
     */
    ...(options.iceServers === undefined ? {} : { peerOpts: { config: { iceServers: options.iceServers } } }),
  });

  return {
    provider,
    isSynced: () => provider.room?.synced ?? false,
    disconnect: () => {
      /**
       * destroy() already calls Room.disconnect() as its own first step
       * internally (see y-webrtc's own source), then additionally removes
       * this room from a module-level registry shared across every
       * WebrtcProvider on the page and detaches a "beforeunload" listener
       * - neither of which plain disconnect() does on its own.
       */
      provider.destroy();
    },
    setLocalPresence: (info) => {
      provider.awareness.setLocalState(info);
    },
    subscribeToRelayStatus: (callback) => {
      /**
       * y-webrtc's SignalingConn extends lib0's WebsocketClient, which
       * carries a `connected` flag and emits "connect"/"disconnect" -
       * read directly off that rather than tracked separately here, so
       * this can never drift from what the provider actually believes.
       *
       * Connected means ANY relay is up: signalingUrls is a list
       * precisely so one being unreachable isn't fatal, and reporting
       * "disconnected" while a working relay remains would be wrong.
       */
      const isConnected = () => provider.signalingConns.some((conn) => conn.connected);
      const handler = () => callback(isConnected());
      for (const conn of provider.signalingConns) {
        conn.on("connect", handler);
        conn.on("disconnect", handler);
      }
      callback(isConnected()); // fire immediately - the relay may already be up (or already failing) before anyone subscribes
      return () => {
        for (const conn of provider.signalingConns) {
          conn.off("connect", handler);
          conn.off("disconnect", handler);
        }
      };
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
