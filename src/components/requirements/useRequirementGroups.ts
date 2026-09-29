import { useMemo } from 'react';
import type {
  RequirementsDocument,
  RequirementItem,
  RequirementItemType,
} from '../../domain/requirements/requirementsTypes';
import type { SubDiagram } from '../../domain/canvas/types';
import { findAllLinkedNodes } from '../../domain/canvas/subDiagramTree';
import plur from 'plur';
import {
  buildEpicTree,
  buildHierarchyIndex,
  filterEpicTree,
  flattenEpicTreeMatches,
  type EpicTree,
  type EpicTreeNode,
} from '../../domain/requirements/requirementsHierarchy';
import type { RequirementsGroupBy } from '../../domain/requirements/requirementsViewPrefs';
const UNCATEGORIZED_KEY = '__uncategorized__';
export const NO_EPIC_KEY = '__no-epic__';
const EMPTY_EPIC_TREE: EpicTree = { roots: [], unparented: [] };

/** The type a new child defaults to: Ticket if it exists, otherwise the
 * first workable type, otherwise the first type of all. */
function pickDefaultChildTypeId(itemTypes: RequirementItemType[]): string | undefined {
  return (
    itemTypes.find((t) => t.id === 'ticket')?.id ??
    itemTypes.find((t) => t.isWorkable)?.id ??
    itemTypes[0]?.id
  );
}

export interface ItemGroup {
  key: string;
  label: string;
  color: string;
  items: RequirementItem[];
}

export interface UseRequirementGroupsOptions {
  doc: RequirementsDocument;
  search: string;
  groupBy: RequirementsGroupBy;
  diagramRoot?: SubDiagram;
}

/**
 * What the Requirements view shows and in what order: the search-filtered
 * items, grouped by type or category or arranged as an epic tree, plus the
 * lookups navigation needs. Moved unchanged from RequirementsView.tsx.
 *
 * PERFORMANCE: every value here is a useMemo, and several reach every
 * RequirementCard (linkedNodesByItemId, hierarchyIndex). Their identity must
 * only change when their inputs do - RequirementCard's memo comparison
 * depends on it.
 *
 * Performance contract: this hook runs inside RequirementsView's render,
 * so it adds no component and no render. Everything it returns is state, a
 * ref, or memoized with the dependencies it had in RequirementsView.tsx.
 * Destructure the result and depend on its members - never on the returned
 * object, which is new on every render.
 */
