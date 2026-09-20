/**
 * The workspace, as a person sees it (WS9-R4, WS6-R3, WS7-R11).
 *
 * Only appears where a store is configured. Everything it needs is already
 * built and tested: the client, device enrollment, and the sealed index.
 * This is the part that decides what to show while each of those is in
 * progress, which is most of the work:
 *
 *   no store        nothing at all - the editor is unchanged
 *   signed out      the providers this store accepts
 *   awaiting        this browser's verification code, and what to do with it
 *   ready           the workspace's documents
 *
 * A document saved here is sealed in this browser. The store never sees a
 * title, a diagram, or a key - except in passthrough mode, which says so.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CloudOff,
  Cloud,
  Loader2,
  ShieldAlert,
  Upload,
  FolderOpen,
  Trash2,
  Check,
  KeyRound,
  Laptop,
  Users,
} from 'lucide-react';
import {
  createStoreClient,
  StoreClientError,
  type IndexEntry,
  type SessionInfo,
  type StoreClient,
} from '../collab/storeClient';
import {
  approveOtherDevice,
  bootstrapFirstDevice,
  createIndexedDbDeviceKeyStorage,
  enrollDevice,
  type DeviceKeyStorage,
  type DeviceState,
  type EnrollmentApi,
} from '../collab/deviceIdentity';
import {
  documentKeyFor,
  escrowDocumentKey,
  fromBase64,
  toBase64,
  indexKeyFor,
  newDocumentKey,
  removeEntry,
  upsertEntry,
} from '../collab/workspaceDocuments';
import { rotateWorkspaceKey } from '../collab/workspaceRotation';
import { importPublicKey, wrapKeyForPublicKey } from '../crypto/keys';
import { announceWorkspaceChange } from '../collab/useWorkspaceSync';
import { unwrapPrivateKeyWithPrivateKey } from '../crypto/keys';

const WORKSPACE_ID = 'default';

export interface WorkspacePanelProps {
  storeUrl: string;
  /** The document on screen, for "Save to workspace". */
  currentDocId: string;
  currentTitle: string;
  /** Its CRDT state, which is what a workspace document holds (WS8-R2). */
  getDocumentState: () => Uint8Array;
  /** Opens a workspace document: the editor opens that document and its
   * contents arrive from the store, merging with anything already here. */
  onOpenDocument: (docId: string) => void;
  /** Test seam; the browser uses IndexedDB. */
  keyStorage?: DeviceKeyStorage;
  client?: StoreClient;
}

type Phase =
  | 'checking'
  | 'offline'
  | 'signed-out'
  | 'enrolling'
  | 'awaiting-approval'
  /** Signed in, with keys of their own, but not yet given the workspace
   * key by anyone who has it (WS7-R8). */
  | 'awaiting-access'
  | 'ready'
  | 'error';

/** Someone else in this workspace, and whether they can read it yet. */
interface Member {
  userId: string;
  displayName?: string;
  publicKey?: string;
  hasAccess: boolean;
}

interface PendingDevice {
  deviceId: string;
  publicKey: string;
  verificationCode: string;
  label?: string;
}

