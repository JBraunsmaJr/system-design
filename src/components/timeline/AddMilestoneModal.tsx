import { useState, useEffect, useMemo } from "react";
import { X, Calendar, Plus, Package, Flag, ClipboardCheck, Rocket, Snowflake, Diamond } from "lucide-react";
import type { Milestone } from "../../domain/milestones";
import {
  BUILT_IN_MILESTONE_TYPES,
  getMilestoneTypeLabel,
  validateMilestone,
} from "../../domain/milestones";
import type { RequirementsDocument } from "../../domain/requirementsTypes";
import { getItemType } from "../../domain/requirementsRegistry";

interface AddMilestoneModalProps {
  initialDate?: string;
  initialType?: string;
  doc: RequirementsDocument;
  onClose: () => void;
  onCreateMilestone: (milestone: Omit<Milestone, "id" | "createdAt" | "updatedAt">) => string;
  onMilestoneCreated?: (id: string) => void;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatTypeFilterLabel(label: string): string {
  const lower = label.toLowerCase();
  if (lower === "dependency") return "Dependencies";
  if (lower === "story") return "Stories";
  if (label.endsWith("s") || label.endsWith("sh") || label.endsWith("ch") || label.endsWith("x") || label.endsWith("z")) return `${label}es`;
  if (label.endsWith("y") && !/[aeiou]y$/i.test(label)) return `${label.slice(0, -1)}ies`;
  return `${label}s`;
}

export function AddMilestoneModal({
  initialDate,
  initialType = "release",
  doc,
  onClose,
  onCreateMilestone,
  onMilestoneCreated,
}: AddMilestoneModalProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState(initialType);
  const [scheduledAt, setScheduledAt] = useState(initialDate || todayISO());
  const [description, setDescription] = useState("");
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [itemSearch, setItemSearch] = useState("");
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const typeLabel = getMilestoneTypeLabel(type);
  const typeDef = BUILT_IN_MILESTONE_TYPES.find((t) => t.id === type);
  const themeColor = typeDef?.color ?? "#9061f9";

  const uniqueItemTypes = useMemo(() => {
    const map = new Map<string, (typeof doc.itemTypes)[number]>();
    for (const t of doc.itemTypes) {
      if (!map.has(t.id)) map.set(t.id, t);
    }
    return Array.from(map.values());
  }, [doc.itemTypes]);

  const allDocItems = useMemo(() => doc.items, [doc]);

  const filteredItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    return allDocItems.filter((item) => {
      if (selectedTypeFilter !== "all" && item.typeId !== selectedTypeFilter) return false;
      if (!q) return true;
      return item.id.toLowerCase().includes(q) || item.title.toLowerCase().includes(q);
    });
  }, [allDocItems, itemSearch, selectedTypeFilter]);

  const toggleItemId = (id: string) => {
    if (selectedItemIds.includes(id)) {
      setSelectedItemIds(selectedItemIds.filter((i) => i !== id));
    } else {
      setSelectedItemIds([...selectedItemIds, id]);
    }
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const candidate = {
      type,
      name: name.trim(),
      scheduledAt,
      description: description.trim() !== "" ? description.trim() : undefined,
      relatedItemIds: selectedItemIds.length > 0 ? selectedItemIds : undefined,
      relatedWorkableItemIds: selectedItemIds.length > 0 ? selectedItemIds : undefined,
    };

    const errors = validateMilestone(candidate, doc);
    if (errors.length > 0) {
      setError(errors[0].message);
      return;
    }

    const id = onCreateMilestone(candidate);
    onMilestoneCreated?.(id);
    onClose();
  };

  const renderTypeIcon = (t: string) => {
    switch (t) {
      case "release":
        return <Package size={15} />;
      case "deadline":
        return <Flag size={15} />;
      case "review":
        return <ClipboardCheck size={15} />;
      case "launch":
        return <Rocket size={15} />;
      case "code-freeze":
        return <Snowflake size={15} />;
      default:
        return <Diamond size={15} />;
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={`Add ${typeLabel}`}>
      <div className="add-milestone-modal" onClick={(e) => e.stopPropagation()}>
        <div className="add-milestone-modal__header" style={{ borderTopColor: themeColor }}>
          <div className="add-milestone-modal__title-row">
            <span
              className="add-milestone-modal__type-badge"
              style={{ backgroundColor: `${themeColor}20`, color: themeColor, borderColor: themeColor }}
            >
              {renderTypeIcon(type)}
              <span>Add {typeLabel}</span>
            </span>

            <button
              type="button"
              className="add-milestone-modal__close-btn"
              onClick={onClose}
              aria-label="Close modal"
            >
              <X size={16} />
            </button>
          </div>
          <p className="add-milestone-modal__subtitle">
            Schedule a point-in-time marker on the timeline without consuming sprint capacity.
          </p>
        </div>

        <form onSubmit={handleCreate} className="add-milestone-modal__form">
          <div className="add-milestone-modal__body">
            {error && <p className="add-milestone-modal__error-message">{error}</p>}

            <div className="add-milestone-modal__field">
              <label className="add-milestone-modal__label">
                Marker Type
              </label>
              <div className="add-milestone-modal__type-selector">
                {BUILT_IN_MILESTONE_TYPES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`add-milestone-modal__type-btn${type === t.id ? " is-active" : ""}`}
                    style={type === t.id ? { borderColor: t.color, color: t.color } : {}}
                    onClick={() => setType(t.id)}
                  >
                    {renderTypeIcon(t.id)}
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="add-milestone-modal__field">
              <label className="add-milestone-modal__label" htmlFor="milestone-name">
                Title / Name *
              </label>
              <input
                id="milestone-name"
                type="text"
                className="add-milestone-modal__input"
                placeholder={type === "release" ? "e.g. Release 2.4" : "e.g. Q3 Architecture Review"}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (error) setError(null);
                }}
                autoFocus
                required
              />
            </div>

            <div className="add-milestone-modal__field">
              <label className="add-milestone-modal__label" htmlFor="milestone-date">
                Scheduled Date *
              </label>
              <div className="add-milestone-modal__input-with-icon">
                <Calendar size={14} className="add-milestone-modal__field-icon" />
                <input
                  id="milestone-date"
                  type="date"
                  className="add-milestone-modal__input"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="add-milestone-modal__field">
              <label className="add-milestone-modal__label" htmlFor="milestone-description">
                Description (Optional)
              </label>
              <textarea
                id="milestone-description"
                className="add-milestone-modal__textarea"
                rows={2}
                placeholder="Scope, objectives, or release notes..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            {/* Optional Related Items & Epics (FR-005, FR-007, FR-008) */}
            <div className="add-milestone-modal__field">
              <label className="add-milestone-modal__label">
                Associated Requirement Items & Epics ({selectedItemIds.length} selected)
              </label>
              <p className="add-milestone-modal__hint">
                Optionally link workable items, Epics, external dependencies, or goals that culminate in this {typeLabel.toLowerCase()}.
              </p>

              <div className="milestone-modal__type-filters">
                <button
                  type="button"
                  className={`milestone-modal__type-filter-btn${selectedTypeFilter === "all" ? " is-active" : ""}`}
                  onClick={() => setSelectedTypeFilter("all")}
                >
                  All Types
                </button>
                {uniqueItemTypes.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`milestone-modal__type-filter-btn${selectedTypeFilter === t.id ? " is-active" : ""}`}
                    style={
                      selectedTypeFilter === t.id
                        ? { borderColor: t.color, color: t.color, backgroundColor: `${t.color}20` }
                        : {}
                    }
                    onClick={() => setSelectedTypeFilter(t.id)}
                  >
                    {formatTypeFilterLabel(t.label)}
                  </button>
                ))}
              </div>

              <input
                type="text"
                className="add-milestone-modal__search-input"
                placeholder="Filter requirement items..."
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
              />

              <div className="add-milestone-modal__workable-picker">
                {filteredItems.length === 0 ? (
                  <p className="add-milestone-modal__workable-empty">
                    {allDocItems.length === 0 ? "No items in requirements doc." : "No matching items."}
                  </p>
                ) : (
                  filteredItems.map((item) => {
                    const itemType = getItemType(doc, item.typeId);
                    const isSelected = selectedItemIds.includes(item.id);
                    return (
                      <label
                        key={item.id}
                        className={`add-milestone-modal__workable-option${isSelected ? " is-selected" : ""}`}
                        title={`${item.id}: ${item.title || "Untitled"}`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleItemId(item.id)}
                        />
                        <span
                          className="add-milestone-modal__item-id"
                          style={{ color: itemType?.color ?? "var(--accent)" }}
                        >
                          {item.id}
                        </span>
                        <span
                          className="add-milestone-modal__item-title"
                          title={item.title || "Untitled"}
                        >
                          {item.title || "Untitled"}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <div className="add-milestone-modal__footer">
            <button
              type="button"
              className="add-milestone-modal__btn add-milestone-modal__btn--cancel"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="add-milestone-modal__btn add-milestone-modal__btn--primary"
              style={{ backgroundColor: themeColor }}
            >
              <Plus size={14} />
              <span>Create {typeLabel}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
