import type {EdgeRouting, EdgeTypeDefinition} from './types';

/** What an edge is drawn at when it has no thickness of its own. */
export const DEFAULT_EDGE_STROKE_WIDTH = 1.75;

/** The thicknesses the Inspector offers. Kept to a short ladder rather than
 * a free number so a diagram's lines stay visually consistent. */
export const EDGE_STROKE_WIDTHS: { value: number; label: string }[] = [
    {value: 1, label: 'Thin'},
    {value: DEFAULT_EDGE_STROKE_WIDTH, label: 'Normal'},
    {value: 2.5, label: 'Medium'},
    {value: 3.5, label: 'Thick'},
    {value: 5, label: 'Heavy'},
];

export const EDGE_ROUTINGS: { value: EdgeRouting; label: string }[] = [
    {value: 'orthogonal', label: 'Orthogonal'},
    {value: 'straight', label: 'Straight'},
    {value: 'curved', label: 'Curved'},
];

/** Reads an edge's thickness, tolerating whatever a file or peer sent. */
export function resolveEdgeStrokeWidth(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 20
        ? value
        : DEFAULT_EDGE_STROKE_WIDTH;
}

/** Arrowhead size in flow units for a line of the given thickness. Grows
 * with the line so a heavy edge doesn't end in a pin-head, but more slowly
 * than the line itself so it doesn't balloon either. Matches React Flow's
 * own default marker (16 x stroke width) at the default thickness. */
export function arrowheadSize(strokeWidth: number): number {
    return Math.round(14 + strokeWidth * 8);
}

/** Reads an edge's routing, tolerating whatever a file or peer sent. */
export function resolveEdgeRouting(value: unknown): EdgeRouting {
    return value === 'straight' || value === 'curved' ? value : 'orthogonal';
}

export const STYLE_GROUP_LABELS: Record<string, string> = {
  sync: 'Synchronous',
  async: 'Asynchronous',
  data: 'Data layer',
  file: 'File / bulk',
  control: 'Control flow',
  vcs: 'Version control',
  blank: 'Unlabeled',
  generic: 'Generic',
};

/** The order the Inspector's type dropdown lists style groups in. */
export const EDGE_STYLE_GROUP_ORDER = [
    'sync',
    'async',
    'control',
    'vcs',
    'blank',
    'data',
    'file',
    'generic',
] as const;

/** Starter traffic taxonomy - extend freely, same pattern as nodeRegistry. */
export const EDGE_TYPES: EdgeTypeDefinition[] = [
  { id: 'http', styleGroup: 'sync', label: 'HTTP / REST', color: '#5B7CFA' },
  { id: 'grpc', styleGroup: 'sync', label: 'gRPC', color: '#3454D1' },
  { id: 'tcp', styleGroup: 'sync', label: 'TCP', color: '#0FA36B' },
  { id: 'websocket', styleGroup: 'sync', label: 'WebSocket', color: '#0C8599' },

  { id: 'webhook', styleGroup: 'async', label: 'Webhook', color: '#F2994A', dash: '6 4' },
  {
    id: 'message-queue',
    styleGroup: 'async',
    label: 'Message Queue',
    color: '#D9822B',
    dash: '6 4',
  },
  { id: 'event-stream', styleGroup: 'async', label: 'Event Stream', color: '#B5651D', dash: '6 4' },

  { id: 'sql', styleGroup: 'data', label: 'SQL Connection', color: '#9061F9', dash: '2 3' },
  { id: 'replication', styleGroup: 'data', label: 'Replication', color: '#7048E8', dash: '2 3' },

  {
    id: 'file-transfer',
    styleGroup: 'file',
    label: 'File Transfer / SFTP',
    color: '#7C8598',
    dash: '8 3 2 3',
  },

  // Code mode - pairs with the "logic" node category (Endpoint, Step,
  // Decision, etc.) for laying out pseudo-code / request-handling flow.
  { id: 'next', styleGroup: 'control', label: 'Next', color: '#22B8CF' },
  { id: 'true', styleGroup: 'control', label: 'True', color: '#40C057' },
  { id: 'false', styleGroup: 'control', label: 'False', color: '#E03131' },
  { id: 'on-error', styleGroup: 'control', label: 'On Error', color: '#E8590C', dash: '4 3' },
  { id: 'loop-back', styleGroup: 'control', label: 'Loop Back', color: '#22B8CF', dash: '2 4' },

  // Git mode - pairs with the "vcs" node category (Branch, Merge, Tag, etc.)
  { id: 'branches-from', styleGroup: 'vcs', label: 'Branches From', color: '#C2255C' },
  { id: 'merges-into', styleGroup: 'vcs', label: 'Merges Into', color: '#A61E4D' },
  { id: 'cherry-picked', styleGroup: 'vcs', label: 'Cherry-Picked', color: '#C2255C', dash: '4 3' },
  { id: 'tags', styleGroup: 'vcs', label: 'Tags', color: '#C2255C', dash: '1 3' },
  { id: 'deploys-to', styleGroup: 'vcs', label: 'Deploys To', color: '#C2255C', dash: '6 3' },

  {
    id: 'blank-solid',
    styleGroup: 'blank',
    label: '',
    menuLabel: 'Blank (Solid)',
    color: '#98A2B3',
  },
  {
    id: 'blank-dashed',
    styleGroup: 'blank',
    label: '',
    menuLabel: 'Blank (Dashed)',
    color: '#98A2B3',
    dash: '6 4',
  },
  {
    id: 'blank-dotted',
    styleGroup: 'blank',
    label: '',
    menuLabel: 'Blank (Dotted)',
    color: '#98A2B3',
    dash: '2 3',
  },

  { id: 'generic', styleGroup: 'generic', label: 'Generic / Other', color: '#98A2B3' },
];

export function getEdgeType(id: string): EdgeTypeDefinition {
  return EDGE_TYPES.find((e) => e.id === id) ?? EDGE_TYPES[EDGE_TYPES.length - 1];
}
