/**
 * The part of a store that is about the person rather than their
 * documents: signing in and out, who the store says they are, and tokens
 * for the relay.
 *
 * Workspaces and documents are trustedStoreClient.ts. This is separate
 * because it is needed without them - someone signed in with nothing shared
 * is still named on their cursor, and a session started by link still needs
 * a relay token where the relay asks for one.
 *
 * These routes are under /v1 because they have not changed since the store
 * was first written; nothing about them is tied to how documents are kept.
 */
import { StoreClientError, type StoreClientErrorReason } from './storeErrors.ts';

export interface StoreSessionClientOptions {
  /** Where the store is, e.g. https://store.example.com */
  baseUrl: string;
  /** Injected for tests; defaults to the platform fetch with cookies. */
  fetch?: typeof fetch;
}

export interface SessionInfo {
  issuer: string;
  subject: string;
  displayName?: string;
}

export function createStoreSessionClient(options: StoreSessionClientOptions) {
  const call =
    options.fetch ??
    ((input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, { ...init, credentials: 'include' }));
  const base = options.baseUrl.replace(/\/+$/, '');

  async function request(path: string, method = 'GET'): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await call(`${base}${path}`, { method });
    } catch (error) {
      // The store being unreachable is ordinary - the editor works without
      // it - so it is its own reason rather than an error to surface raw.
      throw new StoreClientError(`The store could not be reached: ${String(error)}`, 'offline');
    }
    const text = await response.text();
    let body: Record<string, unknown>;
    try {
      body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      throw new StoreClientError(
        'The store returned something that is not JSON.',
        'store-error',
        response.status,
      );
    }
    if (!response.ok) {
      const error = (body.error ?? {}) as { reason?: string; message?: string };
      const reason: StoreClientErrorReason =
        error.reason === 'unauthenticated' || error.reason === 'forbidden'
          ? error.reason
          : 'store-error';
      throw new StoreClientError(
        error.message ?? `The store refused the request (${response.status}).`,
        reason,
        response.status,
      );
    }
    return body;
  }

  return {
    /** Whether joining a session through the relay needs a token from
     * this store. */
    async relayAuthentication(): Promise<'none' | 'required'> {
      const body = await request('/v1/health');
      return body.relayAuthentication === 'required' ? 'required' : 'none';
    },

    /** A short-lived token admitting this person to one session room.
     * Refused where they are not signed in, and for a workspace document's
     * room, whose token comes with the document. */
    async roomToken(room: string): Promise<{ token: string; expiresAt: string }> {
      const body = await request(`/v1/rooms/${encodeURIComponent(room)}/token`, 'POST');
      return body as { token: string; expiresAt: string };
    },

    /** Who the store thinks we are, or null when not signed in. */
    async session(): Promise<SessionInfo | null> {
      try {
        const body = await request('/v1/auth/session');
        return (body.session as SessionInfo) ?? null;
      } catch (error) {
        if (error instanceof StoreClientError && error.reason === 'unauthenticated') return null;
        throw error;
      }
    },

    /** Ends the session at the store, so the cookie stops working. */
    async logout(): Promise<void> {
      await request('/v1/auth/logout', 'POST');
    },

    /** The ways to sign in that this store offers. */
    async providers(): Promise<string[]> {
      const body = await request('/v1/auth/providers');
      return (body.providers as string[]) ?? [];
    },

    /**
     * Where to send the browser to sign in. `returnTo` is the page to come
     * back to; the store accepts its own origin and the editor origins it
     * allows, and refuses any other.
     */
    signInUrl(provider: string, returnTo?: string): string {
      const query = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : '';
      return `${base}/v1/auth/${encodeURIComponent(provider)}/start${query}`;
    },
  };
}

export type StoreSessionClient = ReturnType<typeof createStoreSessionClient>;
