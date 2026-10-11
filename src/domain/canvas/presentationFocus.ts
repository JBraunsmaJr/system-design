import type {Edge, Node} from '@xyflow/react';

export const DIMMED_NODE_OPACITY = 0.15;
export const DIMMED_EDGE_OPACITY = 0.12;

/** The nodes and edges a presentation step highlights. */
export interface PresentationFocusIds {
    nodeIds: readonly string[];
    edgeIds: readonly string[];
}

/**
 * Presentation Mode's look for a step: everything outside the focus set is
 * dimmed, focused nodes get the `is-presentation-focus` glow class, and
 * focused edges are drawn at full opacity (TypedEdge reads `style.opacity
 * === 1` as "focused" and thickens and glows them).
 *
 * `animateEdges` turns on the flowing-dash animation on focused edges. The
 * live presentation wants it; an exported image does not, because a capture
 * freezes the dashes at whatever offset they happened to be at.
 *
 * Shared by the editor's canvas (useCanvasFocusDisplay) and the scenario
 * exporter, so an exported step looks exactly like the presented one.
 */
export function applyPresentationFocusToNodes<N extends Node>(
    nodes: N[],
    focus: PresentationFocusIds,
): N[] {
    const focusIds = new Set(focus.nodeIds);
    return nodes.map((n) => ({
        ...n,
        className: focusIds.has(n.id) ? 'is-presentation-focus' : undefined,
        style: {...n.style, opacity: focusIds.has(n.id) ? 1 : DIMMED_NODE_OPACITY},
    }));
}

export function applyPresentationFocusToEdges<E extends Edge>(
    edges: E[],
    focus: PresentationFocusIds,
    {animateEdges}: { animateEdges: boolean },
): E[] {
    const focusIds = new Set(focus.edgeIds);
    return edges.map((e) => ({
        ...e,
        animated: animateEdges && focusIds.has(e.id),
        style: {...e.style, opacity: focusIds.has(e.id) ? 1 : DIMMED_EDGE_OPACITY},
    }));
}
