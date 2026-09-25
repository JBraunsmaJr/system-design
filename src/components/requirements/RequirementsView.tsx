import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  ChevronUp,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Columns2,
  LayoutList,
  ListTree,
  Rows3,
  Search,
  Settings2,
  Tags,
  Waypoints,
  X,
} from 'lucide-react';
import { RequirementCard } from './RequirementCard';
import { ManageTypesModal } from './ManageTypesModal';
import { ManageRelationshipTypesModal } from './ManageRelationshipTypesModal';
import { AddItemDropdown } from './AddItemDropdown';
import type { RequirementItem, RequirementItemType } from '../../domain/requirementsTypes';
import type { ProgramIncrement } from '../../domain/programIncrements';
import type { TeamDocument } from '../../domain/teamTypes';
import type { SubDiagram } from '../../domain/types';
import {
  findAllLinkedNodes,
  type DiagramPath,
  type LinkedNodeRef,
} from '../../domain/subDiagramTree';
import type { RequirementsStore } from '../../collab/requirementsStore';
import type { PresenceInfo } from '../../collab/session';
import plur from 'plur';
import {
  buildEpicTree,
  buildHierarchyIndex,
  countDescendants,
  filterEpicTree,
  flattenEpicTreeMatches,
  isEpicItem,
  type EpicTree,
  type EpicTreeNode,
} from '../../domain/requirementsHierarchy';
import {
  loadRequirementsViewPrefs,
  saveRequirementsViewPrefs,
  type RequirementsGroupBy,
  type RequirementsLayout,
} from '../../domain/requirementsViewPrefs';
import { RequirementsOutline } from './RequirementsOutline';

interface RequirementsViewProps {
  requirementsStore: RequirementsStore;
  programIncrements: ProgramIncrement[];
  team?: TeamDocument;
  /** The full diagram tree, for finding which nodes (anywhere, at any
   * nesting depth) link back to a given requirement item - see
   * findLinkedNodes. Optional purely for prop-drilling convenience at
   * call sites that don't have it handy; every real caller passes it. */
  diagramRoot?: SubDiagram;
  onNavigateToNode?: (path: DiagramPath, nodeId: string) => void;
  onCreateLinkedNode?: (itemId: string, label: string) => void;
  /** Set by App.tsx when the user clicks a linked requirement pill from
   * the Inspector (while viewing the diagram) - scrolls to and briefly
   * highlights that item once this view mounts/updates, then reports
   * back via onFocusHandled so App.tsx can clear it (avoiding
   * re-triggering the same scroll on an unrelated re-render). */
  focusItemId?: string | null;
  onFocusHandled?: () => void;
  /** Other people currently on this same view, in a collaborative
   * session - already filtered by the caller to just those actually on
   * "requirements" (never includes peers on a different view). Empty
   * outside of a session. */
  peers?: PresenceInfo[];
  /** Reports which item this person currently has open for editing, for
   * presence broadcasting - null when nothing's being edited. */
  onFocusedItemChange?: (itemId: string | null) => void;
  initialSearch?: string;
  /** Keys this person's locally-stored view preferences (grouping mode)
   * to the open document. Optional: without it, one shared "default"
   * entry is used. */
  documentId?: string;
  /** Overrides the stored grouping preference - for tests and for callers
   * that want to open the view in a specific mode. */
  initialGroupBy?: RequirementsGroupBy;
  /** Same, for the list/split layout. */
  initialLayout?: RequirementsLayout;
}

const HIGHLIGHT_DURATION_MS = 2000;

/**
 * A single shared reference for "no linked nodes" - `linkedNodesByItemId.get(id) ?? []`
 * would otherwise allocate a brand new array on every single render for
 * every item with no links, which defeats RequirementCard's React.memo
 * comparison (a new array is never === the previous one, even though the
 * actual content - nothing - never changes).
 */
const EMPTY_LINKED_NODES: LinkedNodeRef[] = [];
/**
 * Same reasoning as EMPTY_LINKED_NODES above: a fresh [] every render
 * for every item with no one else looking at it would defeat
 * RequirementCard's own React.memo comparison just as surely.
 */
const EMPTY_PEERS: PresenceInfo[] = [];
const UNCATEGORIZED_KEY = '__uncategorized__';
const NO_EPIC_KEY = '__no-epic__';
const DETAIL_KEY = '__detail__';
const DETAIL_CHILDREN_KEY = '__detail-children__';
const MAX_NAV_HISTORY = 20;
/** The verb an epic's Add relationship picker opens on when nothing has
 * been used from an epic yet - decomposing an epic is the common case. */
const EPIC_DEFAULT_VERB_KEY = 'parent-of::forward';

/**
 * Where "Back" returns to after following a link between items: in the
 * list, the scroll position the jump started from; in the split view, the
 * item that was open. `label` is the item the jump was made from.
 */
type NavHistoryEntry =
  | { kind: 'scroll'; scrollTop: number; label: string }
  | { kind: 'select'; itemId: string; label: string };