export function useRequirementGroups({
  doc,
  search,
  groupBy,
  diagramRoot,
}: UseRequirementGroupsOptions) {
  /**
   * Computed once for every item here, rather than each RequirementCard
   * independently walking the whole diagram tree for just its own item -
   * see findAllLinkedNodes's own doc comment for why that per-card
   * approach doesn't scale with the number of items in this list.
   */
  const linkedNodesByItemId = useMemo(
    () => (diagramRoot ? findAllLinkedNodes(diagramRoot) : new Map()),
    [diagramRoot],
  );

  const { items: docItems, itemTypes: docItemTypes, relationships: docRelationships } = doc;
  const hierarchyIndex = useMemo(
    () => buildHierarchyIndex({ items: docItems, relationships: docRelationships }),
    [docItems, docRelationships],
  );

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return doc.items;
    return doc.items.filter((item) => {
      if (item.id.toLowerCase().includes(q)) return true;
      if (item.title.toLowerCase().includes(q)) return true;
      if (item.body.toLowerCase().includes(q)) return true;
      const category = doc.categories.find((c) => c.id === item.categoryId);
      return category ? category.label.toLowerCase().includes(q) : false;
    });
  }, [doc.items, doc.categories, search]);

  /**
   * Grouping is computed generically for both modes into the same shape,
   * so the render below is a single loop rather than duplicated markup per
   * mode - "group by category" is just a different recipe for the same
   * {key, label, color, items} structure "group by type" already produces.
   */
  /**
   * The epic grouping's tree, narrowed to the search when there is one
   * (keeping the ancestors of every match, dimmed, for context). Only
   * built in that mode.
   */
  const epicTree = useMemo<EpicTree>(() => {
    if (groupBy !== 'epic') return EMPTY_EPIC_TREE;
    const tree = buildEpicTree(
      { items: docItems, itemTypes: docItemTypes, relationships: docRelationships },
      hierarchyIndex,
    );
    if (!search.trim()) return tree;
    return filterEpicTree(tree, new Set(filteredItems.map((i) => i.id)));
  }, [groupBy, docItems, docItemTypes, docRelationships, hierarchyIndex, filteredItems, search]);

  /** A distinct DOM id for every copy of every item in the epic tree: the
   * first copy keeps the plain `requirement-<id>`, later copies get a
   * numbered suffix. */
  const domIdByNodeKey = useMemo(() => {
    const map = new Map<string, string>();
    const seen = new Map<string, number>();
    const visit = (node: EpicTreeNode) => {
      const n = seen.get(node.item.id) ?? 0;
      seen.set(node.item.id, n + 1);
      map.set(
        node.key,
        n === 0 ? `requirement-${node.item.id}` : `requirement-${node.item.id}--${n + 1}`,
      );
      node.children.forEach(visit);
    };
    epicTree.roots.forEach(visit);
    return map;
  }, [epicTree]);

  const groups = useMemo<ItemGroup[]>(() => {
    if (groupBy === 'epic') return [];
    if (groupBy === 'type') {
      const seenTypeKeys = new Set<string>();
      return doc.itemTypes
        .filter((type) => {
          if (seenTypeKeys.has(type.id)) return false;
          seenTypeKeys.add(type.id);
          return true;
        })
        .map((type) => ({
          key: type.id,
          label: plur(type.label, 2),
          color: type.color,
          items: filteredItems.filter((i) => i.typeId === type.id),
        }))
        .filter((g) => g.items.length > 0);
    }
    const seenCategoryKeys = new Set<string>();
    const categoryGroups = doc.categories
      .filter((cat) => {
        if (seenCategoryKeys.has(cat.id)) return false;
        seenCategoryKeys.add(cat.id);
        return true;
      })
      .map((cat) => ({
        key: cat.id,
        label: cat.label,
        color: cat.color,
        items: filteredItems.filter((i) => i.categoryId === cat.id),
      }))
      .filter((g) => g.items.length > 0);
    const uncategorized = filteredItems.filter(
      (i) => !i.categoryId || !doc.categories.some((c) => c.id === i.categoryId),
    );
    if (uncategorized.length > 0) {
      categoryGroups.push({
        key: UNCATEGORIZED_KEY,
        label: 'Uncategorized',
        color: 'var(--chrome-text-dim)',
        items: uncategorized,
      });
    }
    return categoryGroups;
  }, [groupBy, doc.itemTypes, doc.categories, filteredItems]);

  const defaultChildTypeId = useMemo(() => pickDefaultChildTypeId(doc.itemTypes), [doc.itemTypes]);

  const visibleItems = useMemo(
    () => (groupBy === 'epic' ? flattenEpicTreeMatches(epicTree) : groups.flatMap((g) => g.items)),
    [groupBy, epicTree, groups],
  );

  /** Which outline section each item sits in (e.g. "type:ticket"), so
   * navigation can unfold the right one. Top-level epics and everything
   * nested under them have no section header, so they aren't listed. */
  const outlineSectionOf = useMemo(() => {
    const map = new Map<string, string>();
    if (groupBy === 'epic') {
      for (const item of epicTree.unparented) map.set(item.id, `epic:${NO_EPIC_KEY}`);
    } else {
      for (const group of groups) {
        for (const item of group.items) map.set(item.id, `${groupBy}:${group.key}`);
      }
    }
    return map;
  }, [groupBy, epicTree, groups]);

  const itemCountsByType = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of doc.items) {
      counts[item.typeId] = (counts[item.typeId] ?? 0) + 1;
    }
    return counts;
  }, [doc.items]);

  return {
    linkedNodesByItemId,
    hierarchyIndex,
    epicTree,
    domIdByNodeKey,
    groups,
    defaultChildTypeId,
    visibleItems,
    outlineSectionOf,
    itemCountsByType,
  };
}
