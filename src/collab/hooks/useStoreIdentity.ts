/**
 * Who the store says this person is (WS10-R1), for naming them to others
 * in a session, and what identity providers are available when signed out.
 *
 * Separate from the workspace sync on purpose. Identity does not depend
 * on which document is open, or on whether it is in the workspace at all
 * - someone signed in with nothing shared still belongs on their cursor
 * by name - and asking early means the name is known before any session
 * starts, rather than arriving afterward and having to be republished.
 */
import { useEffect, useState } from 'react';
import { createStoreSessionClient } from '../access/storeSessionClient';

export interface StoreIdentity {
  displayName?: string;
  subject: string;
}

export interface StoreAuthInfo {
  identity: StoreIdentity | null;
  providers: string[];
}

const SIGNED_OUT: StoreAuthInfo = { identity: null, providers: [] };

export function useStoreAuth(storeUrl: string | null): StoreAuthInfo {
  // What was learned, and from which store. Keeping the two together means
  // an answer is only ever shown for the store it came from: with no store,
  // or after pointing at a different one, this reads as signed out until
  // the new store answers - without an effect having to reset anything.
  const [answer, setAnswer] = useState<{ storeUrl: string; auth: StoreAuthInfo } | null>(null);

  useEffect(() => {
    if (!storeUrl) return;
    const setAuth = (auth: StoreAuthInfo) => setAnswer({ storeUrl, auth });
    let canceled = false;
    const client = createStoreSessionClient({ baseUrl: storeUrl });
    const ask = async () => {
      try {
        const session = await client.session();
        if (canceled) return;
        if (session) {
          setAuth({
            identity: { displayName: session.displayName, subject: session.subject },
            providers: [],
          });
        } else {
          const provs = await client.providers().catch(() => []);
          if (!canceled) {
            setAuth({ identity: null, providers: provs });
          }
        }
      } catch {
        if (!canceled) {
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
      canceled = true;
      globalThis.removeEventListener?.('focus', onFocus);
    };
  }, [storeUrl]);

  return answer && answer.storeUrl === storeUrl ? answer.auth : SIGNED_OUT;
}

export function useStoreIdentity(storeUrl: string | null): StoreIdentity | null {
  const { identity } = useStoreAuth(storeUrl);
  return identity;
}
