import {type RefObject, useEffect, useRef} from 'react';
import {type Edge, type Node, ReactFlow, ReactFlowProvider, useNodesInitialized, useReactFlow,} from '@xyflow/react';
import {
    CANVAS_EDGE_TYPES,
    CANVAS_NODE_TYPES,
    DEFAULT_EDGE_OPTIONS,
    PRO_OPTIONS,
} from '../../canvas/canvasElementTypes';
import type {ArchEdgeData, ArchNodeData} from '../../../domain/canvas/types';

/** One diagram level to render. `key` changes whenever its content does, and
 * stays the same across snapshots of the same level, so those share a render. */
export interface CaptureLevel {
  key: string;
  nodes: Node<ArchNodeData>[];
  edges: Edge<ArchEdgeData>[];
}

/** What a capture needs once a level has rendered. */
export interface RenderedLevel {
  key: string;
  /** The surface's element - the capture root, so capture never reaches the
   * editor's canvas. */
  root: HTMLElement;
  /** The level's nodes with React Flow's measured sizes, for framing. */
  getNodes: () => Node[];
}

export interface SrdCaptureSurfaceProps {
  level: CaptureLevel | null;
  onRendered: (rendered: RenderedLevel) => void;
}

/**
 * A React Flow canvas the SRD renders its snapshots from, kept offscreen.
 *
 * Capturing from the editor's canvas meant navigating the user's canvas to
 * each snapshot's level and back, and the result depended on their window and
 * viewport. This surface has a fixed size, draws with the editor's own node
 * and edge types, never moves the user, and works from any view.
 *
 * Positioned offscreen rather than hidden: html-to-image copies computed
 * styles, so `display: none` or `visibility: hidden` would capture nothing.
 */
export function SrdCaptureSurface({ level, onRendered }: SrdCaptureSurfaceProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={rootRef} className="srd-capture-surface" aria-hidden="true" inert>
      {level && (
        // Keyed by level, so each level starts from a fresh store and never
        // inherits measurements from the previous one. Uncontrolled
        // (defaultNodes): React Flow applies its own measurements, which is
        // what sets nodesInitialized. Controlled without an onNodesChange
        // to feed them back, it would never become true.
        <ReactFlowProvider key={level.key}>
          <ReactFlow
            defaultNodes={level.nodes}
            defaultEdges={level.edges}
            nodeTypes={CANVAS_NODE_TYPES}
            edgeTypes={CANVAS_EDGE_TYPES}
            defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
            proOptions={PRO_OPTIONS}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            panOnDrag={false}
            zoomOnScroll={false}
            zoomOnPinch={false}
            zoomOnDoubleClick={false}
            preventScrolling={false}
          />
          <RenderedSignal levelKey={level.key} rootRef={rootRef} onRendered={onRendered} />
        </ReactFlowProvider>
      )}
    </div>
  );
}

function RenderedSignal({
  levelKey,
  rootRef,
  onRendered,
}: {
  levelKey: string;
  rootRef: RefObject<HTMLDivElement | null>;
  onRendered: (rendered: RenderedLevel) => void;
}) {
  const initialized = useNodesInitialized();
  const { getNodes } = useReactFlow();
  useEffect(() => {
    const root = rootRef.current;
    if (!initialized || !root) return;
    // Measured sizes are applied in the commit after initialization; two
    // frames lets that land and paint before anything is captured.
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => onRendered({ key: levelKey, root, getNodes }));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [initialized, levelKey, rootRef, getNodes, onRendered]);
  return null;
}
