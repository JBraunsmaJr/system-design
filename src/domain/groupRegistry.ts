export interface GroupTypeDefinition {
  id: string;
  label: string;
}

/**
 * Boundary/group presets. These render via GroupNode (a resizable, labeled
 * container) rather than TypedNode - visually and semantically distinct from
 * the component taxonomy in nodeRegistry.ts. Add more here the same way you'd
 * add a node type: nothing else needs to change.
 */
export const GROUP_TYPES: GroupTypeDefinition[] = [
  { id: "region", label: "Region" },
  { id: "vpc", label: "VPC / Subnet" },
  { id: "namespace", label: "Kubernetes Namespace" },
  { id: "bounded-context", label: "Bounded Context" },
  { id: "trust-boundary", label: "Trust Boundary" },
  { id: "team", label: "Team Ownership" },
];

export function getGroupType(id: string): GroupTypeDefinition | undefined {
  return GROUP_TYPES.find((g) => g.id === id);
}
