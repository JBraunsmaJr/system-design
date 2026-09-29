import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import {
  startCollabSession,
  type CollabSession,
  type PresenceInfo,
  type LocalPresenceInfo,
} from '../../collab/sync/session';
import {
  createDocumentStores,
  destroyDocumentStores,
  type OpenDocument,
  type OpenDocumentStores,
} from '../../collab/sync/localDocument';
import { undoControllerFor, releaseUndoController } from '../../collab/stores/undoManager';
import { authorizeRelayUrls } from '../../collab/access/relayAccess';
import {
  loadPresenceName,
  savePresenceName,
  loadShowPeerCursors,
  saveShowPeerCursors,
} from '../../domain/network/presenceIdentity';
import {
  loadSignalingUrls,
  saveSignalingUrls,
  parseSignalingUrls,
  getDefaultSignalingUrl,
} from '../../domain/network/signalingConfig';
import {
  loadIceServers,
  saveIceServers,
  parseIceServers,
  getDefaultIceServers,
} from '../../domain/network/iceServerConfig';
import {
  createSessionLink,
  parseSessionLink,
  generateSessionKey,
  sanitizeCurrentUrl,
} from '../../domain/network/sessionLink';
import type { ToastType } from '../../common/components/toast/Toast';

// Small, fixed palette for presence colors - not shared with team's own
// AVATAR_COLORS (TeamView.tsx) since that's module-private and this is
// a genuinely separate concept (a person's presence color for a
// session, not a team member's own identity), even though the actual
// hex values happen to match for visual consistency.
const PRESENCE_COLORS = [
  '#5b7cfa',
  '#9061f9',
  '#0fa36b',
  '#f0578c',
  '#f59e0b',
  '#06b6d4',
  '#ec4899',
  '#8b5cf6',
];

/** Moved from inside App(), where it was redeclared on every render. */
export interface ActiveCollabSession {
  doc: Y.Doc;
  session: CollabSession;
  roomName: string;
  password?: string;
  /** The stores over `doc`. For a session started from the open document
   * these ARE the open document's stores, not a second set. */
  stores: OpenDocumentStores;
  /** Whether this session owns `doc` and its stores - true for a joined
   * session, which must release them when it ends (WS1 Step 1). */
  ownsDocument: boolean;
  /**
   * Joined because the document is in a workspace, rather than chosen
   * by the person. New and Documents stay available in one of these:
   * switching documents means leaving this room and joining another,
   * which is ordinary. In a session someone started or joined by link,
   * switching would replace the document for everyone, so it stays
   * disabled there.
   */
  autoJoined?: boolean;
}

export interface UseCollabSessionOptions {
  openDoc: OpenDocument;
  storeUrl: string | null;
  /** The name the person's sign-in provides, if any. */
  signedInName: string | null;
  /** Must be stable (App's showToast is a useCallback with no deps). */
  showToast: (message: string, type?: ToastType, description?: string) => void;
}

/**
 * Real-time collaboration: the active session, this person's presence, the
 * relay and ICE configuration, and starting, joining and leaving sessions.
 * Moved unchanged from App.tsx.
 *
 * Performance contract (see src/app/README.md): this hook runs inside App's
 * render, so it adds no component, no render and no commit. Every value it
 * returns is either React state, a ref, or memoized with the same
 * dependencies it had in App.tsx. Callers destructure the result and depend
 * on the individual members - never on the returned object, which is new on
 * every render.
 */
