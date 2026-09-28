import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type RefObject,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type {
  Node,
  Edge,
  OnNodesChange,
  OnConnect,
  OnConnectEnd,
  OnNodeDrag,
  OnReconnect,
  HandleType,
  FinalConnectionState,
  InternalNode,
  useStoreApi,
} from '@xyflow/react';
import { getNodeType, NODE_TYPES } from '../../../domain/canvas/nodeRegistry';
import { getGroupType, GROUP_TYPES } from '../../../domain/canvas/groupRegistry';
import { SHAPE_TYPES, globalShapeRegistry } from '../../../domain/canvas/shapeRegistry';
import {
  computeAlignment,
  type AlignBox,
  type AlignmentGuide,
} from '../../../domain/canvas/alignmentGuides';
import {
  getDescendantIds,
  nodeArea,
  pickInnermostGroup,
  toAbsolutePosition,
} from '../../../domain/canvas/graphUtils';
import {
  DRAG_MIME_TYPE,
  GROUP_DRAG_MIME_TYPE,
  TEXT_DRAG_MIME_TYPE,
  SHAPE_DRAG_MIME_TYPE,
  CODE_DRAG_MIME_TYPE,
} from '../Palette';
import type { ArchNodeData, ArchEdgeData } from '../../../domain/canvas/types';
import {
  validateReconnection,
  isSameEndpoints,
  type EdgeEnd,
  draggedEndFromReconnectStart,
  type EdgeEndpoints,
} from '../../../domain/canvas/edgeReconnect';
import { sourceHandleId, targetHandleId } from '../../../domain/canvas/edgeAnchoring';
import { resolveConnectionDrag } from '../edges/edgeAnchoringAdapter';
import {
  CONTEXT_MENU_WIDTH,
  CONTEXT_MENU_HEIGHT,
  type ContextMenuState,
} from '../CanvasContextMenuPortal';

export function nodeToAlignBox(n: Node<ArchNodeData>, allNodes: Node<ArchNodeData>[]): AlignBox {
  const absolute = toAbsolutePosition(n, allNodes, n.parentId);
  return {
    id: n.id,
    x: absolute.x,
    y: absolute.y,
    width: n.measured?.width ?? (n.type === 'text' ? 140 : 200),
    height: n.measured?.height ?? (n.type === 'text' ? 60 : 100),
  };
}

export interface UseCanvasInteractionsOptions {
  nodes: Node<ArchNodeData>[];
  nodesRef: RefObject<Node<ArchNodeData>[]>;
  onNodesChange: OnNodesChange<Node<ArchNodeData>>;
  onConnect: OnConnect;
  onReconnectEdge: (edgeId: string, endpoints: EdgeEndpoints) => void;
  onAddNode: (typeId: string, position: { x: number; y: number }) => void;
  onAddGroup: (typeId: string, position: { x: number; y: number }) => void;
  onAddShape: (typeId: string, position: { x: number; y: number }) => void;
  onAddCode: (position: { x: number; y: number }) => string;
  onAddText: (position: { x: number; y: number }) => string;
  onUpdateNode: (id: string, patch: Partial<ArchNodeData>) => void;
  onReparentNode: (nodeId: string, targetGroupId: string | null) => void;
  onAdoptIntoGroup: (
    groupId: string,
    nodeIds: string[],
    groupPosition?: { x: number; y: number },
  ) => void;
  isPresenting: boolean;
  setEditingLabelNodeId: Dispatch<SetStateAction<string | null>>;
  reactFlowStore: ReturnType<typeof useStoreApi<Node<ArchNodeData>, Edge<ArchEdgeData>>>;
  screenToFlowPosition: (clientPos: { x: number; y: number }) => { x: number; y: number };
  getIntersectingNodes: (node: Node<ArchNodeData>, partially?: boolean) => Node<ArchNodeData>[];
  onCommitGesture?: () => void;
}

