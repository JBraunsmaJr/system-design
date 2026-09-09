import { useState, useEffect, useMemo } from "react";
import { X, Calendar, Plus, Package, Flag, ClipboardCheck, Rocket, Snowflake, Diamond } from "lucide-react";
import type { Milestone } from "../../domain/milestones";
import {
  BUILT_IN_MILESTONE_TYPES,
  getMilestoneTypeLabel,
  validateMilestone,
} from "../../domain/milestones";
import type { RequirementsDocument } from "../../domain/requirementsTypes";
import { getItemType, isItemWorkable } from "../../domain/requirementsRegistry";

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
  const [version, setVersion] = useState("");
  const [description, setDescription] = useState("");
  const [selectedWorkableIds, setSelectedWorkableIds] = useState<string[]>([]);
  const [workableSearch, setWorkableSearch] = useState("");
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

  const allWorkableItems = useMemo(
    () => doc.items.filter((item) => isItemWorkable(doc, item)),
    [doc]
  );

  const filteredWorkableItems = useMemo(() => {
    const q = workableSearch.trim().toLowerCase();
    if (!q) return allWorkableItems;
    return allWorkableItems.filter(
      (item) => item.id.toLowerCase().includes(q) || item.title.toLowerCase().includes(q)
    );
  }, [allWorkableItems, workableSearch]);

  const toggleWorkableId = (id: string) => {
    if (selectedWorkableIds.includes(id)) {
      setSelectedWorkableIds(selectedWorkableIds.filter((i) => i !== id));
    } else {
      setSelectedWorkableIds([...selectedWorkableIds, id]);
    }
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const candidate = {
      type,
      name: name.trim(),
      scheduledAt,
      version: version.trim() !== "" ? version.trim() : undefined,
      description: description.trim() !== "" ? description.trim() : undefined,
      relatedWorkableItemIds: selectedWorkableIds.length > 0 ? selectedWorkableIds : undefined,
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
            Schedule a point-in-time milestone on the timeline without consuming sprint capacity.
          </p>
        </div>

        <form onSubmit={handleCreate} className="add-milestone-modal__form">
          <div className="add-milestone-modal__body">
            {error && <p className="add-milestone-modal__error-message">{error}</p>}

            <div className="add-milestone-modal__field">
              <label className="add-milestone-modal__label">
                Milestone Type
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

            <div className="add-milestone-modal__row">
              <div className="add-milestone-modal__field add-milestone-modal__field--half">
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

              <div className="add-milestone-modal__field add-milestone-modal__field--half">
                <label className="add-milestone-modal__label" htmlFor="milestone-version">
                  Version (Optional)
                </label>
                <input
                  id="milestone-version"
                  type="text"
                  className="add-milestone-modal__input"
                  placeholder="e.g. 2.4.0, 2026.09"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
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

            {/* Optional Related Workable Items (FR-007, FR-008) */}
            <div className="add-milestone-modal__field">
              <label className="add-milestone-modal__label">
                Related Workable Items ({selectedWorkableIds.length} selected)
              </label>
              <p className="add-milestone-modal__hint">
                Optionally link work items that culminate in this {typeLabel.toLowerCase()}. Standalone milestones are also valid.
              </p>

              <input
                type="text"
                className="add-milestone-modal__search-input"
                placeholder="Filter work items..."
                value={workableSearch}
                onChange={(e) => setWorkableSearch(e.target.value)}
              />

              <div className="add-milestone-modal__workable-picker">
                {filteredWorkableItems.length === 0 ? (
                  <p className="add-milestone-modal__workable-empty">
                    {allWorkableItems.length === 0 ? "No workable items in requirements doc." : "No matching items."}
                  </p>
                ) : (
                  filteredWorkableItems.map((item) => {
                    const itemType = getItemType(doc, item.typeId);
                    const isSelected = selectedWorkableIds.includes(item.id);
                    return (
                      <label
                        key={item.id}
                        className={`add-milestone-modal__workable-option${isSelected ? " is-selected" : ""}`}
                        title={`${item.id}: ${item.title || "Untitled"}`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleWorkableId(item.id)}
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
