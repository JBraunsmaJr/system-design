import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import plur from 'plur';
import type {
  RequirementItem,
  RequirementsDocument,
} from '../../../domain/requirements/requirementsTypes';
import {
  buildEpicTree,
  buildHierarchyIndex,
  filterEpicTree,
  flattenEpicTreeMatches,
  type EpicTree,
  type EpicTreeNode,
  type HierarchyIndex,
} from '../../../domain/requirements/requirementsHierarchy';
import type { RequirementsGroupBy } from '../../../domain/requirements/requirementsViewPrefs';

export const UNCATEGORIZED_KEY = '__uncategorized__';
export const NO_EPIC_KEY = '__no-epic__';
export const EMPTY_EPIC_TREE: EpicTree = { roots: [], unparented: [] };

export interface ItemGroup {
  key: string;
  label: string;
  color: string;
  items: RequirementItem[];
}

export interface UseRequirementsFilterOptions {
  doc: RequirementsDocument;
  groupBy: RequirementsGroupBy;
  initialSearch?: string;
  onNavigateToItem: (itemId: string, fromSectionKey?: string, fromItemId?: string) => void;
}

export function useRequirementsFilter({
  doc,
  groupBy,
  initialSearch = '',
  onNavigateToItem,
}: UseRequirementsFilterOptions) {
  const [search, setSearch] = useState(initialSearch);
  const [activeMatchItemId, setActiveMatchItemId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const { items: docItems, itemTypes: docItemTypes, relationships: docRelationships } = doc;
  const hierarchyIndex = useMemo<HierarchyIndex>(
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

  const epicTree = useMemo<EpicTree>(() => {
    if (groupBy !== 'epic') return EMPTY_EPIC_TREE;
    const tree = buildEpicTree(
      { items: docItems, itemTypes: docItemTypes, relationships: docRelationships },
      hierarchyIndex,
    );
    if (!search.trim()) return tree;
    return filterEpicTree(tree, new Set(filteredItems.map((i) => i.id)));
  }, [groupBy, docItems, docItemTypes, docRelationships, hierarchyIndex, filteredItems, search]);

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

  const visibleItems = useMemo(
    () => (groupBy === 'epic' ? flattenEpicTreeMatches(epicTree) : groups.flatMap((g) => g.items)),
    [groupBy, epicTree, groups],
  );

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

  const activeIndex = useMemo(() => {
    if (!search.trim() || visibleItems.length === 0) return 0;
    if (!activeMatchItemId) return 0;
    const idx = visibleItems.findIndex((item) => item.id === activeMatchItemId);
    return idx >= 0 ? idx : 0;
  }, [search, visibleItems, activeMatchItemId]);

  const activeItem = useMemo(() => {
    if (!search.trim() || visibleItems.length === 0) return null;
    return visibleItems[activeIndex] ?? null;
  }, [search, visibleItems, activeIndex]);

  const navigateToMatch = useCallback(
    (index: number) => {
      if (visibleItems.length === 0) return;
      const normalizedIndex =
        ((index % visibleItems.length) + visibleItems.length) % visibleItems.length;
      const targetItem = visibleItems[normalizedIndex];
      if (!targetItem) return;
      setActiveMatchItemId(targetItem.id);
      onNavigateToItem(targetItem.id);
    },
    [visibleItems, onNavigateToItem],
  );

  const goToNextMatch = useCallback(() => {
    if (visibleItems.length === 0) return;
    if (activeMatchItemId === null) {
      navigateToMatch(0);
    } else {
      navigateToMatch(activeIndex + 1);
    }
  }, [visibleItems.length, activeMatchItemId, activeIndex, navigateToMatch]);

  const goToPrevMatch = useCallback(() => {
    if (visibleItems.length === 0) return;
    if (activeMatchItemId === null) {
      navigateToMatch(visibleItems.length - 1);
    } else {
      navigateToMatch(activeIndex - 1);
    }
  }, [visibleItems.length, activeMatchItemId, activeIndex, navigateToMatch]);

  const handleSearchKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        goToPrevMatch();
      } else {
        goToNextMatch();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setSearch('');
      setActiveMatchItemId(null);
      searchInputRef.current?.blur();
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if (e.key === 'F3' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g')) {
        if (search.trim().length > 0) {
          e.preventDefault();
          if (e.shiftKey) {
            goToPrevMatch();
          } else {
            goToNextMatch();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [search, goToNextMatch, goToPrevMatch]);

  return {
    search,
    setSearch,
    searchInputRef,
    activeMatchItemId,
    setActiveMatchItemId,
    hierarchyIndex,
    filteredItems,
    epicTree,
    domIdByNodeKey,
    groups,
    visibleItems,
    outlineSectionOf,
    activeIndex,
    activeItem,
    goToNextMatch,
    goToPrevMatch,
    handleSearchKeyDown,
  };
}
