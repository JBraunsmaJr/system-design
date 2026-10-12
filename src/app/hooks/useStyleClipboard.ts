import {useCallback, useState} from 'react';
import type {Edge, Node} from '@xyflow/react';
import {
    type CopiedStyle,
    edgeStylePatch,
    nodeStylePatch,
    styleFromEdge,
    styleFromNode,
} from '../../domain/canvas/styleClipboard';
import type {ArchEdgeData, ArchEdgeDataPatch, ArchNodeData} from '../../domain/canvas/types';

export interface UseStyleClipboardOptions {
    nodes: Node<ArchNodeData>[];
    edges: Edge<ArchEdgeData>[];
    onUpdateNodes: (updates: { id: string; patch: Partial<ArchNodeData> }[]) => void;
    onUpdateEdges: (updates: { id: string; patch: ArchEdgeDataPatch }[]) => void;
}

/**
 * Copy style / paste style (domain/canvas/styleClipboard.ts). Kept apart
 * from the content clipboard on purpose: copying a style shouldn't throw
 * away the nodes someone copied a moment ago, and vice versa.
 *
 * Like useClipboard's handlers, these are only read by the context menu and
 * the keyboard shortcut effect, never handed to nodes or edges, so their
 * identity following `nodes` costs nothing.
 */
export function useStyleClipboard({
                                      nodes,
                                      edges,
                                      onUpdateNodes,
                                      onUpdateEdges,
                                  }: UseStyleClipboardOptions) {
    const [copiedStyle, setCopiedStyle] = useState<CopiedStyle | null>(null);

    /** Copies the style of the first node, or failing that the first edge. */
    const onCopyStyle = useCallback(
        (nodeIds: string[], edgeIds: string[]) => {
            const node = nodeIds.length > 0 ? nodes.find((n) => n.id === nodeIds[0]) : undefined;
            if (node) {
                setCopiedStyle(styleFromNode(node));
                return;
            }
            const edge = edgeIds.length > 0 ? edges.find((e) => e.id === edgeIds[0]) : undefined;
            if (edge) setCopiedStyle(styleFromEdge(edge));
        },
        [nodes, edges],
    );

    const onPasteStyle = useCallback(
        (nodeIds: string[], edgeIds: string[]) => {
            if (!copiedStyle) return;
            const nodeSet = new Set(nodeIds);
            const edgeSet = new Set(edgeIds);
            onUpdateNodes(
                nodes
                    .filter((n) => nodeSet.has(n.id))
                    .map((n) => ({id: n.id, patch: nodeStylePatch(copiedStyle, n)})),
            );
            onUpdateEdges(
                edges
                    .filter((e) => edgeSet.has(e.id))
                    .map((e) => ({id: e.id, patch: edgeStylePatch(copiedStyle)})),
            );
        },
        [copiedStyle, nodes, edges, onUpdateNodes, onUpdateEdges],
    );

    return {copiedStyle, onCopyStyle, onPasteStyle};
}
