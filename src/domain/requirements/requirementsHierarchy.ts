import type { RequirementItem, RequirementsDocument } from './requirementsTypes.ts';
import { PARENT_OF_RELATIONSHIP_TYPE_ID } from './requirementsRegistry.ts';

/**
 * Parent/child lookups over the "Parent of" relationship, built once per
 * document snapshot so anything that walks the hierarchy (the epic
 * grouping, sticky epic headers, and later the split view) shares one
 * answer to "who are this item's children" instead of each re-deriving
 * it from the raw relationship list.
 *
 * Only relationships whose BOTH ends still exist are indexed, and each
 * list is de-duplicated while keeping relationship insertion order -
 * which is creation order, so children appear in the order they were
 * added.
 */
export interface HierarchyIndex {
  childrenByParentId: Map<string, string[]>;
  parentsByChildId: Map<string, string[]>;
}

export function buildHierarchyIndex(
  doc: Pick<RequirementsDocument, 'items' | 'relationships'>,
): HierarchyIndex {
  const existing = new Set(doc.items.map((i) => i.id));
  const childrenByParentId = new Map<string, string[]>();
  const parentsByChildId = new Map<string, string[]>();
  for (const rel of doc.relationships) {
    if (rel.typeId !== PARENT_OF_RELATIONSHIP_TYPE_ID) continue;
    if (!existing.has(rel.fromItemId) || !existing.has(rel.toItemId)) continue;
    if (rel.fromItemId === rel.toItemId) continue;
    const children = childrenByParentId.get(rel.fromItemId) ?? [];
    if (!children.includes(rel.toItemId)) children.push(rel.toItemId);
    childrenByParentId.set(rel.fromItemId, children);
    const parents = parentsByChildId.get(rel.toItemId) ?? [];
    if (!parents.includes(rel.fromItemId)) parents.push(rel.fromItemId);
    parentsByChildId.set(rel.toItemId, parents);
  }
  return { childrenByParentId, parentsByChildId };
}

/**
 * Whether an item is an epic for grouping purposes: the built-in Epic
 * type, or any type whose label mentions "epic" (so a custom "Sub-epic"
 * or "Initiative Epic" type groups the same way). The timeline uses a
 * similar id-based heuristic; this one also checks the label because
 * custom type ids are opaque ("custom-3").
 */
export function isEpicItem(
  doc: Pick<RequirementsDocument, 'itemTypes'>,
  item: RequirementItem,
): boolean {
  if (item.typeId === 'epic') return true;
  const label = doc.itemTypes.find((t) => t.id === item.typeId)?.label ?? item.typeId;
  return label.toLowerCase().includes('epic');
}

export interface EpicTreeNode {
  item: RequirementItem;
  /** Unique per OCCURRENCE, not per item: a ticket under two epics is two
   * nodes with the same item and different keys (the key is the path of
   * item ids from the root). Used for React keys, DOM ids and selection. */
  key: string;
  /** The id of the top-level epic this occurrence sits under - used to
   * prefer "the copy in the section I'm already in" when navigating. */
  rootId: string;
  depth: number;
  children: EpicTreeNode[];
  /** Set when a search is active and this node is only shown because
   * something beneath it matched - kept for context, rendered dimmed. */
  isContext?: boolean;
}

export interface EpicTree {
  /** One per top-level epic, in document order. */
  roots: EpicTreeNode[];
  /** Everything not beneath any epic, in document order. */
  unparented: RequirementItem[];
}

/**
 * Arranges the document as epics with everything beneath them nested:
 *
 * - A top-level epic is one with no epic anywhere above it. Anything an
 *   epic is "Parent of" - tickets, requirements, other epics - nests
 *   beneath it, recursively.
 * - An item with several parents appears under EACH of them.
 * - Loops in the hierarchy can't be created any more (see
 *   wouldCreateParentCycle), but documents saved before that check may
 *   contain one. Expansion stops the moment an item would appear inside
 *   itself, and epics that sit only inside a loop (so none of them counts
 *   as "top-level") are promoted to roots, so nothing disappears.
 * - Everything not reachable from any epic lands in `unparented`.
 */
export function buildEpicTree(
  doc: Pick<RequirementsDocument, 'items' | 'itemTypes' | 'relationships'>,
  index: HierarchyIndex = buildHierarchyIndex(doc),
): EpicTree {
  const itemById = new Map(doc.items.map((i) => [i.id, i]));
  const epics = doc.items.filter((i) => isEpicItem(doc, i));

  // Everything reachable (strictly below) any epic.
  const belowAnEpic = new Set<string>();
  const stack: string[] = [];
  for (const epic of epics) stack.push(...(index.childrenByParentId.get(epic.id) ?? []));
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (belowAnEpic.has(id)) continue;
    belowAnEpic.add(id);
    stack.push(...(index.childrenByParentId.get(id) ?? []));
  }

  const placed = new Set<string>();
  const build = (
    item: RequirementItem,
    rootId: string,
    depth: number,
    path: string[],
  ): EpicTreeNode => {
    placed.add(item.id);
    const nextPath = [...path, item.id];
    const children: EpicTreeNode[] = [];
    for (const childId of index.childrenByParentId.get(item.id) ?? []) {
      if (nextPath.includes(childId)) continue; // legacy loop - stop here
      const child = itemById.get(childId);
      if (child) children.push(build(child, rootId, depth + 1, nextPath));
    }
    return { item, key: nextPath.join('/'), rootId, depth, children };
  };

  const roots: EpicTreeNode[] = [];
  for (const epic of epics) {
    if (!belowAnEpic.has(epic.id)) roots.push(build(epic, epic.id, 0, []));
  }
  // Epics only reachable through a loop of other epics.
  for (const epic of epics) {
    if (!placed.has(epic.id)) roots.push(build(epic, epic.id, 0, []));
  }

  const unparented = doc.items.filter((i) => !placed.has(i.id));
  return { roots, unparented };
}

/**
 * Narrows a tree to what a search matched: a node survives if it matched
 * or anything beneath it did, and survivors that only made it in for
 * their descendants are flagged isContext so the view can dim them.
 */
export function filterEpicTree(tree: EpicTree, matchedIds: ReadonlySet<string>): EpicTree {
  const filterNode = (node: EpicTreeNode): EpicTreeNode | null => {
    const children = node.children.map(filterNode).filter((c): c is EpicTreeNode => c !== null);
    const matched = matchedIds.has(node.item.id);
    if (!matched && children.length === 0) return null;
    return { ...node, children, isContext: !matched };
  };
  return {
    roots: tree.roots.map(filterNode).filter((n): n is EpicTreeNode => n !== null),
    unparented: tree.unparented.filter((i) => matchedIds.has(i.id)),
  };
}

/**
 * The matched items in on-screen order (depth-first through the tree,
 * then the unparented list), each item ONCE even if it's shown in
 * several places - so search's "2 of 5" counts items, not cards.
 */
export function flattenEpicTreeMatches(tree: EpicTree): RequirementItem[] {
  const seen = new Set<string>();
  const out: RequirementItem[] = [];
  const visit = (node: EpicTreeNode) => {
    if (!node.isContext && !seen.has(node.item.id)) {
      seen.add(node.item.id);
      out.push(node.item);
    }
    node.children.forEach(visit);
  };
  tree.roots.forEach(visit);
  for (const item of tree.unparented) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

/** Counts every descendant occurrence beneath a node (for the header's
 * "n items" label). */
export function countDescendants(node: EpicTreeNode): number {
  return node.children.reduce((sum, c) => sum + 1 + countDescendants(c), 0);
}
