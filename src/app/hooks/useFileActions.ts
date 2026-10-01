import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { Node, Edge } from '@xyflow/react';
import type * as Y from 'yjs';
import { unflattenToSubDiagram } from '../../collab/stores/diagramStore';
import type { UndoController } from '../../collab/stores/undoManager';
import { replaceDocumentContents, type OpenDocument } from '../../collab/sync/localDocument';
import type { ToastType } from '../../common/components/toast/Toast';
import {
  toDiagramFile,
  downloadDiagram,
  downloadDiagramAs,
  parseDiagramFile,
} from '../../domain/canvas/serialization';
import { exportDiagramAsPng, exportDiagramAsSvg } from '../../domain/canvas/imageExport';
import { downloadRequirementsMarkdown } from '../../domain/requirements/requirementsExport';
import { newDocumentId } from '../../domain/storage/documentStore';
import {
  loadTimedCopies,
  saveTimedCopies,
  timedCopyFileName,
  isCopyDue,
  TIMED_COPIES_TEST_SECONDS_KEY,
  type TimedCopiesSettings,
} from '../../domain/storage/timedCopies';
import type { FileSaving } from '../../hooks/useFileSaving';
import { isPerfInstrumentationActive } from '../../perf/instrumentation';
import type { DiagramPath } from '../../domain/canvas/subDiagramTree';
import type { ArchNodeData, ArchEdgeData, Scenario } from '../../domain/canvas/types';
import type { RequirementsDocument } from '../../domain/requirements/requirementsTypes';
import type { ProgramIncrement } from '../../domain/timeline/programIncrements';
import type { TeamDocument } from '../../domain/timeline/teamTypes';
import type { Milestone } from '../../domain/timeline/milestones';
import type { SrdDocumentState } from '../../domain/srd/srdTypes';
import { diagramFileToSnapshot, snapshotToDiagramFile } from '../documentSnapshot';

export interface UseFileActionsOptions {
  openDocumentInTab: (docId: string) => void;
  fileSaving: FileSaving;
  openDoc: OpenDocument;
  activeDoc: Y.Doc;
  undo: UndoController;
  showToast: (message: string, type?: ToastType, description?: string) => void;
  title: string;
  scenarios: Scenario[];
  nodes: Node<ArchNodeData>[];
  diagramSnapshot: { nodes: Node<ArchNodeData>[]; edges: Edge<ArchEdgeData>[] };
  requirementsSnapshot: RequirementsDocument;
  programIncrementsSnapshot: ProgramIncrement[];
  teamSnapshot: TeamDocument;
  milestonesSnapshot: Milestone[];
  srdSnapshot: SrdDocumentState;
  setPath: Dispatch<SetStateAction<DiagramPath>>;
  setActiveScenarioId: Dispatch<SetStateAction<string | null>>;
  setActiveStepIndex: Dispatch<SetStateAction<number>>;
  setIsPresenting: Dispatch<SetStateAction<boolean>>;
}

/**
 * New, save, load, the attached file (WS13), timed copies, and image and
 * markdown exports. Moved unchanged from App.tsx; onFileSelected now lists
 * the setters it receives (React setters, so this changes no identity).
 *
 * Performance contract (see src/app/README.md): this hook runs inside App's
 * render, so it adds no component, no render and no commit. Every value it
 * returns is either React state, a ref, or memoized with the same
 * dependencies it had in App.tsx. Callers destructure the result and depend
 * on the individual members - never on the returned object, which is new on
 * every render.
 */
export function useFileActions({
  openDocumentInTab,
  fileSaving,
  openDoc,
  activeDoc,
  undo,
  showToast,
  title,
  scenarios,
  nodes,
  diagramSnapshot,
  requirementsSnapshot,
  programIncrementsSnapshot,
  teamSnapshot,
  milestonesSnapshot,
  srdSnapshot,
  setPath,
  setActiveScenarioId,
  setActiveStepIndex,
  setIsPresenting,
}: UseFileActionsOptions) {
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      milestonesSnapshot,
      srdSnapshot,
    );
  }, [
    title,
    diagramSnapshot,
    scenarios,
    requirementsSnapshot,
    programIncrementsSnapshot,
    teamSnapshot,
    milestonesSnapshot,
    srdSnapshot,
  ]);

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
    const safeName = title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    void fileSaving.attach(`${safeName || 'diagram'}.json`);
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
      showToast('Could not read the file', 'error');
      return;
    }
    try {
      const parsed = parseDiagramFile(text);
      replaceDocumentContents(openDoc.doc, snapshotToDiagramFile(diagramFileToSnapshot(parsed)));
      undo.clear();
      showToast('Reloaded from file');
    } catch (err) {
      showToast('The file could not be loaded', 'error', (err as Error).message);
    }
  }, [fileSaving, openDoc, undo, showToast]);

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
      event.target.value = '';
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
    [activeDoc, undo, setPath, setActiveScenarioId, setActiveStepIndex, setIsPresenting],
  );

  return {
    fileInputRef,
    onNew,
    onSave,
    timedCopies,
    setTimedCopies,
    onChooseFile,
    onOverwriteFile,
    onReloadFromFile,
    onExportPng,
    onExportSvg,
    onExportRequirementsMarkdown,
    onLoadClick,
    onFileSelected,
  };
}
