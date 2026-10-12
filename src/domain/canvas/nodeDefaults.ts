import type {Node} from '@xyflow/react';
import {getNodeType} from './nodeRegistry';
import {getGroupType} from './groupRegistry';
import {globalShapeRegistry} from './shapeRegistry';
import type {ArchNodeData} from './types';

/**
 * What a node looks like with no overrides - the color and icon its TYPE
 * gives it. Shared by the context menu and the Inspector, so "Reset" means
 * the same thing in both.
 */
export function defaultNodeColor(node: Node<ArchNodeData>): string {
    switch (node.type) {
        case 'typed':
            return getNodeType(node.data.nodeType)?.color ?? '#98A2B3';
        case 'group':
            return getGroupType(node.data.nodeType)?.color ?? '#7C8598';
        case 'shape':
            return globalShapeRegistry.getShape(node.data.nodeType)?.defaults.color ?? '#5B7CFA';
        case 'code':
            return '#22B8CF';
        case 'text':
            return '#e7e9ee';
        default:
            return '#5B7CFA';
    }
}

/** The node's own color override, if any. A text node's lives in
 * textColor - see the context menu's color handler, which writes both. */
export function nodeColorOverride(node: Node<ArchNodeData>): string | undefined {
    return node.data.color ?? (node.type === 'text' ? node.data.textColor : undefined);
}

export function defaultNodeIcon(node: Node<ArchNodeData>): string | undefined {
    switch (node.type) {
        case 'typed':
            return getNodeType(node.data.nodeType)?.icon;
        case 'group':
            return getGroupType(node.data.nodeType)?.icon;
        case 'shape':
            return globalShapeRegistry.getShape(node.data.nodeType)?.iconId;
        default:
            return undefined;
    }
}

/** Node kinds that draw an icon, and so can have one overridden. */
export function nodeHasIcon(node: Node<ArchNodeData>): boolean {
    return node.type === 'typed' || node.type === 'group' || node.type === 'shape';
}

/** The patch that sets a node's color, written the way each kind reads it. */
export function nodeColorPatch(
    node: Node<ArchNodeData>,
    color: string | undefined,
): Partial<ArchNodeData> {
    return node.type === 'text' ? {color, textColor: color} : {color};
}
