import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { LayoutList, Search, Settings2, Tags, Waypoints, X } from "lucide-react";
import { RequirementCard } from "./RequirementCard";
import { ManageTypesModal } from "./ManageTypesModal";
import { ManageRelationshipTypesModal } from "./ManageRelationshipTypesModal";
import { AddItemDropdown } from "./AddItemDropdown";
import type {
  RequirementItem,
  RequirementItemType,
} from "../../domain/requirementsTypes";
import type { ProgramIncrement } from "../../domain/programIncrements";
import type { TeamDocument } from "../../domain/teamTypes";
import type { SubDiagram } from "../../domain/types";
import { findAllLinkedNodes, type DiagramPath, type LinkedNodeRef } from "../../domain/subDiagramTree";
import type { RequirementsStore } from "../../collab/requirementsStore";

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
}

const HIGHLIGHT_DURATION_MS = 2000;
// A single shared reference for "no linked nodes" - `linkedNodesByItemId.get(id) ?? []`
// would otherwise allocate a brand new array on every single render for
// every item with no links, which defeats RequirementCard's React.memo
// comparison (a new array is never === the previous one, even though the
// actual content - nothing - never changes).
const EMPTY_LINKED_NODES: LinkedNodeRef[] = [];
const UNCATEGORIZED_KEY = "__uncategorized__";

