// Namespaced to avoid colliding with anything else that might use this
// browser's localStorage for this origin - same convention as
// signalingConfig.ts and presenceIdentity.ts.
const ICE_SERVERS_KEY = "system-design-editor:ice-servers";

/**
 * The literal value meaning "no ICE servers at all".
 *
 * A distinct token is needed because an empty string cannot express
 * this: an unset VITE_ICE_SERVERS and an explicitly-emptied one are
 * both "" by the time they reach here, and those two have to mean
 * different things - "use the library's defaults" and "use nothing".
 *
 * "Nothing" is a real and important configuration, not a degenerate
 * one. On an isolated network the bundled public STUN servers are
 * unreachable, so every connection attempt stalls waiting for them to
 * time out before falling back to host candidates. Host candidates are
 * all a single flat LAN ever needed, so declaring no ICE servers makes
 * those sessions connect promptly instead of slowly.
 */
export const NO_ICE_SERVERS = "none";

/**
 * Gets the deployment default ICE servers.
 *
 * Checks in order:
 * 1. Runtime config injected into `window.__APP_CONFIG__.ICE_SERVERS` (e.g. from Docker container environment variables)
 * 2. Build-time environment variable `import.meta.env.VITE_ICE_SERVERS`
 * 3. Empty string if unset
 */
export function getDefaultIceServers(): string {
  if (typeof window !== "undefined") {
    const runtimeConfig = (window as unknown as { __APP_CONFIG__?: { ICE_SERVERS?: string } }).__APP_CONFIG__;
    if (runtimeConfig?.ICE_SERVERS) {
      return runtimeConfig.ICE_SERVERS;
    }
  }
  if (typeof import.meta !== "undefined" && typeof import.meta.env !== "undefined") {
    return (import.meta.env.VITE_ICE_SERVERS as string | undefined) ?? "";
  }
  return "";
}

/**
 * Reads this person's own, runtime-configured ICE server list, if
 * they've ever set one. Same storage convention and same null-vs-empty
 * distinction as loadSignalingUrls - null means "never configured, fall
 * back to the build-time default", which is not the same as a saved
 * value that happens to be empty.
 */
export function loadIceServers(): string | null {
  try {
    return localStorage.getItem(ICE_SERVERS_KEY);
  } catch {
    return null;
  }
}

/**
 * Persists this person's own ICE server override. Pass an empty string
 * to clear it and fall back to VITE_ICE_SERVERS again. Failures are
 * silently swallowed, same as signalingConfig.ts's own save function.
 */
export function saveIceServers(raw: string): void {
  try {
    localStorage.setItem(ICE_SERVERS_KEY, raw);
  } catch {
    // Same reasoning as signalingConfig.ts - this is a convenience, not
    // a guarantee.
  }
}

/**
 * Parses a comma-separated ICE server string into what WebRTC expects.
 *
 * Each entry is a URL, optionally followed by a username and credential
 * separated by pipes - TURN servers almost always need authentication,
 * and a format that couldn't express credentials would be useless for
 * exactly the deployments this exists to serve:
 *
 *   stun:stun.internal:3478
 *   turn:turn.internal:3478|username|password
 *
 * Pipe is the delimiter because RFC 7064/7065 don't permit it in a
 * STUN/TURN URI, so it can never appear inside the URL itself and needs
 * no escaping. Commas separate entries, matching how signaling URLs are
 * already configured, so both fields behave the same way.
 *
 * Returns:
 *   undefined - nothing configured; the caller should leave WebRTC's
 *               own defaults alone (currently public STUN servers)
 *   []        - the NO_ICE_SERVERS token; host candidates only
 *   [...]     - the configured servers, replacing the defaults
 *
 * The three-way result is what lets "unconfigured" and "deliberately
 * empty" stay distinguishable all the way down to the peer connection,
 * rather than collapsing into one ambiguous empty array.
 */
export function parseIceServers(raw: string | null | undefined): RTCIceServer[] | undefined {
  if (raw === null || raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  if (trimmed.toLowerCase() === NO_ICE_SERVERS) return [];

  const servers: RTCIceServer[] = [];
  for (const entry of trimmed.split(",")) {
    const parts = entry.split("|").map((p) => p.trim());
    const urls = parts[0];
    if (!urls) continue; // a stray comma shouldn't produce an entry with no URL

    const server: RTCIceServer = { urls };
    // Both are required together: RTCPeerConnection rejects an ICE
    // server that has one without the other, and a TURN entry given
    // only a username would fail at connection time rather than here.
    if (parts[1] && parts[2]) {
      server.username = parts[1];
      server.credential = parts[2];
    }
    servers.push(server);
  }

  // Every entry was malformed - treat as unconfigured rather than
  // silently handing WebRTC an empty list, which would mean something
  // quite different (see NO_ICE_SERVERS).
  return servers.length > 0 ? servers : undefined;
}
