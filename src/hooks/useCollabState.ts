import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import * as Y from 'yjs';
import type { CollabSession, PresenceInfo, LocalPresenceInfo } from '../collab/sync/session';
import { startCollabSession } from '../collab/sync/session';
import {
  loadPresenceName,
  savePresenceName,
  loadShowPeerCursors,
  saveShowPeerCursors,
} from '../domain/network/presenceIdentity';
import {
  loadSignalingUrls,
  saveSignalingUrls,
  parseSignalingUrls,
  getDefaultSignalingUrl,
} from '../domain/network/signalingConfig';
import {
  loadIceServers,
  saveIceServers,
  parseIceServers,
  getDefaultIceServers,
} from '../domain/network/iceServerConfig';
import { parseSessionLink, generateSessionKey } from '../domain/network/sessionLink';
import { useStoreAuth } from '../collab/hooks/useStoreIdentity';
import { startSignIn } from '../collab/access/joinFlow';
import { useAccessRequests } from '../collab/hooks/useAccessRequests';
import {
  createDocumentStores,
  destroyDocumentStores,
  type OpenDocumentStores,
} from '../collab/sync/localDocument';
import type { DocPersistence } from '../collab/sync/persistence';
import { releaseUndoController } from '../collab/stores/undoManager';

export interface ActiveCollabSession {
  doc: Y.Doc;
  session: CollabSession;
  roomName: string;
  password?: string;
  relayUrl?: string;
  stores: OpenDocumentStores;
  ownsDocument: boolean;
  autoJoined?: boolean;
}

export interface UseCollabStateOptions {
  storeUrl: string | null;
  openDocId?: string;
  openDocStores: OpenDocumentStores;
  openDocInstance: { doc: Y.Doc; persistence?: DocPersistence };
  onSessionEnded?: () => void;
}

