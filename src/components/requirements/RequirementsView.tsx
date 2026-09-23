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
  ChevronDown,
  ChevronUp,
  LayoutList,
  ListTree,
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
} from '../../domain/requirementsViewPrefs';

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
      : itemId.replace(/"/g, '\\"');
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
}: RequirementsViewProps) {
  const doc = useSyncExternalStore(
    requirementsStore.subscribe,
    requirementsStore.getSnapshot,
    requirementsStore.getSnapshot,
  );
  const [search, setSearch] = useState(initialSearch);
  const [activeMatchItemId, setActiveMatchItemId] = useState<string | null>(null);
  const [groupBy, setGroupByState] = useState<GroupBy>(
    () => initialGroupBy ?? loadRequirementsViewPrefs(documentId).groupBy ?? 'type',
  );
  const setGroupBy = (next: GroupBy) => {
    setGroupByState(next);
    saveRequirementsViewPrefs(documentId, { groupBy: next });
  };
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
      return doc.itemTypes
        .map((type) => ({
          key: type.id,
          label: plur(type.label, 2),
          color: type.color,
          items: filteredItems.filter((i) => i.typeId === type.id),
        }))
        .filter((g) => g.items.length > 0);
    }
    const categoryGroups = doc.categories
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

  const onNavigateToItem = useCallback((itemId: string, fromSectionKey?: string) => {
    const el = findCardElement(itemId, fromSectionKey);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedId(itemId);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightedId(null), HIGHLIGHT_DURATION_MS);
  }, []);

  const visibleItems = useMemo(
    () => (groupBy === 'epic' ? flattenEpicTreeMatches(epicTree) : groups.flatMap((g) => g.items)),
    [groupBy, epicTree, groups],
  );

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
    options: { sectionKey: string; cardKey?: string; domId?: string; isContext?: boolean },
  ) => {
    const cardKey = options.cardKey ?? item.id;
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
    return (
      <div
        key={node.key}
        className="epic-tree__node"
        style={{ '--epic-depth': node.depth, '--epic-color': color } as React.CSSProperties}
      >
        <button
          type="button"
          className={`epic-tree__header${node.isContext ? ' is-context' : ''}`}
          onClick={() => onNavigateToItem(node.item.id, node.rootId)}
          title={`Go to ${node.item.id}`}
        >
          <span className="epic-tree__header-id" style={{ color }}>
            {node.item.id}
          </span>
          <span className="epic-tree__header-title">{node.item.title || 'Untitled'}</span>
          <span className="epic-tree__header-count">
            {descendantCount} {descendantCount === 1 ? 'item' : 'items'}
          </span>
        </button>
        {card}
        {node.children.length > 0 && (
          <div className="epic-tree__children">{node.children.map(renderEpicNode)}</div>
        )}
      </div>
    );
  };

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
                onClick={() => setGroupBy('type')}
                title="Group by item type"
              >
                <LayoutList size={12} />
                <span>Type</span>
              </button>
              <button
                type="button"
                className={groupBy === 'category' ? 'active' : undefined}
                onClick={() => setGroupBy('category')}
                title="Group by category"
              >
                <Tags size={12} />
                <span>Category</span>
              </button>
              <button
                type="button"
                className={groupBy === 'epic' ? 'active' : undefined}
                onClick={() => setGroupBy('epic')}
                title="Group by epic, with each epic's children nested beneath it"
              >
                <ListTree size={12} />
                <span>Epic</span>
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

      <div
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
                {epicTree.unparented.map((item) => renderCard(item, { sectionKey: NO_EPIC_KEY }))}
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
