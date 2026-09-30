import { type RefObject } from 'react';
import { useCallback, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import {
  useStoreApi,
  type Node,
  type Edge,
  type OnConnectEnd,
  type OnReconnect,
  type HandleType,
  type FinalConnectionState,
  type InternalNode,
} from '@xyflow/react';
import type { ArchNodeData, ArchEdgeData } from '../../domain/canvas/types';
import {
  validateReconnection,
  isSameEndpoints,
  type EdgeEnd,
  draggedEndFromReconnectStart,
  type EdgeEndpoints,
} from '../../domain/canvas/edgeReconnect';
import { sourceHandleId, targetHandleId } from '../../domain/canvas/edgeAnchoring';
import { resolveConnectionDrag } from './edges/edgeAnchoringAdapter';
import type { CanvasProps, CanvasFlow } from './Canvas';

/**
 * Creating an edge by dragging from a node, and moving either end of an
 * existing one. Moved unchanged from Canvas.tsx.
 *
 * PERFORMANCE: all four handlers go straight onto <ReactFlow>, which keeps
 * them in its store; a new identity would push a store update. They read
 * the current nodes through nodesRef, never as a dependency.
 *
 * Performance contract: runs inside Canvas's render, called at the exact
 * position its code had in Canvas.tsx, so it adds no component, no render,
 * and no change to the order effects run in. Destructure the result and
 * depend on its members - never on the returned object, which is new on
 * every render.
 */
export function useEdgeConnectionGestures({
  screenToFlowPosition,
  onConnect,
  onReconnectEdge,
  nodesRef,
}: Pick<CanvasProps, 'onConnect' | 'onReconnectEdge'> & {
  screenToFlowPosition: CanvasFlow['screenToFlowPosition'];
  nodesRef: RefObject<Node<ArchNodeData>[]>;
}) {
  /**
   * Which END of the edge is being dragged during a reconnection, or null
   * when no reconnection is in progress. React Flow reports it (inverted)
   * to onReconnectStart and routes the gesture's end through onConnectEnd
   * as well as onReconnectEnd - this is also how handleConnectEnd tells a
   * reconnection apart from a brand new connection and stays out of it.
   */
  const reconnectEndRef = useRef<EdgeEnd | null>(null);
  const reactFlowStore = useStoreApi<Node<ArchNodeData>, Edge<ArchEdgeData>>();

  /**
   * Where a drag that just ended should attach, resolved geometrically
   * from the release point rather than from whichever React Flow handle
   * happened to be under it - see domain/edgeAnchoring.ts. The same
   * resolution drives EdgeConnectionLine's live preview.
   */
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
        fromNode: state.fromNode as InternalNode<Node>,
        fromHandle: state.fromHandle,
        pointer: screenToFlowPosition(client),
      });
    },
    [reactFlowStore, screenToFlowPosition],
  );

  /**
   * Edge creation. Every node's sides are invisible `grab-<side>` strips
   * (see EdgeHandles.tsx) that can only START a drag, never end one, so
   * React Flow's own onConnect never fires - the edge is created here
   * instead, from the node under the release point: on the side released
   * on, or the side nearest the pointer if released over the body.
   *
   * Direction always follows the drag, by construction: source is the
   * node the drag started on. (The old stacked source/target dots let
   * React Flow flip that, which needed a correction here.)
   */
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
      // handleType is the ANCHORED end's type, not the dragged end's - see
      // draggedEndFromReconnectStart.
      reconnectEndRef.current = draggedEndFromReconnectStart(handleType);
    },
    [],
  );

  /**
   * React Flow only makes edges reconnectable when onReconnect is set, but
   * it only calls it when a release lands on a valid drop HANDLE - which
   * nothing is any more. The real work happens in handleReconnectEnd.
   */
  const handleReconnect = useCallback<OnReconnect<Edge<ArchEdgeData>>>(() => {}, []);

  /**
   * Endpoint reconnection: the dragged end moves to wherever the release
   * resolves to (same rules as creating an edge), the other end stays
   * exactly as it was, so moving one end can never reverse the edge.
   *
   * Two guards before anything is written. A drag released back where it
   * started still ends up here, and writing that would sync a no-op to
   * every peer and put an entry in undo history for a gesture that
   * changed nothing. And both ends have to be nodes at this level of the
   * sub-diagram tree - React Flow only renders one level so a drag
   * shouldn't be able to reach off it, but an edge that did would be
   * invisible from every level rather than visibly wrong.
   */
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

  return {
    handleConnectEnd,
    handleReconnectStart,
    handleReconnect,
    handleReconnectEnd,
  };
}