type GroupBy = "type" | "category";

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
}: RequirementsViewProps) {
  const doc = useSyncExternalStore(requirementsStore.subscribe, requirementsStore.getSnapshot);
  const [search, setSearch] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("type");
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [isManagingTypes, setIsManagingTypes] = useState(false);
  const [isManagingRelationshipTypes, setIsManagingRelationshipTypes] = useState(false);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Kept in sync on every render so useCallback-stabilized handlers can
  // always call the CURRENT store without needing requirementsStore in
  // their own dependency arrays - requirementsStore itself is recreated
  // on every requirements change (see App.tsx), unlike the plain
  // onUpdateDoc callback this replaces, which was already stable. Same
  // reasoning as the old docRef this replaces, generalized from just
  // onAddRelationship (the only handler that previously needed to read
  // doc directly) to every handler below, since all of them now go
  // through the store rather than a stable setter.
  const requirementsStoreRef = useRef(requirementsStore);
  useEffect(() => {
    requirementsStoreRef.current = requirementsStore;
  }, [requirementsStore]);

  // Computed once for every item here, rather than each RequirementCard
  // independently walking the whole diagram tree for just its own item -
  // see findAllLinkedNodes's own doc comment for why that per-card
  // approach doesn't scale with the number of items in this list.
  const linkedNodesByItemId = useMemo(
    () => (diagramRoot ? findAllLinkedNodes(diagramRoot) : new Map()),
    [diagramRoot]
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

  // Grouping is computed generically for both modes into the same shape,
  // so the render below is a single loop rather than duplicated markup per
  // mode - "group by category" is just a different recipe for the same
  // {key, label, color, items} structure "group by type" already produces.
  const groups = useMemo<ItemGroup[]>(() => {
    if (groupBy === "type") {
      return doc.itemTypes
        .map((type) => ({
          key: type.id,
          label: `${type.label}s`,
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
      (i) => !i.categoryId || !doc.categories.some((c) => c.id === i.categoryId)
    );
    if (uncategorized.length > 0) {
      categoryGroups.push({
        key: UNCATEGORIZED_KEY,
        label: "Uncategorized",
        color: "var(--chrome-text-dim)",
        items: uncategorized,
      });
    }
    return categoryGroups;
  }, [groupBy, doc.itemTypes, doc.categories, filteredItems]);

  const onAddItem = (typeId: string) => {
    const id = requirementsStoreRef.current.addItem(typeId);
    // New items should be immediately visible even if a search is
    // narrowing the list, and land at the bottom of their group - scroll
    // to it the same way a reference-click navigation would.
    setSearch("");
    requestAnimationFrame(() => {
      const el = document.getElementById(`requirement-${id}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const onUpdateItem = useCallback((id: string, patch: Partial<RequirementItem>) => {
    requirementsStoreRef.current.updateItem(id, patch);
  }, []);

  const onDeleteItem = useCallback((id: string) => {
    requirementsStoreRef.current.deleteItem(id);
  }, []);

  // Creating a category and assigning it to an item happen as one combined
  // store operation (not two separate calls) so they land as a single
  // undo step, and so the item is never left referencing a categoryId that
  // doesn't exist yet in an intermediate state.
  const onCreateAndAssignCategory = useCallback((itemId: string, label: string) => {
    requirementsStoreRef.current.createAndAssignCategory(itemId, label);
  }, []);

  const onAddRelationship = useCallback((typeId: string, fromItemId: string, toItemId: string): string | null => {
    return requirementsStoreRef.current.addRelationship(typeId, fromItemId, toItemId);
  }, []);

  const onDeleteRelationship = useCallback((relationshipId: string) => {
    requirementsStoreRef.current.deleteRelationship(relationshipId);
  }, []);

  const onNavigateToItem = useCallback((itemId: string) => {
    const el = document.getElementById(`requirement-${itemId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedId(itemId);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightedId(null), HIGHLIGHT_DURATION_MS);
  }, []);

  // Responds to a navigation request from OUTSIDE this view - e.g. the
  // user clicked a linked requirement pill in the Inspector while looking
  // at the diagram, which switches viewMode to "requirements" (in
  // App.tsx) and sets focusItemId at the same time. This view may be
  // mounting fresh at that exact moment, but a plain useEffect (not
  // useLayoutEffect) still runs after the initial render, by which point
  // every RequirementCard's DOM element - including the one this needs to
  // scroll to - already exists.
  useEffect(() => {
    if (!focusItemId) return;
    const frame = requestAnimationFrame(() => {
      onNavigateToItem(focusItemId);
      onFocusHandled?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusItemId, onNavigateToItem, onFocusHandled]);

  const onAddCustomType = (label: string, prefix: string, color: string, isWorkable: boolean): boolean => {
    return requirementsStoreRef.current.addCustomType(label, prefix, color, isWorkable);
  };

  // Label, color, and isWorkable are all safe to edit after the fact for
  // ANY type, including built-in ones - none of them are baked into
  // already-generated item ids the way prefix is, so changing them can't
  // create a mismatch between an item's stored id and its type's current
  // definition. This intentionally never accepts a prefix patch (the
  // caller can only pass these three fields, not arbitrary ones) - prefix
  // is what actually needs to stay stable once items exist under it.
  const onUpdateType = (
    typeId: string,
    patch: Partial<Pick<RequirementItemType, "label" | "color" | "isWorkable">>
  ) => {
    requirementsStoreRef.current.updateType(typeId, patch);
  };

  const onDeleteCustomType = (typeId: string) => {
    requirementsStoreRef.current.deleteCustomType(typeId);
  };

  const itemCountsByType = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of doc.items) {
      counts[item.typeId] = (counts[item.typeId] ?? 0) + 1;
    }
    return counts;
  }, [doc.items]);

  const onAddCustomRelationshipType = (label: string, inverseLabel: string, color: string, isBlocking: boolean) => {
    requirementsStoreRef.current.addCustomRelationshipType(label, inverseLabel, color, isBlocking);
  };

  const onDeleteCustomRelationshipType = (typeId: string) => {
    requirementsStoreRef.current.deleteCustomRelationshipType(typeId);
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
          <div className="requirements-view__search-wrap">
            <Search size={13} className="requirements-view__search-icon" />
            <input
              className="requirements-view__search-input"
              placeholder="Search requirements..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search.length > 0 && (
              <button
                type="button"
                className="requirements-view__search-clear"
                onClick={() => setSearch("")}
                title="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </div>
          {search.trim() ? (
            <span className="requirements-view__count-badge">
              {filteredItems.length} of {doc.items.length}
            </span>
          ) : doc.items.length > 0 ? (
            <span className="requirements-view__count-badge">
              {doc.items.length} {doc.items.length === 1 ? "item" : "items"}
            </span>
          ) : null}
        </div>

        <div className="requirements-view__toolbar-right">
          <div className="requirements-view__group-control">
            <span className="requirements-view__toolbar-label">Group:</span>
            <div className="requirements-view__group-toggle">
              <button
                type="button"
                className={groupBy === "type" ? "active" : undefined}
                onClick={() => setGroupBy("type")}
                title="Group by item type"
              >
                <LayoutList size={12} />
                <span>Type</span>
              </button>
              <button
                type="button"
                className={groupBy === "category" ? "active" : undefined}
                onClick={() => setGroupBy("category")}
                title="Group by category"
              >
                <Tags size={12} />
                <span>Category</span>
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

      <div className="requirements-view__content">
        {doc.items.length === 0 ? (
          <p className="requirements-view__empty">No requirements yet - add one above to get started.</p>
        ) : groups.length === 0 ? (
          <p className="requirements-view__empty">No requirements match your search.</p>
        ) : (
          groups.map((group) => (
            <section key={group.key} className="requirements-view__group">
              <h3 className="requirements-view__group-title" style={{ color: group.color }}>
                {group.label}
              </h3>
              {group.items.map((item) => (
                <RequirementCard
                  key={item.id}
                  item={item}
                  doc={doc}
                  programIncrements={programIncrements}
                  team={team}
                  diagramRoot={diagramRoot}
                  linkedNodes={linkedNodesByItemId.get(item.id) ?? EMPTY_LINKED_NODES}
                  onNavigateToNode={onNavigateToNode}
                  onCreateLinkedNode={onCreateLinkedNode}
                  onUpdateItem={onUpdateItem}
                  onDeleteItem={onDeleteItem}
                  onNavigateToItem={onNavigateToItem}
                  onCreateAndAssignCategory={onCreateAndAssignCategory}
                  onAddRelationship={onAddRelationship}
                  onDeleteRelationship={onDeleteRelationship}
                  highlighted={highlightedId === item.id}
                />
              ))}
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
