import { useCallback } from 'react';
import { createStoreSessionClient } from '../../collab/access/storeSessionClient.ts';
import { useStoreAuth } from '../../collab/hooks/useStoreIdentity';

/**
 * Who is signed in to the store, if this editor has one, and how to sign
 * in.
 *
 * Performance contract (see src/app/README.md): this hook runs inside App's
 * render, so it adds no component, no render and no commit. Every value it
 * returns is either React state, a ref, or memoized. Callers destructure
 * the result and depend on the individual members - never on the returned
 * object, which is new on every render.
 */
export function useStoreSignIn(storeUrl: string | null) {
  const { identity: storeIdentity, providers: storeProviders } = useStoreAuth(storeUrl);

  const isOidcAvailable = Boolean(storeUrl && storeProviders.length > 0);

  const handleLoginOidc = useCallback(() => {
    if (!storeUrl) return;
    const provider = storeProviders.includes('oidc') ? 'oidc' : (storeProviders[0] ?? 'oidc');
    // Back to this page, document and all: a store can serve more than one
    // editor, and only this one knows where it was.
    globalThis.location.assign(
      createStoreSessionClient({ baseUrl: storeUrl }).signInUrl(provider, globalThis.location.href),
    );
  }, [storeUrl, storeProviders]);

  const signedInName = storeIdentity?.displayName?.trim() || null;

  return { storeIdentity, isOidcAvailable, handleLoginOidc, signedInName };
}