export function WorkspacePanel(props: WorkspacePanelProps) {
  const [client] = useState<StoreClient>(
    () => props.client ?? createStoreClient({ baseUrl: props.storeUrl }),
  );
  const [storage] = useState<DeviceKeyStorage>(
    () => props.keyStorage ?? createIndexedDbDeviceKeyStorage(),
  );
  const [phase, setPhase] = useState<Phase>('checking');
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [providers, setProviders] = useState<string[]>([]);
  const [serverReadsContent, setServerReadsContent] = useState(false);
  const [device, setDevice] = useState<DeviceState | null>(null);
  const [pending, setPending] = useState<PendingDevice[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  /** Whether this person may grant access: discovered by asking, since
   * only an administrator may list members (WS10-R2). */
  const [canGrant, setCanGrant] = useState(false);
  const [devices, setDevices] = useState<
    { deviceId: string; label?: string; approvedAt: string | null; revokedAt: string | null }[]
  >([]);
  const [generation, setGeneration] = useState(1);
  /** Set after revoking: a revoked device keeps the workspace key it
   * already unwrapped, and only rotation makes that key worthless. */
  const [rotationAdvised, setRotationAdvised] = useState(false);
  const [entries, setEntries] = useState<IndexEntry[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const workspaceKey = useRef<CryptoKey | null>(null);

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

  const say = (error: unknown): string => {
    if (error instanceof StoreClientError) {
      if (error.reason === 'offline')
        return 'The workspace is unreachable. Your work is saved in this browser.';
      if (error.reason === 'rolled-back')
        return 'The workspace offered an older version than this browser has seen. Nothing was applied.';
      return error.message;
    }
    return String(error);
  };

  const loadEntries = useCallback(
    async (key: CryptoKey) => {
      const listed = await client.readIndex(WORKSPACE_ID, await indexKeyFor(key));
      setEntries(listed.entries);
      if (listed.generation) setGeneration(listed.generation);
    },
    [client],
  );

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const health = await client.health();
      setServerReadsContent(health.cryptoMode === 'passthrough');
      const who = await client.session();
      setSession(who);
      if (!who) {
        setProviders(await client.providers());
        setPhase('signed-out');
        return;
      }
      const state = await enrollDevice({ api, storage });
      setDevice(state);
      if (state.status === 'ready' && state.workspaceKey) {
        workspaceKey.current = state.workspaceKey;
        setPhase('ready');
        await loadEntries(state.workspaceKey);
        // Devices of this person still waiting for approval (WS7-R11).
        const listed = await client.listDevices();
        setDevices(
          listed.map((d) => ({
            deviceId: d.deviceId,
            label: d.label,
            approvedAt: d.approvedAt,
            revokedAt: d.revokedAt,
          })),
        );
        // Who else is in this workspace, and whether they can read it.
        // Only an administrator may ask, so a refusal is not an error -
        // it just means this person cannot hand out access (WS10-R2).
        try {
          const listedMembers = await client.listMembers();
          const me = await client.me();
          setMembers(
            listedMembers
              .filter((member) => member.userId !== me.userId)
              .map((member) => ({
                userId: member.userId,
                displayName: member.displayName,
                publicKey: member.publicKey,
                hasAccess: (member.workspaceKeyGenerations ?? []).includes(generation),
              })),
          );
          setCanGrant(true);
        } catch {
          setMembers([]);
          setCanGrant(false);
        }
        setPending(
          listed
            .filter((d) => !d.approvedAt && !d.revokedAt)
            .map((d) => ({
              deviceId: d.deviceId,
              publicKey: d.publicKey,
              verificationCode: d.verificationCode,
              label: d.label,
            })),
        );
      } else if (state.status === 'awaiting-approval') {
        setPhase('awaiting-approval');
      } else if (state.status === 'awaiting-access') {
        setPhase('awaiting-access');
        setMessage(state.message ?? null);
      } else if (state.status === 'needs-setup') {
        // The person's first browser: it makes the keys.
        setPhase('enrolling');
      } else {
        setPhase('error');
        setMessage(state.message ?? null);
      }
      setMessage(null);
    } catch (error) {
      setPhase(
        error instanceof StoreClientError && error.reason === 'offline' ? 'offline' : 'error',
      );
      setMessage(say(error));
    } finally {
      setBusy(false);
    }
    // api and storage are stable for the life of the panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, loadEntries, storage]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) return refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  /** Clears a stale error on success, unless the action reported
   * something of its own - rotation's summary, for instance. */
  const run = async (work: () => Promise<void>, options: { keepMessage?: boolean } = {}) => {
    setBusy(true);
    try {
      await work();
      if (!options.keepMessage) setMessage(null);
    } catch (error) {
      setMessage(say(error));
    } finally {
      setBusy(false);
    }
  };

  const setUpKeys = () =>
    run(async () => {
      const state = await bootstrapFirstDevice({
        api,
        storage,
        label: navigator.userAgent.slice(0, 60),
      });
      setDevice(state);
      if (state.status === 'ready' && state.workspaceKey) {
        workspaceKey.current = state.workspaceKey;
        setPhase('ready');
        await loadEntries(state.workspaceKey);
      } else {
        setPhase(state.status === 'awaiting-approval' ? 'awaiting-approval' : 'error');
        setMessage(state.message ?? null);
      }
    });

  const saveHere = () =>
    run(async () => {
      const key = workspaceKey.current;
      if (!key) throw new Error('This browser cannot write to the workspace yet.');
      const existing = entries.find((entry) => entry.docId === props.currentDocId);
      const keys = existing
        ? {
            documentKey: await documentKeyFor(existing, key),
            wrappedDocKey: existing.wrappedDocKey,
          }
        : await newDocumentKey(key);
      if (!existing) {
        // Registered, then seeded with the document's CRDT state as its
        // first update. From here the editor keeps it up to date, and two
        // people editing it merge rather than overwrite (WS8-R2).
        const recoveryPem = await client.recoveryPublicKey();
        const version = await client.createDocument(props.currentDocId, {
          wrappedForWorkspace: keys.wrappedDocKey,
          ...(recoveryPem
            ? { wrappedForRecovery: await escrowDocumentKey(keys.documentKey, recoveryPem) }
            : {}),
        });
        await client.appendUpdate(
          props.currentDocId,
          keys.documentKey,
          props.getDocumentState(),
          version,
        );
      }
      const indexKey = await indexKeyFor(key);
      const next = await client.updateIndex(WORKSPACE_ID, indexKey, (current) =>
        upsertEntry(current, {
          docId: props.currentDocId,
          wrappedDocKey: keys.wrappedDocKey,
          title: props.currentTitle,
          updatedAt: new Date().toISOString(),
        }),
      );
      setEntries(next);
      // From here the document keeps itself up to date: the editor picks
      // this up without a reload (WS8-R2).
      announceWorkspaceChange();
    });

  const openEntry = (entry: IndexEntry) =>
    run(async () => {
      // Opening means opening that document, not copying its contents into
      // this one: its updates arrive from the store and merge with
      // whatever this browser already had of it.
      props.onOpenDocument(entry.docId);
    });

  const removeEntryFromWorkspace = (entry: IndexEntry) =>
    run(async () => {
      const key = workspaceKey.current;
      if (!key) return;
      await client.deleteDocument(entry.docId);
      const next = await client.updateIndex(WORKSPACE_ID, await indexKeyFor(key), (current) =>
        removeEntry(current, entry.docId),
      );
      setEntries(next);
      announceWorkspaceChange();
    });

  const revoke = (deviceId: string) =>
    run(async () => {
      await client.revokeDevice(deviceId);
      setDevices((current) =>
        current.map((d) =>
          d.deviceId === deviceId ? { ...d, revokedAt: new Date().toISOString() } : d,
        ),
      );
      setPending((current) => current.filter((d) => d.deviceId !== deviceId));
      // Revoking stops the store serving that browser, but it still holds
      // the workspace key it unwrapped. Only rotation ends that.
      setRotationAdvised(true);
    });

  const rotate = () =>
    run(
      async () => {
        const key = workspaceKey.current;
        if (!key) throw new Error('This browser cannot rotate the workspace key yet.');
        const result = await rotateWorkspaceKey({
          client,
          workspaceId: WORKSPACE_ID,
          currentKey: key,
          currentGeneration: generation,
        });
        workspaceKey.current = result.workspaceKey;
        setGeneration(result.generation);
        setRotationAdvised(false);
        await loadEntries(result.workspaceKey);
        const others = result.selfOnly
          ? ' Only your own key was replaced: ask an administrator to give the new one to everyone else.'
          : '';
        const skipped = result.membersSkipped.length
          ? ` ${result.membersSkipped.length} member(s) have not signed in since publishing a key and will get the new one when they do: ${result.membersSkipped.join(', ')}.`
          : '';
        setMessage(
          `Rotated to key ${result.generation}: ${result.documentsRewrapped} document(s) re-wrapped, ${result.membersGranted} member(s) given the new key. No document content was re-encrypted.${others}${skipped}`,
        );
      },
      { keepMessage: true },
    );

  /**
   * Hands the workspace key to another member, wrapped to their public
   * user key (WS7-R8). Their browser picks it up the next time it looks:
   * nothing secret passes through this one except in wrapped form, and
   * the store never sees the key itself.
   */
  const grantAccess = (member: Member) =>
    run(async () => {
      const key = workspaceKey.current;
      if (!key) throw new Error('This browser does not hold the workspace key.');
      if (!member.publicKey) {
        throw new Error(
          `${member.displayName ?? 'That member'} has not signed in with a browser yet, so there is no key to wrap this to.`,
        );
      }
      const wrapped = await wrapKeyForPublicKey(
        key,
        await importPublicKey(fromBase64(member.publicKey)),
      );
      await client.grantWorkspaceKey(member.userId, generation, toBase64(wrapped));
      setMembers((current) =>
        current.map((candidate) =>
          candidate.userId === member.userId ? { ...candidate, hasAccess: true } : candidate,
        ),
      );
    });

  const approve = (target: PendingDevice) =>
    run(async () => {
      const held = await storage.load();
      const key = workspaceKey.current;
      if (!held || !key) throw new Error('This browser cannot approve another yet.');
      const keys = await client.keysForDevice(held.deviceId);
      if (keys.status !== 'approved') throw new Error('This browser is not approved itself.');
      const userKey = await unwrapPrivateKeyWithPrivateKey(
        {
          keyWrap: Uint8Array.from(atob(keys.wrappedUserKey.keyWrap), (c) => c.charCodeAt(0)),
          body: Uint8Array.from(atob(keys.wrappedUserKey.body), (c) => c.charCodeAt(0)),
        },
        held.keyPair.privateKey,
        { docId: 'user-key', kind: 'key-wrap', version: 1 },
      );
      await approveOtherDevice({ api, storage, thisDeviceId: held.deviceId, userKey }, target);
      // Re-read rather than patch the list: the approved browser now counts
      // among those with access, and appears in the list below.
      const listed = await client.listDevices();
      setDevices(
        listed.map((d) => ({
          deviceId: d.deviceId,
          label: d.label,
          approvedAt: d.approvedAt,
          revokedAt: d.revokedAt,
        })),
      );
      setPending(
        listed
          .filter((d) => !d.approvedAt && !d.revokedAt)
          .map((d) => ({
            deviceId: d.deviceId,
            publicKey: d.publicKey,
            verificationCode: d.verificationCode,
            label: d.label,
          })),
      );
    });

  return (
    <div
      className="workspace-panel"
      data-phase={phase}
      style={{
        padding: '10px 18px',
        borderBottom: '1px solid var(--border, #2d3342)',
        display: 'grid',
        gap: 8,
        fontSize: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {phase === 'offline' ? <CloudOff size={14} /> : <Cloud size={14} />}
        <strong>Workspace</strong>
        {busy && <Loader2 size={12} className="workspace-panel__busy" />}
        {session && (
          <span className="workspace-panel__who" style={{ color: 'var(--text-muted, #9aa3b2)' }}>
            {session.displayName ?? session.subject}
          </span>
        )}
      </div>

      {serverReadsContent && (
        // WS6-R3: not dismissible, and stated plainly.
        <p
          className="workspace-panel__passthrough"
          role="alert"
          style={{
            margin: 0,
            color: 'var(--warning, #e0a84a)',
            display: 'flex',
            gap: 6,
            alignItems: 'center',
          }}
        >
          <ShieldAlert size={14} /> This workspace stores documents unencrypted: the server can read
          their contents.
        </p>
      )}

      {phase === 'offline' && (
        <p className="workspace-panel__status" style={{ margin: 0 }}>
          The workspace is unreachable. Your work is saved in this browser.
        </p>
      )}

      {phase === 'signed-out' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>Sign in to use the workspace:</span>
          {providers.map((provider) => (
            <button
              key={provider}
              type="button"
              className="workspace-panel__sign-in"
              onClick={() =>
                globalThis.location.assign(
                  `${props.storeUrl}/v1/auth/${encodeURIComponent(provider)}/start`,
                )
              }
            >
              {provider}
            </button>
          ))}
        </div>
      )}

      {phase === 'enrolling' && (
        <div style={{ display: 'grid', gap: 6 }}>
          <p style={{ margin: 0 }}>This browser has no workspace keys yet.</p>
          <button
            type="button"
            className="workspace-panel__bootstrap"
            onClick={() => void setUpKeys()}
            disabled={busy}
          >
            Set up this browser
          </button>
        </div>
      )}

      {phase === 'awaiting-approval' && (
        <div style={{ display: 'grid', gap: 6 }}>
          <p style={{ margin: 0 }}>
            Waiting for approval. On a browser you already use, open File &gt; Documents and approve
            this one, checking the code matches.
          </p>
          <code className="workspace-panel__code" style={{ fontSize: 16, letterSpacing: 1 }}>
            {device?.verificationCode}
          </code>
          <button
            type="button"
            className="workspace-panel__recheck"
            onClick={() => void refresh()}
            disabled={busy}
          >
            Check again
          </button>
        </div>
      )}

      {phase === 'ready' && (
        <div style={{ display: 'grid', gap: 8 }}>
          {pending.length > 0 && (
            <div className="workspace-panel__pending" style={{ display: 'grid', gap: 4 }}>
              <strong>Waiting to be approved</strong>
              {pending.map((target) => (
                <div
                  key={target.deviceId}
                  style={{ display: 'flex', gap: 8, alignItems: 'center' }}
                >
                  <code>{target.verificationCode}</code>
                  <span style={{ color: 'var(--text-muted, #9aa3b2)' }}>
                    {target.label ?? 'another browser'}
                  </span>
                  <button
                    type="button"
                    className="workspace-panel__approve"
                    onClick={() => void approve(target)}
                    disabled={busy}
                  >
                    <Check size={12} /> Codes match, approve
                  </button>
                </div>
              ))}
            </div>
          )}

          {canGrant && members.length > 0 && (
            <div className="workspace-panel__members" style={{ display: 'grid', gap: 4 }}>
              <strong>People in this workspace</strong>
              {members.map((member) => (
                <div
                  key={member.userId}
                  className="workspace-panel__member"
                  data-user-id={member.userId}
                  data-has-access={member.hasAccess}
                  style={{ display: 'flex', gap: 8, alignItems: 'center' }}
                >
                  <Users size={12} />
                  <span style={{ flex: 1 }}>{member.displayName ?? member.userId}</span>
                  {member.hasAccess ? (
                    <span style={{ color: 'var(--text-muted, #9aa3b2)' }}>has access</span>
                  ) : (
                    <button
                      type="button"
                      className="workspace-panel__grant"
                      onClick={() => void grantAccess(member)}
                      disabled={busy || !member.publicKey}
                      title={
                        member.publicKey
                          ? 'Wrap the workspace key to this person, so they can read its documents'
                          : 'They have to sign in once before anything can be wrapped to them'
                      }
                    >
                      Give access
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="workspace-panel__save"
              onClick={() => void saveHere()}
              disabled={busy}
            >
              <Upload size={12} /> Save this document to the workspace
            </button>
            <button
              type="button"
              className="workspace-panel__rotate"
              onClick={() => {
                if (
                  window.confirm(
                    'Replace the workspace key?\n\nEvery document is re-wrapped under a new key; their contents are not re-encrypted and nothing is lost. Anyone holding the old key - including a device you have revoked - can no longer open anything saved afterwards.\n\nMembers who have not signed in recently will get the new key when they next do.',
                  )
                ) {
                  void rotate();
                }
              }}
              disabled={busy}
              title="Replace the workspace key, for example after losing a device"
            >
              <KeyRound size={12} /> Rotate key
            </button>
            <span
              className="workspace-panel__generation"
              style={{ color: 'var(--text-muted, #9aa3b2)' }}
            >
              key {generation}
            </span>
          </div>

          {rotationAdvised && (
            <p
              className="workspace-panel__rotation-advice"
              role="alert"
              style={{ margin: 0, color: 'var(--warning, #e0a84a)' }}
            >
              That browser can no longer reach the workspace, but it still holds the key it already
              had. Rotate the key so it cannot open anything saved from now on.
            </p>
          )}

          {devices.length > 1 && (
            <div className="workspace-panel__devices" style={{ display: 'grid', gap: 4 }}>
              <strong>Browsers with access</strong>
              {devices
                .filter((device) => device.approvedAt && !device.revokedAt)
                .map((device) => (
                  <div
                    key={device.deviceId}
                    className="workspace-panel__device"
                    data-device-id={device.deviceId}
                    style={{ display: 'flex', gap: 8, alignItems: 'center' }}
                  >
                    <Laptop size={12} />
                    <span style={{ flex: 1 }}>{device.label ?? device.deviceId}</span>
                    <button
                      type="button"
                      className="workspace-panel__revoke"
                      onClick={() => void revoke(device.deviceId)}
                      disabled={busy}
                    >
                      Revoke
                    </button>
                  </div>
                ))}
            </div>
          )}

          {entries.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--text-muted, #9aa3b2)' }}>
              No documents in the workspace yet.
            </p>
          ) : (
            <ul
              className="workspace-panel__list"
              style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}
            >
              {entries.map((entry) => (
                <li
                  key={entry.docId}
                  className="workspace-panel__entry"
                  data-doc-id={entry.docId}
                  style={{ display: 'flex', gap: 8, alignItems: 'center' }}
                >
                  <span className="workspace-panel__title" style={{ flex: 1 }}>
                    {entry.title}
                  </span>
                  <button
                    type="button"
                    className="workspace-panel__open"
                    onClick={() => void openEntry(entry)}
                    disabled={busy}
                  >
                    <FolderOpen size={12} /> Open
                  </button>
                  <button
                    type="button"
                    className="workspace-panel__remove"
                    onClick={() => void removeEntryFromWorkspace(entry)}
                    disabled={busy}
                  >
                    <Trash2 size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {message && (
        <p
          className="workspace-panel__message"
          role="alert"
          style={{ margin: 0, color: 'var(--danger, #e06c75)' }}
        >
          {message}
        </p>
      )}
    </div>
  );
}
