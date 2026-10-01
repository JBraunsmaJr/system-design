import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { Node, Edge } from '@xyflow/react';
import { unflattenToSubDiagram, type DiagramStore } from '../../collab/stores/diagramStore';
import type { PresenceInfo } from '../../collab/sync/session';
import { EMPTY_DIAGRAM } from '../documentSnapshot';
import type { DiagramPath } from '../../domain/canvas/subDiagramTree';
import type { ArchNodeData, ArchEdgeData } from '../../domain/canvas/types';

export type ViewMode = 'diagram' | 'requirements' | 'timeline' | 'team' | 'skill-tree' | 'srd';

export interface UseViewNavigationOptions {
  activeSession: object | null;
  /** Must be stable - App's is a useCallback with no deps. */
  broadcastPresence: (patch: Partial<PresenceInfo>) => void;
  diagramSnapshot: { nodes: Node<ArchNodeData>[]; edges: Edge<ArchEdgeData>[] };
  diagramStore: DiagramStore;
  setPath: Dispatch<SetStateAction<DiagramPath>>;
  setSelectedNodeIds: Dispatch<SetStateAction<string[]>>;
  setSelectedEdgeIds: Dispatch<SetStateAction<string[]>>;
}

/**
 * Which page is showing (diagram, requirements, timeline, team, skill
 * tree), and jumping between a requirement and the nodes linked to it.
 * Moved unchanged from App.tsx; the only edits are the state setters
 * received as parameters, now listed in the dependency arrays that use them
 * (React setters, so this changes no identity).
 *
 * Performance contract (see src/app/README.md): this hook runs inside App's
 * render, so it adds no component, no render and no commit. Every value it
 * returns is either React state, a ref, or memoized with the same
 * dependencies it had in App.tsx. Callers destructure the result and depend
 * on the individual members - never on the returned object, which is new on
 * every render.
 */
export function useViewNavigation({
  activeSession,
  broadcastPresence,
  diagramSnapshot,
  diagramStore,
  setPath,
  setSelectedNodeIds,
  setSelectedEdgeIds,
}: UseViewNavigationOptions) {
  // Which top-level page is showing - the diagram canvas or the
  // requirements document. Deliberately NOT part of the undoable
  // DiagramSnapshot: switching pages isn't an edit to the content itself.
  const [viewMode, setViewModeRaw] = useState<ViewMode>('diagram');
  /**
   * The recursive tree, for the views still written against it
   * (requirements, timeline, skill tree - all to find linked nodes).
   *
   * Built only while one of them is showing. None of them is mounted in the
   * diagram view, which is where editing and remote bursts happen, so the
   * common path never pays for an unflatten (WS1-R3).
   */
  const viewNeedsTree =
    viewMode === 'requirements' || viewMode === 'timeline' || viewMode === 'skill-tree';
  const diagramTree = useMemo(
    () =>
      viewNeedsTree
        ? unflattenToSubDiagram(diagramSnapshot.nodes, diagramSnapshot.edges)
        : EMPTY_DIAGRAM,
    [viewNeedsTree, diagramSnapshot],
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
  const onNavigateToRequirement = useCallback(
    (itemId: string) => {
      setViewMode('requirements');
      setPendingRequirementFocus(itemId);
    },
    [setViewMode],
  );
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
      setViewMode('diagram');
      setPath(nodePath);
      setPendingNodeFocus(nodeId);
      setSelectedNodeIds([nodeId]);
      setSelectedEdgeIds([]);
    },
    [setViewMode, setPath, setSelectedNodeIds, setSelectedEdgeIds],
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
  const onCreateLinkedNode = useCallback(
    (itemId: string, label: string) => {
      const id = diagramStore.addNode(
        [],
        'typed',
        { x: 0, y: 0 },
        {
          nodeType: 'custom',
          label,
          description: '',
          properties: {},
          tags: [],
          linkedRequirementIds: [itemId],
        },
      );
      setViewMode('diagram');
      setPath([]);
      setPendingNodeFocus(id);
    },
    [diagramStore, setViewMode, setPath],
  );

  return {
    viewMode,
    setViewMode,
    diagramTree,
    setFocusedItemId,
    pendingRequirementFocus,
    onFocusRequirementHandled,
    onNavigateToRequirement,
    pendingNodeFocus,
    onFocusNodeHandled,
    onNavigateToNode,
    onCreateLinkedNode,
  };
}
