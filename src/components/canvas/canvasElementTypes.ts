import {memo} from 'react';
import {type EdgeTypes, MarkerType, type NodeTypes} from '@xyflow/react';
import {TypedNode} from './nodes/TypedNode';
import {TypedEdge} from './edges/TypedEdge';
import {GroupNode} from './nodes/GroupNode';
import {TextNode} from './nodes/TextNode';
import {ShapeNode} from './nodes/ShapeNode';
import {CodeNode} from './nodes/CodeNode';

/**
 * How diagram elements are drawn, shared by every React Flow instance that
 * shows the diagram: the editor's canvas and the SRD's offscreen capture
 * surface. Sharing them is what makes a captured snapshot look like the
 * canvas.
 *
 * Memoized, because React Flow renders a custom node or edge whenever it
 * re-adopts it - including when only its measured size was handed back, which
 * changes nothing the component draws. Unmemoized, every node rendered twice on
 * mount (once, then again once measured), and how many of those second passes
 * landed inside a short measurement window depended on timing: drill-in-out
 * reported 450, 525 or 600 node renders from run to run.
 */
export const CANVAS_NODE_TYPES: NodeTypes = {
  typed: memo(TypedNode),
  group: memo(GroupNode),
  shape: memo(ShapeNode),
  text: memo(TextNode),
  code: memo(CodeNode),
};

export const CANVAS_EDGE_TYPES: EdgeTypes = {
  typed: memo(TypedEdge),
};

export const DEFAULT_EDGE_OPTIONS = {
  type: 'typed',
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#98a2b3' },
  markerStart: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#98a2b3' },
};

export const PRO_OPTIONS = { hideAttribution: true };
