/**
 * Which snapshots an SRD needs, and a fingerprint for each.
 *
 * Images are never stored in the document: every reader renders them from the
 * document's own content and framing. A fingerprint names one rendering - the
 * content of the diagram level it shows, the nodes it frames, the framing, and
 * the capture format - so a rendered image can be reused for exactly as long
 * as nothing it depends on has changed, and is recaptured as soon as anything
 * has. Pure, so it is cheap to test and to run on every document change.
 */
import type { Edge, Node } from '@xyflow/react';
import type { DiagramPath } from '../canvas/subDiagramTree';
import type { SrdDocumentState, SrdSnapshotFraming } from './srdTypes';
import { SRD_DIAGRAM_FRAMING_KEY, framingFor } from './srdSettings';

/**
 * Bump whenever the captured image would differ for the same inputs - a new
 * capture size, pixel ratio, padding, or node rendering - so images rendered
 * by the old code are never reused.
 */
export const SNAPSHOT_CAPTURE_VERSION = 3; // 2: JPEG instead of PNG; 3: pixel ratio 1

export interface SrdSnapshotTarget {
  /** SRD_DIAGRAM_FRAMING_KEY for the architecture diagram, else an item id. */
  key: string;
  kind: 'diagram' | 'item';
  /** The diagram level the snapshot shows. */
  path: DiagramPath;
  /** Identifies the level's current content: equal for every snapshot of the
   * same level, so they can share one render. */
  levelKey: string;
  /** The nodes an item snapshot frames; empty for the diagram, which frames
   * its whole level. */
  nodeIds: string[];
  framing: SrdSnapshotFraming;
  fingerprint: string;
}

export interface PlanSrdSnapshotsInput {
  /** Every node at every level, flat, each carrying `data.parentPath`. */
  nodes: Node[];
  edges: Edge[];
  /** Requirement item ids, in document order. */
  itemIds: readonly string[];
  state: Pick<SrdDocumentState, 'framing'>;
}

function parentPathOf(element: Node | Edge): DiagramPath {
  const path = (element.data as { parentPath?: unknown } | undefined)?.parentPath;
  return Array.isArray(path) ? (path as string[]) : [];
}

function linkedRequirementIdsOf(node: Node): readonly unknown[] {
  const ids = (node.data as { linkedRequirementIds?: unknown } | undefined)?.linkedRequirementIds;
  return Array.isArray(ids) ? ids : [];
}

const pathKey = (path: DiagramPath) => JSON.stringify(path);

/**
 * cyrb53: a fast, well-distributed 53-bit string hash. Not cryptographic, and
 * does not need to be - a collision would reuse a stale image until the next
 * edit, never corrupt the document.
 */
export function hashString(input: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * The nodes linked to each item, at the level holding most of them - the
 * level its snapshot shows. Ties go to the level met first in node order.
 */
export function primaryLinkedNodes(
  nodes: Node[],
): Map<string, { path: DiagramPath; nodeIds: string[] }> {
  // itemId -> pathKey -> group, built in one pass over the nodes.
  const byItem = new Map<string, Map<string, { path: DiagramPath; nodeIds: string[] }>>();
  for (const node of nodes) {
    for (const itemId of linkedRequirementIdsOf(node)) {
      if (typeof itemId !== 'string') continue;
      let groups = byItem.get(itemId);
      if (!groups) byItem.set(itemId, (groups = new Map()));
      const path = parentPathOf(node);
      const key = pathKey(path);
      let group = groups.get(key);
      if (!group) groups.set(key, (group = { path, nodeIds: [] }));
      group.nodeIds.push(node.id);
    }
  }
  const primary = new Map<string, { path: DiagramPath; nodeIds: string[] }>();
  for (const [itemId, groups] of byItem) {
    let best: { path: DiagramPath; nodeIds: string[] } | undefined;
    for (const group of groups.values()) {
      if (!best || group.nodeIds.length > best.nodeIds.length) best = group;
    }
    if (best) primary.set(itemId, best);
  }
  return primary;
}

export function planSrdSnapshots({
  nodes,
  edges,
  itemIds,
  state,
}: PlanSrdSnapshotsInput): SrdSnapshotTarget[] {
  const linked = primaryLinkedNodes(nodes);

  // Each level is hashed at most once, however many snapshots show it.
  const levelHashes = new Map<string, string>();
  const levelHash = (path: DiagramPath): string => {
    const key = pathKey(path);
    let hash = levelHashes.get(key);
    if (hash === undefined) {
      const levelNodes = nodes.filter((n) => pathKey(parentPathOf(n)) === key);
      const levelEdges = edges.filter((e) => pathKey(parentPathOf(e)) === key);
      hash = hashString(JSON.stringify([levelNodes, levelEdges]));
      levelHashes.set(key, hash);
    }
    return hash;
  };

  type PlannedTarget = Omit<SrdSnapshotTarget, 'fingerprint' | 'levelKey'>;

  const fingerprintOf = (target: PlannedTarget): string => {
    const { offsetX, offsetY, zoom } = target.framing;
    return hashString(
      JSON.stringify([
        SNAPSHOT_CAPTURE_VERSION,
        target.kind,
        target.path,
        target.nodeIds,
        offsetX,
        offsetY,
        zoom,
        levelHash(target.path),
      ]),
    );
  };

  const targets: SrdSnapshotTarget[] = [];
  const add = (target: PlannedTarget) => {
    if (target.framing.hidden) return;
    targets.push({
      ...target,
      levelKey: `${pathKey(target.path)}#${levelHash(target.path)}`,
      fingerprint: fingerprintOf(target),
    });
  };

  if (nodes.some((n) => parentPathOf(n).length === 0)) {
    add({
      key: SRD_DIAGRAM_FRAMING_KEY,
      kind: 'diagram',
      path: [],
      nodeIds: [],
      framing: framingFor(state, SRD_DIAGRAM_FRAMING_KEY),
    });
  }
  for (const itemId of itemIds) {
    const group = linked.get(itemId);
    if (!group) continue;
    add({
      key: itemId,
      kind: 'item',
      path: group.path,
      nodeIds: group.nodeIds,
      framing: framingFor(state, itemId),
    });
  }
  return targets;
}