export function useCanvasInteractions({
  nodes,
  nodesRef,
  onNodesChange,
  onConnect,
  onReconnectEdge,
  onAddNode,
  onAddGroup,
  onAddShape,
  onAddCode,
  onAddText,
  onUpdateNode,
  onReparentNode,
  onAdoptIntoGroup,
  isPresenting,
  setEditingLabelNodeId,
  reactFlowStore,
  screenToFlowPosition,
  getIntersectingNodes,
  onCommitGesture,
}: UseCanvasInteractionsOptions) {
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuide[]>([]);
  const reconnectEndRef = useRef<EdgeEnd | null>(null);

  const resolveRelease = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (!state.fromNode || !state.fromHandle) return null;
      const touch = 'changedTouches' in event ? event.changedTouches[0] : null;
      const client = touch
        ? { x: touch.clientX, y: touch.clientY }
        : { x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY };
      const { nodeLookup, transform } = reactFlowStore.getState();
      return resolveConnectionDrag({
        nodeLookup,
        zoom: transform[2],
        fromNode: state.fromNode as InternalNode,
        fromHandle: state.fromHandle,
        pointer: screenToFlowPosition(client),
      });
    },
    [reactFlowStore, screenToFlowPosition],
  );

  const handleConnectEnd = useCallback<OnConnectEnd>(
    (event, state) => {
      if (reconnectEndRef.current) return; // handled by handleReconnectEnd
      const resolved = resolveRelease(event, state);
      if (!resolved?.sourceAnchor || !resolved.target || !state.fromNode) return;
      onConnect({
        source: state.fromNode.id,
        sourceHandle: sourceHandleId(resolved.sourceAnchor.pointId),
        target: resolved.target.nodeId,
        targetHandle: targetHandleId(resolved.target.anchor.pointId),
      });
    },
    [onConnect, resolveRelease],
  );

  const handleReconnectStart = useCallback(
    (_event: ReactMouseEvent, _edge: Edge<ArchEdgeData>, handleType: HandleType) => {
      reconnectEndRef.current = draggedEndFromReconnectStart(handleType);
    },
    [],
  );

  const handleReconnect = useCallback<OnReconnect<Edge<ArchEdgeData>>>(() => {}, []);

  const handleReconnectEnd = useCallback(
    (
      event: MouseEvent | TouchEvent,
      oldEdge: Edge<ArchEdgeData>,
      handleType: HandleType,
      state: FinalConnectionState,
    ) => {
      const draggedEnd = reconnectEndRef.current ?? draggedEndFromReconnectStart(handleType);
      reconnectEndRef.current = null;

      const target = resolveRelease(event, state)?.target;
      if (!target) return;

      const next: EdgeEndpoints =
        draggedEnd === 'target'
          ? {
              source: oldEdge.source,
              sourceHandle: oldEdge.sourceHandle ?? null,
              target: target.nodeId,
              targetHandle: targetHandleId(target.anchor.pointId),
            }
          : {
              source: target.nodeId,
              sourceHandle: sourceHandleId(target.anchor.pointId),
              target: oldEdge.target,
              targetHandle: oldEdge.targetHandle ?? null,
            };
      if (isSameEndpoints(oldEdge, next)) return;

      const check = validateReconnection(next, new Set(nodesRef.current.map((n) => n.id)));
      if (!check.ok) return;

      onReconnectEdge(oldEdge.id, next);
    },
    [onReconnectEdge, resolveRelease, nodesRef],
  );

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });

      const nodeTypeId = event.dataTransfer.getData(DRAG_MIME_TYPE);
      if (nodeTypeId && NODE_TYPES.some((n) => n.id === nodeTypeId)) {
        onAddNode(nodeTypeId, position);
        return;
      }

      const groupTypeId = event.dataTransfer.getData(GROUP_DRAG_MIME_TYPE);
      if (groupTypeId && GROUP_TYPES.some((g) => g.id === groupTypeId)) {
        onAddGroup(groupTypeId, position);
        return;
      }

      const shapeTypeId = event.dataTransfer.getData(SHAPE_DRAG_MIME_TYPE);
      if (
        shapeTypeId &&
        (SHAPE_TYPES.some((s) => s.id === shapeTypeId) || globalShapeRegistry.getShape(shapeTypeId))
      ) {
        onAddShape(shapeTypeId, position);
        return;
      }

      if (event.dataTransfer.getData(CODE_DRAG_MIME_TYPE)) {
        setEditingLabelNodeId(onAddCode(position));
        return;
      }

      if (event.dataTransfer.getData(TEXT_DRAG_MIME_TYPE)) {
        setEditingLabelNodeId(onAddText(position));
      }
    },
    [
      screenToFlowPosition,
      onAddNode,
      onAddGroup,
      onAddShape,
      onAddCode,
      onAddText,
      setEditingLabelNodeId,
    ],
  );

  const onCanvasDoubleClick = useCallback(
    (event: ReactMouseEvent) => {
      if (isPresenting) return;
      const target = event.target as HTMLElement;
      if (!target.classList.contains('react-flow__pane')) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      setEditingLabelNodeId(onAddText(position));
    },
    [isPresenting, screenToFlowPosition, onAddText, setEditingLabelNodeId],
  );

  const getAlignmentCandidates = useCallback(
    (draggedNode: Node<ArchNodeData>) => {
      const carried =
        draggedNode.type === 'group'
          ? getDescendantIds(draggedNode.id, nodesRef.current)
          : undefined;
      return nodesRef.current.filter((n) => n.id !== draggedNode.id && !carried?.has(n.id));
    },
    [nodesRef],
  );

  const onNodeDrag = useCallback<OnNodeDrag<Node<ArchNodeData>>>(
    (_event, draggedNode) => {
      const boxes = [draggedNode, ...getAlignmentCandidates(draggedNode)].map((n) =>
        nodeToAlignBox(n, nodesRef.current),
      );
      const movingBox = boxes.find((b) => b.id === draggedNode.id);
      if (!movingBox) return;
      const { guides } = computeAlignment(movingBox, boxes);
      setAlignmentGuides(guides);
    },
    [getAlignmentCandidates, nodesRef],
  );

  const onNodeDragStop = useCallback<OnNodeDrag<Node<ArchNodeData>>>(
    (_event, draggedNode) => {
      setAlignmentGuides([]);

      let snapDx = 0;
      let snapDy = 0;
      const boxes = [draggedNode, ...getAlignmentCandidates(draggedNode)].map((n) =>
        nodeToAlignBox(n, nodesRef.current),
      );
      const movingBox = boxes.find((b) => b.id === draggedNode.id);
      if (movingBox) {
        ({ snapDx, snapDy } = computeAlignment(movingBox, boxes));
      }

      const allNodes = nodesRef.current;
      if (draggedNode.type === 'group') {
        const draggedArea = nodeArea(draggedNode);
        const carried = getDescendantIds(draggedNode.id, allNodes);
        const fullyOverlapping = getIntersectingNodes(draggedNode, false).filter(
          (n) => !carried.has(n.id),
        );
        const enclosing = fullyOverlapping.filter(
          (n) => n.type === 'group' && nodeArea(n) > draggedArea,
        );
        const enclosed = fullyOverlapping.filter((n) => nodeArea(n) <= draggedArea);

        const container = pickInnermostGroup(draggedNode.id, enclosing, allNodes);
        if (enclosed.length > 0) {
          onAdoptIntoGroup(
            draggedNode.id,
            enclosed.map((n) => n.id),
            { x: draggedNode.position.x + snapDx, y: draggedNode.position.y + snapDy },
          );
        }
        onReparentNode(draggedNode.id, container ? container.id : null);
        if (snapDx !== 0 || snapDy !== 0) {
          onNodesChange([
            {
              id: draggedNode.id,
              type: 'position',
              position: { x: draggedNode.position.x + snapDx, y: draggedNode.position.y + snapDy },
            },
          ]);
        }
        onCommitGesture?.();
        return;
      }

      const intersectingGroup = pickInnermostGroup(
        draggedNode.id,
        getIntersectingNodes(draggedNode),
        allNodes,
      );
      onReparentNode(draggedNode.id, intersectingGroup ? intersectingGroup.id : null);
      if (snapDx !== 0 || snapDy !== 0) {
        onNodesChange([
          {
            id: draggedNode.id,
            type: 'position',
            position: { x: draggedNode.position.x + snapDx, y: draggedNode.position.y + snapDy },
          },
        ]);
      }
      onCommitGesture?.();
    },
    [
      getAlignmentCandidates,
      getIntersectingNodes,
      nodesRef,
      onAdoptIntoGroup,
      onNodesChange,
      onReparentNode,
      onCommitGesture,
    ],
  );

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [activeSubmenu, setActiveSubmenu] = useState<'color' | 'icon' | null>(null);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
    setActiveSubmenu(null);
  }, []);

  const openContextMenu = useCallback(
    (event: ReactMouseEvent, nodeId: string | null) => {
      if (isPresenting) return;
      event.preventDefault();

      const selectedIds = nodesRef.current.filter((n) => n.selected).map((n) => n.id);
      const targetIds =
        nodeId === null ? selectedIds : selectedIds.includes(nodeId) ? selectedIds : [nodeId];
      if (targetIds.length === 0) return;

      const left = Math.min(event.clientX, window.innerWidth - CONTEXT_MENU_WIDTH - 8);
      const top = Math.min(event.clientY, window.innerHeight - CONTEXT_MENU_HEIGHT - 8);
      setActiveSubmenu(null);
      setContextMenu({ x: Math.max(8, left), y: Math.max(8, top), targetIds });
    },
    [isPresenting, nodesRef],
  );

  const handleColorChange = useCallback(
    (color: string | undefined) => {
      if (!contextMenu) return;
      for (const id of contextMenu.targetIds) {
        const node = nodesRef.current.find((n) => n.id === id);
        if (node?.type === 'text') {
          onUpdateNode(id, { color, textColor: color });
        } else {
          onUpdateNode(id, { color });
        }
      }
      closeContextMenu();
    },
    [contextMenu, onUpdateNode, closeContextMenu, nodesRef],
  );

  const handleIconChange = useCallback(
    (icon: string | undefined) => {
      if (!contextMenu) return;
      for (const id of contextMenu.targetIds) {
        onUpdateNode(id, { icon });
      }
      closeContextMenu();
    },
    [contextMenu, onUpdateNode, closeContextMenu],
  );

  const targetPrimaryNode = useMemo(() => {
    if (!contextMenu || contextMenu.targetIds.length === 0) return undefined;
    return nodes.find((n) => n.id === contextMenu.targetIds[0]);
  }, [contextMenu, nodes]);

  const targetCurrentColor = useMemo(() => {
    if (!targetPrimaryNode) return undefined;
    return (
      targetPrimaryNode.data.color ??
      (targetPrimaryNode.type === 'text' ? targetPrimaryNode.data.textColor : undefined)
    );
  }, [targetPrimaryNode]);

  const targetDefaultColor = useMemo(() => {
    if (!targetPrimaryNode) return '#5B7CFA';
    if (targetPrimaryNode.type === 'typed') {
      return getNodeType(targetPrimaryNode.data.nodeType)?.color ?? '#98A2B3';
    }
    if (targetPrimaryNode.type === 'group') {
      return getGroupType(targetPrimaryNode.data.nodeType)?.color ?? '#7C8598';
    }
    if (targetPrimaryNode.type === 'shape') {
      return (
        globalShapeRegistry.getShape(targetPrimaryNode.data.nodeType)?.defaults.color ?? '#5B7CFA'
      );
    }
    if (targetPrimaryNode.type === 'code') {
      return '#22B8CF';
    }
    if (targetPrimaryNode.type === 'text') {
      return '#e7e9ee';
    }
    return '#5B7CFA';
  }, [targetPrimaryNode]);

  const targetCurrentIcon = useMemo(() => {
    if (!targetPrimaryNode) return undefined;
    return targetPrimaryNode.data.icon;
  }, [targetPrimaryNode]);

  const targetDefaultIcon = useMemo(() => {
    if (!targetPrimaryNode) return undefined;
    if (targetPrimaryNode.type === 'typed') {
      return getNodeType(targetPrimaryNode.data.nodeType)?.icon;
    }
    if (targetPrimaryNode.type === 'group') {
      return getGroupType(targetPrimaryNode.data.nodeType)?.icon;
    }
    if (targetPrimaryNode.type === 'shape') {
      return globalShapeRegistry.getShape(targetPrimaryNode.data.nodeType)?.iconId;
    }
    return undefined;
  }, [targetPrimaryNode]);

  const onNodeContextMenu = useCallback(
    (event: ReactMouseEvent, node: Node<ArchNodeData>) => openContextMenu(event, node.id),
    [openContextMenu],
  );
  const onSelectionContextMenu = useCallback(
    (event: ReactMouseEvent) => openContextMenu(event, null),
    [openContextMenu],
  );

  useEffect(() => {
    if (!contextMenu) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeContextMenu();
    };
    document.addEventListener('click', closeContextMenu);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('click', closeContextMenu);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu, closeContextMenu]);

  return {
    alignmentGuides,
    handleConnectEnd,
    handleReconnectStart,
    handleReconnect,
    handleReconnectEnd,
    onDragOver,
    onDrop,
    onCanvasDoubleClick,
    onNodeDrag,
    onNodeDragStop,
    contextMenu,
    activeSubmenu,
    setActiveSubmenu,
    closeContextMenu,
    openContextMenu,
    handleColorChange,
    handleIconChange,
    targetCurrentColor,
    targetDefaultColor,
    targetCurrentIcon,
    targetDefaultIcon,
    onNodeContextMenu,
    onSelectionContextMenu,
  };
}
