/**
 * Who the store says this person is (WS10-R1), for naming them to others
 * in a session, and what identity providers are available when signed out.
 *
 * Separate from the workspace sync on purpose. Identity does not depend
 * on which document is open, or on whether it is in the workspace at all
 * - someone signed in with nothing shared still belongs on their cursor
 * by name - and asking early means the name is known before any session
 * starts, rather than arriving afterwards and having to be republished.
 */
import { useEffect, useState } from 'react';
import { createStoreClient } from './storeClient.ts';

export interface StoreIdentity {
  displayName?: string;
  subject: string;
}

export interface StoreAuthInfo {
  identity: StoreIdentity | null;
  providers: string[];
}

export function useStoreAuth(storeUrl: string | null): StoreAuthInfo {
  const [auth, setAuth] = useState<StoreAuthInfo>({ identity: null, providers: [] });

  useEffect(() => {
    if (!storeUrl) {
      setAuth({ identity: null, providers: [] });
      return;
    }
    let cancelled = false;
    const client = createStoreClient({ baseUrl: storeUrl });
    const ask = async () => {
      try {
        const session = await client.session();
        if (cancelled) return;
        if (session) {
          setAuth({
            identity: { displayName: session.displayName, subject: session.subject },
            providers: [],
          });
        } else {
          const provs = await client.providers().catch(() => []);
          if (!cancelled) {
            setAuth({ identity: null, providers: provs });
          }
        }
      } catch {
        if (!cancelled) {
          setAuth({ identity: null, providers: [] });
        }
      }
    };
    void ask();
    // Signing in happens in another tab of the provider and returns here,
    // so looking again when the window regains focus picks it up without
    // a reload.
    const onFocus = () => void ask();
    globalThis.addEventListener?.('focus', onFocus);
    return () => {
      cancelled = true;
      globalThis.removeEventListener?.('focus', onFocus);
    };
  }, [storeUrl]);

  return auth;
}

export function useStoreIdentity(storeUrl: string | null): StoreIdentity | null {
  const { identity } = useStoreAuth(storeUrl);
  return identity;
}
