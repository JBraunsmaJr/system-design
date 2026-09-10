import { useState, useEffect, useMemo } from "react";
import { X, Calendar, Edit3, Trash2, Check, Plus, Tag, Diamond, Package, Flag, ClipboardCheck, Rocket, Snowflake } from "lucide-react";
import type { Milestone } from "../../domain/milestones";
import {
  BUILT_IN_MILESTONE_TYPES,
  getMilestoneColor,
  getMilestoneTypeLabel,
  validateMilestone,
} from "../../domain/milestones";
import type { RequirementsDocument } from "../../domain/requirementsTypes";
import { getItemType, isItemWorkable } from "../../domain/requirementsRegistry";
import type { ProgramIncrement } from "../../domain/programIncrements";
import { computeSprintDateRanges } from "../../domain/programIncrements";
import { RequirementBody } from "../requirements/RequirementBody";

function formatTypeFilterLabel(label: string): string {
  const lower = label.toLowerCase();
  if (lower === "dependency") return "Dependencies";
  if (lower === "story") return "Stories";
  if (label.endsWith("s") || label.endsWith("sh") || label.endsWith("ch") || label.endsWith("x") || label.endsWith("z")) return `${label}es`;
  if (label.endsWith("y") && !/[aeiou]y$/i.test(label)) return `${label.slice(0, -1)}ies`;
  return `${label}s`;
}

interface MilestoneDetailModalProps {
  milestone: Milestone;
  doc: RequirementsDocument;
  programIncrements?: ProgramIncrement[];
  onClose: () => void;
  onUpdateMilestone: (id: string, patch: Partial<Omit<Milestone, "id">>) => void;
  onDeleteMilestone: (id: string) => void;
  onNavigateToRequirement?: (itemId: string) => void;
  onSelectItem?: (itemId: string) => void;
}

