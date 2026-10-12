import type {Edge, Node} from '@xyflow/react';
import type {ArchEdgeData, ArchEdgeDataPatch, ArchNodeData, EdgeRouting} from './types';

/**
 * "Copy style" / "Paste style": the visual overrides of one node or edge,
 * applied to others.
 *
 * Only the keys the SOURCE actually has a slot for are present, and a key
 * that's present but undefined means "the type default" - so pasting the
 * style of a node with no color override clears the target's override,
 * rather than leaving it alone. That's what makes "make these look like
 * that one" mean what it says.
 *
 * Node and edge styles paste across kinds where it makes sense: color
 * carries over both ways, everything else only to the kind that has it.
 */
export interface CopiedStyle {
    from: 'node' | 'edge';
    color?: string;
    icon?: string;
    fontSize?: number;
    strokeWidth?: number;
    routing?: EdgeRouting;
}

const ICON_NODE_TYPES = new Set(['typed', 'group', 'shape']);
const FONT_SIZE_NODE_TYPES = new Set(['text', 'shape']);

export function styleFromNode(node: Node<ArchNodeData>): CopiedStyle {
    const style: CopiedStyle = {
        from: 'node',
        // A text node's visible color is its textColor - see the context menu's
        // color handler, which writes both.
        color: node.type === 'text' ? (node.data.textColor ?? node.data.color) : node.data.color,
    };
    if (ICON_NODE_TYPES.has(node.type ?? 'typed')) style.icon = node.data.icon;
    if (FONT_SIZE_NODE_TYPES.has(node.type ?? '')) style.fontSize = node.data.fontSize;
    return style;
}

export function styleFromEdge(edge: Edge<ArchEdgeData>): CopiedStyle {
    return {
        from: 'edge',
        color: edge.data?.color,
        strokeWidth: edge.data?.strokeWidth,
        routing: edge.data?.routing,
    };
}

export function nodeStylePatch(
    style: CopiedStyle,
    node: Node<ArchNodeData>,
): Partial<ArchNodeData> {
    const type = node.type ?? 'typed';
    const patch: Partial<ArchNodeData> =
        type === 'text' ? {color: style.color, textColor: style.color} : {color: style.color};
    if ('icon' in style && ICON_NODE_TYPES.has(type)) patch.icon = style.icon;
    if ('fontSize' in style && FONT_SIZE_NODE_TYPES.has(type)) patch.fontSize = style.fontSize;
    return patch;
}

export function edgeStylePatch(style: CopiedStyle): ArchEdgeDataPatch {
    const patch: ArchEdgeDataPatch = {color: style.color};
    if ('strokeWidth' in style) patch.strokeWidth = style.strokeWidth;
    if ('routing' in style) patch.routing = style.routing;
    return patch;
}

/** A one-line description for the context menu, e.g. "color, icon". */
export function describeStyle(style: CopiedStyle): string {
    const parts = ['color'];
    if ('icon' in style) parts.push('icon');
    if ('fontSize' in style) parts.push('text size');
    if ('strokeWidth' in style) parts.push('thickness');
    if ('routing' in style) parts.push('routing');
    return parts.join(', ');
}
