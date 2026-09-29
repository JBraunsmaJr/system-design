import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { Edge } from '@xyflow/react';
import type { ArchEdgeData } from '../../domain/canvas/types';
import type { CanvasProps, CanvasFlow, FocusSet } from './Canvas';

const DIMMED_NODE_OPACITY = 0.15;
const DIMMED_EDGE_OPACITY = 0.12;

/**
 * What React Flow is given to draw while something is in focus (dimmed or
 * highlighted copies of the nodes and edges), and the camera moves that
 * follow focus and level changes. Moved unchanged from Canvas.tsx.
 *
 * PERFORMANCE: with nothing in focus, displayNodes and displayEdges are the
 * very arrays Canvas was given - no copy - which is what lets React Flow
 * skip re-adopting every node. Keep that fast path first.
 *
 * Performance contract: runs inside Canvas's render, called at the exact
 * position its code had in Canvas.tsx, so it adds no component, no render,
 * and no change to the order effects run in. Destructure the result and
 * depend on its members - never on the returned object, which is new on
 * every render.
 */
export function useCanvasFocusDisplay({
  nodes,
  edges,
  presentationFocus,
  previewFocus,
  activeFocus,
  pathKey,
  fitView,
  focusNodeId,
  onFocusHandled,
}: Pick<CanvasProps, 'nodes' | 'edges' | 'previewFocus' | 'focusNodeId' | 'onFocusHandled'> & {
  presentationFocus: FocusSet | null;
  activeFocus: FocusSet | null;
  pathKey: string;
  fitView: CanvasFlow['fitView'];
}) {
  // Dims everything except the active focus set (full presentation step, or
  // a lightweight step preview from ScenarioPanel) and adds a glow class to
  // focused elements so the highlight reads clearly, not just as "slightly
  // less dim." Group nodes and text annotations can be focus targets too -
  // they're ordinary node ids underneath.
  const displayNodes = useMemo(() => {
    // zIndex is attached upstream, inside App's existing nodes map, so
    // there's no second pass over the array here - and the common case
    // returns the identical array it was given, which is what lets React
    // Flow skip re-adopting every node.
    if (presentationFocus) {
      const focusIds = new Set(presentationFocus.nodeIds);
      return nodes.map((n) => ({
        ...n,
        className: focusIds.has(n.id) ? 'is-presentation-focus' : undefined,
        style: { ...n.style, opacity: focusIds.has(n.id) ? 1 : DIMMED_NODE_OPACITY },
      }));
    }
    if (previewFocus) {
      const memberIds = new Set(previewFocus.nodeIds);
      return nodes.map((n) => {
        if (memberIds.has(n.id)) return { ...n, className: 'is-step-member' };
        // Selected while a step is being edited, but not (yet) part of it -
        // a distinct highlight from is-step-member, signaling "you could
        // add this" rather than "this is already included".
        if (n.selected) return { ...n, className: 'is-step-candidate' };
        return n;
      });
    }
    return nodes;
  }, [nodes, presentationFocus, previewFocus]);

  const displayEdges = useMemo(() => {
    if (presentationFocus) {
      const focusIds = new Set(presentationFocus.edgeIds);
      return edges.map((e) => ({
        ...e,
        animated: focusIds.has(e.id),
        style: { ...e.style, opacity: focusIds.has(e.id) ? 1 : DIMMED_EDGE_OPACITY },
      }));
    }
    if (previewFocus) {
      /**
       * TypedEdge reads data.isStepMember itself (see its comment on
       * ArcheEdgeData) rather than a className, since React Flow doesn't pass
       * an edge's className through to custom edge components the way it does
       * for nodes. Setting it explicitly to false (not leaving it undefined)
       * for non-members - rather than only setting it for members - is what lets
       * TypedEdge tell a step preview is active, but this specific
       * edge isn't part of it.
       */
      const memberIds = new Set(previewFocus.edgeIds);
      return edges.map((e): Edge<ArchEdgeData> => {
        if (!e.data) return e;
        return { ...e, data: { ...e.data, isStepMember: memberIds.has(e.id) } };
      });
    }
    return edges;
  }, [edges, presentationFocus, previewFocus]);

  // Auto-frame the camera on the active focus set's nodes. Keyed off a
  // derived string (not the object itself) so this only re-fits when the
  // actual focused ids change, not on every render. Clearing focus doesn't
  // trigger a re-fit - only a newly (re)activated focus does.
  const focusKey = activeFocus ? activeFocus.nodeIds.join(',') : null;
  useEffect(() => {
    if (!activeFocus || activeFocus.nodeIds.length === 0) return;
    fitView({ nodes: activeFocus.nodeIds.map((id) => ({ id })), padding: 0.35, duration: 450 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: see comment above
  }, [focusKey, fitView]);

  // The current level's contents change (drilling in/out swaps to a
  // completely different set of nodes), so re-frame the camera whenever the
  // breadcrumb path changes - UNLESS there's an active focus (presenting or
  // previewing), in which case the focus-based effect above already frames
  // the right thing; without this guard, a scenario step that both changes
  // level AND focuses specific elements would fire two competing fitView
  // calls back to back.
  useEffect(() => {
    if (activeFocus) return;
    fitView({ padding: 0.2, duration: 300 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: see comment above
  }, [pathKey, fitView]);

  // Clears the one-shot "jump to this node" request once it's been
  // consumed, so navigating to the same node again later still fires -
  // same requestAnimationFrame-deferred pattern as RequirementsView's
  // focusItemId handling (waits a frame so this always runs after the
  // fitView effects above, which need the just-changed path's nodes to
  // already be rendered). Deliberately a separate effect, not folded into
  // the fitView effects above, so it can't change their existing,
  // already-correct coordination logic.
  const onFocusHandledRef = useRef(onFocusHandled);
  useLayoutEffect(() => {
    onFocusHandledRef.current = onFocusHandled;
  }, [onFocusHandled]);

  useEffect(() => {
    if (!focusNodeId) return;
    const frame = requestAnimationFrame(() => onFocusHandledRef.current?.());
    return () => cancelAnimationFrame(frame);
  }, [focusNodeId]);

  return {
    displayNodes,
    displayEdges,
  };
}
