import { useState, useEffect, useCallback } from "react";
import { X, ExternalLink, Calendar, Edit3, Check, Trash2 } from "lucide-react";
import { getItemType } from "../../domain/requirementsRegistry";
import { computeSprintDateRanges, type ProgramIncrement } from "../../domain/programIncrements";
import type { RequirementItem, RequirementsDocument } from "../../domain/requirementsTypes";
import { RequirementBody } from "../requirements/RequirementBody";
import { RequirementEditor } from "../requirements/RequirementEditor";
import { CategoryPicker } from "../requirements/CategoryPicker";
import { SprintPicker } from "../requirements/SprintPicker";

interface RequirementDetailModalProps {
  item: RequirementItem;
  doc: RequirementsDocument;
  programIncrements: ProgramIncrement[];
  onClose: () => void;
  onUpdateItem?: (id: string, patch: Partial<RequirementItem>) => void;
  onDeleteItem?: (id: string) => void;
  onNavigateToRequirement?: (itemId: string) => void;
  onSelectItem?: (itemId: string) => void;
  onCreateAndAssignCategory?: (itemId: string, label: string) => void;
}

export function RequirementDetailModal({
  item,
  doc,
  programIncrements,
  onClose,
  onUpdateItem,
  onDeleteItem,
  onNavigateToRequirement,
  onSelectItem,
  onCreateAndAssignCategory,
}: RequirementDetailModalProps) {
  const [isEditing, setIsEditing] = useState(false);

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isEditing) {
          setIsEditing(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, isEditing]);

  const type = getItemType(doc, item.typeId);
  const category = item.categoryId ? doc.categories.find((c) => c.id === item.categoryId) : undefined;

  // Find the PI and sprint information for this item
  let sprintInfo: { piName: string; sprintName: string; startDate?: string; endDate?: string } | undefined;
  if (item.sprintId) {
    for (const pi of programIncrements) {
      const sprint = pi.sprints.find((s) => s.id === item.sprintId);
      if (sprint) {
        const ranges = computeSprintDateRanges(pi);
        const range = ranges.find((r) => r.sprintId === sprint.id);
        sprintInfo = {
          piName: pi.name,
          sprintName: sprint.name,
          startDate: range?.startDate,
          endDate: range?.endDate,
        };
        break;
      }
    }
  }

  const handleNavigateRef = useCallback(
    (targetId: string) => {
      const exists = doc.items.some((i) => i.id === targetId);
      if (exists && onSelectItem) {
        onSelectItem(targetId);
      } else if (onNavigateToRequirement) {
        onClose();
        onNavigateToRequirement(targetId);
      }
    },
    [doc.items, onSelectItem, onNavigateToRequirement, onClose]
  );

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="requirement-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="requirement-detail-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="requirement-detail-modal__header">
          <div className="requirement-detail-modal__tags">
            <span
              className="requirement-detail-modal__id"
              style={{
                color: type?.color ?? "var(--chrome-text)",
                borderColor: `${type?.color ?? "var(--chrome-border)"}88`,
                background: `${type?.color ?? "var(--chrome-border)"}15`,
              }}
            >
              {item.id}
            </span>
            {type && <span className="requirement-detail-modal__type-label">{type.label}</span>}

            {onUpdateItem ? (
              <CategoryPicker
                doc={doc}
                categoryId={item.categoryId}
                onAssign={(categoryId) => onUpdateItem(item.id, { categoryId })}
                onCreateAndAssign={(label) => onCreateAndAssignCategory?.(item.id, label)}
                onClear={() => onUpdateItem(item.id, { categoryId: undefined })}
              />
            ) : (
              category && (
                <span
                  className="pi-board-item__category"
                  style={{
                    color: category.color,
                    borderColor: `${category.color}44`,
                    background: `${category.color}18`,
                  }}
                >
                  {category.label}
                </span>
              )
            )}

            {onUpdateItem && (
              <SprintPicker
                programIncrements={programIncrements}
                sprintId={item.sprintId}
                onAssign={(sprintId) => onUpdateItem(item.id, { sprintId })}
                onClear={() => onUpdateItem(item.id, { sprintId: undefined })}
              />
            )}
          </div>

          <div className="requirement-detail-modal__actions">
            {onNavigateToRequirement && (
              <button
                type="button"
                className="requirement-detail-modal__action-btn"
                onClick={() => {
                  onClose();
                  onNavigateToRequirement(item.id);
                }}
                title="Open in Requirements view"
                aria-label="Open in Requirements view"
              >
                <ExternalLink size={14} />
              </button>
            )}
            {onDeleteItem && (
              <button
                type="button"
                className="requirement-detail-modal__action-btn requirement-detail-modal__action-btn--delete"
                onClick={() => {
                  onDeleteItem(item.id);
                  onClose();
                }}
                title={`Delete ${item.id}`}
                aria-label={`Delete ${item.id}`}
              >
                <Trash2 size={14} />
              </button>
            )}
            <button
              type="button"
              className="requirement-detail-modal__action-btn"
              onClick={onClose}
              title="Close modal (Esc)"
              aria-label="Close modal"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {sprintInfo && !onUpdateItem && (
          <div className="requirement-detail-modal__sprint-info">
            <Calendar size={13} />
            <span>
              <strong>{sprintInfo.piName}</strong> › {sprintInfo.sprintName}
              {sprintInfo.startDate && sprintInfo.endDate && (
                <span className="requirement-detail-modal__dates">
                  {" "}({sprintInfo.startDate} → {sprintInfo.endDate})
                </span>
              )}
            </span>
          </div>
        )}

        <div className="requirement-detail-modal__body">
          {onUpdateItem ? (
            <input
              id="requirement-detail-title"
              className="requirement-detail-modal__title-input"
              value={item.title}
              placeholder="Requirement Title"
              onChange={(e) => onUpdateItem(item.id, { title: e.target.value })}
            />
          ) : (
            <h2 id="requirement-detail-title" className="requirement-detail-modal__title">
              {item.title || "Untitled Requirement"}
            </h2>
          )}

          <div className="requirement-detail-modal__desc-header">
            <span className="requirement-detail-modal__desc-label">Description</span>
            {onUpdateItem && (
              <button
                type="button"
                className="requirement-detail-modal__edit-toggle"
                onClick={() => setIsEditing(!isEditing)}
              >
                {isEditing ? (
                  <>
                    <Check size={12} />
                    <span>Done</span>
                  </>
                ) : (
                  <>
                    <Edit3 size={12} />
                    <span>Edit</span>
                  </>
                )}
              </button>
            )}
          </div>

          <div className="requirement-detail-modal__desc-content">
            {isEditing && onUpdateItem ? (
              <RequirementEditor
                value={item.body}
                onChange={(body) => onUpdateItem(item.id, { body })}
                onDone={() => setIsEditing(false)}
                doc={doc}
                autoFocus
                placeholder="Write a description... type # to reference another item"
              />
            ) : (
              <div
                className="requirement-detail-modal__body-wrap"
                onDoubleClick={() => onUpdateItem && setIsEditing(true)}
              >
                <RequirementBody
                  text={item.body}
                  doc={doc}
                  onNavigateToItem={handleNavigateRef}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
