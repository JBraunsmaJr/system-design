import { useCallback } from 'react';
import { startSignIn } from '../../collab/access/joinFlow.ts';
import { useStoreAuth } from '../../collab/hooks/useStoreIdentity';

/**
 * Who is signed in to the workspace store, if this deployment has one, and
 * how to sign in. Moved unchanged from App.tsx.
 *
 * Performance contract (see src/app/README.md): this hook runs inside App's
 * render, so it adds no component, no render and no commit. Every value it
 * returns is either React state, a ref, or memoised with the same
 * dependencies it had in App.tsx. Callers destructure the result and depend
 * on the individual members - never on the returned object, which is new on
 * every render.
 */
export function useStoreSignIn(storeUrl: string | null) {
  const { identity: storeIdentity, providers: storeProviders } = useStoreAuth(storeUrl);

  const isOidcAvailable = Boolean(
    storeUrl && (storeProviders.includes('oidc') || storeProviders.length > 0),
  );

  const handleLoginOidc = useCallback(() => {
    if (!storeUrl) return;
    const provider = storeProviders.includes('oidc') ? 'oidc' : (storeProviders[0] ?? 'oidc');
    // WS14-R2: commits to a key first where automatic access can use it.
    void startSignIn(storeUrl, provider);
  }, [storeUrl, storeProviders]);

  const signedInName = storeIdentity?.displayName?.trim() || null;

  return { storeIdentity, isOidcAvailable, handleLoginOidc, signedInName };
}
