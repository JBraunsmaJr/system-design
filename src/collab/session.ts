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
export interface CollabSession {
  provider: WebrtcProvider;
  /** True once at least one other peer (or, on the same machine, another
   * browser tab via BroadcastChannel) has been found and initial sync
   * has completed - not the same as "actively connected right now",
   * since WebRTC connections can drop and reform without a fresh sync
   * being needed. */
  isSynced(): boolean;
  disconnect(): void;
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
  };
}
