import type { Node, Edge } from "@xyflow/react";

// Core domain types for the system-design editor.
// These mirror the taxonomy described in the project's Requirements & Software
// Design Document: nodes and edges are *typed* against an extensible registry
// rather than being generic shapes/lines.

export type NodeCategory =
  | "compute"
  | "data"
  | "networking"
  | "messaging"
  | "external"
  | "observability"
  | "logic";

/** A node type as it appears in the palette (e.g. "microservice", "database"). */
export interface NodeTypeDefinition {
  id: string;
  category: NodeCategory;
  label: string;
  /** lucide-react icon component name, e.g. "Server" */
  icon: string;
  color: string;
  /** Pre-filled properties a new instance starts with, e.g. an Endpoint's method/path. */
  defaultProperties?: Record<string, string>;
}

export type EdgeStyleGroup = "sync" | "async" | "data" | "file" | "control" | "generic";

/** An edge/traffic type as it appears in the inspector (e.g. "grpc", "webhook"). */
export interface EdgeTypeDefinition {
  id: string;
  styleGroup: EdgeStyleGroup;
  label: string;
  color: string;
  /** SVG stroke-dasharray, omitted for solid lines */
  dash?: string;
}

/**
 * Per-instance data stored on a React Flow node.
 * `nodeType` points back into the NODE_TYPES registry. `subDiagram`, if
 * present, is a fully independent nested canvas "inside" this node - drilled
 * into via double-click or the Inspector. It's just a regular field on the
 * node's own data, so the whole nested tree serializes as part of the same
 * single JSON file rather than needing separate files per level. A node's
 * subDiagram can itself contain nodes with their own subDiagram, recursively,
 * with no fixed depth limit.
 */
export interface ArchNodeData extends Record<string, unknown> {
  nodeType: string;
  label: string;
  description?: string;
  properties: Record<string, string>;
  tags: string[];
  subDiagram?: SubDiagram;
}

/**
 * Per-instance data stored on a React Flow edge.
 * `edgeType` points back into the EDGE_TYPES registry. `direction` lets an
 * edge's animated flow (Presentation Mode only) run against its drawn
 * source->target arrow - e.g. a reply/response or a replica pulling from a
 * primary. Defaults to "forward" when unset, for backward compatibility
 * with diagrams saved before this field existed.
 */
export interface ArchEdgeData extends Record<string, unknown> {
  edgeType: string;
  label?: string;
  direction?: "forward" | "reverse";
  properties: Record<string, string>;
}

/**
 * An independent set of nodes/edges nested inside a parent node. Scenarios
 * are intentionally NOT part of this - they stay scoped to the top-level
 * diagram for now (see App.tsx), since a scenario step's focus ids only ever
 * make sense against one specific level of the tree.
 */
export interface SubDiagram {
  nodes: Node<ArchNodeData>[];
  edges: Edge<ArchEdgeData>[];
}

/** A single point in a Scenario's walkthrough - see ScenarioPanel/Presentation. */
export interface ScenarioStep {
  id: string;
  title: string;
  narration?: string;
  /** Node/group ids highlighted for this step; everything else dims. */
  focusNodeIds: string[];
  /** Edge ids highlighted for this step. */
  focusEdgeIds: string[];
}

/** A named, ordered walkthrough attached to the diagram. */
export interface Scenario {
  id: string;
  title: string;
  steps: ScenarioStep[];
}
