export interface GroupTypeDefinition {
  id: string;
  label: string;
  icon: string;
  color: string;
  /** CSS border-style keyword; defaults to "dashed" if omitted. */
  borderStyle?: string;
}

/**
 * Boundary/group presets. These render via GroupNode (a resizable, labeled
 * container) rather than TypedNode - visually and semantically distinct from
 * the component taxonomy in nodeRegistry.ts. Each kind gets its own
 * icon+color (and occasionally border style) so different boundary kinds are
 * distinguishable on the canvas at a glance, not just via the Inspector.
 */
export const GROUP_TYPES: GroupTypeDefinition[] = [
  { id: 'region', label: 'Region', icon: 'Globe', color: '#5B7CFA' },
  { id: 'vpc', label: 'VPC / Subnet', icon: 'Network', color: '#0FA36B' },
  { id: 'namespace', label: 'Kubernetes Namespace', icon: 'Boxes', color: '#22B8CF' },
  { id: 'bounded-context', label: 'Bounded Context', icon: 'Layers', color: '#9061F9' },
  {
    id: 'trust-boundary',
    label: 'Trust Boundary',
    icon: 'ShieldAlert',
    color: '#E03131',
    borderStyle: 'double',
  },
  { id: 'team', label: 'Team Ownership', icon: 'Users', color: '#FAB005' },
    // Plain grouping with no architectural meaning of its own - what the
    // context menu's "Group" wraps a selection in (domain/canvas/grouping.ts).
    {id: 'group', label: 'Group', icon: 'Group', color: '#98A2B3'},
];

/** The boundary kind "Group selection" creates. */
export const DEFAULT_GROUP_TYPE_ID = 'group';

export function getGroupType(id: string): GroupTypeDefinition | undefined {
  return GROUP_TYPES.find((g) => g.id === id);
}
