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
  ArrowLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
} from 'lucide-react';
import { RequirementCard } from './RequirementCard';
import { ManageTypesModal } from './ManageTypesModal';
import { ManageRelationshipTypesModal } from './ManageRelationshipTypesModal';
import type {
  RequirementItem,
  RequirementItemType,
} from '../../domain/requirements/requirementsTypes';
import type { ProgramIncrement } from '../../domain/timeline/programIncrements';
import type { TeamDocument } from '../../domain/timeline/teamTypes';
import type { SubDiagram } from '../../domain/canvas/types';
import {
  findAllLinkedNodes,
  type DiagramPath,
  type LinkedNodeRef,
} from '../../domain/canvas/subDiagramTree';
import type { RequirementsStore } from '../../collab/stores/requirementsStore';
import type { PresenceInfo } from '../../collab/sync/session';
import { isEpicItem } from '../../domain/requirements/requirementsHierarchy';
import {
  loadRequirementsViewPrefs,
  saveRequirementsViewPrefs,
  type RequirementsGroupBy,
  type RequirementsLayout,
} from '../../domain/requirements/requirementsViewPrefs';
import { RequirementsOutline } from './RequirementsOutline';
import {
  useRequirementsFilter,
  NO_EPIC_KEY,
} from './hooks/useRequirementsFilter';
import { RequirementsHeaderToolbar } from './components/RequirementsHeaderToolbar';
import { RequirementsTreeList } from './components/RequirementsTreeList';
import { RequirementsGroupSection } from './components/RequirementsGroupSection';

