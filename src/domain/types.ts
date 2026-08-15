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
  | "observability";

/** A node type as it appears in the palette (e.g. "microservice", "database"). */
export interface NodeTypeDefinition {
  id: string;
  category: NodeCategory;
  label: string;
  /** lucide-react icon component name, e.g. "Server" */
  icon: string;
  color: string;
}

export type EdgeStyleGroup = "sync" | "async" | "data" | "file" | "generic";

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
 * `nodeType` points back into the NODE_TYPES registry.
 */
export interface ArchNodeData extends Record<string, unknown> {
  nodeType: string;
  label: string;
  description?: string;
  properties: Record<string, string>;
  tags: string[];
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
