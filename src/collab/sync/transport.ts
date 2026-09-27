/**
 * Sync transport seam (WS1-R9).
 *
 * The same codebase has to serve two audiences whose constraints point in
 * opposite directions.
 *
 * Open source wants ad-hoc collaboration with no infrastructure beyond a
 * stateless relay: two browsers find each other and sync directly. A
 * government deployment may be unable to use that at all, because a
 * browser-to-browser WebRTC data channel is protected by DTLS implemented in
 * the browser, and neither end is a FIPS-validated module. Routing through a
 * server whose TLS terminates in a validated module is the compliant shape.
 *
 * Both are the same Yjs document with a different provider attached, so the
 * difference is confined to this file. Selecting a transport is configuration,
 * not a fork, and a build configured without peer-to-peer must not pull
 * y-webrtc into the bundle at all - hence the dynamic import in the factory
 * rather than a static one.
 */

export type TransportKind = 'webrtc' | 'websocket';

export interface TransportOptions {
  /** Signaling servers for WebRTC, or sync servers for WebSocket. */
  urls: string[];
  /** Room secret. For WebRTC this is the y-webrtc password, from which it
   * derives an AES-GCM key over PBKDF2. */
  password?: string;
  iceServers?: RTCIceServer[];
}

/**
 * The surface the app needs from a provider, which is much narrower than any
 * concrete provider exposes. Keeping it narrow is what makes a second
 * implementation tractable.
 */
export interface SyncTransport {
  readonly kind: TransportKind;
  /** Whether the document has caught up with at least one remote source. */
  isSynced(): boolean;
  /** Awareness instance, used for presence and for ephemeral gesture
   * geometry (WS4-R1). Typed loosely because y-protocols' Awareness is
   * structurally identical across providers but not nominally so. */
  readonly awareness: unknown;
  /** Fired when connection state changes, so the UI can report it. */
  onStatusChange(listener: (connected: boolean) => void): () => void;
  destroy(): void;
}

export interface TransportFactoryOptions extends TransportOptions {
  kind?: TransportKind;
}

/**
 * Which transports this build includes.
 *
 * Read from configuration rather than hardcoded so a government build can ship
 * without the peer-to-peer path compiled in, and so the choice is auditable
 * from the deployment rather than inferred from the source.
 */
export function enabledTransports(config: Record<string, unknown> = {}): TransportKind[] {
  const raw = config.VITE_SYNC_TRANSPORTS;
  if (typeof raw !== 'string' || raw.trim() === '') return ['webrtc'];
  const parsed = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is TransportKind => s === 'webrtc' || s === 'websocket');
  return parsed.length > 0 ? parsed : ['webrtc'];
}

export function defaultTransport(config: Record<string, unknown> = {}): TransportKind {
  return enabledTransports(config)[0];
}

export function isTransportEnabled(
  kind: TransportKind,
  config: Record<string, unknown> = {},
): boolean {
  return enabledTransports(config).includes(kind);
}

/**
 * Builds the peerOpts blob y-webrtc expects for custom ICE servers.
 *
 * Extracted so the reasoning is testable without constructing a provider.
 * Omitted entirely when no servers are configured rather than passed as
 * undefined: `config: { iceServers: undefined }` would override the browser
 * defaults with nothing, quietly turning "not configured" into "no ICE servers
 * at all", which breaks any connection needing STUN.
 */
export function buildPeerOpts(iceServers: RTCIceServer[] | undefined): Record<string, unknown> {
  if (iceServers === undefined) return {};
  return { peerOpts: { config: { iceServers } } };
}
