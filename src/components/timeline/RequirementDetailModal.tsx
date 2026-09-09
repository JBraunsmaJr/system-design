import { useState, useEffect, useCallback, useMemo } from "react";
import { X, ExternalLink, Calendar, Edit3, Check, Trash2, Diamond, Package, Flag, ClipboardCheck, Rocket, Snowflake } from "lucide-react";
import { getItemType, isItemWorkable } from "../../domain/requirementsRegistry";
import { findLinkedNodes, type DiagramPath } from "../../domain/subDiagramTree";
import { computeSprintDateRanges, type ProgramIncrement } from "../../domain/programIncrements";
import type { RequirementItem, RequirementsDocument } from "../../domain/requirementsTypes";
import type { SubDiagram } from "../../domain/types";
import type { Milestone } from "../../domain/milestones";
import { findMilestonesForItem, getMilestoneColor, getMilestoneTypeLabel } from "../../domain/milestones";
import { computeEpicInferredSchedule } from "../../domain/epicScheduling";
import { RequirementBody } from "../requirements/RequirementBody";
import { LinkedDiagramsSection } from "../requirements/LinkedDiagramsSection";
import { RequirementEditor } from "../requirements/RequirementEditor";
import { CategoryPicker } from "../requirements/CategoryPicker";
import { StatusPicker } from "../requirements/StatusPicker";
import { TypePicker } from "../requirements/TypePicker";
import { SprintPicker } from "../requirements/SprintPicker";
import { RelationshipManager } from "../requirements/RelationshipManager";
import { MemberPicker } from "../team/MemberPicker";
import { PointsPicker } from "../team/PointsPicker";
import type { TeamDocument } from "../../domain/teamTypes";

interface RequirementDetailModalProps {
  item: RequirementItem;
  doc: RequirementsDocument;
  programIncrements: ProgramIncrement[];
  milestones?: Milestone[];
  team?: TeamDocument;
  diagramRoot?: SubDiagram;
  onNavigateToNode?: (path: DiagramPath, nodeId: string) => void;
  onCreateLinkedNode?: (itemId: string, label: string) => void;
  onClose: () => void;
  onUpdateItem?: (id: string, patch: Partial<RequirementItem>) => void;
  onConvertItemType?: (id: string, newTypeId: string) => void;
  onDeleteItem?: (id: string) => void;
  onNavigateToRequirement?: (itemId: string) => void;
  onSelectItem?: (itemId: string) => void;
  onSelectMilestone?: (milestoneId: string) => void;
  onCreateAndAssignCategory?: (itemId: string, label: string) => void;
  onDeleteCategory?: (categoryId: string) => void;
  onAddRelationship?: (typeId: string, fromItemId: string, toItemId: string) => string | null;
  onDeleteRelationship?: (relationshipId: string) => void;
}

