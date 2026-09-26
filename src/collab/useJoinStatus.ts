/**
 * What a newcomer waiting for the workspace is told (WS14-R38).
 *
 * Exactly one state at a time, each with its next step:
 *
 *   waiting       a request is open; a teammate's editor will let them in
 *   expired       the sign-in is too old to check; sign in again
 *   not-covered   no rule admits their groups; someone gives access by hand
 *   overage       the provider sent too many groups to check
 *   needs-oidc    they signed in some other way (GitHub); automatic access
 *                 needs the organization's sign-in
 *   can-retry     automatic access is on here, but this sign-in made no
 *                 commitment; signing in again from the editor can fix that
 *   manual        automatic access is not available; the manual flow
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RejectionReason } from '../crypto/idToken.ts';
import {
  defaultPendingJoinStorage,
  startSignIn,
  submitJoinRequest,
  type PendingJoinStorage,
} from './joinFlow.ts';
import type { StoreClient } from './storeClient.ts';
import { fromBase64 } from './workspaceDocuments.ts';

export type JoinView =
  'waiting' | 'expired' | 'not-covered' | 'overage' | 'needs-oidc' | 'can-retry' | 'manual';

export interface JoinStatus {
  view: JoinView;
  /** The last reason a member's browser gave, if one did. */
  lastRejection: RejectionReason | null;
  /** Signs in again, committing to the key already published. */
  signInAgain: () => Promise<void>;
}

export function useJoinStatus(options: {
  client: StoreClient;
  storeUrl: string;
  /** True while the person is waiting for access. */
  active: boolean;
  storage?: PendingJoinStorage;
}): JoinStatus {
  const { client, storeUrl, active } = options;
  const [storage] = useState(() => options.storage ?? defaultPendingJoinStorage());
  const [view, setView] = useState<JoinView>('manual');
  const [lastRejection, setLastRejection] = useState<RejectionReason | null>(null);
  const submitted = useRef(false);
  const oidcProvider = useRef<string | null>(null);

  const check = useCallback(async () => {
    const { providers, autoAccess } = await client.providerDetails();
    const oidc = providers.find((provider) => provider.kind === 'oidc');
    oidcProvider.current = oidc?.id ?? null;
    if (!autoAccess || !oidc) {
      setView('manual');
      return;
    }
    const session = await client.session();
    if (session && oidc.issuer && session.issuer !== oidc.issuer) {
      setView('needs-oidc');
      return;
    }
    if (session?.groupsOverage) {
      setView('overage');
      return;
    }

    if (!submitted.current) {
      const submission = await submitJoinRequest(client, storage);
      if (submission.status === 'sent') {
        submitted.current = true;
        if (submission.reason === 'no-matching-rule') return setView('not-covered');
        if (submission.reason === 'groups-overage') return setView('overage');
        if (submission.requests.some((request) => request.status === 'evidence-expired'))
          return setView('expired');
        return setView(submission.requests.length > 0 ? 'waiting' : 'manual');
      }
      if (submission.status === 'unsupported') return setView('manual');
      // Nothing sent (no evidence, nothing prepared here, or another key
      // published first). A request may still be open from an earlier
      // visit; if not, a fresh sign-in committing to the published key is
      // what lets them in automatically.
      if ((await client.myJoinRequests()).length === 0) return setView('can-retry');
      submitted.current = true;
    }

    const own = await client.myJoinRequests();
    const latest = own[0];
    if (!latest) return setView('not-covered');
    setLastRejection((latest.lastRejection as RejectionReason | null) ?? null);
    if (latest.status === 'open') return setView('waiting');
    if (latest.status === 'evidence-expired' || latest.status === 'expired')
      return setView('expired');
    setView('manual');
  }, [client, storage]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const run = () => {
      if (!cancelled) void check().catch(() => setView('manual'));
    };
    run();
    // The panel already refreshes every few seconds while waiting; this
    // follows at a gentler pace, since the store only changes when a
    // member's browser acts.
    const timer = setInterval(run, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active, check]);

  const signInAgain = useCallback(async () => {
    const provider = oidcProvider.current;
    if (!provider) return;
    const me = await client.me().catch(() => null);
    submitted.current = false;
    await startSignIn(storeUrl, provider, {
      storage,
      ...(me?.publicKey ? { publishedPublicKey: fromBase64(me.publicKey) } : {}),
    });
  }, [client, storeUrl, storage]);

  return { view, lastRejection, signInAgain };
}