export function MilestoneDetailModal({
  milestone,
  doc,
  programIncrements = [],
  onClose,
  onUpdateMilestone,
  onDeleteMilestone,
  onNavigateToRequirement,
  onSelectItem,
}: MilestoneDetailModalProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(milestone.name);
  const [scheduledAt, setScheduledAt] = useState(milestone.scheduledAt);
  const [type, setType] = useState(milestone.type || "release");
  const [description, setDescription] = useState(milestone.description ?? "");
  const [color, setColor] = useState(milestone.color ?? "");
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [workableSearch, setWorkableSearch] = useState("");
  const [isAddingWork, setIsAddingWork] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>("all");

  const startEditing = () => {
    setName(milestone.name);
    setScheduledAt(milestone.scheduledAt);
    setType(milestone.type || "release");
    setDescription(milestone.description ?? "");
    setColor(milestone.color ?? "");
    setValidationError(null);
    setIsEditing(true);
  };

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isAddingWork) {
          setIsAddingWork(false);
          setWorkableSearch("");
        } else if (isEditing) {
          setIsEditing(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, isEditing, isAddingWork]);

  const effectiveColor = getMilestoneColor(
    isEditing
      ? { ...milestone, color: color || undefined, type }
      : milestone
  );
  const typeLabel = getMilestoneTypeLabel(isEditing ? type : milestone.type);

  // All items in requirements doc (workable and non-workable: Tickets, Epics, Dependencies, etc.)
  const allDocItems = useMemo(() => doc.items, [doc]);

  const uniqueItemTypes = useMemo(() => {
    const map = new Map<string, (typeof doc.itemTypes)[number]>();
    for (const t of doc.itemTypes) {
      if (!map.has(t.id)) map.set(t.id, t);
    }
    return Array.from(map.values());
  }, [doc.itemTypes]);

  const currentRelatedIds = useMemo(
    () => milestone.relatedItemIds ?? milestone.relatedWorkableItemIds ?? [],
    [milestone.relatedItemIds, milestone.relatedWorkableItemIds]
  );

  const relatedItems = useMemo(() => {
    const ids = new Set(currentRelatedIds);
    return allDocItems.filter((item) => ids.has(item.id));
  }, [allDocItems, currentRelatedIds]);

  const availableItemsToAdd = useMemo(() => {
    const existingIds = new Set(currentRelatedIds);
    const q = workableSearch.trim().toLowerCase();
    return allDocItems
      .filter((item) => !existingIds.has(item.id))
      .filter((item) => {
        if (selectedTypeFilter !== "all" && item.typeId !== selectedTypeFilter) return false;
        if (q === "") return true;
        return item.id.toLowerCase().includes(q) || item.title.toLowerCase().includes(q);
      });
  }, [allDocItems, currentRelatedIds, workableSearch, selectedTypeFilter]);

  // Map each workable item to its sprint date range if scheduled
  const sprintRangesBySprintId = useMemo(() => {
    const map = new Map<string, { sprintName: string; piName: string; startDate: string; endDate: string }>();
    for (const pi of programIncrements) {
      const ranges = computeSprintDateRanges(pi);
      for (const sprint of pi.sprints) {
        const range = ranges.find((r) => r.sprintId === sprint.id);
        if (range) {
          map.set(sprint.id, {
            sprintName: sprint.name,
            piName: pi.name,
            startDate: range.startDate,
            endDate: range.endDate,
          });
        }
      }
    }
    return map;
  }, [programIncrements]);

  const handleNavigateRef = (targetId: string) => {
    if (onSelectItem) {
      onClose();
      onSelectItem(targetId);
    } else if (onNavigateToRequirement) {
      onClose();
      onNavigateToRequirement(targetId);
    }
  };

  const handleSave = () => {
    const patch = {
      name: name.trim(),
      scheduledAt,
      type,
      description: description.trim() !== "" ? description : undefined,
      color: color.trim() !== "" ? color.trim() : undefined,
    };

    const errors = validateMilestone(patch, doc);
    if (errors.length > 0) {
      setValidationError(errors[0].message);
      return;
    }

    setValidationError(null);
    onUpdateMilestone(milestone.id, patch);
    setIsEditing(false);
  };

  const handleAddItem = (itemId: string) => {
    if (!currentRelatedIds.includes(itemId)) {
      const next = [...currentRelatedIds, itemId];
      onUpdateMilestone(milestone.id, {
        relatedItemIds: next,
        relatedWorkableItemIds: next,
      });
    }
  };

  const handleRemoveItem = (itemId: string) => {
    const next = currentRelatedIds.filter((id) => id !== itemId);
    onUpdateMilestone(milestone.id, {
      relatedItemIds: next,
      relatedWorkableItemIds: next,
    });
  };

  const renderTypeIcon = (t: string) => {
    switch (t) {
      case "release":
        return <Package size={16} />;
      case "deadline":
        return <Flag size={16} />;
      case "review":
        return <ClipboardCheck size={16} />;
      case "launch":
        return <Rocket size={16} />;
      case "code-freeze":
        return <Snowflake size={16} />;
      default:
        return <Diamond size={16} />;
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={`${typeLabel}: ${milestone.name}`}>
      <div className="milestone-detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="milestone-detail-modal__header" style={{ borderTopColor: effectiveColor }}>
          <div className="milestone-detail-modal__title-row">
            <span className="milestone-detail-modal__type-badge" style={{ backgroundColor: `${effectiveColor}20`, color: effectiveColor, borderColor: effectiveColor }}>
              {renderTypeIcon(type)}
              <span>{typeLabel}</span>
            </span>

            {milestone.version && (
              <span className="milestone-detail-modal__version-badge" title="Version metadata">
                v{milestone.version}
              </span>
            )}

            <div className="milestone-detail-modal__actions">
              {!isEditing ? (
                <button
                  type="button"
                  className="milestone-detail-modal__btn milestone-detail-modal__btn--edit"
                  onClick={startEditing}
                  title="Edit Marker"
                >
                  <Edit3 size={14} />
                  <span>Edit</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="milestone-detail-modal__btn milestone-detail-modal__btn--save"
                  onClick={handleSave}
                  title="Save Changes"
                >
                  <Check size={14} />
                  <span>Save</span>
                </button>
              )}

              <button
                type="button"
                className="milestone-detail-modal__close-btn"
                onClick={onClose}
                aria-label="Close modal"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {!isEditing ? (
            <h2 className="milestone-detail-modal__name">{milestone.name}</h2>
          ) : (
            <div className="milestone-detail-modal__edit-name-wrap">
              <label className="milestone-detail-modal__input-label">Marker Name *</label>
              <input
                type="text"
                className="milestone-detail-modal__input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Release 2.4"
                autoFocus
              />
            </div>
          )}

          {validationError && (
            <p className="milestone-detail-modal__error-message">{validationError}</p>
          )}

          <div className="milestone-detail-modal__meta-bar">
            <div className="milestone-detail-modal__meta-item">
              {!isEditing ? (
                <>
                  <Calendar size={14} className="milestone-detail-modal__meta-icon" />
                  <span>
                    Scheduled: <strong>{milestone.scheduledAt}</strong>
                  </span>
                </>
              ) : (
                <label className="milestone-detail-modal__inline-label">
                  Scheduled Date *:
                  <input
                    type="date"
                    className="milestone-detail-modal__date-input"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                  />
                </label>
              )}
            </div>

            {isEditing && (
              <>
                <div className="milestone-detail-modal__meta-item">
                  <Tag size={14} className="milestone-detail-modal__meta-icon" />
                  <label className="milestone-detail-modal__inline-label">
                    Type:
                    <select
                      className="milestone-detail-modal__select"
                      value={type}
                      onChange={(e) => setType(e.target.value)}
                    >
                      {BUILT_IN_MILESTONE_TYPES.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="milestone-detail-modal__meta-item">
                  <label className="milestone-detail-modal__inline-label">
                    Color:
                    <input
                      type="color"
                      className="milestone-detail-modal__color-input"
                      value={effectiveColor}
                      onChange={(e) => setColor(e.target.value)}
                    />
                  </label>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="milestone-detail-modal__body">
          {/* Description section */}
          <div className="milestone-detail-modal__section">
            <h3 className="milestone-detail-modal__section-title">Description</h3>
            {!isEditing ? (
              <div
                className="milestone-detail-modal__desc-wrap"
                onDoubleClick={startEditing}
              >
                <RequirementBody
                  text={milestone.description || ""}
                  doc={doc}
                  onNavigateToItem={handleNavigateRef}
                />
              </div>
            ) : (
              <textarea
                className="milestone-detail-modal__textarea"
                rows={3}
                placeholder="Describe the scope, objectives, or release notes for this marker..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            )}
          </div>

          {/* Associated Items section (FR-005, FR-007, AC-005, DR-005, DR-006) */}
          <div className="milestone-detail-modal__section">
            <div className="milestone-detail-modal__section-header">
              <h3 className="milestone-detail-modal__section-title">
                Associated Requirement Items & Epics ({relatedItems.length})
              </h3>
              <button
                type="button"
                className={`milestone-detail-modal__add-work-btn${isAddingWork ? " is-active" : ""}`}
                onClick={() => {
                  setIsAddingWork(!isAddingWork);
                  if (isAddingWork) setWorkableSearch("");
                }}
              >
                {isAddingWork ? <Check size={13} /> : <Plus size={13} />}
                <span>{isAddingWork ? "Done" : "Add Associated Item"}</span>
              </button>
            </div>

            <p className="milestone-detail-modal__info-hint">
              Requirement items, Epics, external dependencies, or goals linked to this {typeLabel.toLowerCase()}.
            </p>

            {isAddingWork && (
              <div className="milestone-detail-modal__picker-box">
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
                  className="milestone-detail-modal__picker-search"
                  placeholder="Search requirement items by ID or title..."
                  value={workableSearch}
                  onChange={(e) => setWorkableSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setIsAddingWork(false);
                      setWorkableSearch("");
                    }
                  }}
                  autoFocus
                />
                <div className="milestone-detail-modal__picker-list">
                  {availableItemsToAdd.length === 0 ? (
                    <p className="milestone-detail-modal__picker-empty">
                      {workableSearch.trim() ? "No matching items." : "All items in this filter are already associated."}
                    </p>
                  ) : (
                    availableItemsToAdd.map((item) => {
                      const itemType = getItemType(doc, item.typeId);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className="milestone-detail-modal__picker-item"
                          onClick={() => handleAddItem(item.id)}
                          title={`${item.id}: ${item.title || "Untitled"}`}
                        >
                          <span
                            className="milestone-detail-modal__item-id"
                            style={{ color: itemType?.color ?? "var(--accent)" }}
                          >
                            {item.id}
                          </span>
                          <span
                            className="milestone-detail-modal__item-title"
                            title={item.title || "Untitled"}
                          >
                            {item.title || "Untitled"}
                          </span>
                          {isItemWorkable(doc, item) && item.points !== undefined && (
                            <span className="milestone-detail-modal__item-pts">{item.points} pts</span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {relatedItems.length === 0 ? (
              <p className="milestone-detail-modal__work-empty">
                No requirement items or epics associated with this milestone yet. Standalone milestones are fully supported.
              </p>
            ) : (
              <ul className="milestone-detail-modal__work-list">
                {relatedItems.map((item) => {
                  const itemType = getItemType(doc, item.typeId);
                  const sprintSchedule = item.sprintId ? sprintRangesBySprintId.get(item.sprintId) : undefined;
                  return (
                    <li
                      key={item.id}
                      className="milestone-detail-modal__work-row"
                      title={`${item.id}: ${item.title || "Untitled"}`}
                    >
                      <div
                        className="milestone-detail-modal__work-info"
                        title={`${item.id}: ${item.title || "Untitled"}`}
                      >
                        <span
                          className="milestone-detail-modal__item-id"
                          style={{ color: itemType?.color ?? "var(--accent)" }}
                        >
                          {item.id}
                        </span>
                        <span
                          className="milestone-detail-modal__work-title"
                          title={item.title || "Untitled"}
                        >
                          {item.title || "Untitled"}
                        </span>
                        {item.status && (
                          <span className={`milestone-detail-modal__status-pill milestone-detail-modal__status-pill--${item.status}`}>
                            {item.status}
                          </span>
                        )}
                        {sprintSchedule && (
                          <span
                            className="milestone-detail-modal__sprint-info"
                            title={`${sprintSchedule.piName} • ${sprintSchedule.sprintName}`}
                          >
                            {sprintSchedule.sprintName} ({sprintSchedule.startDate} → {sprintSchedule.endDate})
                          </span>
                        )}
                      </div>

                      <div className="milestone-detail-modal__work-row-actions">
                        {(onSelectItem || onNavigateToRequirement) && (
                          <button
                            type="button"
                            className="milestone-detail-modal__link-action"
                            onClick={() => {
                              onClose();
                              if (onSelectItem) {
                                onSelectItem(item.id);
                              } else if (onNavigateToRequirement) {
                                onNavigateToRequirement(item.id);
                              }
                            }}
                            title={`Open ${item.id} details`}
                          >
                            View Item
                          </button>
                        )}
                        <button
                          type="button"
                          className="milestone-detail-modal__remove-work-btn"
                          onClick={() => handleRemoveItem(item.id)}
                          title={`Unlink ${item.id} from this milestone`}
                          aria-label={`Unlink ${item.id}`}
                        >
                          <X size={13} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Footer / Delete actions */}
        <div className="milestone-detail-modal__footer">
          {isConfirmingDelete ? (
            <div className="milestone-detail-modal__confirm-delete">
              <span>Delete this {typeLabel.toLowerCase()}? Associated work items will not be deleted.</span>
              <button
                type="button"
                className="milestone-detail-modal__btn milestone-detail-modal__btn--danger"
                onClick={() => {
                  onDeleteMilestone(milestone.id);
                  onClose();
                }}
              >
                Yes, Delete
              </button>
              <button
                type="button"
                className="milestone-detail-modal__btn milestone-detail-modal__btn--cancel"
                onClick={() => setIsConfirmingDelete(false)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="milestone-detail-modal__delete-btn"
              onClick={() => setIsConfirmingDelete(true)}
            >
              <Trash2 size={13} />
              <span>Delete {typeLabel}</span>
            </button>
          )}

          <button type="button" className="milestone-detail-modal__btn milestone-detail-modal__btn--close" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
