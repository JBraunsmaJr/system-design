import { createContext, useContext } from "react";
import type { ArchEdgeDataPatch, EdgeWaypoint } from "../domain/types";

export interface CanvasContextValue {
  isPresenting: boolean;
  onDrillInto: (nodeId: string) => void;
  editingLabelNodeId: string | null;
  setEditingLabelNodeId: (id: string | null) => void;
  onChangeTextNode: (nodeId: string, text: string) => void;
  onChangeCodeNode: (nodeId: string, code: string) => void;
  onUpdateEdge?: (id: string, patch: ArchEdgeDataPatch) => void;
  onAdoptIntoGroup?: (groupId: string, nodeIds: string[], groupPosition?: { x: number; y: number }) => void;
  /** Bend manipulation, reaching TypedEdge the same way onUpdateEdge
   * already does. Three separate named callbacks rather than one
   * "set the waypoints" callback, because that's the shape the store
   * needs underneath - see DiagramStore's own waypoint operations for
   * why a wholesale array replace is the one thing that must not
   * happen here. */
  onAddEdgeWaypoint?: (edgeId: string, index: number, waypoint: EdgeWaypoint) => void;
  onMoveEdgeWaypoint?: (edgeId: string, waypointId: string, position: { x: number; y: number }) => void;
  onRemoveEdgeWaypoint?: (edgeId: string, waypointId: string) => void;
}

export const CanvasContext = createContext<CanvasContextValue | null>(null);

export function useCanvasContext() {
  return useContext(CanvasContext);
}
