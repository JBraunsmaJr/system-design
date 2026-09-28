import type { Node, Edge } from '@xyflow/react';
import type { ArchNodeData, ArchEdgeData, ArchEdgeDataPatch } from '../../domain/canvas/types';
import type { ZOrderCommand } from '../../domain/canvas/zOrder';
import type { RequirementsDocument } from '../../domain/requirements/requirementsTypes';
import { NodeInspector } from './inspectors/NodeInspector';
import { EdgeInspector } from './inspectors/EdgeInspector';

export interface InspectorProps {
  selectedNode: Node<ArchNodeData> | null;
  selectedEdge: Edge<ArchEdgeData> | null;
  onUpdateNode: (id: string, patch: Partial<ArchNodeData>) => void;
  onUpdateEdge: (id: string, patch: ArchEdgeDataPatch) => void;
  /** Drops every bend from an edge, returning it to automatic routing.
   * Its own callback rather than an onUpdateEdge patch because
   * waypoints deliberately aren't patchable - see ArchEdgeDataPatch. */
  onClearEdgeWaypoints: (edgeId: string) => void;
  onRemoveEdgeWaypoint?: (edgeId: string, waypointId: string) => void;
  onDeleteNode: (id: string) => void;
  onDeleteEdge: (id: string) => void;
  onDrillInto: (id: string) => void;
  requirements: RequirementsDocument;
  onNavigateToRequirement: (itemId: string) => void;
  onZOrderCommand: (command: ZOrderCommand) => void;
}

export function Inspector({
  selectedNode,
  selectedEdge,
  onClearEdgeWaypoints,
  onRemoveEdgeWaypoint,
  onUpdateNode,
  onUpdateEdge,
  onDeleteNode,
  onDeleteEdge,
  onDrillInto,
  requirements,
  onNavigateToRequirement,
  onZOrderCommand,
}: InspectorProps) {
  if (!selectedNode && !selectedEdge) {
    return (
      <aside className="inspector">
        <div className="panel-header">Inspector</div>
        <p className="inspector__empty">
          Select a node or edge to edit its label, description, properties, and tags.
        </p>
      </aside>
    );
  }

  if (selectedNode) {
    return (
      <NodeInspector
        selectedNode={selectedNode}
        onUpdateNode={onUpdateNode}
        onDeleteNode={onDeleteNode}
        onDrillInto={onDrillInto}
        requirements={requirements}
        onNavigateToRequirement={onNavigateToRequirement}
        onZOrderCommand={onZOrderCommand}
      />
    );
  }

  return (
    <EdgeInspector
      selectedEdge={selectedEdge!}
      onUpdateEdge={onUpdateEdge}
      onClearEdgeWaypoints={onClearEdgeWaypoints}
      onRemoveEdgeWaypoint={onRemoveEdgeWaypoint}
      onDeleteEdge={onDeleteEdge}
    />
  );
}
