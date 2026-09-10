import { useCallback, useEffect, useRef, useState } from "react";
import type { Node, Edge } from "@xyflow/react";
import type { ArchNodeData, ArchEdgeData } from "../../domain/types";
import {
  hasDocumentation,
  extractNodeDocumentation,
  extractEdgeDocumentation,
  DEFAULT_HOVER_DELAY,
  DEFAULT_LEAVE_DELAY,
  type DiagramDocumentation,
} from "../../domain/diagramDocumentation";

export interface ActiveTarget {
  type: "node" | "edge";
  id: string;
  anchor: { x: number; y: number };
}

export interface UseDiagramHoverDocumentationOptions {
  nodes: Node<ArchNodeData>[];
  edges: Edge<ArchEdgeData>[];
  hoverDelay?: number;
  leaveDelay?: number;
  disabled?: boolean;
}

export function useDiagramHoverDocumentation({
  nodes,
  edges,
  hoverDelay = DEFAULT_HOVER_DELAY,
  leaveDelay = DEFAULT_LEAVE_DELAY,
  disabled = false,
}: UseDiagramHoverDocumentationOptions) {
  const [activeTarget, setActiveTarget] = useState<ActiveTarget | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current !== null) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  const clearLeaveTimer = useCallback(() => {
    if (leaveTimerRef.current !== null) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
  }, []);

  const closeDocumentation = useCallback(() => {
    clearHoverTimer();
    clearLeaveTimer();
    setIsOpen(false);
    setActiveTarget(null);
  }, [clearHoverTimer, clearLeaveTimer]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      clearHoverTimer();
      clearLeaveTimer();
    };
  }, [clearHoverTimer, clearLeaveTimer]);

  // Live updates (FR-015): Re-evaluate documentation when nodes/edges change
  let currentDoc: DiagramDocumentation | null = null;
  let currentTitle: string | undefined;
  let currentSubtitle: string | undefined;

  if (activeTarget) {
    if (activeTarget.type === "node") {
      const node = nodes.find((n) => n.id === activeTarget.id);
      if (node) {
        const extracted = extractNodeDocumentation(node);
        if (hasDocumentation(extracted.documentation)) {
          currentDoc = extracted.documentation;
          currentTitle = extracted.title;
          currentSubtitle = extracted.subtitle;
        }
      }
    } else if (activeTarget.type === "edge") {
      const edge = edges.find((e) => e.id === activeTarget.id);
      if (edge) {
        const extracted = extractEdgeDocumentation(edge);
        if (hasDocumentation(extracted.documentation)) {
          currentDoc = extracted.documentation;
          currentTitle = extracted.title;
          currentSubtitle = extracted.subtitle;
        }
      }
    }
  }

  // If active target no longer has documentation, hide popup
  useEffect(() => {
    if (isOpen && activeTarget && !currentDoc) {
      setIsOpen(false);
      setActiveTarget(null);
    }
  }, [isOpen, activeTarget, currentDoc]);

  // Mouse handlers for Nodes
  const handleNodeMouseEnter = useCallback(
    (event: React.MouseEvent, node: Node<ArchNodeData>) => {
      if (disabled) return;
      clearLeaveTimer();
      const extracted = extractNodeDocumentation(node);
      if (!hasDocumentation(extracted.documentation)) {
        if (isOpen) closeDocumentation();
        return;
      }

      const anchor = { x: event.clientX, y: event.clientY };

      if (isOpen && activeTarget?.id !== node.id) {
        // If popup is already open from another element, switch smoothly
        setActiveTarget({ type: "node", id: node.id, anchor });
        setIsOpen(true);
      } else {
        clearHoverTimer();
        hoverTimerRef.current = setTimeout(() => {
          setActiveTarget({ type: "node", id: node.id, anchor });
          setIsOpen(true);
        }, hoverDelay);
      }
    },
    [disabled, isOpen, activeTarget?.id, hoverDelay, clearLeaveTimer, clearHoverTimer, closeDocumentation]
  );

  const handleNodeMouseMove = useCallback(
    (event: React.MouseEvent, _node: Node<ArchNodeData>) => {
      if (disabled) return;
      if (!isOpen && hoverTimerRef.current !== null) {
        // Update anchor position while waiting for hover threshold
        setActiveTarget((prev) =>
          prev ? { ...prev, anchor: { x: event.clientX, y: event.clientY } } : null
        );
      }
    },
    [disabled, isOpen]
  );

  const handleNodeMouseLeave = useCallback(
    (_event: React.MouseEvent, _node: Node<ArchNodeData>) => {
      if (disabled) return;
      clearHoverTimer();
      if (isOpen) {
        clearLeaveTimer();
        leaveTimerRef.current = setTimeout(() => {
          closeDocumentation();
        }, leaveDelay);
      }
    },
    [disabled, isOpen, leaveDelay, clearHoverTimer, clearLeaveTimer, closeDocumentation]
  );

  // Mouse handlers for Edges
  const handleEdgeMouseEnter = useCallback(
    (event: React.MouseEvent, edge: Edge<ArchEdgeData>) => {
      if (disabled) return;
      clearLeaveTimer();
      const extracted = extractEdgeDocumentation(edge);
      if (!hasDocumentation(extracted.documentation)) {
        if (isOpen) closeDocumentation();
        return;
      }

      const anchor = { x: event.clientX, y: event.clientY };

      if (isOpen && activeTarget?.id !== edge.id) {
        setActiveTarget({ type: "edge", id: edge.id, anchor });
        setIsOpen(true);
      } else {
        clearHoverTimer();
        hoverTimerRef.current = setTimeout(() => {
          setActiveTarget({ type: "edge", id: edge.id, anchor });
          setIsOpen(true);
        }, hoverDelay);
      }
    },
    [disabled, isOpen, activeTarget?.id, hoverDelay, clearLeaveTimer, clearHoverTimer, closeDocumentation]
  );

  const handleEdgeMouseMove = useCallback(
    (event: React.MouseEvent, _edge: Edge<ArchEdgeData>) => {
      if (disabled) return;
      if (!isOpen && hoverTimerRef.current !== null) {
        setActiveTarget((prev) =>
          prev ? { ...prev, anchor: { x: event.clientX, y: event.clientY } } : null
        );
      }
    },
    [disabled, isOpen]
  );

  const handleEdgeMouseLeave = useCallback(
    (_event: React.MouseEvent, _edge: Edge<ArchEdgeData>) => {
      if (disabled) return;
      clearHoverTimer();
      if (isOpen) {
        clearLeaveTimer();
        leaveTimerRef.current = setTimeout(() => {
          closeDocumentation();
        }, leaveDelay);
      }
    },
    [disabled, isOpen, leaveDelay, clearHoverTimer, clearLeaveTimer, closeDocumentation]
  );

  // Touch handlers (FR-013, 6.3) & Click handlers
  const handleNodeClick = useCallback(
    (event: React.MouseEvent, node: Node<ArchNodeData>) => {
      if (disabled) return;
      const extracted = extractNodeDocumentation(node);
      if (hasDocumentation(extracted.documentation)) {
        clearHoverTimer();
        clearLeaveTimer();
        setActiveTarget({
          type: "node",
          id: node.id,
          anchor: { x: event.clientX, y: event.clientY },
        });
        setIsOpen(true);
      }
    },
    [disabled, clearHoverTimer, clearLeaveTimer]
  );

  const handleEdgeClick = useCallback(
    (event: React.MouseEvent, edge: Edge<ArchEdgeData>) => {
      if (disabled) return;
      const extracted = extractEdgeDocumentation(edge);
      if (hasDocumentation(extracted.documentation)) {
        clearHoverTimer();
        clearLeaveTimer();
        setActiveTarget({
          type: "edge",
          id: edge.id,
          anchor: { x: event.clientX, y: event.clientY },
        });
        setIsOpen(true);
      }
    },
    [disabled, clearHoverTimer, clearLeaveTimer]
  );

  // Keyboard accessibility helper (FR-012)
  const showDocumentationForElement = useCallback(
    (type: "node" | "edge", id: string, anchor: { x: number; y: number }) => {
      if (disabled) return;
      const item =
        type === "node"
          ? nodes.find((n) => n.id === id)
          : edges.find((e) => e.id === id);
      if (!item) return;

      const extracted =
        type === "node"
          ? extractNodeDocumentation(item as Node<ArchNodeData>)
          : extractEdgeDocumentation(item as Edge<ArchEdgeData>);

      if (hasDocumentation(extracted.documentation)) {
        clearHoverTimer();
        clearLeaveTimer();
        setActiveTarget({ type, id, anchor });
        setIsOpen(true);
      }
    },
    [disabled, nodes, edges, clearHoverTimer, clearLeaveTimer]
  );

  // Popup hover persistence (FR-011)
  const handlePopupMouseEnter = useCallback(() => {
    clearLeaveTimer();
  }, [clearLeaveTimer]);

  const handlePopupMouseLeave = useCallback(() => {
    clearLeaveTimer();
    leaveTimerRef.current = setTimeout(() => {
      closeDocumentation();
    }, leaveDelay);
  }, [leaveDelay, clearLeaveTimer, closeDocumentation]);

  return {
    isOpen: isOpen && currentDoc !== null,
    documentation: currentDoc ?? {},
    title: currentTitle,
    subtitle: currentSubtitle,
    anchor: activeTarget?.anchor ?? null,
    closeDocumentation,
    showDocumentationForElement,
    handleNodeMouseEnter,
    handleNodeMouseMove,
    handleNodeMouseLeave,
    handleEdgeMouseEnter,
    handleEdgeMouseMove,
    handleEdgeMouseLeave,
    handleNodeClick,
    handleEdgeClick,
    handlePopupMouseEnter,
    handlePopupMouseLeave,
  };
}
