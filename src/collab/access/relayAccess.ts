/**
 * Getting into a session's relay (WS10-R6, R7).
 *
 * Where a deployment's relay requires membership, a peer must carry a
 * short-lived token the store issued for that room. The token rides in the
 * connection's query string, which is the only place y-webrtc's own client
 * can put one.
 *
 * Everything here is conditional. No store configured, or a relay that
 * does not ask for tokens, and the URLs are returned untouched - which is
 * how every deployment has worked until now.
 *
 * A token admits someone to a room. It does not decrypt anything: what
 * passes through the relay is encrypted with the session's key, which the
 * relay never sees. For a session started by link that key is in the link;
 * for a workspace document it comes from the store, with the document.
 */
import { StoreClientError } from './storeErrors.ts';
import { createStoreSessionClient, type StoreSessionClient } from './storeSessionClient.ts';

export interface RelayAccessOptions {
  storeUrl: string | null;
  room: string;
  urls: string[];
  client?: StoreSessionClient;
  /**
   * Asked first. A workspace document's room on a trusted store is not
   * open to everyone signed in: its token comes with the document, for
   * people who may edit it. Returns the token, null when this room needs
   * none, or undefined when the room is not one it knows - in which case
   * the store is asked in the ordinary way.
   */
  tokenForRoom?: (room: string) => Promise<string | null | undefined>;
}

export interface RelayAccess {
  urls: string[];
  /** Why the URLs are unchanged, when a token might have been expected. */
  note: string | null;
}

const withToken = (url: string, token: string): string => {
  // Preserves any query the deployment already put on its relay URL.
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}token=${encodeURIComponent(token)}`;
};

export async function authorizeRelayUrls(options: RelayAccessOptions): Promise<RelayAccess> {
  const { storeUrl, room, urls } = options;
  if (!storeUrl || urls.length === 0) return { urls, note: null };
  if (options.tokenForRoom) {
    try {
      const token = await options.tokenForRoom(room);
      if (token === null) return { urls, note: null };
      if (token !== undefined) {
        return { urls: urls.map((url) => withToken(url, token)), note: null };
      }
    } catch {
      // As below: go ahead without one, and let the relay say so if it
      // needed it.
      return {
        urls,
        note: "This document's live session could not be authorized. You can keep working; changes are still saved to the workspace.",
      };
    }
  }
  const client = options.client ?? createStoreSessionClient({ baseUrl: storeUrl });

  try {
    if ((await client.relayAuthentication()) !== 'required') return { urls, note: null };
    const token = await client.roomToken(room);
    return { urls: urls.map((url) => withToken(url, token.token)), note: null };
  } catch (error) {
    // Not fatal here: the relay refuses the connection if it needed a
    // token, and says so. Going ahead with a plain URL gives that refusal
    // rather than an error from a store the session did not need.
    const note =
      error instanceof StoreClientError && error.reason === 'unauthenticated'
        ? 'This relay only admits people who have signed in. Sign in, then start the session again.'
        : error instanceof StoreClientError && error.reason === 'offline'
          ? 'The store is unreachable, so this session could not be authorized. If the relay requires it, the connection will be refused.'
          : null;
    return { urls, note };
  }
}
