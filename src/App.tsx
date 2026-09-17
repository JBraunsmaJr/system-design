import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, Profiler, type ProfilerOnRenderCallback, type ChangeEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  ReactFlowProvider,
  type Node,
  type Edge,
  type Connection,
  type OnNodesChange,
  type OnEdgesChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Toolbar } from "./components/Toolbar";
import { CollabPanel } from "./components/CollabPanel";
import { Palette } from "./components/Palette";
import { Canvas } from "./components/Canvas";
import { Inspector } from "./components/Inspector";
import { ScenarioPanel } from "./components/ScenarioPanel";
import { LibraryManagerModal } from "./components/LibraryManagerModal";
import { RequirementsView } from "./components/requirements/RequirementsView";
import { TimelineView } from "./components/timeline/TimelineView";
import { TeamView } from "./components/team/TeamView";
import { SkillTreeView } from "./components/skilltree/SkillTreeView";
import { NODE_TYPES } from "./domain/nodeRegistry";
import { GROUP_TYPES } from "./domain/groupRegistry";
import { SHAPE_TYPES, globalShapeRegistry } from "./domain/shapeRegistry";
import { reorderWithGroupsFirst, toAbsolutePosition } from "./domain/graphUtils";
import type { DiagramPath } from "./domain/subDiagramTree";
import { toDiagramFile, downloadDiagram, downloadDiagramAs, parseDiagramFile } from "./domain/serialization";
import {
  loadTimedCopies,
  saveTimedCopies,
  timedCopyFileName,
  isCopyDue,
  TIMED_COPIES_TEST_SECONDS_KEY,
  type TimedCopiesSettings,
} from "./domain/timedCopies";
import { loadAutosave, clearLegacyAutosave, hasLegacyAutosave, getAutosaveBlockedReason } from "./domain/autosave";
import {
  resolveDocumentId,
  readDocumentParam,
  withDocumentParam,
  sessionDocumentId,
  LAST_DOCUMENT_KEY,
} from "./domain/currentDocument";
import { createDocumentStore, newDocumentId, requestPersistentStorage, type StorageFailureReason } from "./domain/documentStore";
import { createDocumentLibrary } from "./collab/documentLibrary";
import { reconciliationWindowMs } from "./domain/reconciliationWindow";
import { DocumentManager } from "./components/DocumentManager";
import { createIndexedDbBackend } from "./domain/indexedDbBackend";
import { DurabilityIndicator } from "./components/DurabilityIndicator";
import { installUnloadGuard } from "./domain/unloadGuard";
import type { DurabilitySignals } from "./domain/durability";
import { countPersistedReplicas } from "./collab/session";
import { isSoleReplicaHolder } from "./domain/durability";
import { useFileSaving } from "./hooks/useFileSaving";
import { LeaveGuardDialog } from "./components/LeaveGuardDialog";
import {
  acquireDocument,
  replaceDocumentContents,
  createDocumentStores,
  destroyDocumentStores,
  type OpenDocumentStores,
} from "./collab/localDocument";
import { undoableStore, undoControllerFor, releaseUndoController } from "./collab/undoManager";
import { downloadRequirementsMarkdown } from "./domain/requirementsExport";
import { exportDiagramAsPng, exportDiagramAsSvg } from "./domain/imageExport";
import type { ArchNodeData, ArchEdgeData, ArchEdgeDataPatch, EdgeWaypoint, Scenario, ScenarioStep, SubDiagram } from "./domain/types";
import type { RequirementsDocument } from "./domain/requirementsTypes";
import { EMPTY_REQUIREMENTS_DOCUMENT } from "./domain/requirementsTypes";
import {
  BUILT_IN_ITEM_TYPES,
  BUILT_IN_RELATIONSHIP_TYPES,
  withMissingBuiltInTypes,
  withMissingBuiltInRelationshipTypes,
} from "./domain/requirementsRegistry";
import type { ProgramIncrement } from "./domain/programIncrements";
import type { TeamDocument } from "./domain/teamTypes";
import { EMPTY_TEAM_DOCUMENT } from "./domain/teamTypes";
import * as Y from "yjs";
import { getNodesAtPath, getEdgesAtPath, unflattenToSubDiagram, getBreadcrumbLabelsFlat, levelKey, populatedLevels } from "./collab/diagramStore";
import type { EdgeEndpoints } from "./domain/edgeReconnect";
import type { Milestone } from "./domain/milestones";
import { startCollabSession, type CollabSession, type PresenceInfo, type LocalPresenceInfo } from "./collab/session";
import { loadPresenceName, savePresenceName, loadShowPeerCursors, saveShowPeerCursors } from "./domain/presenceIdentity";
import { loadSignalingUrls, saveSignalingUrls, parseSignalingUrls, getDefaultSignalingUrl } from "./domain/signalingConfig";
import { loadIceServers, saveIceServers, parseIceServers, getDefaultIceServers } from "./domain/iceServerConfig";
import { createSessionLink, parseSessionLink, generateSessionKey, sanitizeCurrentUrl } from "./domain/sessionLink";
import { Toast, type ToastType } from "./components/Toast";
import { applyZOrderCommand, computeEffectiveZIndices, type ZOrderCommand } from "./domain/zOrder";
import {
  mergeInFlight,
  applyInFlight,
  remoteInFlight,
  toBroadcast,
  NO_IN_FLIGHT,
  type InFlightMap,
  applyEdgeGesture,
  edgeGestureWrites,
  remoteEdgeGestures,
  NO_EDGE_GESTURES,
  type EdgeGesture,
  type EdgeGestureMap,
} from "./domain/gestureGeometry";
import { classifyNodeChanges, applySelectionChanges, isAutoSizedNodeType, type PendingNodeUpdate, type CurrentNodeGeometry } from "./domain/nodeChangeBatching";
import { recordCommit, isPerfInstrumentationActive, isPerfAutosaveSuppressed } from "./perf/instrumentation";
import { getStandardFixture, type FixtureName } from "./perf/fixtures";
import "./App.css";

/**
 * The objects the canvas was last handed for each store node/edge, reused
 * while every derived input is unchanged. Keyed by the store's own object,
 * which the store itself keeps stable for anything a change did not touch
 * (yjsDiagramStore.ts) - so a drag re-renders the dragged node, not all of
 * them. Weak, so entries go when the store drops the source object.
 */
const derivedNodes = new WeakMap<
  Node<ArchNodeData>,
  { zIndex: number | undefined; measured: Node["measured"]; selected: boolean; hasSub: boolean; out: Node<ArchNodeData> }
>();
const derivedEdges = new WeakMap<Edge<ArchEdgeData>, { selected: boolean; out: Edge<ArchEdgeData> }>();
/**
 * The `data` object handed to each node, kept separately so that a change to
 * only its measured size, selection or stacking - which gives the node a new
 * object - does not also give it new `data`. Memoised node components compare
 * `data` by identity, so this is what lets them skip those renders.
 */
const derivedNodeData = new WeakMap<Node<ArchNodeData>, { hasSub: boolean; data: ArchNodeData }>();

