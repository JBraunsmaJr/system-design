import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LayoutList, Search, Settings2, Tags, Waypoints, X } from "lucide-react";
import { addRelationship, createCategory, generateItemId, isPrefixTaken } from "../../domain/requirementsRegistry";
import { RequirementCard } from "./RequirementCard";
import { ManageTypesModal } from "./ManageTypesModal";
import { ManageRelationshipTypesModal } from "./ManageRelationshipTypesModal";
import { AddItemDropdown } from "./AddItemDropdown";
import type {
  RequirementItem,
  RequirementItemType,
  RequirementsDocument,
  RelationshipType,
} from "../../domain/requirementsTypes";
import type { ProgramIncrement } from "../../domain/programIncrements";

interface RequirementsViewProps {
  doc: RequirementsDocument;
  onUpdateDoc: (updater: (doc: RequirementsDocument) => RequirementsDocument) => void;
  programIncrements: ProgramIncrement[];
  /** Set by App.tsx when the user clicks a linked requirement pill from
   * the Inspector (while viewing the diagram) - scrolls to and briefly
   * highlights that item once this view mounts/updates, then reports
   * back via onFocusHandled so App.tsx can clear it (avoiding
   * re-triggering the same scroll on an unrelated re-render). */
  focusItemId?: string | null;
  onFocusHandled?: () => void;
}

function nextCustomTypeId(doc: RequirementsDocument): string {
  let n = 1;
  while (doc.itemTypes.some((t) => t.id === `custom-${n}`)) n++;
  return `custom-${n}`;
}

const HIGHLIGHT_DURATION_MS = 2000;
const UNCATEGORIZED_KEY = "__uncategorized__";

type GroupBy = "type" | "category";

interface ItemGroup {
  key: string;
  label: string;
  color: string;
  items: RequirementItem[];
}

export function RequirementsView({ doc, onUpdateDoc, programIncrements, focusItemId, onFocusHandled }: RequirementsViewProps) {
  const [search, setSearch] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("type");
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [isManagingTypes, setIsManagingTypes] = useState(false);
  const [isManagingRelationshipTypes, setIsManagingRelationshipTypes] = useState(false);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    const { id, nextSequence } = generateItemId(doc, typeId);
    const newItem: RequirementItem = { id, typeId, title: "", body: "" };
    onUpdateDoc((d) => ({ ...d, items: [...d.items, newItem], nextSequence }));
    // New items should be immediately visible even if a search is
    // narrowing the list, and land at the bottom of their group - scroll
    // to it the same way a reference-click navigation would.
    setSearch("");
    requestAnimationFrame(() => {
      const el = document.getElementById(`requirement-${id}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const onUpdateItem = (id: string, patch: Partial<RequirementItem>) => {
    onUpdateDoc((d) => ({ ...d, items: d.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
  };

  const onDeleteItem = (id: string) => {
    onUpdateDoc((d) => ({
      ...d,
      items: d.items.filter((i) => i.id !== id),
      // A relationship referencing the deleted item on either side has
      // nothing left to point at - same "orphaned reference" reasoning as
      // clearing sprintId when a sprint is deleted elsewhere in this app.
      relationships: d.relationships.filter((r) => r.fromItemId !== id && r.toItemId !== id),
    }));
  };

  // Creating a category and assigning it to an item happen as one combined
  // update (not two separate onUpdateDoc calls) so they land as a single
  // undo step, and so the item is never left referencing a categoryId that
  // doesn't exist yet in an intermediate state.
  const onCreateAndAssignCategory = (itemId: string, label: string) => {
    onUpdateDoc((d) => {
      const { category, categories } = createCategory(d, label);
      return {
        ...d,
        categories,
        items: d.items.map((i) => (i.id === itemId ? { ...i, categoryId: category.id } : i)),
      };
    });
  };

  const onAddRelationship = (typeId: string, fromItemId: string, toItemId: string) => {
    onUpdateDoc((d) => ({ ...d, relationships: addRelationship(d, typeId, fromItemId, toItemId) }));
  };

  const onDeleteRelationship = (relationshipId: string) => {
    onUpdateDoc((d) => ({ ...d, relationships: d.relationships.filter((r) => r.id !== relationshipId) }));
  };

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

  const onAddCustomType = (label: string, prefix: string, color: string): boolean => {
    if (isPrefixTaken(doc, prefix)) return false;
    const newType: RequirementItemType = {
      id: nextCustomTypeId(doc),
      label,
      prefix: prefix.toUpperCase(),
      color,
      isBuiltIn: false,
    };
    onUpdateDoc((d) => ({ ...d, itemTypes: [...d.itemTypes, newType] }));
    return true;
  };

  const onDeleteCustomType = (typeId: string) => {
    onUpdateDoc((d) => {
      const removedIds = new Set(d.items.filter((i) => i.typeId === typeId).map((i) => i.id));
      return {
        ...d,
        itemTypes: d.itemTypes.filter((t) => t.id !== typeId),
        // Items of a deleted type have nothing left to belong to - keeping
        // them around as orphans would just be silently-broken data.
        items: d.items.filter((i) => i.typeId !== typeId),
        // Any relationship touching one of those now-deleted items would
        // otherwise be left pointing at an id that no longer exists.
        relationships: d.relationships.filter((r) => !removedIds.has(r.fromItemId) && !removedIds.has(r.toItemId)),
      };
    });
  };

  const itemCountsByType = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of doc.items) {
      counts[item.typeId] = (counts[item.typeId] ?? 0) + 1;
    }
    return counts;
  }, [doc.items]);

  const onAddCustomRelationshipType = (label: string, inverseLabel: string, color: string) => {
    const newType: RelationshipType = {
      id: `rel-type-${Date.now().toString(36)}`,
      label,
      inverseLabel,
      color,
      isBuiltIn: false,
    };
    onUpdateDoc((d) => ({ ...d, relationshipTypes: [...d.relationshipTypes, newType] }));
  };

  const onDeleteCustomRelationshipType = (typeId: string) => {
    onUpdateDoc((d) => ({
      ...d,
      relationshipTypes: d.relationshipTypes.filter((t) => t.id !== typeId),
      // A relationship using a deleted type has nothing left to describe
      // it - unlike deleting an item type, this does NOT touch any
      // requirement items themselves, only the (much lighter-weight) link
      // records between them.
      relationships: d.relationships.filter((r) => r.typeId !== typeId),
    }));
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