export interface RequirementsViewProps {
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
const EMPTY_LINKED_NODES: LinkedNodeRef[] = [];
const EMPTY_PEERS: PresenceInfo[] = [];
const DETAIL_KEY = '__detail__';
const DETAIL_CHILDREN_KEY = '__detail-children__';
const MAX_NAV_HISTORY = 20;
const EPIC_DEFAULT_VERB_KEY = 'parent-of::forward';

type NavHistoryEntry =
  | { kind: 'scroll'; scrollTop: number; label: string }
  | { kind: 'select'; itemId: string; label: string };

function toggled(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

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

function pickDefaultChildTypeId(itemTypes: RequirementItemType[]): string | undefined {
  return (
    itemTypes.find((t) => t.id === 'ticket')?.id ??
    itemTypes.find((t) => t.isWorkable)?.id ??
    itemTypes[0]?.id
  );
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

  const [initialPrefs] = useState(() => loadRequirementsViewPrefs(documentId));
  const [groupBy, setGroupByState] = useState<RequirementsGroupBy>(
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

  const setGroupBy = (next: RequirementsGroupBy) => {
    setGroupByState(next);
    setNavHistory([]);
  };
  const setLayout = (next: RequirementsLayout) => {
    setLayoutState(next);
    setNavHistory([]);
  };

  const [splitSelectedId, setSplitSelectedId] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [selectedCardKey, setSelectedCardKey] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [isManagingTypes, setIsManagingTypes] = useState(false);
  const [isManagingRelationshipTypes, setIsManagingRelationshipTypes] = useState(false);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const linkedNodesByItemId = useMemo(
    () => (diagramRoot ? findAllLinkedNodes(diagramRoot) : new Map()),
    [diagramRoot],
  );

  const navStateRef = useRef({
    layout,
    groupBy,
    selectedId: null as string | null,
    hierarchyIndex: { parentsByChildId: new Map<string, string[]>(), childrenByParentId: new Map<string, string[]>() },
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

  const onNavigateToItem = useCallback(
    (itemId: string, fromSectionKey?: string, fromItemId?: string) => {
      const nav = navStateRef.current;
      const ancestorsOf = (id: string) => {
        const ancestors = new Set<string>();
        const stack = [...(nav.hierarchyIndex.parentsByChildId.get(id) ?? [])];
        while (stack.length > 0) {
          const parentId = stack.pop()!;
          if (ancestors.has(parentId)) continue;
          ancestors.add(parentId);
          stack.push(...(nav.hierarchyIndex.parentsByChildId.get(parentId) ?? []));
        }
        return ancestors;
      };

      if (nav.layout === 'split') {
        if (fromItemId) {
          pushHistory({ kind: 'select', itemId: fromItemId, label: fromItemId });
        }
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

  const {
    search,
    setSearch,
    searchInputRef,
    activeMatchItemId,
    setActiveMatchItemId,
    hierarchyIndex,
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
  } = useRequirementsFilter({
    doc,
    groupBy,
    initialSearch,
    onNavigateToItem,
  });

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

  const onOpenFromDetail = useCallback(
    (itemId: string) =>
      onNavigateToItem(itemId, undefined, navStateRef.current.selectedId ?? undefined),
    [onNavigateToItem],
  );

  const selectedItemId = useMemo(() => {
    if (splitSelectedId && doc.items.some((i) => i.id === splitSelectedId)) return splitSelectedId;
    return visibleItems[0]?.id ?? null;
  }, [splitSelectedId, doc.items, visibleItems]);

  useLayoutEffect(() => {
    navStateRef.current = {
      layout,
      groupBy,
      selectedId: selectedItemId,
      hierarchyIndex,
      outlineSectionOf,
    };
  }, [layout, groupBy, selectedItemId, hierarchyIndex, outlineSectionOf]);

  const onAddItem = (typeId: string) => {
    const id = requirementsStoreRef.current.addItem(typeId);
    setSearch('');
    if (layout === 'split') {
      setSplitSelectedId(id);
      return;
    }
    requestAnimationFrame(() => {
      findCardElement(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

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

  const onCreateAndAssignCategory = useCallback((itemId: string, label: string) => {
    requirementsStoreRef.current.createAndAssignCategory(itemId, label);
  }, []);

  const onDeleteCategory = useCallback((categoryId: string) => {
    requirementsStoreRef.current.deleteCategory(categoryId);
  }, []);

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

  const renderCard = (
    item: RequirementItem,
    options: {
      sectionKey: string;
      cardKey?: string;
      domId?: string;
      isContext?: boolean;
      collapsible?: boolean;
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

  const renderDetail = () => {
    const item = selectedItemId ? doc.items.find((i) => i.id === selectedItemId) : undefined;
    if (!item) {
      return <p className="requirements-view__empty">Select an item on the left to open it.</p>;
    }
    const itemById = new Map(doc.items.map((i) => [i.id, i]));
    const parents = hierarchyIndex.parentsByChildId.get(item.id) ?? [];
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
      <RequirementsHeaderToolbar
        doc={doc}
        search={search}
        setSearch={setSearch}
        searchInputRef={searchInputRef}
        activeMatchItemId={activeMatchItemId}
        setActiveMatchItemId={setActiveMatchItemId}
        visibleItems={visibleItems}
        activeIndex={activeIndex}
        goToPrevMatch={goToPrevMatch}
        goToNextMatch={goToNextMatch}
        handleSearchKeyDown={handleSearchKeyDown}
        groupBy={groupBy}
        setGroupBy={setGroupBy}
        layout={layout}
        setLayout={setLayout}
        itemCountsByType={itemCountsByType}
        onAddItem={onAddItem}
        onOpenManageTypes={() => setIsManagingTypes(true)}
        onOpenManageRelationshipTypes={() => setIsManagingRelationshipTypes(true)}
        onCollapseAllCards={() => setCollapsedIds(new Set(doc.items.map((i) => i.id)))}
        onExpandAllCards={() => {
          setCollapsedIds(new Set());
          setFoldedIds(new Set());
        }}
      />

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
              <RequirementsTreeList
                epicTree={epicTree}
                doc={doc}
                foldedIds={foldedIds}
                onToggleFolded={onToggleFolded}
                onNavigateToItem={onNavigateToItem}
                domIdByNodeKey={domIdByNodeKey}
                searchQuery={trimmedSearch}
                renderCard={renderCard}
              />
            ) : (
              groups.map((group) => (
                <RequirementsGroupSection
                  key={group.key}
                  group={group}
                  renderCard={renderCard}
                />
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