let idSeed = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${idSeed++}`;

const EMPTY_DIAGRAM: SubDiagram = { nodes: [], edges: [] };

/** A document's content as plain values - the shape a file or autosave is
 * normalised into before it seeds a Y.Doc. Not live state: the Y.Doc is. */
interface DiagramSnapshot {
  title: string;
  root: SubDiagram;
  scenarios: Scenario[];
  requirements: RequirementsDocument;
  programIncrements: ProgramIncrement[];
  team: TeamDocument;
  milestones: Milestone[];
}

/**
 * Converts a raw parsed DiagramFile (from a loaded .json file OR a
 * restored localStorage autosave - both go through parseDiagramFile, so
 * both land here) into a normalized DiagramSnapshot ready to become app
 * state. Shared by onFileSelected and the autosave-restore lazy
 * initializer specifically so the two paths can't drift out of sync with
 * each other over time.
 */
function diagramFileToSnapshot(file: ReturnType<typeof parseDiagramFile>): DiagramSnapshot {
  // Diagrams saved before cross-diagram scenarios existed won't have a
  // `path` on their steps at all - default those to root so old files
  // keep working rather than crashing on a missing field.
  const normalizedScenarios = file.scenarios.map((sc) => ({
    ...sc,
    steps: sc.steps.map((st) => ({ ...st, path: st.path ?? [] })),
  }));
  // Similarly, files saved before requirements existed at all need the
  // built-in types populated from scratch, or "Add item" / "Add
  // relationship" would have nothing to offer - and separately, a file
  // saved after requirements existed but before some LATER built-in type
  // was added (e.g. before "Ticket") needs that one specific type merged
  // in, without disturbing anything else already saved.
  const finalRequirements = {
    ...file.requirements,
    itemTypes: withMissingBuiltInTypes(file.requirements.itemTypes),
    relationshipTypes: withMissingBuiltInRelationshipTypes(file.requirements.relationshipTypes),
  };
  return {
    title: file.title,
    root: { nodes: file.nodes, edges: file.edges },
    scenarios: normalizedScenarios,
    requirements: finalRequirements,
    programIncrements: file.programIncrements,
    team: file.team ?? EMPTY_TEAM_DOCUMENT,
    milestones: file.milestones ?? [],
  };
}

const DEFAULT_SNAPSHOT: DiagramSnapshot = {
  title: "Untitled Diagram",
  root: EMPTY_DIAGRAM,
  scenarios: [],
  requirements: {
    ...EMPTY_REQUIREMENTS_DOCUMENT,
    itemTypes: BUILT_IN_ITEM_TYPES,
    relationshipTypes: BUILT_IN_RELATIONSHIP_TYPES,
  },
  programIncrements: [],
  team: EMPTY_TEAM_DOCUMENT,
  milestones: [],
};

/** The inverse of diagramFileToSnapshot, for whole-document writes that start
 * from a snapshot rather than a parsed file (New). */
function snapshotToDiagramFile(snapshot: DiagramSnapshot) {
  return toDiagramFile(
    snapshot.title,
    snapshot.root.nodes,
    snapshot.root.edges,
    snapshot.scenarios,
    snapshot.requirements,
    snapshot.programIncrements,
    snapshot.team,
    snapshot.milestones
  );
}

// Small, fixed palette for presence colors - not shared with team's own
// AVATAR_COLORS (TeamView.tsx) since that's module-private and this is
// a genuinely separate concept (a person's presence color for a
// session, not a team member's own identity), even though the actual
// hex values happen to match for visual consistency.
const PRESENCE_COLORS = ["#5b7cfa", "#9061f9", "#0fa36b", "#f0578c", "#f59e0b", "#06b6d4", "#ec4899", "#8b5cf6"];

function App() {
  /**
   * What the app booted with: a restored autosave, or the default. Read once,
   * to seed the open document when it turns out to be empty; the document is
   * the model from then on (WS1-R1), including for title and scenarios.
   */
  const [bootSnapshot] = useState<DiagramSnapshot>(() => {
    // The retired localStorage draft, read once (WS2-R1). It only seeds the
    // document if the document turns out to be empty, and is cleared after
    // the first successful save to the document store.
    const autosave = loadAutosave();
    return autosave ? diagramFileToSnapshot(autosave) : DEFAULT_SNAPSHOT;
  });

  /**
   * Which document this tab has open (WS2-R3): the URL's `?doc=`, else the
   * last one opened in this browser, else "local". Written back to the URL so
   * a reload reopens it and another tab can hold a different one.
   */
  const [openDocId] = useState(() => {
    let lastDocId: string | null = null;
    try {
      lastDocId = localStorage.getItem(LAST_DOCUMENT_KEY);
    } catch {
      // Storage unavailable: fall through to the default document.
    }
    return resolveDocumentId({ urlDocId: readDocumentParam(window.location.href), lastDocId }).docId;
  });
  useEffect(() => {
    const next = withDocumentParam(window.location.href, openDocId);
    if (next !== window.location.href) window.history.replaceState(window.history.state, "", next);
    try {
      localStorage.setItem(LAST_DOCUMENT_KEY, openDocId);
    } catch {
      // A preference; losing it only means a bare URL opens the default.
    }
  }, [openDocId]);

  /** The catalogue of stored documents and their snapshots (WS2-R3). */
  const [documentStore] = useState(() => createDocumentStore(createIndexedDbBackend()));
  const [documentLibrary] = useState(() =>
    createDocumentLibrary({ store: documentStore }, { reconciliationWindowMs: reconciliationWindowMs() })
  );
  const [isDocumentManagerOpen, setIsDocumentManagerOpen] = useState(false);
  /** The file this document is continuously saved to, if any (WS13-R1). */
  const fileSaving = useFileSaving(openDocId);

  /**
   * Switches this tab to another stored document by navigating, so the open
   * document is closed and released exactly as on any unload. Any session
   * link is dropped - opening a document must not rejoin a session.
   */
  const openDocumentInTab = useCallback((docId: string) => {
    const url = new URL(withDocumentParam(window.location.href, docId));
    url.hash = "";
    window.location.assign(url.toString());
  }, []);

  // --- Collaborative sessions -----------------------------------------------
  //
  // A session is a provider on a document (WS1-R4), covering every domain the
  // document holds at once. Undo keeps working throughout (WS3-R2): it is
  // scoped to this user's transaction origin, so it reverts only their own
  // edits and never a collaborator's.
  interface ActiveCollabSession {
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
  }
  const [activeSession, setActiveSession] = useState<ActiveCollabSession | null>(null);

  const [displayName, setDisplayName] = useState(() => loadPresenceName() ?? `Guest-${Math.random().toString(36).slice(2, 6)}`);
  // Purely local, display-side preference - has NO effect on what this
  // person broadcasts about their own cursor, only on whether THEY see
  // everyone else's. See presenceIdentity.ts's own doc comment for why.
  const [showPeerCursors, setShowPeerCursorsState] = useState(() => loadShowPeerCursors());
  const setShowPeerCursors = useCallback((show: boolean) => {
    setShowPeerCursorsState(show);
    saveShowPeerCursors(show);
  }, []);
  const onDisplayNameChange = useCallback((name: string) => {
    setDisplayName(name);
    savePresenceName(name);
  }, []);

  // Deliberately no reset to [] when activeSession becomes null - the
  // stale peer list from a just-ended session is harmless, since
  // CollabPanel only ever reads presencePeers via activeSession itself,
  // which is null at that point anyway. Resetting here would mean
  // calling setState directly and unconditionally in an effect body,
  // which is exactly the pattern React's own linting steers away from.
  const [presencePeers, setPresencePeers] = useState<PresenceInfo[]>([]);

  /**
   * The open document (WS1-R1). Created by a lazy initialiser so it exists from the
   * first render - which is what lets the seams below drop their adapter
   * fallback entirely (WS1 Step 4). The initialiser runs exactly once, so
   * `diagram` is read at boot and never again.
   */
  const [openDoc] = useState(() => {
    // The restored autosave is a DiagramFile, so its root is the nested tree,
    // and openDocumentNow's seed is the import boundary that flattens it
    // (WS1-R3). Passing it through unchanged is the point: flattening here as
    // well is how the two load paths came to disagree about the shape.
    // acquireDocument, not openDocumentNow: StrictMode runs this initializer
    // twice, and a second live provider on the same database corrupts it.
    return acquireDocument({
      docId: openDocId,
      initial: snapshotToDiagramFile(bootSnapshot),
    });
  });
  // The document exists from the first render; this only has to release it.
  //
  // The close is deferred by a task, and cancelled if the effect runs again
  // first. StrictMode (dev only) runs this cleanup and the effect back to back
  // at mount while keeping the same state - so an immediate close destroyed
  // the stores of a document the app went on using, and no local edit ever
  // reached the canvas in dev. A real unmount still closes, one task later.
  const pendingClose = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const held = openDoc;
    if (pendingClose.current !== null) {
      clearTimeout(pendingClose.current);
      pendingClose.current = null;
    }
    return () => {
      pendingClose.current = setTimeout(() => {
        pendingClose.current = null;
        // Step 1 exists for this: without it every remount leaves observers
        // rebuilding snapshots against a document nobody reads.
        releaseUndoController(held.doc);
        void held.close();
      }, 0);
    };
  }, [openDoc]);
  /** Local persistence for the session document, as CONFIRMED - starts as
   * loading rather than assuming success (NFR-10). */
  /** Confirmed local-persistence state for the session document, tagged with
   * the session it belongs to. Tagging rather than resetting means a new
   * session cannot inherit the previous one's result, and avoids a
   * synchronous state reset inside an effect (NFR-10). */
  const [sessionPersistence, setSessionPersistence] = useState<{
    session: object | null;
    state: "active" | "loading" | "unavailable";
  }>({ session: null, state: "loading" });
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
  const [toast, setToast] = useState<{
    id?: number;
    message: string;
    description?: string;
    type?: ToastType;
  } | null>(null);

  const showToast = useCallback(
    (message: string, type: ToastType = "success", description?: string) => {
      setToast({ id: Date.now(), message, type, description });
    },
    []
  );
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
      setSessionPersistence({ session: owner, state: "active" });
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
  const localPresenceRef = useRef<LocalPresenceInfo>({ name: "", color: "", cursor: null, selectedNodeIds: [], selectedEdgeIds: [], viewMode: null, focusedItemId: null, diagramPath: "" });
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
      sessionPersistence.session === activeSession.session && sessionPersistence.state === "active";
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
    [flushCursor]
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

  const appVersion = useMemo(() => (import.meta.env.VITE_APP_VERSION as string | undefined) ?? "Development", [])

  // The raw, comma-separated string as typed/edited in CollabPanel -
  // this person's own runtime override if they've ever set one,
  // otherwise the deployer's build-time/container default. Kept as the raw
  // string (not pre-parsed into an array) specifically so the input
  // field in CollabPanel can be a normal, directly-editable controlled
  // input without needing to serialize/deserialize on every keystroke.
  const [signalingUrlsInput, setSignalingUrlsInputState] = useState(() => {
    const saved = loadSignalingUrls();
    return saved !== null && saved.trim() !== "" ? saved : buildTimeSignalingDefault;
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
    return saved !== null && saved.trim() !== "" ? saved : buildTimeIceServersDefault;
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
    [openDoc]
  );

  // Starts a brand-new session on the document already open (WS1-R4).
  const startNewSession = useCallback(
    (explicitKey?: string, explicitRoom?: string) => {
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
      const sessionKey = explicitKey && explicitKey.trim() ? explicitKey.trim() : generateSessionKey();
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
      const session = startCollabSession(doc, roomName, {
        signalingUrls,
        password: sessionKey,
        iceServers,
        // Already persisted under its document key - don't store it twice.
        existingPersistence: openDoc.persistence,
      });

      const initialPresence: LocalPresenceInfo = {
        name: displayName.trim() || "Guest",
        color: PRESENCE_COLORS[Math.floor(Math.random() * PRESENCE_COLORS.length)],
        cursor: null,
        selectedNodeIds: [],
        selectedEdgeIds: [],
        viewMode: null,
        focusedItemId: null,
        diagramPath: "",
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
      });

      // Auto-copy shareable session link to clipboard
      const shareLink = createSessionLink({
        roomName,
        key: sessionKey,
        signalingUrlsInput,
        defaultSignalingUrls: buildTimeSignalingDefault,
      });
      if (typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function") {
        navigator.clipboard
          .writeText(shareLink)
          .then(() => {
            showToast("Session link copied to clipboard");
          })
          .catch(() => {
            // Silently ignore clipboard write failures (e.g. non-HTTPS, unfocused window)
          });
      }
    },
    [openDoc, endSession, signalingUrls, signalingUrlsInput, buildTimeSignalingDefault, iceServers, displayName, showToast]
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
    (roomName: string, passwordOrKey?: string, relayOverride?: string) => {
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

      if(effectiveKey === undefined) {
        /*
          Every session this app creates is encrypted with its own key.
          Joining without one connects but can never decrypt a single
          update, which reads as "the session is empty".
         */
        showToast("This session link has no key, so the session cannot be opened.", "error")
        return
      }

      // WS1-R5: a separate document, never merged into the open one.
      const doc = new Y.Doc();
      const stores = createDocumentStores(doc);
      const session = startCollabSession(doc, roomName, { signalingUrls: effectiveSignalingUrls, password: effectiveKey, iceServers });
      const initialPresence: LocalPresenceInfo = {
        name: displayName.trim() || "Guest",
        color: PRESENCE_COLORS[Math.floor(Math.random() * PRESENCE_COLORS.length)],
        cursor: null,
        selectedNodeIds: [],
        selectedEdgeIds: [],
        viewMode: null,
        focusedItemId: null,
        diagramPath: "",
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
    [endSession, signalingUrls, setSignalingUrlsInput, iceServers, displayName, showToast]
  );

  // Auto-join if a session link is present in the URL on initial mount or hash change
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleUrlSession = () => {
      const currentHref = window.location.href;
      const parsed = parseSessionLink(currentHref);
      if (parsed.roomName && parsed.roomName !== currentHref) {
        joinSession(parsed.roomName, parsed.password || parsed.key || "", parsed.relay);
        showToast(`Joined session: ${parsed.roomName}`, "info");
        sanitizeCurrentUrl();
      }
    };

    handleUrlSession();

    window.addEventListener("hashchange", handleUrlSession);
    return () => {
      window.removeEventListener("hashchange", handleUrlSession);
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
      if (activeSession) endSession(activeSession);
    };
    // Only ever runs on unmount - intentionally not re-running when
    // activeSession itself changes, since that would disconnect and
    // immediately reconnect on every session state update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * The active store set (WS1-R1).
   *
   * One document, so this is no longer a choice between two representations -
   * a session's stores and the open document's stores are both Yjs stores over
   * the same schema. The adapter fallback covers only the few frames before
   * the document finishes opening; deleting it is Step 4.
   */
  /**
   * The document the user is looking at: the joined session's while in one,
   * otherwise the open local document (which is also the shared one after
   * starting a session). Whole-document writes - load, New - target this, so
   * they change what is on screen rather than a document nobody can see.
   */
  const activeDoc = activeSession?.doc ?? openDoc.doc;
  const rawStores = activeSession?.stores ?? openDoc.stores;

  /**
   * Undo for the document on screen (WS3-R1, WS3-R2). Scoped by origin, so it
   * works identically in and out of a session and never reverts a peer's edit.
   */
  const undo = useMemo(() => undoControllerFor(activeDoc), [activeDoc]);
  const canUndo = useSyncExternalStore(undo.subscribe, undo.canUndo);
  const canRedo = useSyncExternalStore(undo.subscribe, undo.canRedo);

  /**
   * The seams everything reads and writes through. Every mutating method runs
   * under the undo origin (undoableStore), so no call site can make an edit
   * that silently falls outside history. Memoised on the underlying store set,
   * so identities are stable for useSyncExternalStore and memoised children.
   */
  const teamStore = useMemo(() => undoableStore(rawStores.team, undo), [rawStores, undo]);
  const requirementsStore = useMemo(() => undoableStore(rawStores.requirements, undo), [rawStores, undo]);
  const programIncrementsStore = useMemo(
    () => undoableStore(rawStores.programIncrements, undo),
    [rawStores, undo]
  );
  const milestonesStore = useMemo(() => undoableStore(rawStores.milestones, undo), [rawStores, undo]);
  const diagramStore = useMemo(() => undoableStore(rawStores.diagram, undo), [rawStores, undo]);
  const metaStore = useMemo(() => undoableStore(rawStores.meta, undo), [rawStores, undo]);
  const metaSnapshot = useSyncExternalStore(metaStore.subscribe, metaStore.getSnapshot);
  const { title, scenarios } = metaSnapshot;

  // Same value-or-updater shape as the useState setters these replaced, so
  // every existing call site is unchanged.
  const setTitle = useCallback(
    (updater: string | ((prev: string) => string)) =>
      metaStore.setTitle(
        typeof updater === "function" ? updater(metaStore.getSnapshot().title) : updater
      ),
    [metaStore]
  );
  const setScenarios = useCallback(
    (updater: Scenario[] | ((prev: Scenario[]) => Scenario[])) =>
      metaStore.setScenarios(
        typeof updater === "function" ? updater(metaStore.getSnapshot().scenarios) : updater
      ),
    [metaStore]
  );
  const diagramStoreRef = useRef(diagramStore);

  // Subscribed via useSyncExternalStore (not just a plain useMemo keyed
  // on diagramStore/path/selection) because the Yjs-backed session store
  // never changes ITS OWN object reference when a remote peer edits the
  // diagram - it's the same store instance for the whole session. A
  // plain useMemo would never re-run for a remote change at all, only
  // ever catching up once something else (like switching views) forced
  // a re-render for an unrelated reason. The local adapter's own
  // subscribe is a deliberate no-op (local mode already re-renders via
  // React's own state flow when setRoot changes), so this costs nothing
  // extra there - it's specifically the collaborative path this fixes.
  const diagramSnapshot = useSyncExternalStore(diagramStore.subscribe, diagramStore.getSnapshot);
  const teamSnapshot = useSyncExternalStore(teamStore.subscribe, teamStore.getSnapshot);
  const requirementsSnapshot = useSyncExternalStore(requirementsStore.subscribe, requirementsStore.getSnapshot);
  const programIncrementsSnapshot = useSyncExternalStore(programIncrementsStore.subscribe, programIncrementsStore.getSnapshot);
  const milestonesSnapshot = useSyncExternalStore(milestonesStore.subscribe, milestonesStore.getSnapshot);


  // No tree is derived here (WS1-R3). The flat snapshot is canonical; the
  // recursive tree is built only at export boundaries (save, autosave) and for
  // the views that are written against it - see diagramTree further down.
  // Deriving it unconditionally cost a full unflatten per document change,
  // which the perf gate recorded as one per remote update.

  // Layout effect rather than a render-phase assignment, for the same
  // reason as activeSessionRef above - and with the same consequence if
  // it's wrong, since this ref decides whether an edit lands in the
  // local adapter store or the session's shared Yjs doc. Its only
  // readers are the onUpdateNode/onUpdateEdge callbacks further down,
  // both invoked from event handlers.
  useLayoutEffect(() => {
    diagramStoreRef.current = diagramStore;
  }, [diagramStore]);

  // Auto-saves the current diagram to localStorage so a refresh, an
  // accidental tab close, or a crash doesn't lose work - separate from
  // (and in addition to) the explicit Save button, which downloads a real
  // .json file. Debounced the same way undo history is, so a burst of
  // rapid edits (a drag, a typing session) results in one write once
  // things settle rather than one write per change. Once the first
  // autosave has happened, the indicator stays showing "Autosaved" for
  // the rest of the session - there's no real value in a live-ticking
  // "saved 3s ago" here, just confidence that it's happening at all.
  const [hasAutosaved, setHasAutosaved] = useState(false);
  const [autosaveFailure, setAutosaveFailure] = useState<{ reason: StorageFailureReason; message: string } | null>(null);
  const [autosaveBlocked] = useState(getAutosaveBlockedReason);
  const legacyDraftPending = useRef(hasLegacyAutosave());
  const writeToFile = fileSaving.write;
  // Bumped when an attached file becomes writable, so it is written straight
  // away rather than on the next edit.
  const fileWriteEpoch = fileSaving.writeEpoch;

  /**
   * The stored-document id for what is on screen: the open document, or - in
   * a joined session - that session's own replica entry, so joining never
   * overwrites the local document's snapshot (WS1-R5).
   */
  const activeDocId =
    activeSession && activeSession.ownsDocument ? sessionDocumentId(activeSession.roomName) : openDocId;
  const activeRoom = activeSession?.roomName ?? null;
  const activeKey = activeSession?.password ?? null;

  useEffect(() => {
    // The perf harness measures editing, not autosave - see
    // isPerfAutosaveSuppressed. Always false outside instrumented builds.
    if (isPerfAutosaveSuppressed()) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      // Export boundary: built once per debounced write, not once per change.
      const tree = unflattenToSubDiagram(diagramSnapshot.nodes, diagramSnapshot.edges);
      const file = toDiagramFile(
        title,
        tree.nodes,
        tree.edges,
        scenarios,
        requirementsSnapshot,
        programIncrementsSnapshot,
        teamSnapshot,
        milestonesSnapshot
      );
      // A snapshot in the document store, alongside the live y-indexeddb
      // replica: it keeps the index's title and time current (WS2-R3), is a
      // readable fallback if the replica is damaged, and is the write whose
      // failure the durability indicator reports (WS2-R4). It replaces the
      // localStorage draft (WS2-R1).
      const origin =
        activeRoom !== null
          ? ({ origin: "session", sessionRoom: activeRoom, sessionKey: activeKey ?? undefined } as const)
          : ({ origin: "local" } as const);
      // WS13-R1: the attached file belongs to the open local document, never
      // to a joined session's content.
      if (activeDocId === openDocId) void writeToFile(JSON.stringify(file, null, 2));
      void documentStore.writeDocument(activeDocId, file, origin).then((result) => {
        if (cancelled) return;
        // Set from the confirmed outcome, never the attempt (NFR-10).
        if (result.ok) {
          setHasAutosaved(true);
          setAutosaveFailure(null);
          // WS2-R5: ask for durable storage when a document is first stored.
          if (result.value.createdAt === result.value.updatedAt) void requestPersistentStorage();
          if (legacyDraftPending.current && activeDocId === openDocId) {
            legacyDraftPending.current = false;
            clearLegacyAutosave();
          }
        } else {
          setAutosaveFailure({ reason: result.reason, message: result.message });
        }
      });
    }, 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [title, diagramSnapshot, scenarios, requirementsSnapshot, programIncrementsSnapshot, teamSnapshot, milestonesSnapshot, documentStore, activeDocId, activeRoom, activeKey, openDocId, writeToFile, fileWriteEpoch]);

  /**
   * WS13-R12: the session this document was last shared in, if its room and
   * key were kept - offered as "Resume session" so a former participant can
   * host it again after everyone has left.
   */
  const [resumableSession, setResumableSession] = useState<{ room: string; key: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void documentStore.listDocuments().then((listed) => {
      if (cancelled || !listed.ok) return;
      const entry = listed.value.find((e) => e.docId === openDocId);
      setResumableSession(
        entry?.sessionRoom && entry.sessionKey ? { room: entry.sessionRoom, key: entry.sessionKey } : null
      );
    });
    return () => {
      cancelled = true;
    };
    // Re-read when a session ends, which is when a room first becomes resumable.
  }, [documentStore, openDocId, activeRoom]);

  /**
   * What the app currently knows about whether this document is safe
   * (WS13-R8/R9). Every field is a CONFIRMED observation, never an intention:
   * the indicator is the one thing in the UI that must not be optimistic.
   */
  const durabilitySignals: DurabilitySignals = useMemo(() => {
    const inSession = activeSession !== null;
    // The file belongs to the local document. A joined session is another
    // document, and describing it as saved to that file would be false.
    const file = activeSession?.ownsDocument
      ? { fileAccess: fileSaving.signals.fileAccess, fileAttachment: null, fileBacked: false }
      : fileSaving.signals;
    return {
      ...file,
      localPersistence: inSession
        ? sessionPersistence.session === activeSession.session
          ? sessionPersistence.state
          : "loading"
        : autosaveFailure?.reason === "unavailable"
          ? "unavailable"
          : hasAutosaved
            ? "active"
            : "loading",
      storageFailure: autosaveFailure,
      autosaveBlockedReason: autosaveBlocked,
      // Counted only in a session; outside one there is nobody else to count,
      // and claiming "you are the only person with a copy" to a solo user
      // would be noise rather than a warning.
      replicaCount: inSession
        ? countPersistedReplicas(
            presencePeers,
            sessionPersistence.session === activeSession.session &&
              sessionPersistence.state === "active",
          )
        : undefined,
    };
  }, [
    activeSession,
    sessionPersistence,
    autosaveFailure,
    autosaveBlocked,
    hasAutosaved,
    presencePeers,
    fileSaving.signals,
  ]);

  // WS13-R7. Read live rather than captured, so the prompt reflects the state
  // at the moment of closing.
  const durabilityRef = useRef(durabilitySignals);
  useEffect(() => {
    durabilityRef.current = durabilitySignals;
  }, [durabilitySignals]);
  useEffect(() => {
    const guard = installUnloadGuard(() => durabilityRef.current);
    return () => guard.release();
  }, []);

  const [path, setPath] = useState<DiagramPath>([]);

  // Rebroadcasts this peer's own diagram path whenever it changes, so
  // peers viewing a DIFFERENT sub-diagram level correctly know not to
  // render this person's cursor - see broadcastPresence's own cursor
  // handling and Canvas's peer-cursor filtering for the other half of
  // this fix.
  useEffect(() => {
    if (!activeSession) return;
    broadcastPresence({ diagramPath: path.join("/") });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession, path]);

  // Expose test harness helper hooks onto window.__PERF__ when active
  useEffect(() => {
    if (typeof window !== "undefined" && (window as unknown as Record<string, unknown>).__PERF__) {
      const perfObj = (window as unknown as Record<string, unknown>).__PERF__ as Record<string, unknown>;
      perfObj.Y = Y;
      (window as unknown as Record<string, unknown>).Y = Y;
      /**
       * Through the seam, not through React state (WS1 Step 3).
       *
       * These are the highest-consequence writers in the app, because their
       * failure is silent: a fixture that does not load leaves an empty
       * canvas, and zero renders reads as a green IMPROVEMENT in the perf
       * gate rather than as a failure. Routing them through diagramStore now
       * means the later swap to a Y.Doc changes the implementation under
       * them rather than quietly bypassing them.
       */
      perfObj.loadFixture = (name: FixtureName) => {
        const fixture = getStandardFixture(name);
        diagramStore.replaceAll(fixture);
        return fixture;
      };
      perfObj.setDiagram = (diagram: SubDiagram) => {
        diagramStore.replaceAll(diagram);
      };
      perfObj.setPath = (newPath: string[]) => {
        setPath(newPath);
      };
      perfObj.setSelectedNodes = (nodeIds: string[]) => {
        setSelectedNodeIds(nodeIds);
      };
      perfObj.setSelectedEdges = (edgeIds: string[]) => {
        setSelectedEdgeIds(edgeIds);
      };
      perfObj.startCollabSessionWithDoc = (doc: Y.Doc) => {
        const roomName = `perf-room-${Math.random().toString(36).slice(2, 8)}`;
        const stores = createDocumentStores(doc);
        const session = startCollabSession(doc, roomName, {
          signalingUrls,
          iceServers,
          // The harness measures the editing path, not the storage layer.
          // Leaving persistence on also makes runs non-deterministic, since
          // each one would find whatever the previous one left in IndexedDB
          // under a room name that is random per run.
          persist: false,
        });
        setActiveSession({
          doc,
          session,
          roomName,
          stores,
          ownsDocument: true,
        });
      };
      perfObj.leaveCollabSession = () => {
        leaveSession();
      };
      // Encoded size of the document on screen - how WS4-R1 is checked
      // ("a drag adds no more than 1KB").
      perfObj.docBytes = () => Y.encodeStateAsUpdate(activeDoc).byteLength;
    }
  }, [diagramStore, setPath, signalingUrls, iceServers, leaveSession, activeDoc]);

  const breadcrumbLabels = useMemo(
    () => getBreadcrumbLabelsFlat(diagramSnapshot.nodes, path),
    [diagramSnapshot, path]
  );

  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);

  // Rebroadcasts this peer's own selection whenever it changes, so
  // everyone else's "someone else has this selected" indicator (see
  // Canvas's peerSelections prop) stays current. A no-op when no
  // session is active - broadcastPresence itself already guards on
  // activeSessionRef, this dependency just avoids scheduling pointless
  // work while purely-local editing changes selection constantly.
  useEffect(() => {
    if (!activeSession) return;
    broadcastPresence({ selectedNodeIds, selectedEdgeIds });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession, selectedNodeIds, selectedEdgeIds]);

  // This client's own record of what React Flow last measured each node
  // to be. Deliberately state rather than a ref, even though it's only
  // ever written from an event handler: the nodes memo below reads it
  // during render, which is exactly what a ref must not be used for.
  // Writes are guarded on the value actually having changed, so the
  // steady state (React Flow re-reporting sizes that didn't change) sets
  // no state and triggers no render. Purely local and never written to
  // any store - see the `measured` line below, and isAutoSizedNodeType,
  // for why sharing it is what broke.
  const [measuredDimensions, setMeasuredDimensions] = useState<Map<string, { width: number; height: number }>>(
    () => new Map()
  );

  // nodes/edges are derived from diagramStore rather than stored directly -
  // selection is deliberately NOT part of that store's schema (it's
  // ephemeral, per-person state, not something a collaborator should see
  // reflected in their own view), so it's combined in here on every read
  // instead, using selectedNodeIds/selectedEdgeIds as the sole source of
  // truth. This replaces what used to be tracked as a `.selected` field
  // persisted directly on the node/edge objects themselves.
  /**
   * Geometry of nodes this user is dragging or resizing right now (WS4-R1).
   * Rendered over the document and broadcast to peers, but not written to the
   * document until the gesture ends - see flushPendingNodeUpdates.
   */
  const [inFlight, setInFlight] = useState<InFlightMap>(NO_IN_FLIGHT);
  const inFlightRef = useRef<InFlightMap>(NO_IN_FLIGHT);
  /** Edge bends being dragged by this user, rendered but not yet written. */
  const [edgeInFlight, setEdgeInFlight] = useState<EdgeGestureMap>(NO_EDGE_GESTURES);
  const edgeGesturesRef = useRef(new Map<string, EdgeGesture>());
  /** Other peers' in-flight bends at this level. */
  const peerEdgeInFlight = useMemo(
    () => (activeSession ? remoteEdgeGestures(presencePeers, path.join("/")) : new Map()),
    [activeSession, presencePeers, path]
  );
  /** Other peers' in-flight geometry at this level (WS4-R3). */
  const peerInFlight = useMemo(
    () => (activeSession ? remoteInFlight(presencePeers, path.join("/")) : NO_IN_FLIGHT),
    [activeSession, presencePeers, path]
  );

  const subDiagramLevels = useMemo(() => populatedLevels(diagramSnapshot.nodes), [diagramSnapshot]);
  const { nodes, edges } = useMemo(() => {
    const rawNodes = reorderWithGroupsFirst(getNodesAtPath(diagramSnapshot.nodes, path));
    const rawEdges = getEdgesAtPath(diagramSnapshot.edges, path);
    /**
     * Keyed only on what the ordering actually depends on - id, size and
     * any explicit override. Position is deliberately excluded: the rule
     * is area-based, so recomputing while something is dragged would be
     * pure waste on every animation frame.
     */
    const zIndices = computeEffectiveZIndices(
      rawNodes.map((n) => ({
        id: n.id,
        x: 0,
        y: 0,
        width: n.width ?? measuredDimensions.get(n.id)?.width ?? 0,
        height: n.height ?? measuredDimensions.get(n.id)?.height ?? 0,
        zIndex: n.data.zIndex,
      }))
    );

    const selectedNodes = new Set(selectedNodeIds);
    const selectedEdges = new Set(selectedEdgeIds);

    return {
      nodes: rawNodes.map((n) => {
        // Stacking order, folded into this existing pass rather than computed
        // again downstream - see domain/zOrder.ts for the rule. Derived from
        // live geometry so a rectangle enlarged to enclose more nodes drops
        // behind them without anyone reordering anything.
        const zIndex = zIndices.get(n.id);
        // Re-attached because React Flow reads `measured` EXCLUSIVELY off the
        // node object the app hands it (adoptUserNodes) and does not carry its
        // own previous value forward - so a node the store rebuilds would
        // otherwise lose its measured size until a re-measure a frame later.
        // This is each client's OWN measurement of its OWN DOM, deliberately
        // never sent over the session - see isAutoSizedNodeType.
        const measured = measuredDimensions.get(n.id) ?? n.measured;
        const selected = selectedNodes.has(n.id);
        const hasSub = subDiagramLevels.has(levelKey([...path, n.id]));
        // Same inputs, same object (WS1-R8): React Flow skips a node whose
        // object is identical to last time, and re-renders it otherwise.
        const hit = derivedNodes.get(n);
        let out: Node<ArchNodeData>;
        if (hit && hit.zIndex === zIndex && hit.measured === measured && hit.selected === selected && hit.hasSub === hasSub) {
          out = hit.out;
        } else {
          let dataHit = derivedNodeData.get(n);
          if (!dataHit || dataHit.hasSub !== hasSub) {
            dataHit = { hasSub, data: { ...n.data, hasSubDiagram: hasSub } };
            derivedNodeData.set(n, dataHit);
          }
          out = { ...n, zIndex, measured, selected, data: dataHit.data };
          derivedNodes.set(n, { zIndex, measured, selected, hasSub, out });
        }
        // In-flight geometry over the document's (WS4-R1, WS4-R3): this
        // user's own gesture first, since they are the one holding the node.
        // Only the moving nodes get a new object, so only they re-render.
        return applyInFlight(out, inFlight.get(n.id) ?? peerInFlight.get(n.id));
      }),
      edges: rawEdges.map((e) => {
        const selected = selectedEdges.has(e.id);
        const hit = derivedEdges.get(e);
        let out: Edge<ArchEdgeData>;
        if (hit && hit.selected === selected) {
          out = hit.out;
        } else {
          out = { ...e, selected };
          derivedEdges.set(e, { selected, out });
        }
        // In-flight bends, this user's first; only those edges get new objects.
        const own = edgeInFlight.get(e.id);
        const peer = own ? undefined : peerEdgeInFlight.get(e.id);
        if (!own && !peer) return out;
        const waypoints = own ? applyEdgeGesture(out.data?.waypoints, own) : peer;
        return { ...out, data: { ...(out.data as ArchEdgeData), waypoints } };
      }),
    };
  }, [diagramSnapshot, subDiagramLevels, path, selectedNodeIds, selectedEdgeIds, measuredDimensions, inFlight, peerInFlight, edgeInFlight, peerEdgeInFlight]);

  // Only position/dimensions changes need to reach the store - selection
  // changes are handled separately (and more robustly, since it's the
  // full aggregate rather than an incremental diff) via onSelectionChange
  // below. 'remove' changes are never expected here: Canvas.tsx sets
  // deleteKeyCode={null}, so React Flow's own delete-key handling never
  // fires through this path at all - deletion always goes through the
  // app's own onDeleteNode/onDeleteEdge, which have additional logic
  // (group-child release, populated-sub-diagram confirmation) a raw
  // 'remove' change would bypass entirely. 'add'/'replace' aren't
  // expected either: nodes are always added via explicit app actions.
  // Position/dimension changes are coalesced to at most one store commit
  // per animation frame while a gesture is actively in progress, rather
  // than one commit per raw browser event - mousemove can fire far
  // faster than the screen refreshes (especially on high-polling-rate
  // mice), and every commit was triggering a full diagramStore rebuild
  // plus a full app re-render, which is what made dragging both slow
  // and visually unreliable. pendingNodeUpdates is keyed by node id, so
  // multiple updates to the SAME node within one frame simply overwrite
  // each other (only the latest position/size within the frame ever
  // gets committed) - correctly handles dragging several selected nodes
  // together too, since each gets its own independent pending entry.
  const nodesRef = useRef(nodes);
  useLayoutEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const pendingNodeUpdates = useRef(new Map<string, PendingNodeUpdate>());
  /** Reparents requested while a gesture's commit is pending (a node dropped
   * into a group), applied last inside that commit - see onReparentNode. */
  const pendingReparents = useRef(new Map<string, string | undefined>());
  const commitScheduled = useRef(false);
  const pendingFlushHandle = useRef<number | null>(null);

  /**
   * Folds this frame's pending geometry into the in-flight overlay and
   * broadcasts it - nothing reaches the document mid-gesture (WS4-R1).
   */
  const flushPendingNodeUpdates = useCallback(() => {
    pendingFlushHandle.current = null;
    const pending = pendingNodeUpdates.current;
    if (pending.size === 0) return;
    const next = mergeInFlight(inFlightRef.current, pending);
    pending.clear();
    inFlightRef.current = next;
    setInFlight(next);
    broadcastPresence({ gesture: toBroadcast(path.join("/"), next) });
  }, [broadcastPresence, path]);

  /**
   * Ends a gesture: every node it moved or resized is written exactly once
   * (WS4-R2), in ONE transaction under the undo origin, so peers receive one
   * update and the whole gesture is one undo step. Also the path for
   * standalone changes (an arrow-key nudge, a snap correction), which have no
   * overlay and simply commit.
   */
  const commitNodeGesture = useCallback(() => {
    commitScheduled.current = false;
    const pending = pendingNodeUpdates.current;
    const final = mergeInFlight(inFlightRef.current, pending);
    pending.clear();
    const reparents = new Map(pendingReparents.current);
    pendingReparents.current.clear();
    if (final.size > 0 || reparents.size > 0) {
      undo.transact(() => {
        for (const [id, g] of final) {
          // A reparented node's position is written by updateParentId below,
          // relative to its new parent - writing it here as well would be a
          // second write for the same node.
          if (g.position && !reparents.has(id)) diagramStore.updatePosition(id, g.position);
          if (g.width !== undefined || g.height !== undefined) diagramStore.updateDimensions(id, g.width, g.height);
        }
        // Relative positions are derived here, from the geometry this commit
        // is writing - the last rendered frame can be a frame or two behind
        // the release, which put the node visibly off from where it was
        // dropped.
        const rendered = nodesRef.current;
        const withFinal = (n: Node<ArchNodeData>) => {
          const g = final.get(n.id);
          return g?.position ? { ...n, position: g.position } : n;
        };
        const current = rendered.map(withFinal);
        for (const [id, parentId] of reparents) {
          const node = current.find((n) => n.id === id);
          if (!node) continue;
          const absolute = toAbsolutePosition(node, current, node.parentId);
          const parent = parentId ? current.find((n) => n.id === parentId) : undefined;
          const position = parent
            ? { x: absolute.x - parent.position.x, y: absolute.y - parent.position.y }
            : absolute;
          diagramStore.updateParentId(id, parentId, position);
        }
      });
    }
    // Cleared in the same batch as the store notification above, so no frame
    // shows the node back at its old position.
    if (inFlightRef.current.size > 0) {
      inFlightRef.current = NO_IN_FLIGHT;
      setInFlight(NO_IN_FLIGHT);
      broadcastPresence({ gesture: null });
    }
  }, [undo, diagramStore, broadcastPresence]);

  // Cancels any still-pending animation frame if the component unmounts
  // mid-gesture, so a stale callback can never fire against a store that
  // may no longer even be the active one (e.g. a session having just
  // ended).
  useEffect(() => {
    return () => {
      if (pendingFlushHandle.current !== null) cancelAnimationFrame(pendingFlushHandle.current);
    };
  }, []);

  const onNodesChange = useCallback<OnNodesChange<Node<ArchNodeData>>>(
    (changes) => {
      // Handled here, synchronously, rather than relying solely on
      // onSelectionChange below: React Flow's own source
      // (SelectionListenerInner) calls onSelectionChange from INSIDE a
      // useEffect, one render cycle after the actual click - which
      // doesn't match this app's own controlled-nodes-array setup (see
      // this file's own notes on why React Flow needs the app to feed
      // position/dimension changes back promptly for the same reason).
      // That one-render delay was reported as a real, concrete bug:
      // selecting node A appeared to do nothing, and only selecting
      // node B afterward caused A (not B) to visibly become selected -
      // exactly the symptom of a selection update that's always one
      // interaction behind. Each 'select' change is independent and
      // incremental (a normal click replacing the whole selection still
      // arrives as multiple changes in the same batch - deselect the
      // old, select the new - not a single "replace everything" event),
      // so folding them in here one at a time is correct.
      setSelectedNodeIds((cur) => applySelectionChanges(changes, cur));

      // Recorded for EVERY node, including the content-sized ones whose
      // dimensions deliberately never reach the store - this is exactly
      // the value the nodes memo re-attaches so a remote edit doesn't
      // wipe it, so it has to be kept current regardless of whether the
      // change is also going to be committed. The same-value check
      // matters: React Flow re-reports unchanged sizes routinely, and
      // returning the existing Map for those keeps this from rendering
      // on every one of them.
      setMeasuredDimensions((cur) => {
        let next: Map<string, { width: number; height: number }> | null = null;
        for (const change of changes) {
          if (change.type !== "dimensions" || !change.dimensions) continue;
          const prev = cur.get(change.id);
          if (prev && prev.width === change.dimensions.width && prev.height === change.dimensions.height) continue;
          next ??= new Map(cur);
          next.set(change.id, { width: change.dimensions.width, height: change.dimensions.height });
        }
        return next ?? cur;
      });

      const currentNodeGeometry = new Map<string, CurrentNodeGeometry>(
        nodesRef.current.map((n) => [
          n.id,
          { position: n.position, width: n.width, height: n.height, isAutoSized: isAutoSizedNodeType(n.type) },
        ])
      );
      const { isActiveGesture, gestureEnded } = classifyNodeChanges(changes, pendingNodeUpdates.current, currentNodeGeometry);
      const gestureInProgress = inFlightRef.current.size > 0;
      if (isActiveGesture) {
        if (pendingFlushHandle.current === null) {
          pendingFlushHandle.current = requestAnimationFrame(flushPendingNodeUpdates);
        }
      } else if (gestureEnded) {
        // Released. Committed in a microtask rather than here, because React
        // Flow calls onNodeDragStop right after this - and its alignment-snap
        // correction and drop-into-group reparent belong to the same gesture.
        // Folding them in keeps it to one write per node (WS4-R2) and one
        // transaction. A microtask still runs before the next paint.
        if (pendingFlushHandle.current !== null) {
          cancelAnimationFrame(pendingFlushHandle.current);
          pendingFlushHandle.current = null;
        }
        if (!commitScheduled.current) {
          commitScheduled.current = true;
          queueMicrotask(commitNodeGesture);
        }
      } else if (!gestureInProgress && !commitScheduled.current && pendingNodeUpdates.current.size > 0) {
        // A standalone change with no gesture open (an arrow-key nudge).
        // Anything arriving while a gesture is open or awaiting its commit -
        // a snap correction, a stray batch mid-drag - stays pending and is
        // folded into that commit instead of committing on its own.
        commitNodeGesture();
      }
    },
    [flushPendingNodeUpdates, commitNodeGesture]
  );

  // Edges have no position/dimensions concept, so the only thing this
  // needs to do is the same synchronous 'select' handling as
  // onNodesChange above, for the identical reason (onSelectionChange's
  // own one-render-cycle delay via React Flow's internal useEffect).
  // 'remove'/'add'/'replace' are never expected here - see this file's
  // other notes on why edges are always added/removed via explicit app
  // actions, never through this path.
  const onEdgesChange = useCallback<OnEdgesChange<Edge<ArchEdgeData>>>((changes) => {
    setSelectedEdgeIds((cur) => applySelectionChanges(changes, cur));
  }, []);
  const fileInputRef = useRef<HTMLInputElement>(null);



  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [isPresenting, setIsPresenting] = useState(false);
  // Which top-level page is showing - the diagram canvas or the
  // requirements document. Deliberately NOT part of the undoable
  // DiagramSnapshot: switching pages isn't an edit to the content itself.
  const [viewMode, setViewModeRaw] = useState<"diagram" | "requirements" | "timeline" | "team" | "skill-tree">("diagram");
  /**
   * The recursive tree, for the views still written against it
   * (requirements, timeline, skill tree - all to find linked nodes).
   *
   * Built only while one of them is showing. None of them is mounted in the
   * diagram view, which is where editing and remote bursts happen, so the
   * common path never pays for an unflatten (WS1-R3).
   */
  const viewNeedsTree = viewMode === "requirements" || viewMode === "timeline" || viewMode === "skill-tree";
  const diagramTree = useMemo(
    () => (viewNeedsTree ? unflattenToSubDiagram(diagramSnapshot.nodes, diagramSnapshot.edges) : EMPTY_DIAGRAM),
    [viewNeedsTree, diagramSnapshot]
  );

  // Which requirements/timeline item this peer currently has open -
  // null when browsing a list without anything specific focused, or on
  // a view that doesn't track this at all (diagram/team/skill-tree).
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);

  // Resets focusedItemId at the actual point viewMode changes (a real
  // user action, via the toolbar), rather than reacting to the change
  // afterward in an effect - calling setState synchronously inside an
  // effect body is exactly the cascading-render pattern React's own
  // lint rules steer away from. This way, both state updates are
  // ordinary, sibling calls within the same event handler, which React
  // batches together into a single render - not two.
  const setViewMode = useCallback((mode: typeof viewMode) => {
    setViewModeRaw(mode);
    setFocusedItemId(null);
  }, []);

  // Rebroadcasts viewMode/focusedItemId whenever either changes - two
  // separate effects (rather than one watching both) since they change
  // independently far more often than together, and each only needs to
  // send the one field that actually changed.
  useEffect(() => {
    if (!activeSession) return;
    broadcastPresence({ viewMode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession, viewMode]);
  useEffect(() => {
    if (!activeSession) return;
    broadcastPresence({ focusedItemId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession, focusedItemId]);
  // Set together with viewMode when the user clicks a linked requirement
  // pill in the Inspector (while looking at the diagram) - see
  // RequirementsView's focusItemId prop for how this actually triggers
  // the scroll-and-highlight once that view mounts.
  const [pendingRequirementFocus, setPendingRequirementFocus] = useState<string | null>(null);
  const onFocusRequirementHandled = useCallback(() => {
    setPendingRequirementFocus(null);
  }, []);
  const onNavigateToRequirement = useCallback((itemId: string) => {
    setViewMode("requirements");
    setPendingRequirementFocus(itemId);
  }, [setViewMode]);
  // Mirrors onNavigateToRequirement above - jumps to the diagram, drills
  // to whichever sub-diagram level actually contains the target node
  // (path is relative to root, see findLinkedNodes), and requests the
  // camera focus Canvas consumes via focusNodeId/onFocusHandled.
  const [pendingNodeFocus, setPendingNodeFocus] = useState<string | null>(null);
  const onFocusNodeHandled = useCallback(() => {
    setPendingNodeFocus(null);
  }, []);
  const onNavigateToNode = useCallback(
    (nodePath: DiagramPath, nodeId: string) => {
      setViewMode("diagram");
      setPath(nodePath);
      setPendingNodeFocus(nodeId);
      setSelectedNodeIds([nodeId]);
      setSelectedEdgeIds([]);
    },
    [setViewMode]
  );
  /** Quick-action from a requirement's "Linked Diagrams" section - rather
   * than making the person go create a node manually then hunt down the
   * Inspector's requirement linker, this does both steps in one action
   * and jumps straight there. Always creates at ROOT (path: []) rather
   * than whatever `path` happens to currently be - the person calling
   * this is usually looking at Requirements/Timeline, not the diagram, so
   * there's no meaningful "current sub-diagram" to add into; root is the
   * one predictable, always-discoverable place regardless of where they
   * were when they clicked. */
  const onCreateLinkedNode = useCallback((itemId: string, label: string) => {
    const id = diagramStore.addNode([], "typed", { x: 0, y: 0 }, {
      nodeType: "custom",
      label,
      description: "",
      properties: {},
      tags: [],
      linkedRequirementIds: [itemId],
    });
    setViewMode("diagram");
    setPath([]);
    setPendingNodeFocus(id);
  }, [diagramStore, setViewMode]);
  const [isScenarioPanelOpen, setIsScenarioPanelOpen] = useState(false);
  const [isLibraryModalOpen, setIsLibraryModalOpen] = useState(false);
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [isPaletteCollapsed, setIsPaletteCollapsed] = useState(false);
  const [isInspectorCollapsed, setIsInspectorCollapsed] = useState(false);

  const onConnect = useCallback<(connection: Connection) => void>(
    (connection) => {
      diagramStore.addEdge(
        path,
        connection.source,
        connection.target,
        { edgeType: "blank-solid", label: "", direction: "forward", properties: {} },
        connection.sourceHandle,
        connection.targetHandle
      );
    },
    [diagramStore, path]
  );

  const onAddNode = useCallback(
    (typeId: string, position: { x: number; y: number }) => {
      const def = NODE_TYPES.find((n) => n.id === typeId);
      if (!def) return;
      diagramStore.addNode(path, "typed", position, {
        nodeType: typeId,
        label: def.label,
        description: "",
        properties: { ...(def.defaultProperties ?? {}) },
        tags: [],
      });
    },
    [diagramStore, path]
  );

  const onAddGroup = useCallback(
    (typeId: string, position: { x: number; y: number }) => {
      const def = GROUP_TYPES.find((g) => g.id === typeId);
      if (!def) return;
      const id = diagramStore.addNode(path, "group", position, {
        nodeType: typeId,
        label: def.label,
        description: "",
        properties: {},
        tags: [],
      });
      diagramStore.updateDimensions(id, 320, 220);
    },
    [diagramStore, path]
  );

  const onAddText = useCallback(
    (position: { x: number; y: number }): string => {
      return diagramStore.addNode(path, "text", position, {
        nodeType: "text",
        label: "",
        description: "",
        properties: {},
        tags: [],
        textColor: "#e7e9ee",
        fontSize: 16,
      });
    },
    [diagramStore, path]
  );

  const onAddShape = useCallback(
    (typeId: string, position: { x: number; y: number }) => {
      const fullDef = globalShapeRegistry.getShape(typeId);
      const def = fullDef
        ? {
            id: fullDef.id,
            defaultWidth: fullDef.defaults.width,
            defaultHeight: fullDef.defaults.height,
            color: fullDef.defaults.color,
            label: fullDef.defaults.label ?? "",
          }
        : SHAPE_TYPES.find((s) => s.id === typeId);
      if (!def) return;
      const id = diagramStore.addNode(path, "shape", position, {
        nodeType: typeId,
        label: (def as { label?: string }).label ?? "",
        description: "",
        properties: {},
        tags: [],
        color: (def as { color?: string }).color,
      });
      diagramStore.updateDimensions(id, def.defaultWidth, def.defaultHeight);
    },
    [diagramStore, path]
  );

  const onAddCode = useCallback(
    (position: { x: number; y: number }): string => {
      const id = diagramStore.addNode(path, "code", position, {
        nodeType: "code",
        label: "",
        description: "",
        properties: {},
        tags: [],
        codeContent: "",
        codeLanguage: "json",
      });
      diagramStore.updateDimensions(id, 320, 220);
      return id;
    },
    [diagramStore, path]
  );

  // Called after dragging a regular node - see Canvas.tsx's onNodeDragStop.
  // newParentId is the group it now overlaps, or null if it's no longer over
  // any group. Converts position to/from parent-relative coordinates so the
  // node visually stays where the user dropped it.
  const onReparentNode = useCallback(
    (nodeId: string, newParentId: string | null) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const currentParentId = node.parentId ?? null;
      if (currentParentId === newParentId) return;

      const absolute = toAbsolutePosition(node, nodes, node.parentId);
      const newParent = newParentId ? nodes.find((n) => n.id === newParentId) : undefined;
      const nextPosition = newParent
        ? { x: absolute.x - newParent.position.x, y: absolute.y - newParent.position.y }
        : absolute;

      // Dropped at the end of a gesture whose commit is still pending: apply
      // it inside that commit, after the positions, so this node is written
      // once and its position is the one relative to its new parent.
      if (commitScheduled.current) {
        pendingReparents.current.set(nodeId, newParentId ?? undefined);
        return;
      }
      diagramStore.updateParentId(nodeId, newParentId ?? undefined, nextPosition);
    },
    [nodes, diagramStore]
  );

  // Called after dragging or resizing a *boundary* - see Canvas.tsx's onNodeDragStop
  // and GroupNode.tsx's onResizeEnd.
  // `nodeIds` are whichever nodes now fall fully inside it and aren't
  // already its children. Any node already parented to a different group
  // gets moved over (its position is re-derived relative to the new parent,
  // same math as onReparentNode).
  const onAdoptIntoGroup = useCallback(
    (groupId: string, nodeIds: string[], groupPosition?: { x: number; y: number }) => {
      // Read at call time, not captured: this callback travels through
      // CanvasContext, so depending on `nodes` gave it a new identity on every
      // change, and every node and edge component re-rendered with it (WS1-R8).
      const current = nodesRef.current;
      const group = current.find((n) => n.id === groupId);
      if (!group) return;
      const groupPos = groupPosition ?? group.position;
      for (const nodeId of nodeIds) {
        if (nodeId === groupId) continue;
        const n = current.find((nn) => nn.id === nodeId);
        if (!n) continue;
        const absolute = toAbsolutePosition(n, current, n.parentId);
        const relative = { x: absolute.x - groupPos.x, y: absolute.y - groupPos.y };
        diagramStore.updateParentId(nodeId, groupId, relative);
      }
    },
    [diagramStore]
  );

  const onUpdateNode = useCallback(
    (id: string, patch: Partial<ArchNodeData>) => {
      diagramStoreRef.current.updateNode(id, patch);
    },
    []
  );

  /**
   * Applies a z-order command to the current selection.
   *
   * Lives here rather than in the Inspector because reordering is
   * inherently relative - working out what "in front" means needs every
   * node's geometry, and the Inspector only ever sees the one that's
   * selected.
   *
   * The width/height fallback matches Canvas's own: a content-sized node
   * carries no explicit width, only a measured one, and reading n.width
   * alone would score all of them as zero-area.
   */
  const onZOrderCommand = useCallback(
    (command: ZOrderCommand, targetIds?: string[]) => {
      // Defaults to the selection for the Inspector's buttons; the
      // context menu passes targets explicitly, since right-clicking an
      // unselected node should act on THAT node.
      const ids = targetIds ?? selectedNodeIds;
      const boxes = nodes.map((n) => ({
        id: n.id,
        x: n.position.x,
        y: n.position.y,
        width: n.width ?? n.measured?.width ?? 0,
        height: n.height ?? n.measured?.height ?? 0,
        zIndex: n.data.zIndex,
      }));
      // An empty result means the command wouldn't change anything -
      // skip the store write rather than syncing a no-op to every peer.
      for (const patch of applyZOrderCommand(boxes, ids, command)) {
        diagramStoreRef.current.updateNode(patch.id, { zIndex: patch.zIndex });
      }
    },
    [nodes, selectedNodeIds]
  );

  const onUpdateEdge = useCallback(
    (id: string, patch: ArchEdgeDataPatch) => {
      diagramStoreRef.current.updateEdge(id, patch);
    },
    []
  );

  /**
   * Edge manipulation - moving an edge's ends onto different nodes, and
   * bending its route with waypoints.
   *
   * All five go through diagramStoreRef rather than `diagramStore`
   * directly, for the same reason onUpdateNode/onUpdateEdge already do:
   * they're called from event handlers (some of them on every frame of a
   * drag), and the ref is what decides whether the write lands in local
   * state or the session's shared document without every one of these
   * needing to be rebuilt when a session starts or ends.
   *
   * Each one is a distinct named store operation rather than a patch of
   * the edge's data. Endpoints can't be expressed as a data patch at all
   * - they're top-level React Flow Edge fields - and waypoints must not
   * be, because replacing the whole list is exactly what stops
   * concurrent edits to it from merging. See DiagramStore for the full
   * reasoning.
   */
  const onReconnectEdge = useCallback((edgeId: string, endpoints: EdgeEndpoints) => {
    diagramStoreRef.current.reconnectEdge(edgeId, endpoints);
  }, []);

  /**
   * Bend drags are gestures (WS4-R1): adding and moving record into the edge's
   * in-flight gesture, shown once per frame and broadcast to peers, and
   * onEndEdgeGesture writes the result once (WS4-R2).
   */
  const edgeFlushHandle = useRef<number | null>(null);
  const publishEdgeGestures = useCallback(() => {
    edgeFlushHandle.current = null;
    const snapshot = new Map(edgeGesturesRef.current);
    setEdgeInFlight(snapshot.size ? snapshot : NO_EDGE_GESTURES);
    const edges: Record<string, EdgeWaypoint[]> = {};
    for (const [edgeId, gesture] of snapshot) {
      const stored = diagramStoreRef.current.getSnapshot().edges.find((e) => e.id === edgeId)?.data?.waypoints;
      edges[edgeId] = applyEdgeGesture(stored, gesture);
    }
    broadcastPresence({ edgeGesture: snapshot.size ? { path: path.join("/"), edges } : null });
  }, [broadcastPresence, path]);
  const scheduleEdgePublish = useCallback(() => {
    if (edgeFlushHandle.current === null) edgeFlushHandle.current = requestAnimationFrame(publishEdgeGestures);
  }, [publishEdgeGestures]);

  const onAddEdgeWaypoint = useCallback((edgeId: string, index: number, waypoint: EdgeWaypoint) => {
    const current = edgeGesturesRef.current.get(edgeId);
    edgeGesturesRef.current.set(edgeId, {
      created: { index, waypoint },
      moved: current?.moved ?? new Map(),
    });
    scheduleEdgePublish();
  }, [scheduleEdgePublish]);

  const onMoveEdgeWaypoint = useCallback(
    (edgeId: string, waypointId: string, position: { x: number; y: number }) => {
      const current = edgeGesturesRef.current.get(edgeId);
      const moved = new Map(current?.moved ?? []);
      moved.set(waypointId, position);
      edgeGesturesRef.current.set(edgeId, { created: current?.created, moved });
      scheduleEdgePublish();
    },
    [scheduleEdgePublish]
  );

  const onEndEdgeGesture = useCallback(
    (edgeId: string) => {
      const gesture = edgeGesturesRef.current.get(edgeId);
      if (!gesture) return;
      edgeGesturesRef.current.delete(edgeId);
      if (edgeFlushHandle.current !== null) {
        cancelAnimationFrame(edgeFlushHandle.current);
        edgeFlushHandle.current = null;
      }
      const { add, moves } = edgeGestureWrites(gesture);
      // One transaction under the undo origin: one sync update, one undo step.
      undo.transact(() => {
        if (add) diagramStore.addEdgeWaypoint(edgeId, add.index, add.waypoint);
        for (const m of moves) diagramStore.moveEdgeWaypoint(edgeId, m.id, { x: m.x, y: m.y });
      });
      // Cleared in the same batch as the store notification: no frame shows
      // the bend back where it started.
      publishEdgeGestures();
    },
    [undo, diagramStore, publishEdgeGestures]
  );

  const onRemoveEdgeWaypoint = useCallback((edgeId: string, waypointId: string) => {
    diagramStoreRef.current.removeEdgeWaypoint(edgeId, waypointId);
  }, []);

  const onClearEdgeWaypoints = useCallback((edgeId: string) => {
    diagramStoreRef.current.clearEdgeWaypoints(edgeId);
  }, []);

  // Deleting a node also drops any edges attached to it. Deleting a group
  // releases the nodes inside it (converted back to absolute position)
  // rather than deleting them - see the hint text in Inspector.tsx. Deleting
  // a node that has a populated sub-diagram asks for confirmation first,
  // since that would take everything nested inside it along with it.
  const onDeleteNode = useCallback(
    (id: string) => {
      const target = nodes.find((n) => n.id === id);
      if (!target) return;
      const nestedCount = getNodesAtPath(diagramStore.getSnapshot().nodes, [...path, id]).length;
      if (nestedCount > 0) {
        const ok = window.confirm(
          `"${target.data.label}" contains a sub-diagram with ${nestedCount} node${nestedCount === 1 ? "" : "s"} inside. Delete it and everything inside?`
        );
        if (!ok) return;
      }
      // Release any group children BEFORE deleting - deleteNode's own
      // cascade only removes DESCENDANTS at deeper tree levels; group
      // children (same-level, parentId containment) are a different,
      // unrelated concept that deliberately stays the UI's job (see
      // diagramStore.ts's own doc comment on deleteNode).
      for (const child of nodes) {
        if (child.parentId !== id) continue;
        const absolute = toAbsolutePosition(child, nodes, id);
        diagramStore.updateParentId(child.id, undefined, absolute);
      }
      diagramStore.deleteNode(id);
      setSelectedNodeIds((cur) => cur.filter((n) => n !== id));
    },
    [nodes, path, diagramStore]
  );

  const onDeleteEdge = useCallback(
    (id: string) => {
      diagramStore.deleteEdge(id);
      setSelectedEdgeIds((cur) => cur.filter((e) => e !== id));
    },
    [diagramStore]
  );

  const onDeleteSelection = useCallback(() => {
    selectedEdgeIds.forEach(onDeleteEdge);
    selectedNodeIds.forEach(onDeleteNode);
  }, [selectedNodeIds, selectedEdgeIds, onDeleteNode, onDeleteEdge]);

  // --- Copy / paste --------------------------------------------------------

  // Clipboard lives in app state (not the OS clipboard) - simpler, and
  // avoids the Clipboard API's permission prompts for something that only
  // needs to work within this tab. Deliberately NOT cleared on navigation:
  // copying something at one diagram level and pasting it after drilling
  // into another is a reasonable, useful thing to do, given everything here
  // is one tree.
  //
  // relativePath on each clipboard item is relative to the COPY
  // operation's own root, not the diagram's global path - [] for a
  // top-level copied item, [oldNodeId] for something one level inside a
  // copied node's own sub-diagram, and so on. This is what lets copying
  // a node with a populated sub-diagram bring its nested content along:
  // the flattened nodes/edges this component reads only ever cover the
  // CURRENTLY VIEWED level, so a copied node's own nested descendants
  // (which live at deeper parentPath values in the global flat space,
  // not in the node's own data field the way the old recursive-tree
  // model kept them) have to be gathered explicitly, one level at a
  // time, from the store's full snapshot.
  const [clipboard, setClipboard] = useState<{
    nodes: (Node<ArchNodeData> & { relativePath: string[] })[];
    edges: (Edge<ArchEdgeData> & { relativePath: string[] })[];
  } | null>(null);
  // Each consecutive paste (without re-copying) offsets a bit further, so
  // repeated pastes cascade diagonally instead of stacking exactly on top
  // of each other.
  const [pasteOffset, setPasteOffset] = useState(0);

  const onCopy = useCallback(() => {
    if (selectedNodeIds.length === 0) return;
    const selectedSet = new Set(selectedNodeIds);
    // Copying a boundary brings its contents along, even if they weren't
    // individually selected - an empty duplicated boundary would feel broken.
    const groupIds = new Set(nodes.filter((n) => selectedSet.has(n.id) && n.type === "group").map((n) => n.id));
    const childNodes = nodes.filter((n) => n.parentId && groupIds.has(n.parentId) && !selectedSet.has(n.id));
    const toCopy = [...nodes.filter((n) => selectedSet.has(n.id)), ...childNodes];
    const copiedIds = new Set(toCopy.map((n) => n.id));

    // A node whose parent ISN'T also being copied (e.g. copying one child
    // without its boundary) becomes a root item in the clipboard - convert
    // its position to absolute first, since relative-to-parent coordinates
    // are meaningless without that parent coming along.
    const normalized = toCopy.map((n) => {
      if (n.parentId && !copiedIds.has(n.parentId)) {
        const absolute = toAbsolutePosition(n, nodes, n.parentId);
        return { ...n, parentId: undefined, position: absolute };
      }
      return n;
    });

    const topLevelEdges = edges.filter((e) => copiedIds.has(e.source) && copiedIds.has(e.target));

    const { nodes: allNodes, edges: allEdges } = diagramStore.getSnapshot();
    function gatherDescendants(
      nodeId: string,
      relativePath: string[]
    ): { nodes: (Node<ArchNodeData> & { relativePath: string[] })[]; edges: (Edge<ArchEdgeData> & { relativePath: string[] })[] } {
      const childPath = [...relativePath, nodeId];
      const levelNodes = getNodesAtPath(allNodes, [...path, ...childPath]);
      const levelEdges = getEdgesAtPath(allEdges, [...path, ...childPath]);
      let result = {
        nodes: levelNodes.map((n) => ({ ...n, relativePath: childPath })),
        edges: levelEdges.map((e) => ({ ...e, relativePath: childPath })),
      };
      for (const child of levelNodes) {
        const deeper = gatherDescendants(child.id, childPath);
        result = { nodes: [...result.nodes, ...deeper.nodes], edges: [...result.edges, ...deeper.edges] };
      }
      return result;
    }

    let descendantNodes: (Node<ArchNodeData> & { relativePath: string[] })[] = [];
    let descendantEdges: (Edge<ArchEdgeData> & { relativePath: string[] })[] = [];
    for (const n of normalized) {
      const gathered = gatherDescendants(n.id, []);
      descendantNodes = [...descendantNodes, ...gathered.nodes];
      descendantEdges = [...descendantEdges, ...gathered.edges];
    }

    setClipboard({
      nodes: [...normalized.map((n) => ({ ...n, relativePath: [] })), ...descendantNodes],
      edges: [...topLevelEdges.map((e) => ({ ...e, relativePath: [] })), ...descendantEdges],
    });
    setPasteOffset(0);
  }, [nodes, edges, selectedNodeIds, diagramStore, path]);

  const onPaste = useCallback(() => {
    if (!clipboard || clipboard.nodes.length === 0) return;
    const offset = 40 + pasteOffset;

    // A node depends on its relativePath ancestors (tree-level nesting)
    // AND its parentId (group containment - a SAME-level dependency, one
    // a depth-only sort can't correctly order: a group's own child could
    // otherwise get processed before the group itself, if it happened to
    // come first in the underlying storage order) both having their new
    // ids assigned first. Repeatedly processing whatever's ready handles
    // both kinds of dependency, and any depth, without needing a full
    // topological sort. Always terminates: every parentId that survives
    // into the clipboard is guaranteed to also be IN the clipboard -
    // onCopy strips parentId whenever the parent isn't also being
    // copied, and gatherDescendants always copies an entire nested level
    // wholesale, so a node's own group (if any) at that level is never
    // left out.
    const remaining = [...clipboard.nodes];
    const idMap = new Map<string, string>();
    const remapPath = (relativePath: string[]) => relativePath.map((oldId) => idMap.get(oldId) ?? oldId);

    const rootPastedIds: string[] = [];
    while (remaining.length > 0) {
      const readyIndex = remaining.findIndex(
        (n) => n.relativePath.every((ancestorId) => idMap.has(ancestorId)) && (!n.parentId || idMap.has(n.parentId))
      );
      if (readyIndex === -1) break; // shouldn't happen - see comment above - but never hang if it somehow does
      const [n] = remaining.splice(readyIndex, 1);

      const isTopLevel = n.relativePath.length === 0;
      const shouldOffset = isTopLevel && !n.parentId;
      const position = shouldOffset ? { x: n.position.x + offset, y: n.position.y + offset } : n.position;
      const newParentId = n.parentId ? idMap.get(n.parentId) : undefined;
      const newId = diagramStore.addNode([...path, ...remapPath(n.relativePath)], n.type ?? "typed", position, n.data);
      idMap.set(n.id, newId);
      if (newParentId !== undefined) diagramStore.updateParentId(newId, newParentId, position);
      if (n.width !== undefined || n.height !== undefined) diagramStore.updateDimensions(newId, n.width, n.height);
      if (isTopLevel) rootPastedIds.push(newId);
    }

    const newEdgeIds: string[] = [];
    for (const e of clipboard.edges) {
      const newSource = idMap.get(e.source);
      const newTarget = idMap.get(e.target);
      if (!newSource || !newTarget) continue; // shouldn't happen - every edge's endpoints were copied along with it
      const newEdgeId = diagramStore.addEdge(
        [...path, ...remapPath(e.relativePath)],
        newSource,
        newTarget,
        e.data ?? { edgeType: "blank-solid", label: "", direction: "forward", properties: {} },
        e.sourceHandle,
        e.targetHandle
      );
      newEdgeIds.push(newEdgeId);
    }

    // The pasted result becomes the new selection - matches how paste
    // behaves elsewhere (Figma, PowerPoint, etc.), letting the person
    // immediately nudge/move what they just pasted. Only top-level items
    // are marked selected, matching how a normal click or rubber-band
    // selection already treats a group (the group itself gets selected,
    // not each individual child), relying on React Flow's built-in
    // parent-child dragging to move a selected group's contents together.
    setSelectedNodeIds(rootPastedIds);
    setSelectedEdgeIds(newEdgeIds);
    setPasteOffset((p) => p + 40);
  }, [clipboard, pasteOffset, diagramStore, path]);

  // --- Sub-diagram navigation ---------------------------------------------

  const onDrillInto = useCallback(
    (nodeId: string) => {
      if (isPresenting) return;
      setPath((p) => [...p, nodeId]);
      setSelectedNodeIds([]);
      setSelectedEdgeIds([]);
      setActiveStepId(null);
    },
    [isPresenting]
  );

  const onNavigateToRoot = useCallback(() => {
    setPath([]);
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
    setActiveStepId(null);
  }, []);

  const onNavigateToPathIndex = useCallback((index: number) => {
    setPath((p) => p.slice(0, index + 1));
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
    setActiveStepId(null);
  }, []);

  // --- Scenarios (can now span multiple diagram levels - see path below) --

  const onCreateScenario = useCallback(() => {
    const id = nextId("scenario");
    setScenarios((s) => [...s, { id, title: `Scenario ${s.length + 1}`, steps: [] }]);
    setActiveScenarioId(id);
  }, [setScenarios]);

  const onRenameScenario = useCallback(
    (id: string, newTitle: string) => {
      setScenarios((s) => s.map((sc) => (sc.id === id ? { ...sc, title: newTitle } : sc)));
    },
    [setScenarios]
  );

  const onDeleteScenario = useCallback(
    (id: string) => {
      setScenarios((s) => s.filter((sc) => sc.id !== id));
      setActiveScenarioId((cur) => (cur === id ? null : cur));
    },
    [setScenarios]
  );

  const onSelectScenario = useCallback((id: string) => {
    setActiveScenarioId(id);
    setActiveStepId(null);
  }, []);

  // Falls back to the first scenario when nothing's been explicitly picked
  // yet (e.g. right after loading a file, or before ever touching the
  // dropdown) - this MUST match whatever ScenarioPanel displays, or the
  // preview toggle silently does nothing while the panel looks fine. See
  // the activeScenarioId prop passed to ScenarioPanel below - it receives
  // this already-resolved id rather than the raw state, so there's only one
  // place deciding the fallback.
  const activeScenario = useMemo(
    () => scenarios.find((s) => s.id === activeScenarioId) ?? scenarios[0] ?? null,
    [scenarios, activeScenarioId]
  );

  // Selecting a step in the list makes it both the editor's subject AND the
  // canvas preview target at once - clicking the same one again deselects,
  // which is how you get back to seeing the undimmed diagram without
  // closing the panel. When previewing a step that resides on a subdiagram,
  // automatically navigate there just like during presentation.
  const onSelectStep = useCallback(
    (stepId: string) => {
      const isDeselecting = activeStepId === stepId;
      const nextId = isDeselecting ? null : stepId;
      setActiveStepId(nextId);
      if (!isDeselecting) {
        const step = activeScenario?.steps.find((st) => st.id === stepId);
        if (step && step.path) {
          setPath(step.path);
        }
      }
    },
    [activeScenario, activeStepId, setPath]
  );

  // Captures whatever's currently selected on the canvas - AND which level
  // of the tree you're currently drilled into - as a new step. That's what
  // lets a single scenario walk through several nested diagrams: advancing
  // through steps with different `path`s auto-navigates between them (see
  // the presentation-path-sync effect below). The new step becomes active
  // immediately, so you can start writing its narration without a second click.
  const onAddStep = useCallback(
    (scenarioId: string) => {
      if (selectedNodeIds.length === 0 && selectedEdgeIds.length === 0) return;
      const newStepId = nextId("step");
      setScenarios((s) =>
        s.map((sc) => {
          if (sc.id !== scenarioId) return sc;
          const step: ScenarioStep = {
            id: newStepId,
            title: `Step ${sc.steps.length + 1}`,
            narration: "",
            path: [...path],
            focusNodeIds: [...selectedNodeIds],
            focusEdgeIds: [...selectedEdgeIds],
          };
          return { ...sc, steps: [...sc.steps, step] };
        })
      );
      setActiveStepId(newStepId);
    },
    [selectedNodeIds, selectedEdgeIds, path, setScenarios]
  );

  // Adds/removes the current canvas selection to/from an EXISTING step's
  // focus set, rather than requiring you to delete and recreate the whole
  // step to change what it highlights. Both are unions/differences against
  // whatever's already there, not a wholesale replace.
  const onAddSelectionToStep = useCallback(
    (scenarioId: string, stepId: string) => {
      if (selectedNodeIds.length === 0 && selectedEdgeIds.length === 0) return;
      setScenarios((s) =>
        s.map((sc) =>
          sc.id !== scenarioId
            ? sc
            : {
                ...sc,
                steps: sc.steps.map((st) =>
                  st.id !== stepId
                    ? st
                    : {
                        ...st,
                        focusNodeIds: Array.from(new Set([...st.focusNodeIds, ...selectedNodeIds])),
                        focusEdgeIds: Array.from(new Set([...st.focusEdgeIds, ...selectedEdgeIds])),
                      }
                ),
              }
        )
      );
    },
    [selectedNodeIds, selectedEdgeIds, setScenarios]
  );

  const onRemoveSelectionFromStep = useCallback(
    (scenarioId: string, stepId: string) => {
      if (selectedNodeIds.length === 0 && selectedEdgeIds.length === 0) return;
      const removeNodes = new Set(selectedNodeIds);
      const removeEdges = new Set(selectedEdgeIds);
      setScenarios((s) =>
        s.map((sc) =>
          sc.id !== scenarioId
            ? sc
            : {
                ...sc,
                steps: sc.steps.map((st) =>
                  st.id !== stepId
                    ? st
                    : {
                        ...st,
                        focusNodeIds: st.focusNodeIds.filter((nid) => !removeNodes.has(nid)),
                        focusEdgeIds: st.focusEdgeIds.filter((eid) => !removeEdges.has(eid)),
                      }
                ),
              }
        )
      );
    },
    [selectedNodeIds, selectedEdgeIds, setScenarios]
  );

  const onUpdateStep = useCallback(
    (scenarioId: string, stepId: string, patch: Partial<ScenarioStep>) => {
      setScenarios((s) =>
        s.map((sc) =>
          sc.id === scenarioId
            ? { ...sc, steps: sc.steps.map((st) => (st.id === stepId ? { ...st, ...patch } : st)) }
            : sc
        )
      );
    },
    [setScenarios]
  );

  const onDeleteStep = useCallback(
    (scenarioId: string, stepId: string) => {
      setScenarios((s) =>
        s.map((sc) => (sc.id === scenarioId ? { ...sc, steps: sc.steps.filter((st) => st.id !== stepId) } : sc))
      );
      setActiveStepId((cur) => (cur === stepId ? null : cur));
    },
    [setScenarios]
  );

  const onMoveStep = useCallback(
    (scenarioId: string, stepId: string, direction: "up" | "down") => {
      setScenarios((s) =>
        s.map((sc) => {
          if (sc.id !== scenarioId) return sc;
          const index = sc.steps.findIndex((st) => st.id === stepId);
          const swapWith = direction === "up" ? index - 1 : index + 1;
          if (index === -1 || swapWith < 0 || swapWith >= sc.steps.length) return sc;
          const steps = [...sc.steps];
          [steps[index], steps[swapWith]] = [steps[swapWith], steps[index]];
          return { ...sc, steps };
        })
      );
    },
    [setScenarios]
  );

  const previewFocus = useMemo(() => {
    if (!activeStepId || !activeScenario) return null;
    const step = activeScenario.steps.find((st) => st.id === activeStepId);
    if (!step) return null;
    return { nodeIds: step.focusNodeIds, edgeIds: step.focusEdgeIds };
  }, [activeStepId, activeScenario]);

  const onStartPresenting = useCallback(
    (scenarioId: string) => {
      const scenario = scenarios.find((s) => s.id === scenarioId);
      if (!scenario || scenario.steps.length === 0) return;
      setActiveScenarioId(scenarioId);
      setActiveStepIndex(0);
      setPath(scenario.steps[0].path);
      setSelectedNodeIds([]);
      setSelectedEdgeIds([]);
      setActiveStepId(null);
      setIsPresenting(true);
    },
    [scenarios]
  );

  const onExitPresenting = useCallback(() => setIsPresenting(false), []);

  // Cross-diagram scenarios: each step carries its own `path`, so advancing
  // sets both the step index AND (when it differs) navigates there directly -
  // right here in the handler that causes the change, rather than reacting
  // to the mismatch after the fact in an effect.
  const onPresentNext = useCallback(() => {
    const steps = activeScenario?.steps ?? [];
    const nextIndex = Math.min(activeStepIndex + 1, Math.max(steps.length - 1, 0));
    const nextStep = steps[nextIndex];
    if (nextStep) setPath(nextStep.path);
    setActiveStepIndex(nextIndex);
  }, [activeScenario, activeStepIndex]);

  const onPresentPrev = useCallback(() => {
    const prevIndex = Math.max(activeStepIndex - 1, 0);
    const steps = activeScenario?.steps ?? [];
    const prevStep = steps[prevIndex];
    if (prevStep) setPath(prevStep.path);
    setActiveStepIndex(prevIndex);
  }, [activeScenario, activeStepIndex]);

  const presentation = useMemo(() => {
    if (!isPresenting || !activeScenario) return null;
    const step = activeScenario.steps[activeStepIndex];
    if (!step) return null;
    return { scenario: activeScenario, step, stepIndex: activeStepIndex };
  }, [isPresenting, activeScenario, activeStepIndex]);

  // Delete key: acts on whatever's currently multi-selected, but never while
  // presenting, and never while typing in a field.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isPresenting) return;
      if (viewMode !== "diagram") return;
      if (event.key !== "Backspace" && event.key !== "Delete") return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      if (selectedNodeIds.length > 0 || selectedEdgeIds.length > 0) {
        onDeleteSelection();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isPresenting, viewMode, selectedNodeIds, selectedEdgeIds, onDeleteSelection]);

  const onUndo = useCallback(() => {
    if (isPresenting) return;
    undo.undo();
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
  }, [isPresenting, undo]);

  const onRedo = useCallback(() => {
    if (isPresenting) return;
    undo.redo();
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
  }, [isPresenting, undo]);

  // Copy/paste: Ctrl+C / Cmd+C and Ctrl+V / Cmd+V, same guards as delete -
  // never while presenting, never while typing in a field (so normal text
  // copy/paste inside the Inspector's inputs is completely unaffected), and
  // never when text is highlighted/selected during copy (so users can copy
  // selected text from requirement items and elsewhere via standard clipboard).
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isPresenting) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;

      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "c") {
        const selection = window.getSelection();
        const hasTextSelection = Boolean(selection && !selection.isCollapsed && selection.toString().length > 0);
        if (hasTextSelection) return;
        if (viewMode !== "diagram") return;
        event.preventDefault();
        onCopy();
      } else if ((event.ctrlKey || event.metaKey) && key === "v") {
        if (viewMode !== "diagram") return;
        event.preventDefault();
        onPaste();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isPresenting, viewMode, onCopy, onPaste]);

  // Undo/redo: Ctrl+Z / Cmd+Z, and BOTH common redo conventions - Ctrl+Y
  // (Windows-style) and Ctrl+Shift+Z (Mac/many web apps) - same guards as
  // copy/paste. Deliberately a separate effect from copy/paste above rather
  // than folded into it, since the redo-key handling (checking shiftKey,
  // supporting two different keys) is its own bit of complexity worth
  // keeping visually separate from the simpler copy/paste block.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isPresenting) return;
      if (viewMode !== "diagram") return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "z" && event.shiftKey) {
        event.preventDefault();
        onRedo();
      } else if (key === "z") {
        event.preventDefault();
        onUndo();
      } else if (key === "y") {
        event.preventDefault();
        onRedo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isPresenting, viewMode, onUndo, onRedo]);

  // Presentation navigation: arrow keys / space / escape.
  useEffect(() => {
    if (!isPresenting) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" || event.key === " ") {
        event.preventDefault();
        onPresentNext();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        onPresentPrev();
      } else if (event.key === "Escape") {
        onExitPresenting();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isPresenting, onPresentNext, onPresentPrev, onExitPresenting]);

  // --- File / diagram lifecycle -------------------------------------------

  /**
   * A new, empty document in this tab (WS2-R3). The current one is already
   * stored and stays in the document list, so nothing is cleared or lost -
   * this used to wipe the only document the app had.
   */
  const onNew = useCallback(() => {
    openDocumentInTab(newDocumentId());
  }, [openDocumentInTab]);

  // Always saves the full tree from the root, regardless of which level
  // you're currently viewing - a save from inside a drilled-down sub-diagram
  // must not lose everything above/beside it.
  /** The document on screen as a DiagramFile - an export boundary. */
  const buildCurrentFile = useCallback(() => {
    const tree = unflattenToSubDiagram(diagramSnapshot.nodes, diagramSnapshot.edges);
    return toDiagramFile(
      title,
      tree.nodes,
      tree.edges,
      scenarios,
      requirementsSnapshot,
      programIncrementsSnapshot,
      teamSnapshot,
      milestonesSnapshot
    );
  }, [title, diagramSnapshot, scenarios, requirementsSnapshot, programIncrementsSnapshot, teamSnapshot, milestonesSnapshot]);

  const onSave = useCallback(() => {
    downloadDiagram(buildCurrentFile());
  }, [buildCurrentFile]);

  /**
   * Timed copies (WS13-R6): opt-in downloads at an interval, only when the
   * document changed since the last one.
   */
  const [timedCopies, setTimedCopiesState] = useState<TimedCopiesSettings>(loadTimedCopies);
  const setTimedCopies = useCallback((next: TimedCopiesSettings) => {
    saveTimedCopies(next);
    setTimedCopiesState(next);
  }, []);
  const buildCurrentFileRef = useRef(buildCurrentFile);
  useLayoutEffect(() => {
    buildCurrentFileRef.current = buildCurrentFile;
  }, [buildCurrentFile]);
  const lastCopied = useRef<string | null>(null);
  useEffect(() => {
    if (!timedCopies.enabled) return;
    let intervalMs = timedCopies.minutes * 60_000;
    if (isPerfInstrumentationActive()) {
      // Instrumented builds only, so the browser suite need not wait minutes.
      const seconds = Number(localStorage.getItem(TIMED_COPIES_TEST_SECONDS_KEY));
      if (seconds > 0) intervalMs = seconds * 1000;
    }
    const timer = setInterval(() => {
      const file = buildCurrentFileRef.current();
      // metadata.updatedAt changes on every build; the content is what counts.
      const content = JSON.stringify({ ...file, metadata: undefined });
      if (!isCopyDue(content, lastCopied.current)) return;
      lastCopied.current = content;
      downloadDiagramAs(file, timedCopyFileName(file.title, new Date()));
    }, intervalMs);
    return () => clearInterval(timer);
  }, [timedCopies]);

  const onChooseFile = useCallback(() => {
    const safeName = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    void fileSaving.attach(`${safeName || "diagram"}.json`);
  }, [title, fileSaving]);

  /** WS13-R4: the file changed elsewhere. Overwrite it with what is on screen. */
  const onOverwriteFile = useCallback(() => {
    void fileSaving.overwrite(JSON.stringify(buildCurrentFile(), null, 2));
  }, [fileSaving, buildCurrentFile]);

  /** WS13-R4: the file changed elsewhere. Load its version instead - a
   * whole-document replacement, so undo history is cleared (WS3-R4). */
  const onReloadFromFile = useCallback(async () => {
    const text = await fileSaving.reloadExternal();
    if (text === null) {
      showToast("Could not read the file", "error");
      return;
    }
    try {
      const parsed = parseDiagramFile(text);
      replaceDocumentContents(openDoc.doc, snapshotToDiagramFile(diagramFileToSnapshot(parsed)));
      undo.clear();
      showToast("Reloaded from file");
    } catch (err) {
      showToast("The file could not be loaded", "error", (err as Error).message);
    }
  }, [fileSaving, openDoc, undo, showToast]);

  /**
   * WS13-R11: leaving when nobody else here holds a saved copy needs an
   * explicit confirmation that says what that means.
   */
  const [isLeaveGuardOpen, setIsLeaveGuardOpen] = useState(false);
  const requestLeave = useCallback(() => {
    if (isSoleReplicaHolder(durabilitySignals)) setIsLeaveGuardOpen(true);
    else leaveSession();
  }, [durabilitySignals, leaveSession]);

  // Exports export the CURRENT view (whatever level you're looking at),
  // unlike Save - drilling into a node and exporting just that sub-diagram
  // as its own image is a reasonable, likely common thing to want.
  const onExportPng = useCallback(() => {
    exportDiagramAsPng(nodes, title).catch((err) => window.alert((err as Error).message));
  }, [nodes, title]);

  const onExportSvg = useCallback(() => {
    exportDiagramAsSvg(nodes, title).catch((err) => window.alert((err as Error).message));
  }, [nodes, title]);

  const onExportRequirementsMarkdown = useCallback(() => {
    downloadRequirementsMarkdown(title, requirementsSnapshot);
  }, [title, requirementsSnapshot]);

  const onLoadClick = useCallback(() => fileInputRef.current?.click(), []);

  const onFileSelected = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = parseDiagramFile(text);
        // Into the document, not into React state: the canvas reads the
        // document, so writing state here would leave the old diagram on
        // screen with no error to explain it.
        // Normalised through the snapshot so a file gets the same upgrades as a
        // restored autosave (built-in requirement types, scenario step paths).
        replaceDocumentContents(activeDoc, snapshotToDiagramFile(diagramFileToSnapshot(parsed)));
        // Undo must not reach back across a file load (WS3-R4).
        undo.clear();
        setPath([]);
        setActiveScenarioId(null);
        setActiveStepIndex(0);
        setIsPresenting(false);
      } catch (err) {
        window.alert(`Couldn't open that file: ${(err as Error).message}`);
      }
    },
    [activeDoc, undo]
  );

  const selectedNodeId = selectedNodeIds[0] ?? null;
  const selectedEdgeId = selectedEdgeIds[0] ?? null;
  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedEdge = edges.find((e) => e.id === selectedEdgeId) ?? null;
  const canAddStep = selectedNodeIds.length > 0 || selectedEdgeIds.length > 0;
  const onCanvasProfilerRender: ProfilerOnRenderCallback = useCallback(
    (_id, _phase, actualDuration) => {
      recordCommit(actualDuration);
    },
    []
  );

  const canvasElement = (
    <Canvas
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      peers={
        !activeSession
          ? []
          : presencePeers.map((p) => {
              const onSamePath = p.diagramPath === path.join("/");
              const shouldShowCursor = showPeerCursors && onSamePath;
              return p.cursor === null || shouldShowCursor ? p : { ...p, cursor: null };
            })
      }
      onCursorMove={onCursorMove}
      onConnect={onConnect}
      onAddNode={onAddNode}
      onAddGroup={onAddGroup}
      onAddText={onAddText}
      onAddShape={onAddShape}
      onAddCode={onAddCode}
      onUpdateNode={onUpdateNode}
      onUpdateEdge={onUpdateEdge}
      onReconnectEdge={onReconnectEdge}
      onAddEdgeWaypoint={onAddEdgeWaypoint}
      onMoveEdgeWaypoint={onMoveEdgeWaypoint}
      onEndEdgeGesture={onEndEdgeGesture}
      onRemoveEdgeWaypoint={onRemoveEdgeWaypoint}
      onReparentNode={onReparentNode}
      onAdoptIntoGroup={onAdoptIntoGroup}
      onZOrderCommand={onZOrderCommand}
      presentation={presentation}
      previewFocus={previewFocus}
      focusNodeId={pendingNodeFocus}
      onFocusHandled={onFocusNodeHandled}
      onPresentNext={onPresentNext}
      onPresentPrev={onPresentPrev}
      onExitPresenting={onExitPresenting}
      breadcrumbLabels={breadcrumbLabels}
      onDrillInto={onDrillInto}
      onNavigateToRoot={onNavigateToRoot}
      onNavigateToPathIndex={onNavigateToPathIndex}
      isSelectMode={isSelectMode}
      onToggleSelectMode={() => setIsSelectMode((v) => !v)}
    />
  );

  return (
    <div className="app">
      {appVersion && (
          <div className="app-version">{appVersion}</div>
      )}
      {!isPresenting && (
        <Toolbar
          title={title}
          onTitleChange={setTitle}
          onNew={onNew}
          onOpenDocuments={() => setIsDocumentManagerOpen(true)}
          onSave={onSave}
          onLoadClick={onLoadClick}
          isScenarioPanelOpen={isScenarioPanelOpen}
          onToggleScenarioPanel={() => setIsScenarioPanelOpen((v) => !v)}
          onExportPng={onExportPng}
          onExportSvg={onExportSvg}
          canExport={nodes.length > 0}
          onUndo={onUndo}
          onRedo={onRedo}
          canUndo={canUndo}
          canRedo={canRedo}
          viewMode={viewMode}
          onSetViewMode={setViewMode}
          onExportRequirementsMarkdown={onExportRequirementsMarkdown}
          canExportRequirements={requirementsSnapshot.items.length > 0}
          onManageLibraries={() => setIsLibraryModalOpen(true)}
          hasAutosaved={hasAutosaved}
          durabilityIndicator={
            <DurabilityIndicator
              signals={durabilitySignals}
              onExport={onSave}
              onChooseFile={onChooseFile}
              onResumeFile={() => void fileSaving.resume()}
              onReloadFromFile={() => void onReloadFromFile()}
              onOverwriteFile={onOverwriteFile}
              onStopFile={fileSaving.fileName && !activeSession?.ownsDocument ? () => void fileSaving.detach() : undefined}
              fileName={activeSession?.ownsDocument ? null : fileSaving.fileName}
            />
          }
          isInSession={!!activeSession}
          collabPanel={
            <CollabPanel
              signalingConfigured={signalingUrls.length > 0}
              signalingUrlsInput={signalingUrlsInput}
              onSignalingUrlsInputChange={setSignalingUrlsInput}
              buildTimeSignalingDefault={buildTimeSignalingDefault}
              iceServersInput={iceServersInput}
              onIceServersInputChange={setIceServersInput}
              buildTimeIceServersDefault={buildTimeIceServersDefault}
              activeSession={
                activeSession
                  ? {
                      roomName: activeSession.roomName,
                      password: activeSession.password,
                      isSynced: () => activeSession.session.isSynced(),
                      relayConnected,
                      peers: presencePeers,
                    }
                  : null
              }
              displayName={displayName}
              onDisplayNameChange={onDisplayNameChange}
              showPeerCursors={showPeerCursors}
              onShowPeerCursorsChange={setShowPeerCursors}
              onStartSession={startNewSession}
              resumableRoom={resumableSession?.room ?? null}
              onResumeSession={
                resumableSession ? () => startNewSession(resumableSession.key, resumableSession.room) : undefined
              }
              onJoinSession={joinSession}
              onLeaveSession={requestLeave}
              onCopyLink={() => showToast("Session link copied to clipboard")}
            />
          }
        />
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        style={{ display: "none" }}
        onChange={onFileSelected}
      />
      <div className="app__body">
        {viewMode === "diagram" && (
          <>
        {!isPresenting && !isScenarioPanelOpen && (
          <div className={`app__sidebar-wrap app__sidebar-wrap--left${isPaletteCollapsed ? " is-collapsed" : ""}`}>
            {!isPaletteCollapsed && <Palette />}
            <button
              type="button"
              className="app__sidebar-toggle app__sidebar-toggle--left"
              onClick={() => setIsPaletteCollapsed((v) => !v)}
              title={isPaletteCollapsed ? "Show component palette" : "Hide component palette"}
              aria-label={isPaletteCollapsed ? "Show component palette" : "Hide component palette"}
            >
              {isPaletteCollapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
            </button>
          </div>
        )}
        <div className="app__canvas-column">
          <ReactFlowProvider>
            {isPerfInstrumentationActive() ? (
              <Profiler id="CanvasProfiler" onRender={onCanvasProfilerRender}>
                {canvasElement}
              </Profiler>
            ) : (
              canvasElement
            )}
          </ReactFlowProvider>
        </div>
        {!isPresenting && (
          <div
            className={`app__sidebar-wrap app__sidebar-wrap--right${
              !isScenarioPanelOpen && isInspectorCollapsed ? " is-collapsed" : ""
            }`}
          >
            {isScenarioPanelOpen ? (
              <ScenarioPanel
                scenarios={scenarios}
                activeScenarioId={activeScenario?.id ?? null}
                onSelectScenario={onSelectScenario}
                onCreateScenario={onCreateScenario}
                onRenameScenario={onRenameScenario}
                onDeleteScenario={onDeleteScenario}
                onAddStep={onAddStep}
                onAddSelectionToStep={onAddSelectionToStep}
                onRemoveSelectionFromStep={onRemoveSelectionFromStep}
                onUpdateStep={onUpdateStep}
                onDeleteStep={onDeleteStep}
                onMoveStep={onMoveStep}
                onPresent={onStartPresenting}
                canAddStep={canAddStep}
                activeStepId={activeStepId}
                onSelectStep={onSelectStep}
                diagramNodes={diagramSnapshot.nodes}
                currentPath={path}
                onClose={() => {
                  setIsScenarioPanelOpen(false);
                  setActiveStepId(null);
                }}
              />
            ) : (
              <>
                <button
                  type="button"
                  className="app__sidebar-toggle app__sidebar-toggle--right"
                  onClick={() => setIsInspectorCollapsed((v) => !v)}
                  title={isInspectorCollapsed ? "Show inspector" : "Hide inspector"}
                  aria-label={isInspectorCollapsed ? "Show inspector" : "Hide inspector"}
                >
                  {isInspectorCollapsed ? <ChevronLeft size={13} /> : <ChevronRight size={13} />}
                </button>
                {!isInspectorCollapsed && (
                  <Inspector
                    selectedNode={selectedNode}
                    selectedEdge={selectedEdge}
                    onUpdateNode={onUpdateNode}
                    onUpdateEdge={onUpdateEdge}
                    onClearEdgeWaypoints={onClearEdgeWaypoints}
                    onRemoveEdgeWaypoint={onRemoveEdgeWaypoint}
                    onDeleteNode={onDeleteNode}
                    onDeleteEdge={onDeleteEdge}
                    onDrillInto={onDrillInto}
                    requirements={requirementsSnapshot}
                    onNavigateToRequirement={onNavigateToRequirement}
                    onZOrderCommand={onZOrderCommand}
                  />
                )}
              </>
            )}
          </div>
        )}
          </>
        )}
        {viewMode === "requirements" && (
          <RequirementsView
            requirementsStore={requirementsStore}
            programIncrements={programIncrementsSnapshot}
            team={teamSnapshot}
            diagramRoot={diagramTree}
            onNavigateToNode={onNavigateToNode}
            onCreateLinkedNode={onCreateLinkedNode}
            focusItemId={pendingRequirementFocus}
            onFocusHandled={onFocusRequirementHandled}
            peers={activeSession ? presencePeers.filter((p) => p.viewMode === "requirements") : []}
            onFocusedItemChange={setFocusedItemId}
          />
        )}
        {viewMode === "timeline" && (
          <TimelineView
            programIncrementsStore={programIncrementsStore}
            requirementsStore={requirementsStore}
            milestonesStore={milestonesStore}
            team={teamSnapshot}
            diagramRoot={diagramTree}
            onNavigateToNode={onNavigateToNode}
            onCreateLinkedNode={onCreateLinkedNode}
            onNavigateToRequirement={onNavigateToRequirement}
            peers={activeSession ? presencePeers.filter((p) => p.viewMode === "timeline") : []}
            onFocusedItemChange={setFocusedItemId}
          />
        )}
        {viewMode === "team" && (
          <TeamView
            teamStore={teamStore}
            programIncrementsStore={programIncrementsStore}
            requirements={requirementsSnapshot}
          />
        )}
        {viewMode === "skill-tree" && (
          <SkillTreeView
            requirementsStore={requirementsStore}
            programIncrements={programIncrementsSnapshot}
            team={teamSnapshot}
            diagramRoot={diagramTree}
            onNavigateToNode={onNavigateToNode}
            onCreateLinkedNode={onCreateLinkedNode}
            onNavigateToRequirement={onNavigateToRequirement}
          />
        )}
      </div>
      <LeaveGuardDialog
        isOpen={isLeaveGuardOpen}
        onStay={() => setIsLeaveGuardOpen(false)}
        onExportAndLeave={() => {
          onSave();
          setIsLeaveGuardOpen(false);
          leaveSession();
        }}
        onLeave={() => {
          setIsLeaveGuardOpen(false);
          leaveSession();
        }}
      />
      <DocumentManager
        isOpen={isDocumentManagerOpen}
        onClose={() => setIsDocumentManagerOpen(false)}
        library={documentLibrary}
        currentDocId={openDocId}
        onRenameCurrent={setTitle}
        timedCopies={timedCopies}
        onTimedCopiesChange={setTimedCopies}
        onOpenDocument={openDocumentInTab}
        onNewDocument={onNew}
      />
      <LibraryManagerModal
        isOpen={isLibraryModalOpen}
        onClose={() => setIsLibraryModalOpen(false)}
      />
      {toast && (
        <Toast
          key={toast.id}
          message={toast.message}
          description={toast.description}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}

export default App;
