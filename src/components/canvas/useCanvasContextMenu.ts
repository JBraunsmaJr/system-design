import {
    type MouseEvent as ReactMouseEvent,
    type RefObject,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import {type Edge, type Node} from '@xyflow/react';
import {getEdgeType} from '../../domain/canvas/edgeRegistry';
import {defaultNodeColor, defaultNodeIcon, nodeColorOverride, nodeColorPatch,} from '../../domain/canvas/nodeDefaults';
import type {CopiedStyle} from '../../domain/canvas/styleClipboard';
import type {ArrangeCommand} from '../../domain/canvas/arrange';
import type {ArchEdgeData, ArchEdgeDataPatch, ArchNodeData} from '../../domain/canvas/types';
import type {RequirementsDocument} from '../../domain/requirements/requirementsTypes';
import type {CanvasProps} from './Canvas';

// Clamped so the menu and submenus never open partly off-screen. The height
// is only the first guess - CanvasContextMenu measures itself once open and
// moves up if it would still run off the bottom.
export const CONTEXT_MENU_WIDTH = 200;
export const CONTEXT_MENU_HEIGHT = 240;

/**
 * The selection commands the right-click menu offers beyond color, icon and
 * stacking. Supplied by App as one object (they all live in its hooks);
 * without it the menu shows only what it always did.
 */
export interface CanvasContextActions {
    onUpdateNodes: (updates: { id: string; patch: Partial<ArchNodeData> }[]) => void;
    onUpdateEdges: (updates: { id: string; patch: ArchEdgeDataPatch }[]) => void;
    onDuplicate: (nodeIds: string[]) => void;
    /** Saves the nodes (and what copying them brings along) as a reusable
     * fragment in the palette. Optional: without it the command isn't offered. */
    onSaveFragment?: (nodeIds: string[], name: string) => void;
    onGroup: (nodeIds: string[]) => void;
    onUngroup: (nodeIds: string[]) => void;
    onSetLocked: (nodeIds: string[], locked: boolean) => void;
    onCopyStyle: (nodeIds: string[], edgeIds: string[]) => void;
    onPasteStyle: (nodeIds: string[], edgeIds: string[]) => void;
    /** What "Paste style" would apply, or null when nothing's been copied. */
    copiedStyle: CopiedStyle | null;
    /** For "Link requirement". */
    requirements: RequirementsDocument;
    /** Align / distribute / match size - see domain/canvas/arrange.ts. */
    onArrange: (command: ArrangeCommand, nodeIds: string[]) => void;
}

export type ContextSubmenu = 'color' | 'icon' | 'requirements' | 'arrange' | 'fragment';

/**
 * The right-click menu's state: what it targets, which submenu is open,
 * the color and icon changes it applies, and dismissing it. Moved
 * unchanged from Canvas.tsx; its markup is CanvasContextMenu.
 *
 * Performance contract: runs inside Canvas's render, called at the exact
 * position its code had in Canvas.tsx, so it adds no component, no render,
 * and no change to the order effects run in. Destructure the result and
 * depend on its members - never on the returned object, which is new on
 * every render.
 */
export function useCanvasContextMenu({
  isPresenting,
  nodes,
                                         edges,
  nodesRef,
  onUpdateNode,
                                         onUpdateEdge,
                                         contextActions,
                                     }: Pick<CanvasProps, 'nodes' | 'edges' | 'onUpdateNode' | 'onUpdateEdge' | 'contextActions'> & {
  isPresenting: boolean;
  nodesRef: RefObject<Node<ArchNodeData>[]>;
}) {
    // Read at call time by openEdgeContextMenu, which goes to React Flow and
    // from there to every edge - depending on `edges` directly would give it
    // a new identity on every change and re-render all of them.
    const edgesRef = useRef(edges);
    useLayoutEffect(() => {
        edgesRef.current = edges;
    }, [edges]);

  /**
   * Right-click menu state. Position is in VIEWPORT coordinates (the menu
   * is portaled to document.body and fixed-positioned), not flow
   * coordinates - it should stay under the cursor, not pinned to a spot
   * on the canvas that moves when you pan.
   */
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
      /** Nodes the menu acts on. */
    targetIds: string[];
      /** Edges it acts on - the selected ones when right-clicking inside a
       * selection, or the one edge right-clicked. */
      targetEdgeIds: string[];
  } | null>(null);
    const [activeSubmenu, setActiveSubmenu] = useState<ContextSubmenu | null>(null);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
    setActiveSubmenu(null);
  }, []);

  const openContextMenu = useCallback(
      (event: ReactMouseEvent, nodeId: string | null, edgeId: string | null = null) => {
      if (isPresenting) return; // the locked slideshow view has nothing to arrange
      event.preventDefault();

      const selectedIds = nodesRef.current.filter((n) => n.selected).map((n) => n.id);
          const selectedEdgeIds = edgesRef.current.filter((e) => e.selected).map((e) => e.id);
      // Right-clicking inside a multi-selection acts on the whole
          // selection; right-clicking a node or edge outside it acts on just
          // that one, which is what every other editor does and avoids silently
      // reordering something off-screen.
          const insideSelection =
              (nodeId === null && edgeId === null) ||
              (nodeId !== null && selectedIds.includes(nodeId)) ||
              (edgeId !== null && selectedEdgeIds.includes(edgeId));
          const targetIds = insideSelection ? selectedIds : nodeId !== null ? [nodeId] : [];
          const targetEdgeIds = insideSelection ? selectedEdgeIds : edgeId !== null ? [edgeId] : [];
          if (targetIds.length === 0 && targetEdgeIds.length === 0) return;

      // Clamped so the menu never opens partly off-screen.
      const left = Math.min(event.clientX, window.innerWidth - CONTEXT_MENU_WIDTH - 8);
      const top = Math.min(event.clientY, window.innerHeight - CONTEXT_MENU_HEIGHT - 8);
      setActiveSubmenu(null);
          setContextMenu({x: Math.max(8, left), y: Math.max(8, top), targetIds, targetEdgeIds});
    },
    [isPresenting, nodesRef],
  );

    /** Applied to every target in one transaction where App supplies the
     * batch actions (one undo step), one write per target where it doesn't. */
  const handleColorChange = useCallback(
    (color: string | undefined) => {
      if (!contextMenu) return;
        const nodeUpdates = contextMenu.targetIds.flatMap((id) => {
        const node = nodesRef.current.find((n) => n.id === id);
            return node ? [{id, patch: nodeColorPatch(node, color)}] : [];
        });
        const edgeUpdates = contextMenu.targetEdgeIds.map((id) => ({id, patch: {color}}));
        if (contextActions) {
            contextActions.onUpdateNodes(nodeUpdates);
            contextActions.onUpdateEdges(edgeUpdates);
        } else {
            for (const u of nodeUpdates) onUpdateNode(u.id, u.patch);
            for (const u of edgeUpdates) onUpdateEdge(u.id, u.patch);
      }
      closeContextMenu();
    },
        [contextMenu, contextActions, onUpdateNode, onUpdateEdge, closeContextMenu, nodesRef],
  );

  const handleIconChange = useCallback(
    (icon: string | undefined) => {
      if (!contextMenu) return;
        if (contextActions) {
            contextActions.onUpdateNodes(contextMenu.targetIds.map((id) => ({id, patch: {icon}})));
        } else {
            for (const id of contextMenu.targetIds) onUpdateNode(id, {icon});
      }
      closeContextMenu();
    },
      [contextMenu, contextActions, onUpdateNode, closeContextMenu],
  );

  const targetPrimaryNode = useMemo(() => {
    if (!contextMenu || contextMenu.targetIds.length === 0) return undefined;
    return nodes.find((n) => n.id === contextMenu.targetIds[0]);
  }, [contextMenu, nodes]);

    // An edge-only target (right-clicking a line) reads its color from the
    // first edge instead - see targetEdgeIds.
    const targetPrimaryEdge = useMemo(() => {
        if (!contextMenu || targetPrimaryNode || contextMenu.targetEdgeIds.length === 0)
            return undefined;
        return edges.find((e) => e.id === contextMenu.targetEdgeIds[0]);
    }, [contextMenu, targetPrimaryNode, edges]);

  const targetCurrentColor = useMemo(() => {
      if (targetPrimaryNode) return nodeColorOverride(targetPrimaryNode);
      return targetPrimaryEdge?.data?.color;
  }, [targetPrimaryNode, targetPrimaryEdge]);

  const targetDefaultColor = useMemo(() => {
      if (targetPrimaryNode) return defaultNodeColor(targetPrimaryNode);
      if (targetPrimaryEdge) return getEdgeType(targetPrimaryEdge.data?.edgeType ?? 'generic').color;
    return '#5B7CFA';
  }, [targetPrimaryNode, targetPrimaryEdge]);

  const targetCurrentIcon = useMemo(() => {
    if (!targetPrimaryNode) return undefined;
    return targetPrimaryNode.data.icon;
  }, [targetPrimaryNode]);

  const targetDefaultIcon = useMemo(() => {
    if (!targetPrimaryNode) return undefined;
      return defaultNodeIcon(targetPrimaryNode);
  }, [targetPrimaryNode]);

  /**
   * Both handlers are memoized rather than written inline on the
   * ReactFlow element, because React Flow hands onNodeContextMenu down
   * to EVERY NodeWrapper (which is memo'd) and puts onMoveStart in its
   * own store. An inline arrow is a new identity on every render, so it
   * would break the memo on every node at once and push a store update
   * each render - turning any Canvas re-render into a re-render of the
   * whole graph.
   */
  const onNodeContextMenu = useCallback(
    (event: ReactMouseEvent, node: Node<ArchNodeData>) => openContextMenu(event, node.id),
    [openContextMenu],
  );
  const onSelectionContextMenu = useCallback(
    (event: ReactMouseEvent) => openContextMenu(event, null),
    [openContextMenu],
  );
    const onEdgeContextMenu = useCallback(
        (event: ReactMouseEvent, edge: Edge<ArchEdgeData>) => openContextMenu(event, null, edge.id),
        [openContextMenu],
    );

  useEffect(() => {
    if (!contextMenu) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeContextMenu();
    };
    // Any click anywhere dismisses, including one that lands on the menu
    // itself - the item's own onClick has already run by then.
    document.addEventListener('click', closeContextMenu);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('click', closeContextMenu);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu, closeContextMenu]);

  return {
    contextMenu,
    activeSubmenu,
    setActiveSubmenu,
    closeContextMenu,
    handleColorChange,
    handleIconChange,
    targetCurrentColor,
    targetDefaultColor,
    targetCurrentIcon,
    targetDefaultIcon,
    onNodeContextMenu,
    onSelectionContextMenu,
      onEdgeContextMenu,
  };
}