export function useCollabSession({
  openDoc,
  storeUrl,
  signedInName,
  showToast,
}: UseCollabSessionOptions) {
  // --- Collaborative sessions -----------------------------------------------
  //
  // A session is a provider on a document (WS1-R4), covering every domain the
  // document holds at once. Undo keeps working throughout (WS3-R2): it is
  // scoped to this user's transaction origin, so it reverts only their own
  // edits and never a collaborator's.
  const [activeSession, setActiveSession] = useState<ActiveCollabSession | null>(null);

  const [displayName, setDisplayName] = useState(
    () => loadPresenceName() ?? `Guest-${Math.random().toString(36).slice(2, 6)}`,
  );
  // Purely local, display-side preference - has NO effect on what this
  // person broadcasts about their own cursor, only on whether THEY see
  // everyone else's. See presenceIdentity.ts's own doc comment for why.
  const [showPeerCursors, setShowPeerCursorsState] = useState(() => loadShowPeerCursors());
  const setShowPeerCursors = useCallback((show: boolean) => {
    setShowPeerCursorsState(show);
    saveShowPeerCursors(show);
  }, []);
  /** Whether the person typed their name, rather than it being generated.
   * A typed name outranks the one their sign-in provides. */
  const [nameChosen, setNameChosen] = useState(() => loadPresenceName() !== null);
  const onDisplayNameChange = useCallback((name: string) => {
    setDisplayName(name);
    setNameChosen(true);
    savePresenceName(name);
  }, []);

  /**
   * The name others see on this person's cursor. Three sources, in order:
   * a name they typed (saved, so it survives a reload), then the name
   * their sign-in provides, then a generated "Guest-…".
   *
   * The signed-in name is used but never saved: saving it would make it a
   * "chosen" name, and the next person to sign in on this browser would
   * appear as the last one.
   */
  const presenceName = nameChosen ? displayName : (signedInName ?? displayName);

  // Deliberately no reset to [] when activeSession becomes null - the
  // stale peer list from a just-ended session is harmless, since
  // CollabPanel only ever reads presencePeers via activeSession itself,
  // which is null at that point anyway. Resetting here would mean
  // calling setState directly and unconditionally in an effect body,
  // which is exactly the pattern React's own linting steers away from.
  const [presencePeers, setPresencePeers] = useState<PresenceInfo[]>([]);

  /** Local persistence for the session document, as CONFIRMED - starts as
   * loading rather than assuming success (NFR-10). */
  /** Confirmed local-persistence state for the session document, tagged with
   * the session it belongs to. Tagging rather than resetting means a new
   * session cannot inherit the previous one's result, and avoids a
   * synchronous state reset inside an effect (NFR-10). */
  const [sessionPersistence, setSessionPersistence] = useState<{
    session: object | null;
    state: 'active' | 'loading' | 'unavailable';
  }>({ session: null, state: 'loading' });
  /**
   * Whether the current session can actually reach a signaling relay.
   * Null outside a session, or before the first status arrives. Kept
   * separate from isSynced() on purpose: "not synced" is the normal
   * state of a session nobody else has joined yet, whereas "relay
   * unreachable" means the URL, DNS, TLS or the relay process itself is
   * wrong - and without telling those apart the panel reports "Session
   * Active" identically in both cases.
   */
  const [relayConnected, setRelayConnected] = useState<boolean | null>(null);
  // Reports the session document's local persistence once it has actually
  // loaded. Reset to "loading" on every session change so a new session never
  // inherits the previous one's confirmed state.
  useEffect(() => {
    if (!activeSession) return;
    let cancelled = false;
    const { persistence } = activeSession.session;
    const owner = activeSession.session;
    void persistence.whenSynced.then(() => {
      if (cancelled) return;
      // whenSynced resolves even when the database could not be opened - the
      // provider reports that by never having stored anything - so this is the
      // point where the state becomes known either way.
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

  // Holds this peer's own full presence state, rebuilt and rebroadcast
  // as a WHOLE each time any single piece of it changes (name/color at
  // session start, cursor position on mouse move, selection on
  // selection change) - setLocalPresence always replaces the entire
  // state at once (matching Awareness's own setLocalState semantics),
  // so broadcasting only the field that changed would silently wipe out
  // everything else that was previously set.
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
  // activeSessionRef lets broadcastPresence stay a permanently stable
  // function (empty deps) while still always reaching the CURRENT
  // session.
  //
  // Updated from a layout effect rather than during render, because a
  // render can be started and then thrown away - interrupted by a
  // higher-priority update, or double-invoked in StrictMode - while a
  // ref mutation made during that render survives it. A callback
  // committed from the last render that actually landed would then read
  // a session this component never committed to, and broadcast presence
  // into it. That is a real hazard on this branch specifically: the
  // value being tracked IS the session identity.
  //
  // useLayoutEffect and not useEffect: passive effects are deferred
  // after paint, leaving a window where committed handlers can fire
  // against a ref that still points at the previous session. Layout
  // effects run synchronously after commit and before both paint and
  // every passive effect, so the ref is current before anything can
  // read it. Every reader is an event handler or a passive effect
  // (broadcastPresence's own call site below, and the useEffects that
  // call it further down), never a render or a child layout effect -
  // which is what makes the layout-effect timing sufficient here.
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

  // A name that changes mid-session - typed, or a sign-in that finished
  // after the session began - reaches the others now, not next session.
  useEffect(() => {
    broadcastPresence({ name: presenceName.trim() || 'Guest' });
  }, [presenceName, broadcastPresence]);

  /**
   * WS13-R10: tell the others this participant holds a saved copy, once its
   * local persistence is confirmed. Other peers count replicas from exactly
   * this flag - nothing set it before, so every participant counted everyone
   * else as holding nothing, and the leave guard warned people who were not
   * the only holder.
   */
  useEffect(() => {
    if (!activeSession) return;
    const confirmed =
      sessionPersistence.session === activeSession.session && sessionPersistence.state === 'active';
    if (confirmed) broadcastPresence({ hasPersistedReplica: true });
  }, [activeSession, sessionPersistence, broadcastPresence]);

  // Rebroadcasts this peer's own selection whenever it changes - moved
  // below, right after selectedNodeIds/selectedEdgeIds are actually
  // declared (this file declares them much further down).

  // Cursor position updates are throttled to at most once per animation
  // frame, the same pattern (and for the same reason) as the node
  // position/dimension throttling above - mousemove fires far more
  // often than the screen refreshes, and every update here goes out
  // over the network to every peer, not just into local state.
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
  useEffect(() => {
    return () => {
      if (cursorFlushHandle.current !== null) cancelAnimationFrame(cursorFlushHandle.current);
    };
  }, []);

  // The deployer's own default, baked in at build time or injected via
  // container environment variables - still useful as a starting point,
  // but no longer the only way to set this: see signalingUrlsInput/
  // setSignalingUrlsRaw below for the runtime override.
  const buildTimeSignalingDefault = useMemo(() => getDefaultSignalingUrl(), []);

  // The raw, comma-separated string as typed/edited in CollabPanel -
  // this person's own runtime override if they've ever set one,
  // otherwise the deployer's build-time/container default. Kept as the raw
  // string (not pre-parsed into an array) specifically so the input
  // field in CollabPanel can be a normal, directly-editable controlled
  // input without needing to serialize/deserialize on every keystroke.
  const [signalingUrlsInput, setSignalingUrlsInputState] = useState(() => {
    const saved = loadSignalingUrls();
    return saved !== null && saved.trim() !== '' ? saved : buildTimeSignalingDefault;
  });
  const setSignalingUrlsInput = useCallback((raw: string) => {
    setSignalingUrlsInputState(raw);
    saveSignalingUrls(raw);
  }, []);
  const signalingUrls = useMemo(() => parseSignalingUrls(signalingUrlsInput), [signalingUrlsInput]);

  // ICE servers, configured exactly like the signaling URLs above: a
  // build-time or container-injected default the deployer provides,
  // overridable at runtime per browser without a rebuild.
  //
  // Separate from the signaling URL because they solve different halves
  // of the connection and fail independently - the relay is how peers
  // FIND each other, ICE is how they REACH each other. A network can
  // have a perfectly working relay and still never form a peer
  // connection, which is precisely the case on a segmented internal
  // network with no route to the public STUN servers WebRTC ships with.
  const buildTimeIceServersDefault = useMemo(() => getDefaultIceServers(), []);
  const [iceServersInput, setIceServersInputState] = useState(() => {
    const saved = loadIceServers();
    return saved !== null && saved.trim() !== '' ? saved : buildTimeIceServersDefault;
  });
  const setIceServersInput = useCallback((raw: string) => {
    setIceServersInputState(raw);
    saveIceServers(raw);
  }, []);
  const iceServers = useMemo(() => parseIceServers(iceServersInput), [iceServersInput]);

  /**
   * Drops a session's provider and, for a joined session, releases the
   * document it opened: its stores' observers and its undo controller.
   *
   * Leaving a joined session puts the local document back on screen. That is a
   * document boundary, so the local document's undo history is cleared rather
   * than resumed (WS3-R4) - undo must never act on a document the user was not
   * just looking at.
   */
  const endSession = useCallback(
    (ending: ActiveCollabSession) => {
      ending.session.disconnect();
      if (ending.ownsDocument) {
        destroyDocumentStores(ending.stores);
        releaseUndoController(ending.doc);
        undoControllerFor(openDoc.doc).clear();
      }
    },
    [openDoc],
  );

  // Starts a brand-new session on the document already open (WS1-R4).
  /**
   * A workspace document is open in a room everyone holding its key
   * computes, so opening it is enough to be in it with whoever else has
   * it open: presence, cursors, and live edits, rather than changes
   * appearing with nobody attached to them (WS3, WS8-R2).
   *
   * Joined once per room. A session the person started or joined by link
   * is left alone - they chose that one.
   */
  const autoJoinedRoom = useRef<string | null>(null);

  const startNewSession = useCallback(
    async (explicitKey?: string, explicitRoom?: string, options?: { autoJoined?: boolean }) => {
      /**
       * Restarting a session used to mean copying the old session's content
       * back into React state before building a fresh document. With one
       * document there is nothing to copy - the content is already where it
       * needs to be, so this only has to drop the old provider.
       */
      if (activeSessionRef.current) {
        endSession(activeSessionRef.current);
      }
      // An explicit room is a rehost (WS13-R12): the same room and key, so the
      // original session link works again.
      const roomName = explicitRoom ?? `session-${Math.random().toString(36).slice(2, 10)}`;
      const sessionKey =
        explicitKey && explicitKey.trim() ? explicitKey.trim() : generateSessionKey();
      /**
       * WS1-R4: the document the user has open BECOMES the session document,
       * with the stores already built over it. Starting a session is a provider
       * attachment: no seeding, no second store set, no visible transition, and
       * undo history carries straight across.
       *
       * There used to be a "defensive" seed here for an empty document. It
       * seeded from values captured at boot, so on an emptied document it would
       * have resurrected stale content. An empty document is simply an empty
       * session.
       */
      const doc = openDoc.doc;
      // Where the relay requires membership, the store issues a token for
      // this room first (WS10-R6). Untouched where it does not, which is
      // every deployment that has no store.
      const relay = await authorizeRelayUrls({ storeUrl, room: roomName, urls: signalingUrls });
      if (relay.note) showToast(relay.note);
      const session = startCollabSession(doc, roomName, {
        signalingUrls: relay.urls,
        password: sessionKey,
        iceServers,
        // Already persisted under its document key - don't store it twice.
        existingPersistence: openDoc.persistence,
      });

      const initialPresence: LocalPresenceInfo = {
        name: presenceName.trim() || 'Guest',
        color: PRESENCE_COLORS[Math.floor(Math.random() * PRESENCE_COLORS.length)],
        cursor: null,
        selectedNodeIds: [],
        selectedEdgeIds: [],
        viewMode: null,
        focusedItemId: null,
        diagramPath: '',
      };
      localPresenceRef.current = initialPresence;
      session.setLocalPresence(initialPresence);
      setActiveSession({
        doc,
        session,
        roomName,
        password: sessionKey,
        stores: openDoc.stores,
        ownsDocument: false,
        autoJoined: options?.autoJoined ?? false,
      });

      // Auto-copy shareable session link to clipboard
      const shareLink = createSessionLink({
        roomName,
        key: sessionKey,
        signalingUrlsInput,
        defaultSignalingUrls: buildTimeSignalingDefault,
      });
      if (
        typeof navigator !== 'undefined' &&
        typeof navigator.clipboard?.writeText === 'function'
      ) {
        navigator.clipboard
          .writeText(shareLink)
          .then(() => {
            showToast('Session link copied to clipboard');
          })
          .catch(() => {
            // Silently ignore clipboard write failures (e.g. non-HTTPS, unfocused window)
          });
      }
    },
    [
      openDoc,
      endSession,
      signalingUrls,
      signalingUrlsInput,
      buildTimeSignalingDefault,
      iceServers,
      presenceName,
      showToast,
      storeUrl,
    ],
  );

  // Joins an existing session by room name - never seeds from local state,
  // since the whole point of joining is to receive whatever the session
  // already has rather than imposing this browser's own state onto it.
  //
  // The document is no longer necessarily empty at this point: if this browser
  // has been in this room before, local persistence restores it immediately,
  // so the session opens with content on screen before any peer connects and
  // works offline. That restored copy and the peers' copy converge on sync the
  // same way two live peers do (WS2-R1).
  const joinSession = useCallback(
    async (roomName: string, passwordOrKey?: string, relayOverride?: string) => {
      // Switching sessions no longer means copying the old one's content
      // anywhere - dropping the provider is the whole job.
      if (activeSessionRef.current) {
        endSession(activeSessionRef.current);
      }
      let effectiveSignalingUrls = signalingUrls;
      if (relayOverride && relayOverride.trim()) {
        const trimmedRelay = relayOverride.trim();
        setSignalingUrlsInput(trimmedRelay);
        effectiveSignalingUrls = parseSignalingUrls(trimmedRelay);
      }
      const effectiveKey = passwordOrKey && passwordOrKey.trim() ? passwordOrKey.trim() : undefined;

      if (effectiveKey === undefined) {
        /*
          Every session this app creates is encrypted with its own key.
          Joining without one connects but can never decrypt a single
          update, which reads as "the session is empty".
         */
        showToast('This session link has no key, so the session cannot be opened.', 'error');
        return;
      }

      // Joining needs a token for this room just as starting one does
      // (WS10-R6). Without it, a relay with RELAY_TOKEN_SECRET set refuses
      // the joiner's subscribe and publish, so the host never hears its
      // announce, no peer connection forms, and the session looks empty.
      // Untouched where the relay does not require tokens.
      const relay = await authorizeRelayUrls({
        storeUrl,
        room: roomName,
        urls: effectiveSignalingUrls,
      });
      if (relay.note) showToast(relay.note);

      // WS1-R5: a separate document, never merged into the open one.
      const doc = new Y.Doc();
      const stores = createDocumentStores(doc);
      const session = startCollabSession(doc, roomName, {
        signalingUrls: relay.urls,
        password: effectiveKey,
        iceServers,
      });
      const initialPresence: LocalPresenceInfo = {
        name: presenceName.trim() || 'Guest',
        color: PRESENCE_COLORS[Math.floor(Math.random() * PRESENCE_COLORS.length)],
        cursor: null,
        selectedNodeIds: [],
        selectedEdgeIds: [],
        viewMode: null,
        focusedItemId: null,
        diagramPath: '',
      };
      localPresenceRef.current = initialPresence;
      session.setLocalPresence(initialPresence);
      setActiveSession({
        doc,
        session,
        roomName,
        password: effectiveKey,
        stores,
        ownsDocument: true,
      });
    },
    [
      endSession,
      signalingUrls,
      setSignalingUrlsInput,
      iceServers,
      presenceName,
      showToast,
      storeUrl,
    ],
  );

  // Auto-join if a session link is present in the URL on initial mount or hash change
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleUrlSession = () => {
      const currentHref = window.location.href;
      const parsed = parseSessionLink(currentHref);
      if (parsed.roomName && parsed.roomName !== currentHref) {
        void joinSession(parsed.roomName, parsed.password || parsed.key || '', parsed.relay);
        showToast(`Joined session: ${parsed.roomName}`, 'info');
        sanitizeCurrentUrl();
      }
    };

    handleUrlSession();

    window.addEventListener('hashchange', handleUrlSession);
    return () => {
      window.removeEventListener('hashchange', handleUrlSession);
    };
  }, [joinSession, showToast]);

  /**
   * Leaving a session used to copy its final state back into local React
   * state, so that edits made during the session - yours and collaborators' -
   * were not discarded when the connection ended.
   *
   * With one document that copy is unnecessary and would be actively wrong:
   * the session was editing the document directly, so everything is already
   * where it belongs. Disconnecting drops the provider and nothing else.
   */
  const leaveSession = useCallback(() => {
    if (!activeSession) return;
    endSession(activeSession);
    setActiveSession(null);
  }, [activeSession, endSession]);

  useEffect(() => {
    return () => {
      if (activeSessionRef.current) endSession(activeSessionRef.current);
    };
    // Only ever runs on unmount - reads activeSessionRef.current to avoid
    // closing over a stale activeSession value, while keeping the cleanup
    // restricted to component unmount.
  }, [endSession]);

  return {
    activeSession,
    setActiveSession,
    activeSessionRef,
    autoJoinedRoom,
    presenceName,
    onDisplayNameChange,
    showPeerCursors,
    setShowPeerCursors,
    presencePeers,
    sessionPersistence,
    relayConnected,
    broadcastPresence,
    onCursorMove,
    buildTimeSignalingDefault,
    signalingUrlsInput,
    setSignalingUrlsInput,
    signalingUrls,
    buildTimeIceServersDefault,
    iceServersInput,
    setIceServersInput,
    iceServers,
    startNewSession,
    joinSession,
    leaveSession,
  };
}
