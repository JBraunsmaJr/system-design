import type { RequirementItem, RequirementsDocument } from "./requirementsTypes";

export type SkillTreeNodeState = "done" | "in-progress" | "unlocked" | "locked";

export interface SkillTreeNode {
  item: RequirementItem;
  /** Layering rank - the length of the LONGEST chain of direct blocking
   * relationships (among workable items) ending at this item. Items with
   * no workable blockers sit at rank 0. Used purely for layout (which
   * column a node is drawn in); has no bearing on lock state, which only
   * ever looks at DIRECT blockers - see `state`'s own reasoning below. */
  rank: number;
  state: SkillTreeNodeState;
  /** True when the item is marked in-progress but at least one of its
   * direct blockers isn't done yet - a real signal worth surfacing (the
   * same underlying insight as the Gantt view's schedule-conflict
   * detector: work is proceeding ahead of something it depends on),
   * not something to hide just because the person marked it in-progress
   * anyway. */
  isBlockedDespiteProgress: boolean;
  /** Direct workable blockers only (ids) - used to draw edges. */
  blockerIds: string[];
  /** True when this item couldn't be assigned a normal rank because it's
   * part of (or depends on) a cycle in the underlying relationship data.
   * Cycle prevention stops NEW blocking relationships from forming a
   * cycle, but doesn't retroactively fix data that already had one
   * before this feature existed, or that was hand-edited - this flag is
   * the defensive fallback for that case, rather than crashing or
   * looping forever trying to rank something with no well-defined rank. */
  inCycle: boolean;
}

export interface SkillTreeEdge {
  fromItemId: string;
  toItemId: string;
}

export interface SkillTree {
  nodes: SkillTreeNode[];
  edges: SkillTreeEdge[];
}

/**
 * Builds the skill tree for every workable item in `doc`: which items are
 * ready to start, which are blocked and by what, and a layering rank for
 * each so the tree can be drawn left-to-right in dependency order with
 * independent branches laid out in parallel.
 *
 * Only items whose type is marked workable participate at all - see
 * RequirementItemType.isWorkable's own doc comment for why a Requirement
 * or Goal shouldn't compete for space in a view specifically about doing
 * work. Only relationships whose type is marked isBlocking count as
 * edges, and only when BOTH ends are workable items - a non-workable
 * item never reaches "done" (defaultStatusForType never assigns it a
 * status at all), so a blocking relationship FROM one would otherwise
 * lock the workable item on the other end forever; that edge is silently
 * ignored for tree purposes rather than treated as an unresolvable block.
 *
 * Lock state only ever looks at an item's DIRECT blockers, not its whole
 * ancestry - if a direct blocker is done, whatever ITS blockers were is
 * irrelevant to whether this item can start now. This matches how most
 * task trackers reason about "ready to start" and keeps the rule simple:
 * verified via 14 cases (chains, diamonds, in-progress-while-blocked,
 * non-workable blockers, custom blocking types, cycles in legacy data)
 * before this was ever wired into any UI.
 */
export function computeSkillTree(doc: RequirementsDocument): SkillTree {
  const workableTypeIds = new Set(doc.itemTypes.filter((t) => t.isWorkable).map((t) => t.id));
  const workableItems = doc.items.filter((i) => workableTypeIds.has(i.typeId));
  const workableIds = new Set(workableItems.map((i) => i.id));
  const blockingTypeIds = new Set(doc.relationshipTypes.filter((t) => t.isBlocking).map((t) => t.id));

  const blockedBy = new Map<string, string[]>(workableItems.map((i) => [i.id, []]));
  const blocks = new Map<string, string[]>(workableItems.map((i) => [i.id, []]));
  for (const rel of doc.relationships) {
    if (!blockingTypeIds.has(rel.typeId)) continue;
    if (!workableIds.has(rel.fromItemId) || !workableIds.has(rel.toItemId)) continue;
    blockedBy.get(rel.toItemId)!.push(rel.fromItemId);
    blocks.get(rel.fromItemId)!.push(rel.toItemId);
  }

  // Kahn's algorithm with rank tracking (longest-path layering): items
  // with zero remaining unprocessed blockers enter the frontier at the
  // max rank reached so far via any of their blockers, +1. Naturally
  // handles cycles by simply never finishing them - anything left
  // unprocessed afterward is exactly the set of items in, or depending
  // on, a cycle.
  const rank = new Map<string, number>();
  const inDegree = new Map<string, number>(workableItems.map((i) => [i.id, blockedBy.get(i.id)!.length]));
  const queue: string[] = workableItems.filter((i) => inDegree.get(i.id) === 0).map((i) => i.id);
  const processed = new Set<string>();
  for (const id of queue) rank.set(id, 0);

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (processed.has(id)) continue;
    processed.add(id);
    for (const nextId of blocks.get(id)!) {
      rank.set(nextId, Math.max(rank.get(nextId) ?? 0, rank.get(id)! + 1));
      inDegree.set(nextId, inDegree.get(nextId)! - 1);
      if (inDegree.get(nextId) === 0) queue.push(nextId);
    }
  }

  const maxProcessedRank = Math.max(0, ...[...processed].map((id) => rank.get(id) ?? 0));
  const itemById = new Map(doc.items.map((i) => [i.id, i]));

  const nodes: SkillTreeNode[] = workableItems.map((item) => {
    const inCycle = !processed.has(item.id);
    const itemRank = inCycle ? maxProcessedRank + 1 : rank.get(item.id) ?? 0;
    const blockerIds = blockedBy.get(item.id)!;
    const hasUndoneBlocker = blockerIds.some((bid) => itemById.get(bid)?.status !== "done");

    let state: SkillTreeNodeState;
    if (item.status === "done") state = "done";
    else if (item.status === "in-progress") state = "in-progress";
    else if (hasUndoneBlocker) state = "locked";
    else state = "unlocked";

    return {
      item,
      rank: itemRank,
      state,
      isBlockedDespiteProgress: item.status === "in-progress" && hasUndoneBlocker,
      blockerIds,
      inCycle,
    };
  });

  const edges: SkillTreeEdge[] = [];
  for (const item of workableItems) {
    for (const blockerId of blockedBy.get(item.id)!) {
      edges.push({ fromItemId: blockerId, toItemId: item.id });
    }
  }

  return { nodes, edges };
}
