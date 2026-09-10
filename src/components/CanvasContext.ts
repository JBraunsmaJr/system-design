import { createContext, useContext } from "react";
import type { ArchEdgeData } from "../domain/types";

export interface CanvasContextValue {
  isPresenting: boolean;
  onDrillInto: (nodeId: string) => void;
  editingLabelNodeId: string | null;
  setEditingLabelNodeId: (id: string | null) => void;
  onChangeTextNode: (nodeId: string, text: string) => void;
  onChangeCodeNode: (nodeId: string, code: string) => void;
  onUpdateEdge?: (id: string, patch: Partial<ArchEdgeData>) => void;
  onAdoptIntoGroup?: (groupId: string, nodeIds: string[], groupPosition?: { x: number; y: number }) => void;
}

export const CanvasContext = createContext<CanvasContextValue | null>(null);

export function useCanvasContext() {
  return useContext(CanvasContext);
}