export function useCollabState({
  storeUrl,
  openDocStores,
  openDocInstance,
  onSessionEnded,
}: UseCollabStateOptions) {
  const [signalingUrlsInput, setSignalingUrlsInput] = useState<string>(
    () => loadSignalingUrls() ?? '',
  );
  const [iceServersInput, setIceServersInput] = useState<string>(() => loadIceServers() ?? '');

  const buildTimeSignalingDefault = getDefaultSignalingUrl();
  const buildTimeIceServersDefault = getDefaultIceServers();

  const updateSignalingUrls = useCallback((raw: string) => {
    saveSignalingUrls(raw);
    setSignalingUrlsInput(raw);
  }, []);

  const updateIceServers = useCallback((raw: string) => {
    saveIceServers(raw);
    setIceServersInput(raw);
  }, []);

  const signalingConfigured = Boolean(signalingUrlsInput || buildTimeSignalingDefault);

  const [activeSession, setActiveSession] = useState<ActiveCollabSession | null>(() => {
    if (typeof window === 'undefined') return null;
    const raw = window.location.hash || window.location.href;
    if (!raw.includes('session=') && !raw.includes('room=')) return null;
    const parsed = parseSessionLink(raw);
    if (!parsed.roomName) return null;

    const cleanUrl = window.location.pathname + window.location.search;
    window.history.replaceState(null, '', cleanUrl);

    const doc = new Y.Doc();
    const rawUrls = parsed.relay || loadSignalingUrls() || getDefaultSignalingUrl();
    const relayUrls = parseSignalingUrls(rawUrls);
    const rawIce = loadIceServers() || getDefaultIceServers();
    const parsedIce = parseIceServers(rawIce);

    const session = startCollabSession(doc, parsed.roomName, {
      password: parsed.key || parsed.password,
      signalingUrls: relayUrls,
      iceServers: parsedIce,
      persist: true,
    });
    const stores = createDocumentStores(doc);
    return {
      doc,
      session,
      roomName: parsed.roomName,
      password: parsed.key || parsed.password,
      relayUrl: parsed.relay || rawUrls,
      stores,
      ownsDocument: true,
      autoJoined: true,
    };
  });

  const [displayName, setDisplayName] = useState(
    () => loadPresenceName() ?? `Guest-${Math.random().toString(36).slice(2, 6)}`,
  );
  const [showPeerCursors, setShowPeerCursorsState] = useState(() => loadShowPeerCursors());
  const setShowPeerCursors = useCallback((show: boolean) => {
    setShowPeerCursorsState(show);
    saveShowPeerCursors(show);
  }, []);

  const [nameChosen, setNameChosen] = useState(() => loadPresenceName() !== null);
  const onDisplayNameChange = useCallback((name: string) => {
    setDisplayName(name);
    setNameChosen(true);
    savePresenceName(name);
  }, []);

  const { identity: storeIdentity, providers: storeProviders } = useStoreAuth(storeUrl);

  const isOidcAvailable = Boolean(
    storeUrl && (storeProviders?.includes('oidc') || (storeProviders?.length ?? 0) > 0),
  );

  const handleLoginOidc = useCallback(() => {
    if (!storeUrl) return;
    const provider = storeProviders?.includes('oidc') ? 'oidc' : (storeProviders?.[0] ?? 'oidc');
    void startSignIn(storeUrl, provider);
  }, [storeUrl, storeProviders]);

  const accessRequests = useAccessRequests({ storeUrl });
  const signedInName = storeIdentity?.displayName?.trim() || null;
  const presenceName = signedInName || displayName;

  const [presencePeers, setPresencePeers] = useState<PresenceInfo[]>([]);
  const [sessionPersistence, setSessionPersistence] = useState<{
    session: object | null;
    state: 'active' | 'loading' | 'unavailable';
  }>({ session: null, state: 'loading' });
  const [relayConnected, setRelayConnected] = useState<boolean | null>(null);

  const isSynced = useSyncExternalStore(
    (onStoreChange) => {
      if (!activeSession) return () => {};
      const sessionAny = activeSession.session as unknown as {
        provider?: {
          on: (event: string, handler: () => void) => void;
          off: (event: string, handler: () => void) => void;
        };
      };
      const provider = sessionAny.provider;
      if (!provider) return () => {};
      provider.on('synced', onStoreChange);
      provider.on('sync', onStoreChange);
      return () => {
        provider.off('synced', onStoreChange);
        provider.off('sync', onStoreChange);
      };
    },
    () => (activeSession ? activeSession.session.isSynced() : false),
  );

  useEffect(() => {
    if (!activeSession) return;
    let cancelled = false;
    const { persistence } = activeSession.session;
    const owner = activeSession.session;
    void persistence.whenSynced.then(() => {
      if (cancelled) return;
      setSessionPersistence({ session: owner, state: 'active' });
    });
    return () => {
      cancelled = true;
    };
  }, [activeSession]);

  useEffect(() => {
    if (!activeSession) return;
    const unsubscribePresence = activeSession.session.subscribeToPresence(setPresencePeers);
    const unsubscribeRelay = activeSession.session.subscribeToRelayStatus(setRelayConnected);
    return () => {
      unsubscribePresence();
      unsubscribeRelay();
    };
  }, [activeSession]);

  const localPresenceRef = useRef<LocalPresenceInfo>({
    name: '',
    color: '',
    cursor: null,
    selectedNodeIds: [],
    selectedEdgeIds: [],
    viewMode: null,
    focusedItemId: null,
    diagramPath: '',
  });

  const activeSessionRef = useRef(activeSession);
  useLayoutEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  const broadcastPresence = useCallback((patch: Partial<PresenceInfo>) => {
    const session = activeSessionRef.current?.session;
    if (!session) return;
    localPresenceRef.current = { ...localPresenceRef.current, ...patch };
    session.setLocalPresence(localPresenceRef.current);
  }, []);

  useEffect(() => {
    if (!activeSession) return;
    broadcastPresence({ name: presenceName.trim() || 'Guest' });
  }, [activeSession, presenceName, broadcastPresence]);

  useEffect(() => {
    if (!activeSession) return;
    const confirmed =
      sessionPersistence.session === activeSession.session && sessionPersistence.state === 'active';
    if (confirmed) broadcastPresence({ hasPersistedReplica: true });
  }, [activeSession, sessionPersistence, broadcastPresence]);

  const pendingCursorRef = useRef<{ x: number; y: number } | null>(null);
  const hasPendingCursorRef = useRef(false);
  const cursorFlushHandle = useRef<number | null>(null);
  const flushCursor = useCallback(() => {
    cursorFlushHandle.current = null;
    if (!hasPendingCursorRef.current) return;
    hasPendingCursorRef.current = false;
    broadcastPresence({ cursor: pendingCursorRef.current });
  }, [broadcastPresence]);

  const onCursorMove = useCallback(
    (position: { x: number; y: number } | null) => {
      pendingCursorRef.current = position;
      hasPendingCursorRef.current = true;
      if (cursorFlushHandle.current === null) {
        cursorFlushHandle.current = requestAnimationFrame(flushCursor);
      }
    },
    [flushCursor],
  );

  const leaveSession = useCallback(() => {
    if (!activeSession) return;
    const closing = activeSession;
    setActiveSession(null);
    setSessionPersistence({ session: null, state: 'loading' });
    setRelayConnected(null);
    closing.session.disconnect();
    if (closing.ownsDocument) {
      releaseUndoController(closing.doc);
      destroyDocumentStores(closing.stores);
      closing.doc.destroy();
    }
    onSessionEnded?.();
  }, [activeSession, onSessionEnded]);

  const handleStartSession = useCallback(
    (customKey?: string, overrideRoomName?: string, overrideRelayUrl?: string) => {
      if (activeSession) leaveSession();
      const roomName =
        overrideRoomName ||
        `room-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const sessionKey = customKey || generateSessionKey();
      if (overrideRelayUrl) {
        setSignalingUrlsInput(overrideRelayUrl);
        saveSignalingUrls(overrideRelayUrl);
      }
      const rawUrls = overrideRelayUrl || signalingUrlsInput || buildTimeSignalingDefault;
      const relayUrls = parseSignalingUrls(rawUrls);
      const rawIce = iceServersInput || buildTimeIceServersDefault;
      const parsedIce = parseIceServers(rawIce);

      const session = startCollabSession(openDocInstance.doc, roomName, {
        password: sessionKey,
        signalingUrls: relayUrls,
        iceServers: parsedIce,
        persist: false,
        existingPersistence: openDocInstance.persistence,
      });
      setActiveSession({
        doc: openDocInstance.doc,
        session,
        roomName,
        password: sessionKey,
        relayUrl: rawUrls,
        stores: openDocStores,
        ownsDocument: false,
      });
    },
    [
      activeSession,
      leaveSession,
      openDocInstance.doc,
      openDocInstance.persistence,
      openDocStores,
      signalingUrlsInput,
      buildTimeSignalingDefault,
      iceServersInput,
      buildTimeIceServersDefault,
    ],
  );

  const handleJoinSession = useCallback(
    (roomName: string, password?: string, relayUrl?: string) => {
      if (activeSession) leaveSession();
      const parsed = parseSessionLink(roomName);
      const effectiveRoom = parsed.roomName || roomName.trim();
      const effectivePassword = password ?? parsed.key ?? parsed.password;
      const effectiveRelay = relayUrl ?? parsed.relay;
      if (effectiveRelay) {
        setSignalingUrlsInput(effectiveRelay);
        saveSignalingUrls(effectiveRelay);
      }
      const rawUrls = effectiveRelay || signalingUrlsInput || buildTimeSignalingDefault;
      const relayUrls = parseSignalingUrls(rawUrls);
      const rawIce = iceServersInput || buildTimeIceServersDefault;
      const parsedIce = parseIceServers(rawIce);

      const doc = new Y.Doc();
      const session = startCollabSession(doc, effectiveRoom, {
        password: effectivePassword,
        signalingUrls: relayUrls,
        iceServers: parsedIce,
        persist: true,
      });
      const stores = createDocumentStores(doc);
      setActiveSession({
        doc,
        session,
        roomName: effectiveRoom,
        password: effectivePassword,
        relayUrl: rawUrls,
        stores,
        ownsDocument: true,
      });
    },
    [
      activeSession,
      leaveSession,
      signalingUrlsInput,
      buildTimeSignalingDefault,
      iceServersInput,
      buildTimeIceServersDefault,
    ],
  );

  return {
    activeSession,
    setActiveSession,
    displayName,
    setDisplayName,
    nameChosen,
    onDisplayNameChange,
    showPeerCursors,
    setShowPeerCursors,
    storeIdentity,
    storeProviders,
    isOidcAvailable,
    handleLoginOidc,
    accessRequests,
    presenceName,
    presencePeers,
    sessionPersistence,
    relayConnected,
    isSynced: activeSession ? isSynced : false,
    signalingUrlsInput,
    onSignalingUrlsInputChange: updateSignalingUrls,
    buildTimeSignalingDefault,
    iceServersInput,
    onIceServersInputChange: updateIceServers,
    buildTimeIceServersDefault,
    signalingConfigured,
    broadcastPresence,
    onCursorMove,
    leaveSession,
    handleStartSession,
    handleJoinSession,
  };
}
