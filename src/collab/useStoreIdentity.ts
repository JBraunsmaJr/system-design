/**
 * Who the store says this person is (WS10-R1), for naming them to others
 * in a session.
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

export function useStoreIdentity(storeUrl: string | null): StoreIdentity | null {
  const [identity, setIdentity] = useState<StoreIdentity | null>(null);

  useEffect(() => {
    if (!storeUrl) return;
    let cancelled = false;
    const client = createStoreClient({ baseUrl: storeUrl });
    const ask = () =>
      client.session().then(
        (session) => {
          if (!cancelled)
            setIdentity(
              session ? { displayName: session.displayName, subject: session.subject } : null,
            );
        },
        () => {
          // Unreachable: the name falls back to whatever the person chose,
          // or the generated one. Nothing here is worth an error.
        },
      );
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

  return identity;
}