export function RequirementDetailModal({
  item,
  doc,
  programIncrements,
  milestones = [],
  team,
  diagramRoot,
  onNavigateToNode,
  onCreateLinkedNode,
  onClose,
  onUpdateItem,
  onConvertItemType,
  onDeleteItem,
  onNavigateToRequirement,
  onSelectItem,
  onSelectMilestone,
  onCreateAndAssignCategory,
  onDeleteCategory,
  onAddRelationship,
  onDeleteRelationship,
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
  const linkedNodes = useMemo(
    () => (diagramRoot ? findLinkedNodes(diagramRoot, item.id) : []),
    [diagramRoot, item.id]
  );
  const category = item.categoryId ? doc.categories.find((c) => c.id === item.categoryId) : undefined;

  const isEpic = item.typeId === "epic" || item.typeId.toLowerCase().includes("epic");
  const epicSchedule = useMemo(() => {
    return computeEpicInferredSchedule(item.id, doc, programIncrements, milestones);
  }, [item.id, doc, programIncrements, milestones]);

  const linkedMilestones = useMemo(() => {
    return findMilestonesForItem(milestones, item.id);
  }, [milestones, item.id]);

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

  const renderMilestoneIcon = (t: string) => {
    switch (t) {
      case "release":
        return <Package size={13} />;
      case "deadline":
        return <Flag size={13} />;
      case "review":
        return <ClipboardCheck size={13} />;
      case "launch":
        return <Rocket size={13} />;
      case "code-freeze":
        return <Snowflake size={13} />;
      default:
        return <Diamond size={13} />;
    }
  };

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
            {onUpdateItem ? (
              <TypePicker
                doc={doc}
                typeId={item.typeId}
                onChange={(newTypeId) => {
                  if (onConvertItemType) {
                    onConvertItemType(item.id, newTypeId);
                  } else {
                    onUpdateItem(item.id, { typeId: newTypeId } as any);
                  }
                }}
              />
            ) : (
              type && <span className="requirement-detail-modal__type-label">{type.label}</span>
            )}
            {onUpdateItem && isItemWorkable(doc, item) && (
              <StatusPicker status={item.status} onChange={(status) => onUpdateItem(item.id, { status })} />
            )}

            {onUpdateItem ? (
              <CategoryPicker
                doc={doc}
                categoryId={item.categoryId}
                onAssign={(categoryId) => onUpdateItem(item.id, { categoryId })}
                onCreateAndAssign={(label) => onCreateAndAssignCategory?.(item.id, label)}
                onClear={() => onUpdateItem(item.id, { categoryId: undefined })}
                onDelete={onDeleteCategory}
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

            {onUpdateItem && isItemWorkable(doc, item) && (
              <SprintPicker
                programIncrements={programIncrements}
                sprintId={item.sprintId}
                onAssign={(sprintId) => onUpdateItem(item.id, { sprintId })}
                onClear={() => onUpdateItem(item.id, { sprintId: undefined })}
              />
            )}

            {team && onUpdateItem && isItemWorkable(doc, item) && (
              <MemberPicker
                team={team}
                assigneeId={item.assigneeId}
                onAssign={(assigneeId) => onUpdateItem(item.id, { assigneeId })}
                onClear={() => onUpdateItem(item.id, { assigneeId: undefined })}
              />
            )}

            {onUpdateItem && isItemWorkable(doc, item) && (
              <PointsPicker
                points={item.points}
                onChange={(points) => onUpdateItem(item.id, { points })}
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

        {isEpic && (
          <div className="requirement-detail-modal__sprint-info" style={{ backgroundColor: "rgba(139, 92, 246, 0.1)", borderColor: "rgba(139, 92, 246, 0.3)" }}>
            <Calendar size={13} style={{ color: "#8b5cf6" }} />
            <span>
              <strong style={{ color: "#8b5cf6" }}>Inferred Schedule:</strong>{" "}
              {epicSchedule.startDate ? (
                <>
                  {epicSchedule.startDate} → {epicSchedule.endDate ? epicSchedule.endDate : <span style={{ color: "#f59e0b" }}>Open-ended ({epicSchedule.unscheduledChildrenCount} unscheduled)</span>}
                </>
              ) : (
                <span style={{ color: "var(--chrome-text-dim)" }}>Unscheduled (0 child items scheduled)</span>
              )}
              {" • "}
              <strong>{epicSchedule.scheduledChildrenCount}/{epicSchedule.totalChildrenCount}</strong> scheduled
              {" • "}
              <strong>{epicSchedule.completedChildrenCount}</strong> done
              {" • "}
              <strong>{epicSchedule.totalPoints}</strong> pts
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

          {onUpdateItem && onAddRelationship && onDeleteRelationship && (
            <div className="requirement-detail-modal__relationships">
              <span className="requirement-detail-modal__desc-label">Relationships</span>
              <RelationshipManager
                itemId={item.id}
                doc={doc}
                onAddRelationship={onAddRelationship}
                onDeleteRelationship={onDeleteRelationship}
                onNavigateToItem={handleNavigateRef}
              />
            </div>
          )}
          {diagramRoot && (
            <LinkedDiagramsSection
              itemId={item.id}
              itemTitle={item.title}
              linkedNodes={linkedNodes}
              onNavigateToNode={(nodePath, nodeId) => {
                onClose();
                onNavigateToNode?.(nodePath, nodeId);
              }}
              onCreateLinkedNode={(itemId, label) => {
                onClose();
                onCreateLinkedNode?.(itemId, label);
              }}
            />
          )}

          {linkedMilestones.length > 0 && (
            <div className="requirement-detail-modal__section" style={{ marginTop: "16px" }}>
              <span className="requirement-detail-modal__desc-label">Linked Milestones & Releases</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "6px" }}>
                {linkedMilestones.map((m) => {
                  const mColor = getMilestoneColor(m);
                  const mLabel = getMilestoneTypeLabel(m.type);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className="pi-board-column__milestone-pill"
                      style={{ borderColor: mColor, color: mColor }}
                      onClick={() => {
                        if (onSelectMilestone) {
                          onClose();
                          onSelectMilestone(m.id);
                        }
                      }}
                      title={`${mLabel}: ${m.name} • Scheduled: ${m.scheduledAt}`}
                    >
                      <span className="pi-board-column__milestone-shape">◆</span>
                      <span>{renderMilestoneIcon(m.type)}</span>
                      <span className="pi-board-column__milestone-name">{m.name}</span>
                      <span style={{ opacity: 0.8, fontSize: "11px" }}>({m.scheduledAt})</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