function toggled(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
const EMPTY_EPIC_TREE: EpicTree = { roots: [], unparented: [] };

type GroupBy = RequirementsGroupBy;

/**
 * Finds the card for `itemId` on screen. An item can be shown more than
 * once when grouping by epic (a ticket under two epics), so this prefers
 * the copy in `preferSectionKey` - the section the navigation came from -
 * and otherwise takes the first copy in document order.
 */
function findCardElement(itemId: string, preferSectionKey?: string): HTMLElement | null {
  const escaped =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(itemId)
      : itemId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const copies = Array.from(
    document.querySelectorAll<HTMLElement>(`[data-requirement-id="${escaped}"]`),
  );
  if (copies.length === 0) return null;
  if (preferSectionKey) {
    const inSection = copies.find((el) => el.dataset.sectionKey === preferSectionKey);
    if (inSection) return inSection;
  }
  return copies[0];
}

/** The type a new child defaults to: Ticket if it exists, otherwise the
 * first workable type, otherwise the first type of all. */
function pickDefaultChildTypeId(itemTypes: RequirementItemType[]): string | undefined {
  return (
    itemTypes.find((t) => t.id === 'ticket')?.id ??
    itemTypes.find((t) => t.isWorkable)?.id ??
    itemTypes[0]?.id
  );
}

interface ItemGroup {
  key: string;
  label: string;
  color: string;
  items: RequirementItem[];
}

export function RequirementsView({
  requirementsStore,
  programIncrements,
  team,
  diagramRoot,
  onNavigateToNode,
  onCreateLinkedNode,
  focusItemId,
  onFocusHandled,
  peers = [],
  onFocusedItemChange,
  initialSearch = '',
  documentId,
  initialGroupBy,
  initialLayout,
}: RequirementsViewProps) {
  const doc = useSyncExternalStore(
    requirementsStore.subscribe,
    requirementsStore.getSnapshot,
    requirementsStore.getSnapshot,
  );
  const [search, setSearch] = useState(initialSearch);
  const [activeMatchItemId, setActiveMatchItemId] = useState<string | null>(null);
  // Per-person view preferences - see requirementsViewPrefs.ts. Read once;
  // written back by the effect further down whenever any of them change.
  const [initialPrefs] = useState(() => loadRequirementsViewPrefs(documentId));
  const [groupBy, setGroupByState] = useState<GroupBy>(
    () => initialGroupBy ?? initialPrefs.groupBy ?? 'type',
  );
  const [layout, setLayoutState] = useState<RequirementsLayout>(
    () => initialLayout ?? initialPrefs.layout ?? 'list',
  );
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(
    () => new Set(initialPrefs.collapsedIds),
  );
  const [foldedIds, setFoldedIds] = useState<ReadonlySet<string>>(
    () => new Set(initialPrefs.foldedIds),
  );
  const [collapsedSectionKeys, setCollapsedSectionKeys] = useState<ReadonlySet<string>>(
    () => new Set(initialPrefs.collapsedSectionKeys),
  );
  const [lastVerbByTypeId, setLastVerbByTypeId] = useState<Record<string, string>>(
    () => initialPrefs.lastVerbByTypeId ?? {},
  );
  const [navHistory, setNavHistory] = useState<NavHistoryEntry[]>([]);
  // Back positions only make sense within the arrangement they were taken
  // in, so switching grouping or layout starts a fresh history.
  const setGroupBy = (next: GroupBy) => {
    setGroupByState(next);
    setNavHistory([]);
  };
  const setLayout = (next: RequirementsLayout) => {
    setLayoutState(next);
    setNavHistory([]);
  };
  /** The item open in the split view's detail pane. */
  const [splitSelectedId, setSplitSelectedId] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  /** Which card copy is selected (see RequirementCard's cardKey) - drives
   * where the child quick-add row appears. Local UI state only. */
  const [selectedCardKey, setSelectedCardKey] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [isManagingTypes, setIsManagingTypes] = useState(false);
  const [isManagingRelationshipTypes, setIsManagingRelationshipTypes] = useState(false);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  /**
   * Keep in sync on every render so useCallback-stabilized handlers can
   * always call the CURRENT store without needing requirementsStore in
   * their own dependency arrays - requirementsStore itself is recreated
   * on every requirements change (see App.tsx), unlike the plain
   * onUpdateDoc callback this replaces, which was already stable. Same
   * reasoning as the old docRef this replaces, generalized from just
   * onAddRelationship (the only handler that previously needed to read
   * doc directly) to every handler below, since all of them now go
   * through the store rather than a stable setter.
   */
  const requirementsStoreRef = useRef(requirementsStore);
  const onFocusHandledRef = useRef(onFocusHandled);
  useLayoutEffect(() => {
    requirementsStoreRef.current = requirementsStore;
    onFocusHandledRef.current = onFocusHandled;
  }, [requirementsStore, onFocusHandled]);

  useEffect(() => {
    saveRequirementsViewPrefs(documentId, {
      groupBy,
      layout,
      collapsedIds: [...collapsedIds],
      foldedIds: [...foldedIds],
      collapsedSectionKeys: [...collapsedSectionKeys],
      lastVerbByTypeId,
    });
  }, [
    documentId,
    groupBy,
    layout,
    collapsedIds,
    foldedIds,
    collapsedSectionKeys,
    lastVerbByTypeId,
  ]);

  const onToggleCollapsed = useCallback((itemId: string) => {
    setCollapsedIds((prev) => toggled(prev, itemId));
  }, []);
  const onToggleFolded = useCallback((itemId: string) => {
    setFoldedIds((prev) => toggled(prev, itemId));
  }, []);
  const onToggleSection = useCallback((fullSectionKey: string) => {
    setCollapsedSectionKeys((prev) => toggled(prev, fullSectionKey));
  }, []);
  const onCollapseOutline = useCallback((fullSectionKeys: string[], parentIds: string[]) => {
    setCollapsedSectionKeys((prev) => new Set([...prev, ...fullSectionKeys]));
    setFoldedIds((prev) => new Set([...prev, ...parentIds]));
  }, []);
  const onExpandOutline = useCallback((fullSectionKeys: string[]) => {
    const keys = new Set(fullSectionKeys);
    setCollapsedSectionKeys((prev) => new Set([...prev].filter((k) => !keys.has(k))));
    setFoldedIds(new Set());
  }, []);
  const onVerbUsed = useCallback((itemTypeId: string, verbKey: string) => {
    setLastVerbByTypeId((prev) =>
      prev[itemTypeId] === verbKey ? prev : { ...prev, [itemTypeId]: verbKey },
    );
  }, []);

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

  const onAddItem = (typeId: string) => {
    const id = requirementsStoreRef.current.addItem(typeId);
    /*
     * New items should be immediately visible even if a search is
     * narrowing the list, and land at the bottom of their group - scroll
     * to it the same way a reference-click navigation would.
     */
    setSearch('');
    if (layout === 'split') {
      setSplitSelectedId(id);
      return;
    }
    requestAnimationFrame(() => {
      findCardElement(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  /**
   * Unlike onAddItem, deliberately doesn't scroll or clear the search:
   * the quick-add row is for staying on the parent and adding several
   * children in a row.
   */
  const onAddChildItem = useCallback(
    (parentId: string, typeId: string, title: string): string | null =>
      requirementsStoreRef.current.addChildItem(parentId, typeId, title),
    [],
  );

  const defaultChildTypeId = useMemo(() => pickDefaultChildTypeId(doc.itemTypes), [doc.itemTypes]);

  const onUpdateItem = useCallback((id: string, patch: Partial<RequirementItem>) => {
    requirementsStoreRef.current.updateItem(id, patch);
  }, []);

  const onConvertItemType = useCallback((id: string, newTypeId: string) => {
    requirementsStoreRef.current.convertItemType(id, newTypeId);
  }, []);

  const onConvertAllItemsOfType = useCallback((fromTypeId: string, toTypeId: string) => {
    return requirementsStoreRef.current.convertAllItemsOfType(fromTypeId, toTypeId);
  }, []);

  const onDeleteItem = useCallback((id: string) => {
    requirementsStoreRef.current.deleteItem(id);
  }, []);

  /**
   * Creating a category and assigning it to an item happen as one combined
   * store operation (not two separate calls) so they land as a single
   * undo step, and so the item is never left referencing a categoryId that
   * doesn't exist yet in an intermediate state.
   */
  const onCreateAndAssignCategory = useCallback((itemId: string, label: string) => {
    requirementsStoreRef.current.createAndAssignCategory(itemId, label);
  }, []);

  /**
   * Categories are created ad hoc from any card's picker, so they're
   * deleted from there too. The store clears categoryId on every item
   * that referenced it, so nothing is left dangling
   */
  const onDeleteCategory = useCallback((categoryId: string) => {
    requirementsStoreRef.current.deleteCategory(categoryId);
  }, []);

  // One instance shared by every card, rather than a fresh arrow per
  // card per render. RequirementCard compares this by identity in its
  // memo comparator, so a per-card closure would make that comparison
  // always fail and defeat memoization for the whole list.
  // onFocusedItemChange is a useState setter from App, so it's stable
  // and this callback is too.
  const onEditingChange = useCallback(
    (itemId: string, isEditing: boolean) => onFocusedItemChange?.(isEditing ? itemId : null),
    [onFocusedItemChange],
  );

  const onAddRelationship = useCallback(
    (typeId: string, fromItemId: string, toItemId: string): string | null => {
      return requirementsStoreRef.current.addRelationship(typeId, fromItemId, toItemId);
    },
    [],
  );

  const onDeleteRelationship = useCallback((relationshipId: string) => {
    requirementsStoreRef.current.deleteRelationship(relationshipId);
  }, []);

  /** Read by the stable callbacks below, which must not change identity
   * (every card compares them in its memo check). Updated after render. */
  const navStateRef = useRef({
    layout,
    groupBy,
    selectedId: null as string | null,
    hierarchyIndex,
    outlineSectionOf: new Map<string, string>(),
  });

  const flash = useCallback((itemId: string) => {
    setHighlightedId(itemId);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightedId(null), HIGHLIGHT_DURATION_MS);
  }, []);

  const pushHistory = useCallback((entry: NavHistoryEntry) => {
    setNavHistory((prev) => [...prev.slice(-(MAX_NAV_HISTORY - 1)), entry]);
  }, []);

  /**
   * Follows a link to another item. `fromItemId` is set when the jump came
   * from a card (a relationship chip, a #reference, an Open button), which
   * is what makes it worth a "Back" entry; search-match stepping and
   * external focus requests leave it out.
   *
   * - Split view: opens the item in the detail pane.
   * - List: scrolls to its card, preferring the copy in `fromSectionKey`.
   *   If the target sits inside a folded epic, its ancestors are unfolded
   *   first, then the scroll happens once they've rendered.
   */
  const onNavigateToItem = useCallback(
    (itemId: string, fromSectionKey?: string, fromItemId?: string) => {
      const nav = navStateRef.current;
      const ancestorsOf = (id: string) => {
        const ancestors = new Set<string>();
        const stack = [...(nav.hierarchyIndex.parentsByChildId.get(id) ?? [])];
        while (stack.length > 0) {
          const next = stack.pop()!;
          if (ancestors.has(next)) continue;
          ancestors.add(next);
          stack.push(...(nav.hierarchyIndex.parentsByChildId.get(next) ?? []));
        }
        return ancestors;
      };
      if (nav.layout === 'split') {
        if (fromItemId && nav.selectedId && nav.selectedId !== itemId) {
          pushHistory({ kind: 'select', itemId: nav.selectedId, label: nav.selectedId });
        }
        // Reveal the target in the outline: unfold its section and every
        // parent above it (only what's needed - other folds stay).
        const section = nav.outlineSectionOf.get(itemId);
        if (section) {
          setCollapsedSectionKeys((prev) => {
            if (!prev.has(section)) return prev;
            const next = new Set(prev);
            next.delete(section);
            return next;
          });
        }
        if (nav.groupBy === 'epic') {
          const ancestors = ancestorsOf(itemId);
          if (ancestors.size > 0) {
            setFoldedIds((prev) =>
              [...prev].some((id) => ancestors.has(id))
                ? new Set([...prev].filter((id) => !ancestors.has(id)))
                : prev,
            );
          }
        }
        setSplitSelectedId(itemId);
        flash(itemId);
        return;
      }
      const scrollTo = (el: HTMLElement) => {
        if (fromItemId && contentRef.current) {
          pushHistory({
            kind: 'scroll',
            scrollTop: contentRef.current.scrollTop,
            label: fromItemId,
          });
        }
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        flash(itemId);
      };
      const el = findCardElement(itemId, fromSectionKey);
      if (el) {
        scrollTo(el);
        return;
      }
      if (nav.groupBy !== 'epic') return;
      const ancestors = ancestorsOf(itemId);
      if (ancestors.size === 0) return;
      setFoldedIds((prev) => new Set([...prev].filter((id) => !ancestors.has(id))));
      requestAnimationFrame(() => {
        const unfolded = findCardElement(itemId, fromSectionKey);
        if (unfolded) scrollTo(unfolded);
      });
    },
    [flash, pushHistory],
  );

  const goBack = () => {
    const entry = navHistory[navHistory.length - 1];
    if (!entry) return;
    setNavHistory((prev) => prev.slice(0, -1));
    if (entry.kind === 'select') {
      setSplitSelectedId(entry.itemId);
      flash(entry.itemId);
    } else {
      contentRef.current?.scrollTo({ top: entry.scrollTop, behavior: 'smooth' });
      flash(entry.label);
    }
  };

  /** "Open" on a child card in the split view's detail pane. */
  const onOpenFromDetail = useCallback(
    (itemId: string) =>
      onNavigateToItem(itemId, undefined, navStateRef.current.selectedId ?? undefined),
    [onNavigateToItem],
  );

  const visibleItems = useMemo(
    () => (groupBy === 'epic' ? flattenEpicTreeMatches(epicTree) : groups.flatMap((g) => g.items)),
    [groupBy, epicTree, groups],
  );

  /** The split view's open item: the chosen one while it still exists,
   * otherwise the first visible item. */
  const selectedItemId = useMemo(() => {
    if (splitSelectedId && doc.items.some((i) => i.id === splitSelectedId)) return splitSelectedId;
    return visibleItems[0]?.id ?? null;
  }, [splitSelectedId, doc.items, visibleItems]);

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

  useLayoutEffect(() => {
    navStateRef.current = {
      layout,
      groupBy,
      selectedId: selectedItemId,
      hierarchyIndex,
      outlineSectionOf,
    };
  }, [layout, groupBy, selectedItemId, hierarchyIndex, outlineSectionOf]);

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

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
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

  /*
   * Responds to a navigation request from OUTSIDE this view - e.g. the
   * user clicked a linked requirement pill in the Inspector while looking
   * at the diagram, which switches viewMode to "requirements" (in
   * App.tsx) and sets focusItemId at the same time. This view may be
   * mounting fresh at that exact moment, but a plain useEffect (not
   * useLayoutEffect) still runs after the initial render, by which point
   * every RequirementCard's DOM element - including the one this needs to
   * scroll to - already exists.
   */
  useEffect(() => {
    if (!focusItemId) return;
    const frame = requestAnimationFrame(() => {
      onNavigateToItem(focusItemId);
      onFocusHandledRef.current?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusItemId, onNavigateToItem]);

  const onAddCustomType = (
    label: string,
    prefix: string,
    color: string,
    isWorkable: boolean,
  ): boolean => {
    return requirementsStoreRef.current.addCustomType(label, prefix, color, isWorkable);
  };

  /**
   * Label, color, and isWorkable are all safe to edit after the fact for
   * ANY type, including built-in ones - none of them are baked into
   * already-generated item ids the way prefix is, so changing them can't create
   * a mismatch between an item's stored id and its type's current definition.
   * This intentionally never accepts a prefix patch (the
   * caller can only pass these three fields, not arbitrary ones) - prefix
   * is what actually needs to stay stable once items exist under it.
   * @param typeId
   * @param patch
   */
  const onUpdateType = (
    typeId: string,
    patch: Partial<Pick<RequirementItemType, 'label' | 'color' | 'isWorkable'>>,
  ) => {
    requirementsStoreRef.current.updateType(typeId, patch);
  };

  const onDeleteCustomType = (typeId: string): boolean => {
    return requirementsStoreRef.current.deleteCustomType(typeId);
  };

  const itemCountsByType = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of doc.items) {
      counts[item.typeId] = (counts[item.typeId] ?? 0) + 1;
    }
    return counts;
  }, [doc.items]);

  const onAddCustomRelationshipType = (
    label: string,
    inverseLabel: string,
    color: string,
    isBlocking: boolean,
  ) => {
    requirementsStoreRef.current.addCustomRelationshipType(label, inverseLabel, color, isBlocking);
  };

  const onDeleteCustomRelationshipType = (typeId: string) => {
    requirementsStoreRef.current.deleteCustomRelationshipType(typeId);
  };

  const trimmedSearch = search.trim();

  /**
   * One card, however it's grouped. `cardKey` and `domId` only differ from
   * the item id in the epic grouping, where an item can appear several
   * times.
   */
  const renderCard = (
    item: RequirementItem,
    options: {
      sectionKey: string;
      cardKey?: string;
      domId?: string;
      isContext?: boolean;
      /** False for the split view's open item, which is always expanded. */
      collapsible?: boolean;
      /** Show an Open button (children in the split view's detail pane). */
      openable?: boolean;
    },
  ) => {
    const cardKey = options.cardKey ?? item.id;
    const collapsible = options.collapsible ?? true;
    return (
      <RequirementCard
        key={cardKey}
        item={item}
        doc={doc}
        programIncrements={programIncrements}
        team={team}
        diagramRoot={diagramRoot}
        linkedNodes={linkedNodesByItemId.get(item.id) ?? EMPTY_LINKED_NODES}
        onNavigateToNode={onNavigateToNode}
        onCreateLinkedNode={onCreateLinkedNode}
        onUpdateItem={onUpdateItem}
        onConvertItemType={onConvertItemType}
        onDeleteItem={onDeleteItem}
        onNavigateToItem={onNavigateToItem}
        onCreateAndAssignCategory={onCreateAndAssignCategory}
        onDeleteCategory={onDeleteCategory}
        onAddRelationship={onAddRelationship}
        onDeleteRelationship={onDeleteRelationship}
        highlighted={
          highlightedId === item.id || (Boolean(trimmedSearch) && activeItem?.id === item.id)
        }
        peersHere={
          peers.length === 0 ? EMPTY_PEERS : peers.filter((p) => p.focusedItemId === item.id)
        }
        onEditingChange={onEditingChange}
        searchQuery={trimmedSearch}
        domId={options.domId}
        sectionKey={options.sectionKey}
        cardKey={cardKey}
        isSelected={selectedCardKey === cardKey}
        onSelect={setSelectedCardKey}
        isContext={options.isContext}
        onAddChildItem={onAddChildItem}
        defaultChildTypeId={defaultChildTypeId}
        isCollapsed={collapsible && collapsedIds.has(item.id)}
        onToggleCollapsed={collapsible ? onToggleCollapsed : undefined}
        preferredVerbKey={
          lastVerbByTypeId[item.typeId] ??
          (isEpicItem(doc, item) ? EPIC_DEFAULT_VERB_KEY : undefined)
        }
        onVerbUsed={onVerbUsed}
        onOpenItem={options.openable ? onOpenFromDetail : undefined}
      />
    );
  };

  /**
   * An epic (or any item with children) renders as a block: a compact
   * header that sticks to the top of the list while you're anywhere in
   * its subtree, then its own card, then its children indented beneath.
   * Nested headers stack below their parent's (--epic-depth), so deep in
   * a nested epic you can still see the whole path above you. A plain
   * leaf is just its card.
   */
  const renderEpicNode = (node: EpicTreeNode): React.ReactNode => {
    const card = renderCard(node.item, {
      sectionKey: node.rootId,
      cardKey: node.key,
      domId: domIdByNodeKey.get(node.key),
      isContext: node.isContext,
    });
    const isEpic = isEpicItem(doc, node.item);
    if (!isEpic && node.children.length === 0) {
      return <div key={node.key}>{card}</div>;
    }
    const type = doc.itemTypes.find((t) => t.id === node.item.typeId);
    const color = type?.color ?? 'var(--chrome-text-dim)';
    const descendantCount = countDescendants(node);
    const hasChildren = node.children.length > 0;
    // A search shows every match, folded or not.
    const isFolded = hasChildren && foldedIds.has(node.item.id) && !trimmedSearch;
    return (
      <div
        key={node.key}
        className={`epic-tree__node${isFolded ? ' is-folded' : ''}`}
        style={{ '--epic-depth': node.depth, '--epic-color': color } as React.CSSProperties}
      >
        <div className={`epic-tree__header${node.isContext ? ' is-context' : ''}`}>
          {hasChildren ? (
            <button
              type="button"
              className="epic-tree__fold"
              onClick={() => onToggleFolded(node.item.id)}
              aria-expanded={!isFolded}
              aria-label={`${isFolded ? 'Show' : 'Hide'} the items under ${node.item.id}`}
              title={isFolded ? 'Show children' : 'Hide children'}
            >
              {isFolded ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            </button>
          ) : (
            <span className="epic-tree__fold-spacer" />
          )}
          <button
            type="button"
            className="epic-tree__header-link"
            onClick={() => onNavigateToItem(node.item.id, node.rootId)}
            title={`Go to ${node.item.id}`}
          >
            <span className="epic-tree__header-id" style={{ color }}>
              {node.item.id}
            </span>
            <span className="epic-tree__header-title">{node.item.title || 'Untitled'}</span>
            <span className="epic-tree__header-count">
              {descendantCount} {descendantCount === 1 ? 'item' : 'items'}
              {isFolded ? ' hidden' : ''}
            </span>
          </button>
        </div>
        {card}
        {hasChildren && !isFolded && (
          <div className="epic-tree__children">{node.children.map(renderEpicNode)}</div>
        )}
      </div>
    );
  };

  /** The split view's right-hand side: the open item in full, the path of
   * parents above it, and its children beneath - so an epic and its
   * tickets are on screen together. */
  const renderDetail = () => {
    const item = selectedItemId ? doc.items.find((i) => i.id === selectedItemId) : undefined;
    if (!item) {
      return <p className="requirements-view__empty">Select an item on the left to open it.</p>;
    }
    const itemById = new Map(doc.items.map((i) => [i.id, i]));
    const parents = hierarchyIndex.parentsByChildId.get(item.id) ?? [];
    // The path through the first parent, root first.
    const path: RequirementItem[] = [];
    const seen = new Set([item.id]);
    let cursor: string | undefined = parents[0];
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const parent = itemById.get(cursor);
      if (!parent) break;
      path.unshift(parent);
      cursor = hierarchyIndex.parentsByChildId.get(cursor)?.[0];
    }
    const otherParents = parents
      .slice(1)
      .map((id) => itemById.get(id))
      .filter((p): p is RequirementItem => Boolean(p));
    const children = (hierarchyIndex.childrenByParentId.get(item.id) ?? [])
      .map((id) => itemById.get(id))
      .filter((c): c is RequirementItem => Boolean(c));
    const anyChildExpanded = children.some((c) => !collapsedIds.has(c.id));
    const crumb = (p: RequirementItem) => (
      <button
        key={p.id}
        type="button"
        className="requirements-split__crumb"
        onClick={() => onNavigateToItem(p.id, undefined, item.id)}
        title={p.title || p.id}
      >
        <span style={{ color: doc.itemTypes.find((t) => t.id === p.typeId)?.color }}>{p.id}</span>{' '}
        {p.title || 'Untitled'}
      </button>
    );
    return (
      <>
        {(path.length > 0 || otherParents.length > 0) && (
          <nav className="requirements-split__breadcrumbs" aria-label="Parents">
            {path.map((p) => (
              <span key={p.id} className="requirements-split__crumb-wrap">
                {crumb(p)}
                <ChevronRight size={12} aria-hidden />
              </span>
            ))}
            <span className="requirements-split__crumb-current">{item.id}</span>
            {otherParents.length > 0 && (
              <span className="requirements-split__also">also under {otherParents.map(crumb)}</span>
            )}
          </nav>
        )}
        {renderCard(item, {
          sectionKey: DETAIL_KEY,
          cardKey: `detail:${item.id}`,
          collapsible: false,
        })}
        {children.length > 0 && (
          <section className="requirements-split__children">
            <h3 className="requirements-view__group-title requirements-split__children-title">
              Children <span className="requirements-split__children-count">{children.length}</span>
              <button
                type="button"
                className="requirements-split__children-toggle"
                onClick={() =>
                  setCollapsedIds((prev) => {
                    const next = new Set(prev);
                    for (const child of children) {
                      if (anyChildExpanded) next.add(child.id);
                      else next.delete(child.id);
                    }
                    return next;
                  })
                }
              >
                {anyChildExpanded ? <ChevronsDownUp size={12} /> : <ChevronsUpDown size={12} />}
                {anyChildExpanded ? 'Collapse all' : 'Expand all'}
              </button>
            </h3>
            {children.map((child) =>
              renderCard(child, {
                sectionKey: DETAIL_CHILDREN_KEY,
                cardKey: `child:${child.id}`,
                openable: true,
              }),
            )}
          </section>
        )}
      </>
    );
  };

  const backEntry = navHistory[navHistory.length - 1];
  const backButton = backEntry ? (
    <button type="button" className="requirements-view__back" onClick={goBack}>
      <ArrowLeft size={13} />
      Back to {backEntry.label}
    </button>
  ) : null;

  return (
    <div className="requirements-view">
      <div className="requirements-view__toolbar">
        <div className="requirements-view__toolbar-left">
          <AddItemDropdown
            itemTypes={doc.itemTypes}
            onAddItem={onAddItem}
            onOpenManageTypes={() => setIsManagingTypes(true)}
            itemCountsByType={itemCountsByType}
          />
          <div className={`requirements-view__search-wrap${search.trim() ? ' has-query' : ''}`}>
            <Search size={13} className="requirements-view__search-icon" />
            <input
              ref={searchInputRef}
              className="requirements-view__search-input"
              placeholder="Search requirements..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                if (!e.target.value.trim()) {
                  setActiveMatchItemId(null);
                }
              }}
              onKeyDown={handleSearchKeyDown}
            />
            {search.trim().length > 0 && (
              <div className="requirements-view__search-actions">
                <span className="requirements-view__search-counter">
                  {visibleItems.length > 0
                    ? `${activeIndex + 1} of ${visibleItems.length}`
                    : '0 of 0'}
                </span>
                <button
                  type="button"
                  className="requirements-view__search-nav-btn"
                  onClick={goToPrevMatch}
                  onMouseDown={(e) => e.preventDefault()}
                  disabled={visibleItems.length === 0}
                  title="Previous match (Shift+Enter, Shift+F3)"
                  aria-label="Previous match"
                >
                  <ChevronUp size={13} />
                </button>
                <button
                  type="button"
                  className="requirements-view__search-nav-btn"
                  onClick={goToNextMatch}
                  onMouseDown={(e) => e.preventDefault()}
                  disabled={visibleItems.length === 0}
                  title="Next match (Enter, F3)"
                  aria-label="Next match"
                >
                  <ChevronDown size={13} />
                </button>
                <button
                  type="button"
                  className="requirements-view__search-clear"
                  onClick={() => {
                    setSearch('');
                    setActiveMatchItemId(null);
                    searchInputRef.current?.focus();
                  }}
                  title="Clear search (Escape)"
                  aria-label="Clear search"
                >
                  <X size={12} />
                </button>
              </div>
            )}
            {search.length > 0 && search.trim().length === 0 && (
              <button
                type="button"
                className="requirements-view__search-clear"
                onClick={() => {
                  setSearch('');
                  setActiveMatchItemId(null);
                }}
                title="Clear search"
                aria-label="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </div>
          {!search.trim() && doc.items.length > 0 && (
            <span className="requirements-view__count-badge">
              {doc.items.length} {doc.items.length === 1 ? 'item' : 'items'}
            </span>
          )}
        </div>

        <div className="requirements-view__toolbar-right">
          <div className="requirements-view__group-control">
            <span className="requirements-view__toolbar-label">Group:</span>
            <div className="requirements-view__group-toggle">
              <button
                type="button"
                className={groupBy === 'type' ? 'active' : undefined}
                aria-pressed={groupBy === 'type'}
                onClick={() => setGroupBy('type')}
                title="Group by item type"
              >
                <LayoutList size={12} />
                <span>Type</span>
              </button>
              <button
                type="button"
                className={groupBy === 'category' ? 'active' : undefined}
                aria-pressed={groupBy === 'category'}
                onClick={() => setGroupBy('category')}
                title="Group by category"
              >
                <Tags size={12} />
                <span>Category</span>
              </button>
              <button
                type="button"
                className={groupBy === 'epic' ? 'active' : undefined}
                aria-pressed={groupBy === 'epic'}
                onClick={() => setGroupBy('epic')}
                title="Group by epic, with each epic's children nested beneath it"
              >
                <ListTree size={12} />
                <span>Epic</span>
              </button>
            </div>
          </div>

          <div className="requirements-view__group-control">
            <span className="requirements-view__toolbar-label">View:</span>
            <div className="requirements-view__group-toggle">
              <button
                type="button"
                className={layout === 'list' ? 'active' : undefined}
                aria-pressed={layout === 'list'}
                onClick={() => setLayout('list')}
                title="One scrolling list of cards"
              >
                <Rows3 size={12} />
                <span>List</span>
              </button>
              <button
                type="button"
                className={layout === 'split' ? 'active' : undefined}
                aria-pressed={layout === 'split'}
                onClick={() => setLayout('split')}
                title="An outline on the left, the open item and its children on the right"
              >
                <Columns2 size={12} />
                <span>Split</span>
              </button>
            </div>
            <div className="requirements-view__group-toggle">
              <button
                type="button"
                onClick={() => setCollapsedIds(new Set(doc.items.map((i) => i.id)))}
                title="Collapse all cards to their headers"
                aria-label="Collapse all cards"
              >
                <ChevronsDownUp size={12} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setCollapsedIds(new Set());
                  setFoldedIds(new Set());
                }}
                title="Expand all cards and show every epic's children"
                aria-label="Expand all cards"
              >
                <ChevronsUpDown size={12} />
              </button>
            </div>
          </div>

          <div className="requirements-view__toolbar-divider" />

          <div className="requirements-view__manage-group">
            <button
              type="button"
              className="requirements-view__manage-btn"
              onClick={() => setIsManagingTypes(true)}
              title="Manage requirement types"
            >
              <Settings2 size={13} />
              <span>Types</span>
            </button>
            <button
              type="button"
              className="requirements-view__manage-btn"
              onClick={() => setIsManagingRelationshipTypes(true)}
              title="Manage relationship types"
            >
              <Waypoints size={13} />
              <span>Relationships</span>
            </button>
          </div>
        </div>
      </div>

      {layout === 'split' ? (
        <div className="requirements-split">
          <aside className="requirements-split__outline">
            {doc.items.length === 0 ? (
              <p className="requirements-view__empty">No requirements yet.</p>
            ) : visibleItems.length === 0 ? (
              <p className="requirements-view__empty">No matches.</p>
            ) : (
              <RequirementsOutline
                doc={doc}
                groups={groups}
                epicTree={groupBy === 'epic' ? epicTree : undefined}
                sectionKeyPrefix={groupBy}
                noEpicSectionKey={NO_EPIC_KEY}
                selectedId={selectedItemId}
                onSelect={setSplitSelectedId}
                foldedIds={foldedIds}
                onToggleFolded={onToggleFolded}
                collapsedSectionKeys={collapsedSectionKeys}
                onToggleSection={onToggleSection}
                onCollapseAll={onCollapseOutline}
                onExpandAll={onExpandOutline}
                searchQuery={trimmedSearch}
              />
            )}
          </aside>
          <div className="requirements-split__detail">
            {doc.items.length === 0 ? (
              <p className="requirements-view__empty">
                No requirements yet - add one above to get started.
              </p>
            ) : (
              renderDetail()
            )}
          </div>
          {backButton}
        </div>
      ) : (
        <div className="requirements-view__list-wrap">
          <div
            ref={contentRef}
            className={`requirements-view__content requirements-view__content--${groupBy}`}
            // Clicking empty space (not a card) clears the selection, which
            // also hides the child quick-add row.
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) setSelectedCardKey(null);
            }}
          >
            {doc.items.length === 0 ? (
              <p className="requirements-view__empty">
                No requirements yet - add one above to get started.
              </p>
            ) : visibleItems.length === 0 ? (
              <p className="requirements-view__empty">No requirements match your search.</p>
            ) : groupBy === 'epic' ? (
              <>
                {epicTree.roots.length > 0 && (
                  <section className="requirements-view__group epic-tree">
                    {epicTree.roots.map(renderEpicNode)}
                  </section>
                )}
                {epicTree.unparented.length > 0 && (
                  <section className="requirements-view__group">
                    <h3
                      className="requirements-view__group-title"
                      style={{ color: 'var(--chrome-text-dim)' }}
                    >
                      No epic
                    </h3>
                    {epicTree.unparented.map((item) =>
                      renderCard(item, { sectionKey: NO_EPIC_KEY }),
                    )}
                  </section>
                )}
              </>
            ) : (
              groups.map((group) => (
                <section key={group.key} className="requirements-view__group">
                  <h3 className="requirements-view__group-title" style={{ color: group.color }}>
                    {group.label}
                  </h3>
                  {group.items.map((item) => renderCard(item, { sectionKey: group.key }))}
                </section>
              ))
            )}
          </div>
          {backButton}
        </div>
      )}

      {isManagingTypes && (
        <ManageTypesModal
          doc={doc}
          onAddCustomType={onAddCustomType}
          onUpdateType={onUpdateType}
          onDeleteCustomType={onDeleteCustomType}
          onConvertAllItemsOfType={onConvertAllItemsOfType}
          onClose={() => setIsManagingTypes(false)}
        />
      )}
      {isManagingRelationshipTypes && (
        <ManageRelationshipTypesModal
          doc={doc}
          onAddCustomType={onAddCustomRelationshipType}
          onDeleteCustomType={onDeleteCustomRelationshipType}
          onClose={() => setIsManagingRelationshipTypes(false)}
        />
      )}
    </div>
  );
}
