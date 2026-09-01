import { useMemo, useRef, useState } from "react";
import { Plus, Settings2 } from "lucide-react";
import { generateItemId, isPrefixTaken } from "../../domain/requirementsRegistry";
import { RequirementCard } from "./RequirementCard";
import { ManageTypesModal } from "./ManageTypesModal";
import type { RequirementItem, RequirementItemType, RequirementsDocument } from "../../domain/requirementsTypes";

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

export function RequirementsView({ doc, onUpdateDoc }: RequirementsViewProps) {
  const [search, setSearch] = useState("");
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [isManagingTypes, setIsManagingTypes] = useState(false);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return doc.items;
    return doc.items.filter(
      (item) =>
        item.id.toLowerCase().includes(q) ||
        item.title.toLowerCase().includes(q) ||
        item.body.toLowerCase().includes(q)
    );
  }, [doc.items, search]);

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
        <button type="button" className="requirements-view__manage-types" onClick={() => setIsManagingTypes(true)}>
          <Settings2 size={13} />
          Types
        </button>
      </div>

      <div className="requirements-view__content">
        {doc.items.length === 0 ? (
          <p className="requirements-view__empty">No requirements yet - add one above to get started.</p>
        ) : (
          doc.itemTypes.map((type) => {
            const itemsOfType = filteredItems.filter((i) => i.typeId === type.id);
            if (itemsOfType.length === 0) return null;
            return (
              <section key={type.id} className="requirements-view__group">
                <h3 className="requirements-view__group-title" style={{ color: type.color }}>
                  {type.label}s
                </h3>
                {itemsOfType.map((item) => (
                  <RequirementCard
                    key={item.id}
                    item={item}
                    doc={doc}
                    onUpdateItem={onUpdateItem}
                    onDeleteItem={onDeleteItem}
                    onNavigateToItem={onNavigateToItem}
                    highlighted={highlightedId === item.id}
                  />
                ))}
              </section>
            );
          })
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
