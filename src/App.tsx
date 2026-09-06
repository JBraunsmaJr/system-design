import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useUndoableState } from "./hooks/useUndoableState";
import {
  ReactFlowProvider,
  type Node,
  type Edge,
  type Connection,
  type OnNodesChange,
  type OnEdgesChange,
  type OnSelectionChangeFunc,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Toolbar } from "./components/Toolbar";
import { CollabPanel } from "./components/CollabPanel";
import { Palette } from "./components/Palette";
import { Canvas } from "./components/Canvas";
import { Inspector } from "./components/Inspector";
import { ScenarioPanel } from "./components/ScenarioPanel";
import { RequirementsView } from "./components/requirements/RequirementsView";
import { TimelineView } from "./components/timeline/TimelineView";
import { TeamView } from "./components/team/TeamView";
import { SkillTreeView } from "./components/skilltree/SkillTreeView";
import { NODE_TYPES } from "./domain/nodeRegistry";
import { GROUP_TYPES } from "./domain/groupRegistry";
import { SHAPE_TYPES } from "./domain/shapeRegistry";
import { reorderWithGroupsFirst, toAbsolutePosition } from "./domain/graphUtils";
import {
  getBreadcrumbLabels,
  type DiagramPath,
} from "./domain/subDiagramTree";
import { toDiagramFile, downloadDiagram, parseDiagramFile } from "./domain/serialization";
import { loadAutosave, saveAutosave } from "./domain/autosave";
import { downloadRequirementsMarkdown } from "./domain/requirementsExport";
import { exportDiagramAsPng, exportDiagramAsSvg } from "./domain/imageExport";
import type { ArchNodeData, ArchEdgeData, Scenario, ScenarioStep, SubDiagram } from "./domain/types";
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
import { createAdapterTeamStore, seedTeamStore } from "./collab/teamStore";
import { createYjsTeamStore } from "./collab/yjsTeamStore";
import type { TeamStore } from "./collab/teamStore";
import { createAdapterRequirementsStore } from "./collab/requirementsStore";
import { createYjsRequirementsStore, seedYjsRequirementsDoc } from "./collab/yjsRequirementsStore";
import type { RequirementsStore } from "./collab/requirementsStore";
import { createAdapterProgramIncrementsStore } from "./collab/programIncrementsStore";
import { createAdapterDiagramStore } from "./collab/adapterDiagramStore";
import { getNodesAtPath, getEdgesAtPath, unflattenToSubDiagram } from "./collab/diagramStore";
import type { DiagramStore } from "./collab/diagramStore";
import { createYjsDiagramStore, seedYjsDiagramDoc } from "./collab/yjsDiagramStore";
import { createYjsProgramIncrementsStore, seedYjsProgramIncrementsDoc } from "./collab/yjsProgramIncrementsStore";
import type { ProgramIncrementsStore } from "./collab/programIncrementsStore";
import { startCollabSession, type CollabSession, type PresenceInfo } from "./collab/session";
import { loadPresenceName, savePresenceName } from "./domain/presenceIdentity";
import { classifyNodeChanges, applySelectionChanges, type PendingNodeUpdate } from "./domain/nodeChangeBatching";
import "./App.css";

