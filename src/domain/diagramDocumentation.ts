import type { Node, Edge } from "@xyflow/react";
import type { ArchNodeData, ArchEdgeData } from "./types";
import { getNodeType, CATEGORY_LABELS } from "./nodeRegistry";
import { getGroupType } from "./groupRegistry";
import { globalShapeRegistry, getShapeType } from "./shapeRegistry";
import { getEdgeType } from "./edgeRegistry";

export interface DiagramDocumentation {
  description?: string;
  properties?: Record<string, unknown>;
  tags?: string[];
}

export const DEFAULT_HOVER_DELAY = 300;
export const DEFAULT_LEAVE_DELAY = 150;

/**
 * Checks whether a single property value has meaningful content.
 * Empty strings (or whitespace-only), empty arrays, and empty objects
 * are considered empty. Numbers, booleans, and non-empty structures are meaningful.
 * Cycles are tracked via WeakSet to prevent stack overflow on self-referential structures.
 */
export function isMeaningfulValue(val: unknown, seen = new WeakSet<object>()): boolean {
  if (val === undefined || val === null) {
    return false;
  }
  if (typeof val === "string") {
    return val.trim().length > 0;
  }
  if (typeof val === "number") {
    return !Number.isNaN(val);
  }
  if (typeof val === "boolean") {
    return true;
  }
  if (typeof val === "object") {
    if (seen.has(val)) return false;
    seen.add(val);
    if (Array.isArray(val)) {
      return val.length > 0 && val.some((item) => isMeaningfulValue(item, seen));
    }
    const entries = Object.entries(val);
    if (entries.length === 0) return false;
    return entries.some(([k, v]) => k.trim().length > 0 && isMeaningfulValue(v, seen));
  }
  return false;
}

/**
 * A shared utility to determine whether documentation is meaningful (TR-003, FR-003).
 * Treats whitespace-only strings, empty objects, empty arrays, and empty tags
 * as having no documentation.
 */
