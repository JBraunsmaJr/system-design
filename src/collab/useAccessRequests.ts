/**
 * People waiting to be let into the workspace (WS7-R8), noticed from the
 * document rather than only from inside File > Documents.
 *
 * A request for access is addressed to whoever can grant it. Leaving it in
 * a dialog nobody has a reason to open means the person asking waits until
 * someone happens to look - so this watches for them from the editor, and
 * the notice carries the grant action with it.
 *
 * Only a browser that holds the workspace key can grant anything, so this
 * attaches to the device this browser already has and never registers
 * one. A browser without the key simply sees no requests.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createStoreClient, type StoreClient } from './storeClient.ts';
import {
  attachExistingDevice,
  createIndexedDbDeviceKeyStorage,
  type DeviceKeyStorage,
  type EnrollmentApi,
} from './deviceIdentity.ts';
import { fromBase64, indexKeyFor, toBase64 } from './workspaceDocuments.ts';
import { importPublicKey, wrapKeyForPublicKey } from '../crypto/keys.ts';
import { createJwksSource, type RejectionReason } from '../crypto/idToken.ts';
import {
  autoGrantEnabledHere,
  createLocalStorageRuleVersionStore,
  createRejectionMemory,
  runAutoGrant,
} from './autoGrant.ts';

const WORKSPACE_ID = 'default';

export interface AccessRequest {
  userId: string;
  displayName: string;
  /** WS14-R39: why this browser did not let them in automatically. */
  rejection?: RejectionReason;
}

/** WS14-R39: someone this browser just let in, and through which group. */
export interface AutoGrantNotice {
  userId: string;
  displayName: string;
  matchedGroup: string;
}

export interface AccessRequestsOptions {
  storeUrl: string | null;
  /** How often to look. Signing in is rare; a request is not urgent to
   * the second, and this should not become a steady load on the store. */
  pollMs?: number;
  client?: StoreClient;
  keyStorage?: DeviceKeyStorage;
}

export function useAccessRequests(options: AccessRequestsOptions) {
  const { storeUrl } = options;
  const pollMs = options.pollMs ?? 15_000;
  const [client] = useState<StoreClient | null>(
    () => options.client ?? (storeUrl ? createStoreClient({ baseUrl: storeUrl }) : null),
  );
  const [storage] = useState<DeviceKeyStorage>(
    () => options.keyStorage ?? createIndexedDbDeviceKeyStorage(),
  );
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [granting, setGranting] = useState<string | null>(null);
  const [autoGranted, setAutoGranted] = useState<AutoGrantNotice[]>([]);
  // WS14: kept for the life of the hook, so the key cache (R21), the rule
  // versions seen (R20) and the quiet period for failures (R27) persist
  // across polls.
  const [keySource] = useState(() => createJwksSource());
  const [ruleVersions] = useState(() => createLocalStorageRuleVersionStore());
  const [memory] = useState(() => createRejectionMemory());
  const rejections = useRef(new Map<string, RejectionReason>());
  const looking = useRef(false);
  /** What granting needs, found while looking. */
  const holding = useRef<{
    workspaceKey: CryptoKey;
    generation: number;
    publicKeys: Map<string, string>;
  } | null>(null);

  const look = useCallback(async () => {
    if (!client || looking.current) return;
    looking.current = true;
    const api: EnrollmentApi = {
      registerDevice: (publicKey, label) => client.registerDevice(publicKey, label),
      keysForDevice: (deviceId) => client.keysForDevice(deviceId),
      publishUserPublicKey: (publicKey) => client.publishUserPublicKey(publicKey),
      putWorkspaceKey: (generation, wrappedKey) => client.putWorkspaceKey(generation, wrappedKey),
      listDevices: () => client.listDevices(),
      approveDevice: (deviceId, code, wrapped, from) =>
        client.approveDevice(deviceId, code, wrapped, from),
      setOwnUserKey: (deviceId, wrapped) => client.setOwnUserKey(deviceId, wrapped),
      workspaceExists: () => client.workspaceExists(WORKSPACE_ID),
    };
    try {
      const device = await attachExistingDevice({ api, storage });
      if (device.status !== 'ready' || !device.workspaceKey) {
        holding.current = null;
        setRequests([]);
        return;
      }
      const index = await client.readIndex(WORKSPACE_ID, await indexKeyFor(device.workspaceKey));
      const generation = index.generation ?? 1;
      const me = await client.me();
      const members = await client.listMembers();
      const waiting = members.filter(
        (member) =>
          member.userId !== me.userId &&
          // Only someone who can actually be granted access: a member who
          // has never published a key has nothing to wrap it to, and a
          // notice with a button that cannot work is worse than none.
          !!member.publicKey &&
          !(member.workspaceKeyGenerations ?? []).includes(generation),
      );
      holding.current = {
        workspaceKey: device.workspaceKey,
        generation,
        publicKeys: new Map(waiting.map((member) => [member.userId, member.publicKey!])),
      };
      const show = (list: typeof waiting) =>
        setRequests(
          list.map((member) => ({
            userId: member.userId,
            displayName: member.displayName ?? 'Someone',
            ...(rejections.current.has(member.userId)
              ? { rejection: rejections.current.get(member.userId) }
              : {}),
          })),
        );
      show(waiting);

      // WS14-R26 to R28: let in, without a click, anyone the workspace's
      // own rule admits. The decision is the verifier's; see autoGrant.ts.
      if (autoGrantEnabledHere()) {
        const outcome = await runAutoGrant({
          client,
          workspaceId: WORKSPACE_ID,
          workspaceKey: device.workspaceKey,
          generation,
          keySource,
          ruleVersions,
          memory,
        });
        for (const rejected of outcome.rejected)
          rejections.current.set(rejected.userId, rejected.reason);
        if (outcome.granted.length > 0) {
          const letIn = new Set(outcome.granted.map((granted) => granted.userId));
          setAutoGranted((current) => [
            ...current,
            ...outcome.granted.map((granted) => ({
              userId: granted.userId,
              displayName: granted.displayName ?? 'Someone',
              matchedGroup: granted.matchedGroup,
            })),
          ]);
          show(waiting.filter((member) => !letIn.has(member.userId)));
        } else if (outcome.rejected.length > 0) {
          show(waiting);
        }
      }
    } catch {
      // Unreachable, or signed out. The notice is a convenience: the same
      // requests are in File > Documents whenever this can see them.
    } finally {
      looking.current = false;
    }
  }, [client, storage, keySource, ruleVersions, memory]);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) return look();
    });
    const timer = setInterval(() => void look(), pollMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [client, look, pollMs]);

  /** Wraps the workspace key to their published public key. */
  const grant = useCallback(
    async (userId: string) => {
      const held = holding.current;
      const publicKey = held?.publicKeys.get(userId);
      if (!client || !held || !publicKey) return;
      setGranting(userId);
      try {
        const wrapped = await wrapKeyForPublicKey(
          held.workspaceKey,
          await importPublicKey(fromBase64(publicKey)),
        );
        await client.grantWorkspaceKey(userId, held.generation, toBase64(wrapped));
        setRequests((current) => current.filter((request) => request.userId !== userId));
      } finally {
        setGranting(null);
      }
    },
    [client],
  );

  const dismissAutoGranted = useCallback((userId: string) => {
    setAutoGranted((current) => current.filter((notice) => notice.userId !== userId));
  }, []);

  return { requests, grant, granting, refresh: look, autoGranted, dismissAutoGranted };
}