let idSeed = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${idSeed++}`;

const EMPTY_DIAGRAM: SubDiagram = { nodes: [], edges: [] };

/** The undoable "document" - everything a user would think of as "my
 * content", as opposed to transient UI state like which panel is open or
 * what's currently selected (neither of which belongs in undo history). */
interface DiagramSnapshot {
  title: string;
  root: SubDiagram;
  scenarios: Scenario[];
  requirements: RequirementsDocument;
  programIncrements: ProgramIncrement[];
  team: TeamDocument;
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
};

// Small, fixed palette for presence colors - not shared with team's own
// AVATAR_COLORS (TeamView.tsx) since that's module-private and this is
// a genuinely separate concept (a person's presence color for a
// session, not a team member's own identity), even though the actual
// hex values happen to match for visual consistency.
const PRESENCE_COLORS = ["#5b7cfa", "#9061f9", "#0fa36b", "#f0578c", "#f59e0b", "#06b6d4", "#ec4899", "#8b5cf6"];

function App() {
  const {
    present: diagram,
    set: setDiagram,
    undo: undoDiagram,
    redo: redoDiagram,
    resetHistory: resetDiagramHistory,
    canUndo,
    canRedo,
  } = useUndoableState<DiagramSnapshot>(() => {
    // Lazy init (a function, not a direct value) so this - including the
    // localStorage read - only ever runs once, on the very first render,
    // rather than on every render the way a plain object literal argument
    // would be recomputed (even though only the first one is ever used).
    const autosave = loadAutosave();
    return autosave ? diagramFileToSnapshot(autosave) : DEFAULT_SNAPSHOT;
  });
  const { title, root, scenarios, requirements, programIncrements, team } = diagram;

  // Thin wrappers matching the exact shape of the plain useState setters
  // they replace (value OR updater-function), so every existing call site
  // below - setTitle(...), setRoot(...), setScenarios(...) - keeps working
  // completely unchanged; only how these three pieces of state are STORED
  // changed (one combined, undoable container instead of three separate
  // useState calls), not how anything calls into them.
  const setTitle = useCallback(
    (updater: string | ((prev: string) => string)) =>
      setDiagram((prev) => ({
        ...prev,
        title: typeof updater === "function" ? (updater as (p: string) => string)(prev.title) : updater,
      })),
    [setDiagram]
  );
  const setRoot = useCallback(
    (updater: SubDiagram | ((prev: SubDiagram) => SubDiagram)) =>
      setDiagram((prev) => ({
        ...prev,
        root: typeof updater === "function" ? (updater as (p: SubDiagram) => SubDiagram)(prev.root) : updater,
      })),
    [setDiagram]
  );
  // rootRef always holds the CURRENT root, updated on every render (a
  // plain ref mutation during render, not a state update - safe, and
  // exactly the pattern React itself recommends for "keep a ref in sync
  // with the latest value" situations). getRoot reads from this ref
  // rather than closing over `root` directly, which is what lets
  // localDiagramStore itself stay a single, stable instance below
  // instead of being torn down and rebuilt on every edit.
  const rootRef = useRef(root);
  // Deliberate, safe use of the well-known "keep a ref fresh for a
  // stable callback" pattern. This mutation always completes before
  // anything else in this same render pass could read it (getRoot below
  // is only ever CALLED later, from event handlers via the store's own
  // methods, never during render itself) - JS execution within one
  // function call is strictly sequential, so there's no actual
  // staleness risk in React's current runtime. The alternative -
  // updating this via useEffect instead - would introduce a REAL bug:
  // effects run only after the render phase completes, so getSnapshot
  // (called synchronously during render, via useSyncExternalStore
  // below) would read one-render-stale data on exactly the render where
  // root just changed. This lint rule exists to guard against a future
  // React Compiler reordering/memoizing parts of a render in ways that
  // could break that sequencing guarantee - this project doesn't use
  // the compiler today, and if it ever does, this specific pattern is
  // exactly the kind of thing that would need re-examining then, not a
  // sign anything is wrong with it now.
  // eslint-disable-next-line react-hooks/refs
  rootRef.current = root;
  // Deliberately NOT depending on `root` here - only on `setRoot`
  // (itself stable across renders, since it only depends on setDiagram).
  // The adapter's own getSnapshot has a cache keyed on root's identity
  // (see adapterDiagramStore.ts), but that cache lives INSIDE the
  // closure created by createAdapterDiagramStore - if this useMemo
  // depended on `root` and recreated the store on every edit, each new
  // instance would start with an empty cache and immediately re-flatten
  // from scratch anyway, defeating that fix in practice. A single,
  // long-lived instance is what lets the cache (and, just as
  // importantly, stable object references for every node that DIDN'T
  // change) actually persist between edits rather than being thrown
  // away every single time. getRoot's own read of rootRef.current
  // happens later, inside store method calls triggered from event
  // handlers, never during render - see the note above.
  // eslint-disable-next-line react-hooks/refs
  const localDiagramStore = useMemo(() => createAdapterDiagramStore(() => rootRef.current, setRoot), [setRoot]);
  const setScenarios = useCallback(
    (updater: Scenario[] | ((prev: Scenario[]) => Scenario[])) =>
      setDiagram((prev) => ({
        ...prev,
        scenarios: typeof updater === "function" ? (updater as (p: Scenario[]) => Scenario[])(prev.scenarios) : updater,
      })),
    [setDiagram]
  );
  const setRequirements = useCallback(
    (updater: (prev: RequirementsDocument) => RequirementsDocument) =>
      setDiagram((prev) => ({ ...prev, requirements: updater(prev.requirements) })),
    [setDiagram]
  );
  const localRequirementsStore = useMemo(
    () => createAdapterRequirementsStore(() => requirements, setRequirements),
    [requirements, setRequirements]
  );

  const setProgramIncrements = useCallback(
    (updater: (prev: ProgramIncrement[]) => ProgramIncrement[]) =>
      setDiagram((prev) => ({ ...prev, programIncrements: updater(prev.programIncrements) })),
    [setDiagram]
  );
  const localProgramIncrementsStore = useMemo(
    () => createAdapterProgramIncrementsStore(() => programIncrements, setProgramIncrements),
    [programIncrements, setProgramIncrements]
  );

  const setTeam = useCallback(
    (updater: (prev: TeamDocument) => TeamDocument) =>
      setDiagram((prev) => ({ ...prev, team: updater(prev.team) })),
    [setDiagram]
  );
  const localTeamStore = useMemo(() => createAdapterTeamStore(() => team, setTeam), [team, setTeam]);

  // --- Collaborative sessions -----------------------------------------------
  //
  // A session covers all four domains - team, requirements, program
  // increments, and now the diagram itself, once its own DiagramStore got
  // real UI wiring (createAdapterDiagramStore/createYjsDiagramStore).
  // Starting or joining a session switches every one of them over
  // together; there's no partial-session state where some domains are
  // collaborative and others aren't.
  //
  // Undo/redo is a known, deliberate limitation while a session is active:
  // team/requirements/programIncrements stop flowing through setTeam/
  // setRequirements/setProgramIncrements for the duration (those calls are
  // what feeds the undo-tracked `diagram` snapshot), so the app's own
  // undo stack is simply frozen with respect to collaborative edits until
  // the session ends - pressing undo won't touch anything a collaborator
  // (or you) just changed, but it also can't corrupt anything, since
  // nothing collaborative is being fed into that history at all. A real
  // per-edit undo during an active session would mean adopting Yjs's own
  // UndoManager, which the original collaboration plan already called out
  // as a separate, later decision - not attempted here.
  interface ActiveCollabSession {
    doc: Y.Doc;
    session: CollabSession;
    roomName: string;
    teamStore: TeamStore;
    requirementsStore: RequirementsStore;
    programIncrementsStore: ProgramIncrementsStore;
    diagramStore: DiagramStore;
  }
  const [activeSession, setActiveSession] = useState<ActiveCollabSession | null>(null);

  const [displayName, setDisplayName] = useState(() => loadPresenceName() ?? `Guest-${Math.random().toString(36).slice(2, 6)}`);
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
  useEffect(() => {
    if (!activeSession) return;
    return activeSession.session.subscribeToPresence(setPresencePeers);
  }, [activeSession]);

  const signalingUrls = useMemo(() => {
    const raw = import.meta.env.VITE_SIGNALING_URL as string | undefined;
    return raw ? raw.split(",").map((u) => u.trim()).filter(Boolean) : [];
  }, []);

  // Starts a brand-new session, seeding it with whatever's already here so
  // nothing is lost - the new session's initial state IS the current local
  // state, not an empty workbook.
  const startNewSession = useCallback(
    () => {
      const roomName = `session-${Math.random().toString(36).slice(2, 10)}`;
      const doc = new Y.Doc();
      seedYjsRequirementsDoc(doc, requirements);
      seedYjsProgramIncrementsDoc(doc, programIncrements);
      seedYjsDiagramDoc(doc, root);
      const teamStore = createYjsTeamStore(doc);
      seedTeamStore(teamStore, team);
      const requirementsStoreForSession = createYjsRequirementsStore(doc);
      const programIncrementsStoreForSession = createYjsProgramIncrementsStore(doc);
      const diagramStoreForSession = createYjsDiagramStore(doc);
      const session = startCollabSession(doc, roomName, { signalingUrls });
      session.setLocalPresence({
        name: displayName.trim() || "Guest",
        color: PRESENCE_COLORS[Math.floor(Math.random() * PRESENCE_COLORS.length)],
      });
      setActiveSession({
        doc,
        session,
        roomName,
        teamStore,
        requirementsStore: requirementsStoreForSession,
        programIncrementsStore: programIncrementsStoreForSession,
        diagramStore: diagramStoreForSession,
      });
    },
    [requirements, programIncrements, team, root, signalingUrls, displayName]
  );

  // Joins an existing session by room name - starts from an EMPTY doc
  // rather than seeding local state, since the whole point of joining is
  // to receive whatever the session already has from other peers, not to
  // impose this browser's own local state onto it.
  const joinSession = useCallback(
    (roomName: string) => {
      const doc = new Y.Doc();
      const teamStore = createYjsTeamStore(doc);
      const requirementsStoreForSession = createYjsRequirementsStore(doc);
      const programIncrementsStoreForSession = createYjsProgramIncrementsStore(doc);
      const diagramStoreForSession = createYjsDiagramStore(doc);
      const session = startCollabSession(doc, roomName, { signalingUrls });
      session.setLocalPresence({
        name: displayName.trim() || "Guest",
        color: PRESENCE_COLORS[Math.floor(Math.random() * PRESENCE_COLORS.length)],
      });
      setActiveSession({
        doc,
        session,
        roomName,
        teamStore,
        requirementsStore: requirementsStoreForSession,
        programIncrementsStore: programIncrementsStoreForSession,
        diagramStore: diagramStoreForSession,
      });
    },
    [signalingUrls, displayName]
  );

  // Leaving a session writes its final state back into the local,
  // undo-tracked snapshot before disconnecting - so whatever happened
  // during the session (your own edits, or anything synced in from
  // collaborators) is preserved going forward, not silently discarded the
  // moment the connection ends.
  const leaveSession = useCallback(() => {
    if (!activeSession) return;
    setTeam(() => activeSession.teamStore.getSnapshot());
    setRequirements(() => activeSession.requirementsStore.getSnapshot());
    setProgramIncrements(() => activeSession.programIncrementsStore.getSnapshot());
    const finalDiagramSnapshot = activeSession.diagramStore.getSnapshot();
    setRoot(() => unflattenToSubDiagram(finalDiagramSnapshot.nodes, finalDiagramSnapshot.edges));
    activeSession.session.disconnect();
    setActiveSession(null);
  }, [activeSession, setTeam, setRequirements, setProgramIncrements, setRoot]);

  useEffect(() => {
    return () => {
      activeSession?.session.disconnect();
    };
    // Only ever runs on unmount - intentionally not re-running when
    // activeSession itself changes, since that would disconnect and
    // immediately reconnect on every session state update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const teamStore = activeSession?.teamStore ?? localTeamStore;
  const requirementsStore = activeSession?.requirementsStore ?? localRequirementsStore;
  const programIncrementsStore = activeSession?.programIncrementsStore ?? localProgramIncrementsStore;
  const diagramStore = activeSession?.diagramStore ?? localDiagramStore;
  // onUpdateNode/onUpdateEdge (below) read the current diagram store
  // through this ref rather than closing over `diagramStore` directly,
  // so THEIR OWN function identity stays permanently stable across a
  // session starting or ending - unlike getSnapshot/subscribe (used via
  // useSyncExternalStore below), these are pure write operations with no
  // subscription semantics, so there's no re-subscription behavior to
  // preserve by letting them change reference the normal way. See the
  // note by onUpdateNode's own definition for why this matters: without
  // it, onUpdateNode/onUpdateEdge changing reference on every session
  // start cascaded into Canvas's nodeTypes/edgeTypes objects recomputing
  // at that exact moment (onChangeTextNode/onChangeCodeNode depend on
  // onUpdateNode; TypedEdge depends on onUpdateEdge directly) - which
  // tripped React Flow's own "you've created a new nodeTypes/edgeTypes
  // object" warning and forced a full unmount+remount of every node and
  // edge component at the same moment the underlying data was ALSO
  // changing (switching from local to session data) - a combination a
  // real user reported as edges specifically failing to render right
  // after starting a session.
  const diagramStoreRef = useRef(diagramStore);
  // Same justification as rootRef above: this mutation always completes
  // before onUpdateNode/onUpdateEdge (defined later in this same
  // function body, only ever CALLED later still, from event handlers)
  // could read it - never during render itself.
  // eslint-disable-next-line react-hooks/refs
  diagramStoreRef.current = diagramStore;

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
  useEffect(() => {
    const timer = setTimeout(() => {
      saveAutosave(
        toDiagramFile(
          diagram.title,
          diagram.root.nodes,
          diagram.root.edges,
          diagram.scenarios,
          diagram.requirements,
          diagram.programIncrements,
          diagram.team
        )
      );
      setHasAutosaved(true);
    }, 1000);
    return () => clearTimeout(timer);
  }, [diagram]);

  const [path, setPath] = useState<DiagramPath>([]);

  const breadcrumbLabels = useMemo(() => getBreadcrumbLabels(root, path), [root, path]);

  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);

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

  // nodes/edges are derived from diagramStore rather than stored directly -
  // selection is deliberately NOT part of that store's schema (it's
  // ephemeral, per-person state, not something a collaborator should see
  // reflected in their own view), so it's combined in here on every read
  // instead, using selectedNodeIds/selectedEdgeIds as the sole source of
  // truth. This replaces what used to be tracked as a `.selected` field
  // persisted directly on the node/edge objects themselves.
  const { nodes, edges } = useMemo(() => {
    const rawNodes = reorderWithGroupsFirst(getNodesAtPath(diagramSnapshot.nodes, path));
    const rawEdges = getEdgesAtPath(diagramSnapshot.edges, path);
    return {
      nodes: rawNodes.map((n) => ({ ...n, selected: selectedNodeIds.includes(n.id) })),
      edges: rawEdges.map((e) => ({ ...e, selected: selectedEdgeIds.includes(e.id) })),
    };
  }, [diagramSnapshot, path, selectedNodeIds, selectedEdgeIds]);

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
  const pendingNodeUpdates = useRef(new Map<string, PendingNodeUpdate>());
  const pendingFlushHandle = useRef<number | null>(null);

  const flushPendingNodeUpdates = useCallback(() => {
    pendingFlushHandle.current = null;
    const pending = pendingNodeUpdates.current;
    if (pending.size === 0) return;
    for (const [id, update] of pending) {
      if (update.type === "position") {
        diagramStore.updatePosition(id, update.position);
      } else {
        diagramStore.updateDimensions(id, update.width, update.height);
      }
    }
    pending.clear();
  }, [diagramStore]);

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

      const { isActiveGesture } = classifyNodeChanges(changes, pendingNodeUpdates.current);
      if (isActiveGesture) {
        if (pendingFlushHandle.current === null) {
          pendingFlushHandle.current = requestAnimationFrame(flushPendingNodeUpdates);
        }
      } else {
        // The gesture just ended (dragging/resizing became false), or
        // this is a standalone change with no dragging flag at all (an
        // arrow-key nudge, or onNodeDragStop's own alignment-snap
        // correction) - either way, commit right away rather than
        // waiting up to one frame for something that isn't part of an
        // in-progress, high-frequency gesture.
        if (pendingFlushHandle.current !== null) {
          cancelAnimationFrame(pendingFlushHandle.current);
          pendingFlushHandle.current = null;
        }
        flushPendingNodeUpdates();
      }
    },
    [flushPendingNodeUpdates]
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
  const [viewMode, setViewMode] = useState<"diagram" | "requirements" | "timeline" | "team" | "skill-tree">("diagram");
  // Set together with viewMode when the user clicks a linked requirement
  // pill in the Inspector (while looking at the diagram) - see
  // RequirementsView's focusItemId prop for how this actually triggers
  // the scroll-and-highlight once that view mounts.
  const [pendingRequirementFocus, setPendingRequirementFocus] = useState<string | null>(null);
  const onNavigateToRequirement = useCallback((itemId: string) => {
    setViewMode("requirements");
    setPendingRequirementFocus(itemId);
  }, []);
  // Mirrors onNavigateToRequirement above - jumps to the diagram, drills
  // to whichever sub-diagram level actually contains the target node
  // (path is relative to root, see findLinkedNodes), and requests the
  // camera focus Canvas consumes via focusNodeId/onFocusHandled.
  const [pendingNodeFocus, setPendingNodeFocus] = useState<string | null>(null);
  const onNavigateToNode = useCallback(
    (nodePath: DiagramPath, nodeId: string) => {
      setViewMode("diagram");
      setPath(nodePath);
      setPendingNodeFocus(nodeId);
    },
    []
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
  }, [diagramStore]);
  const [isScenarioPanelOpen, setIsScenarioPanelOpen] = useState(false);
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [isPaletteCollapsed, setIsPaletteCollapsed] = useState(false);
  const [isInspectorCollapsed, setIsInspectorCollapsed] = useState(false);
  const [scenarioPanelHeight, setScenarioPanelHeight] = useState(380);

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
      const def = SHAPE_TYPES.find((s) => s.id === typeId);
      if (!def) return;
      const id = diagramStore.addNode(path, "shape", position, {
        nodeType: typeId,
        label: "",
        description: "",
        properties: {},
        tags: [],
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

      diagramStore.updateParentId(nodeId, newParentId ?? undefined, nextPosition);
    },
    [nodes, diagramStore]
  );

  // Called after dragging a *boundary* - see Canvas.tsx's onNodeDragStop.
  // `nodeIds` are whichever nodes now fall fully inside it and aren't
  // already its children. Any node already parented to a different group
  // gets moved over (its position is re-derived relative to the new parent,
  // same math as onReparentNode).
  const onAdoptIntoGroup = useCallback(
    (groupId: string, nodeIds: string[]) => {
      const group = nodes.find((n) => n.id === groupId);
      if (!group) return;
      for (const nodeId of nodeIds) {
        if (nodeId === groupId) continue;
        const n = nodes.find((nn) => nn.id === nodeId);
        if (!n) continue;
        const absolute = toAbsolutePosition(n, nodes, n.parentId);
        const relative = { x: absolute.x - group.position.x, y: absolute.y - group.position.y };
        diagramStore.updateParentId(nodeId, groupId, relative);
      }
    },
    [nodes, diagramStore]
  );

  const onSelectionChange = useCallback<OnSelectionChangeFunc>(({ nodes: selNodes, edges: selEdges }) => {
    setSelectedNodeIds(selNodes.map((n) => n.id));
    setSelectedEdgeIds(selEdges.map((e) => e.id));
  }, []);

  const onUpdateNode = useCallback(
    (id: string, patch: Partial<ArchNodeData>) => {
      diagramStoreRef.current.updateNode(id, patch);
    },
    []
  );

  const onUpdateEdge = useCallback(
    (id: string, patch: Partial<ArchEdgeData>) => {
      diagramStoreRef.current.updateEdge(id, patch);
    },
    []
  );

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

  // Selecting a step in the list makes it both the editor's subject AND the
  // canvas preview target at once - clicking the same one again deselects,
  // which is how you get back to seeing the undimmed diagram without
  // closing the panel.
  const onSelectStep = useCallback((stepId: string) => {
    setActiveStepId((cur) => (cur === stepId ? null : stepId));
  }, []);

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
  }, [isPresenting, selectedNodeIds, selectedEdgeIds, onDeleteSelection]);

  const onUndo = useCallback(() => {
    if (isPresenting) return;
    undoDiagram();
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
  }, [isPresenting, undoDiagram]);

  const onRedo = useCallback(() => {
    if (isPresenting) return;
    redoDiagram();
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
  }, [isPresenting, redoDiagram]);

  // Copy/paste: Ctrl+C / Cmd+C and Ctrl+V / Cmd+V, same guards as delete -
  // never while presenting, never while typing in a field (so normal text
  // copy/paste inside the Inspector's inputs is completely unaffected).
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isPresenting) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "c") {
        event.preventDefault();
        onCopy();
      } else if ((event.ctrlKey || event.metaKey) && key === "v") {
        event.preventDefault();
        onPaste();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isPresenting, onCopy, onPaste]);

  // Undo/redo: Ctrl+Z / Cmd+Z, and BOTH common redo conventions - Ctrl+Y
  // (Windows-style) and Ctrl+Shift+Z (Mac/many web apps) - same guards as
  // copy/paste. Deliberately a separate effect from copy/paste above rather
  // than folded into it, since the redo-key handling (checking shiftKey,
  // supporting two different keys) is its own bit of complexity worth
  // keeping visually separate from the simpler copy/paste block.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isPresenting) return;
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
  }, [isPresenting, onUndo, onRedo]);

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

  const onNew = useCallback(() => {
    if (root.nodes.length > 0 && !window.confirm("Clear the current diagram? Unsaved changes will be lost.")) {
      return;
    }
    resetDiagramHistory(DEFAULT_SNAPSHOT);
    setPath([]);
    setActiveScenarioId(null);
    setActiveStepIndex(0);
    setIsPresenting(false);
  }, [root.nodes.length, resetDiagramHistory]);

  // Always saves the full tree from the root, regardless of which level
  // you're currently viewing - a save from inside a drilled-down sub-diagram
  // must not lose everything above/beside it.
  const onSave = useCallback(() => {
    downloadDiagram(toDiagramFile(title, root.nodes, root.edges, scenarios, requirements, programIncrements, team));
  }, [title, root, scenarios, requirements, programIncrements, team]);

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
    downloadRequirementsMarkdown(title, requirements);
  }, [title, requirements]);

  const onLoadClick = useCallback(() => fileInputRef.current?.click(), []);

  const onFileSelected = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = parseDiagramFile(text);
        resetDiagramHistory(diagramFileToSnapshot(parsed));
        setPath([]);
        setActiveScenarioId(null);
        setActiveStepIndex(0);
        setIsPresenting(false);
      } catch (err) {
        window.alert(`Couldn't open that file: ${(err as Error).message}`);
      }
    },
    [resetDiagramHistory]
  );

  const selectedNodeId = selectedNodeIds[0] ?? null;
  const selectedEdgeId = selectedEdgeIds[0] ?? null;
  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedEdge = edges.find((e) => e.id === selectedEdgeId) ?? null;
  const canAddStep = selectedNodeIds.length > 0 || selectedEdgeIds.length > 0;

  return (
    <div className="app">
      {!isPresenting && (
        <Toolbar
          title={title}
          onTitleChange={setTitle}
          onNew={onNew}
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
          canExportRequirements={requirements.items.length > 0}
          hasAutosaved={hasAutosaved}
        />
      )}
      {!isPresenting && (
        <CollabPanel
          signalingConfigured={signalingUrls.length > 0}
          activeSession={activeSession ? { roomName: activeSession.roomName, isSynced: () => activeSession.session.isSynced(), peers: presencePeers } : null}
          displayName={displayName}
          onDisplayNameChange={onDisplayNameChange}
          onStartSession={startNewSession}
          onJoinSession={joinSession}
          onLeaveSession={leaveSession}
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
        {!isPresenting && (
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
            <Canvas
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onSelectionChange={onSelectionChange}
              onAddNode={onAddNode}
              onAddGroup={onAddGroup}
              onAddText={onAddText}
              onAddShape={onAddShape}
              onAddCode={onAddCode}
              onUpdateNode={onUpdateNode}
              onUpdateEdge={onUpdateEdge}
              onReparentNode={onReparentNode}
              onAdoptIntoGroup={onAdoptIntoGroup}
              presentation={presentation}
              previewFocus={previewFocus}
              focusNodeId={pendingNodeFocus}
              onFocusHandled={() => setPendingNodeFocus(null)}
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
          </ReactFlowProvider>
          {!isPresenting && isScenarioPanelOpen && (
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
              root={root}
              currentPath={path}
              height={scenarioPanelHeight}
              onHeightChange={setScenarioPanelHeight}
              onClose={() => {
                setIsScenarioPanelOpen(false);
                setActiveStepId(null);
              }}
            />
          )}
        </div>
        {!isPresenting && (
          <div
            className={`app__sidebar-wrap app__sidebar-wrap--right${isInspectorCollapsed ? " is-collapsed" : ""}`}
          >
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
                onDeleteNode={onDeleteNode}
                onDeleteEdge={onDeleteEdge}
                onDrillInto={onDrillInto}
                requirements={requirements}
                onNavigateToRequirement={onNavigateToRequirement}
              />
            )}
          </div>
        )}
          </>
        )}
        {viewMode === "requirements" && (
          <RequirementsView
            requirementsStore={requirementsStore}
            programIncrements={programIncrements}
            team={team}
            diagramRoot={root}
            onNavigateToNode={onNavigateToNode}
            onCreateLinkedNode={onCreateLinkedNode}
            focusItemId={pendingRequirementFocus}
            onFocusHandled={() => setPendingRequirementFocus(null)}
          />
        )}
        {viewMode === "timeline" && (
          <TimelineView
            programIncrementsStore={programIncrementsStore}
            requirementsStore={requirementsStore}
            team={team}
            diagramRoot={root}
            onNavigateToNode={onNavigateToNode}
            onCreateLinkedNode={onCreateLinkedNode}
            onNavigateToRequirement={onNavigateToRequirement}
          />
        )}
        {viewMode === "team" && (
          <TeamView
            teamStore={teamStore}
            programIncrementsStore={programIncrementsStore}
            requirements={requirements}
          />
        )}
        {viewMode === "skill-tree" && (
          <SkillTreeView
            requirementsStore={requirementsStore}
            programIncrements={programIncrements}
            team={team}
            diagramRoot={root}
            onNavigateToNode={onNavigateToNode}
            onCreateLinkedNode={onCreateLinkedNode}
            onNavigateToRequirement={onNavigateToRequirement}
          />
        )}
      </div>
    </div>
  );
}

export default App;
