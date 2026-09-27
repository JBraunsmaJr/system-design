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
 * A token admits someone to a room. It does not decrypt anything: session
 * content is encrypted with the key from the share link (WS3-R1), which
 * neither the store nor the relay ever sees.
 */
import { createStoreClient, StoreClientError, type StoreClient } from './storeClient.ts';

export interface RelayAccessOptions {
  storeUrl: string | null;
  room: string;
  urls: string[];
  client?: StoreClient;
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
  const client = options.client ?? createStoreClient({ baseUrl: storeUrl });

  try {
    const health = await client.health();
    if (health.relayAuthentication !== 'required') return { urls, note: null };
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
          ? 'The store is unreachable, so this session could not be authorised. If the relay requires it, the connection will be refused.'
          : null;
    return { urls, note };
  }
}
