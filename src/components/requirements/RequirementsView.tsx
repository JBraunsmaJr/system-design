import { useMemo, useRef, useState } from "react";
import { LayoutList, Plus, Settings2, Tags } from "lucide-react";
import { createCategory, generateItemId, isPrefixTaken } from "../../domain/requirementsRegistry";
import { RequirementCard } from "./RequirementCard";
import { ManageTypesModal } from "./ManageTypesModal";
import type {
  RequirementItem,
  RequirementItemType,
  RequirementsDocument,
} from "../../domain/requirementsTypes";

interface RequirementsViewProps {
  doc: RequirementsDocument;
  onUpdateDoc: (updater: (doc: RequirementsDocument) => RequirementsDocument) => void;
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

export function RequirementsView({ doc, onUpdateDoc }: RequirementsViewProps) {
  const [search, setSearch] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("type");
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [isManagingTypes, setIsManagingTypes] = useState(false);
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
    onUpdateDoc((d) => ({ ...d, items: d.items.filter((i) => i.id !== id) }));
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

  const onNavigateToItem = (itemId: string) => {
    const el = document.getElementById(`requirement-${itemId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedId(itemId);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightedId(null), HIGHLIGHT_DURATION_MS);
  };

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
    onUpdateDoc((d) => ({
      ...d,
      itemTypes: d.itemTypes.filter((t) => t.id !== typeId),
      // Items of a deleted type have nothing left to belong to - keeping
      // them around as orphans would just be silently-broken data.
      items: d.items.filter((i) => i.typeId !== typeId),
    }));
  };

  return (
    <div className="requirements-view">
      <div className="requirements-view__toolbar">
        <input
          className="requirements-view__search"
          placeholder="Search requirements..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="requirements-view__add-menu">
          {doc.itemTypes.map((type) => (
            <button
              key={type.id}
              type="button"
              className="requirements-view__add-button"
              onClick={() => onAddItem(type.id)}
              style={{ borderColor: `${type.color}66`, color: type.color }}
            >
              <Plus size={12} />
              {type.label}
            </button>
          ))}
        </div>
        <div className="requirements-view__right-cluster">
          <div className="requirements-view__group-toggle">
            <button
              type="button"
              className={groupBy === "type" ? "active" : undefined}
              onClick={() => setGroupBy("type")}
              title="Group by item type"
            >
              <LayoutList size={12} />
              Type
            </button>
            <button
              type="button"
              className={groupBy === "category" ? "active" : undefined}
              onClick={() => setGroupBy("category")}
              title="Group by category"
            >
              <Tags size={12} />
              Category
            </button>
          </div>
          <button type="button" className="requirements-view__manage-types" onClick={() => setIsManagingTypes(true)}>
            <Settings2 size={13} />
            Types
          </button>
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
                  onUpdateItem={onUpdateItem}
                  onDeleteItem={onDeleteItem}
                  onNavigateToItem={onNavigateToItem}
                  onCreateAndAssignCategory={onCreateAndAssignCategory}
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
    </div>
  );
}