export function hasDocumentation(
  documentation: DiagramDocumentation | undefined
): boolean {
  if (!documentation) {
    return false;
  }

  // 1. Description
  if (
    typeof documentation.description === "string" &&
    documentation.description.trim().length > 0
  ) {
    return true;
  }

  // 2. Tags
  if (
    Array.isArray(documentation.tags) &&
    documentation.tags.some(
      (tag) => typeof tag === "string" && tag.trim().length > 0
    )
  ) {
    return true;
  }

  // 3. Properties
  if (
    documentation.properties &&
    typeof documentation.properties === "object" &&
    !Array.isArray(documentation.properties)
  ) {
    for (const [key, value] of Object.entries(documentation.properties)) {
      if (key.trim().length > 0 && isMeaningfulValue(value)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Safely formats property values into human-readable strings (TR-005, FR-006).
 * Handles primitives, arrays, objects, and circular references without crashing.
 */
export function formatPropertyValue(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isNaN(value) ? "NaN" : String(value);
  if (typeof value === "boolean") return value ? "true" : "false";

  if (typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);

    if (Array.isArray(value)) {
      if (value.length === 0) return "[]";
      const formattedItems = value.map((item) => formatPropertyValue(item, seen));
      return formattedItems.join(", ");
    }

    try {
      const jsonSeen = new WeakSet<object>();
      jsonSeen.add(value);
      return JSON.stringify(
        value,
        (key, val) => {
          if (typeof val === "object" && val !== null) {
            if (key !== "" && (jsonSeen.has(val) || seen.has(val))) {
              return "[Circular]";
            }
            jsonSeen.add(val);
            seen.add(val);
          }
          return val;
        },
        2
      );
    } catch {
      return "[Object]";
    }
  }

  return String(value);
}

export interface ExtractedDocumentation {
  documentation: DiagramDocumentation;
  title?: string;
  subtitle?: string;
}

/**
 * Extracts and normalizes documentation from an ArchNode.
 */
export function extractNodeDocumentation(
  node: Node<ArchNodeData>
): ExtractedDocumentation {
  const data = node.data;
  const isGroup = node.type === "group";
  const isShape = node.type === "shape";
  const isCode = node.type === "code";
  const isText = node.type === "text";

  const title: string | undefined = data?.label?.trim() ? data.label.trim() : undefined;
  let subtitle: string | undefined;

  if (isGroup) {
    const groupDef = getGroupType(data.nodeType);
    subtitle = groupDef?.label ?? "Boundary";
  } else if (isShape) {
    const fullShapeDef = globalShapeRegistry.getShape(data.nodeType);
    const shapeDef = getShapeType(data.nodeType);
    subtitle = fullShapeDef?.name ?? shapeDef?.label ?? "Shape";
  } else if (isCode) {
    subtitle = data.codeLanguage ? `Code (${data.codeLanguage})` : "Code Snippet";
  } else if (isText) {
    subtitle = "Text Note";
  } else {
    const nodeDef = getNodeType(data.nodeType);
    if (nodeDef) {
      subtitle = `${CATEGORY_LABELS[nodeDef.category] || nodeDef.category} · ${nodeDef.label}`;
    } else {
      subtitle = data.nodeType;
    }
  }

  const rawTags = data?.tags;
  const tags = Array.isArray(rawTags)
    ? rawTags.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    : undefined;

  const documentation: DiagramDocumentation = {
    description: data.description,
    properties: data.properties,
    tags,
  };

  return {
    documentation,
    title,
    subtitle,
  };
}

/**
 * Extracts and normalizes documentation from an ArchEdge.
 */
export function extractEdgeDocumentation(
  edge: Edge<ArchEdgeData>
): ExtractedDocumentation {
  const data = edge.data;
  const edgeTypeDef = getEdgeType(data?.edgeType ?? "generic");

  const title: string | undefined = data?.label?.trim()
    ? data.label.trim()
    : edgeTypeDef?.label?.trim()
    ? edgeTypeDef.label.trim()
    : undefined;

  const subtitle = edgeTypeDef?.label || "Edge";

  const rawTags = (data as Record<string, unknown> | undefined)?.tags;
  const tags = Array.isArray(rawTags)
    ? rawTags.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    : undefined;

  const documentation: DiagramDocumentation = {
    description: (data as Record<string, unknown> | undefined)?.description as string | undefined,
    properties: data?.properties,
    tags,
  };

  return {
    documentation,
    title,
    subtitle,
  };
}

export interface PopupSize {
  width: number;
  height: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

/**
 * Computes viewport-aware positioning for the documentation popup.
 * Places the popup near the anchor coordinates, shifting and flipping
 * to remain fully within the viewport.
 */
export function computeDocumentationPopupPosition(
  anchor: { x: number; y: number },
  popupSize: PopupSize,
  viewport: ViewportSize,
  gap = 12
): { top: number; left: number } {
  const margin = 10;
  let left = anchor.x + gap;
  let top = anchor.y + gap;

  // Horizontal clamping & adjustment
  if (left + popupSize.width + margin > viewport.width) {
    // Try placing to the left of anchor
    const leftCandidate = anchor.x - popupSize.width - gap;
    if (leftCandidate >= margin) {
      left = leftCandidate;
    } else {
      // Clamp to right edge with margin
      left = Math.max(margin, viewport.width - popupSize.width - margin);
    }
  }

  // Vertical clamping & adjustment (flip above if overflowing below)
  if (top + popupSize.height + margin > viewport.height) {
    const topCandidate = anchor.y - popupSize.height - gap;
    if (topCandidate >= margin) {
      top = topCandidate;
    } else {
      top = Math.max(margin, viewport.height - popupSize.height - margin);
    }
  }

  left = Math.max(margin, Math.min(left, viewport.width - popupSize.width - margin));
  top = Math.max(margin, Math.min(top, viewport.height - popupSize.height - margin));

  return { top, left };
}
