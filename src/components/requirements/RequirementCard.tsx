import { useState } from "react";
import { Trash2 } from "lucide-react";
import { getItemType, isItemWorkable } from "../../domain/requirementsRegistry";
import { RequirementBody } from "./RequirementBody";
import { RequirementEditor } from "./RequirementEditor";
import { CategoryPicker } from "./CategoryPicker";
import { StatusPicker } from "./StatusPicker";
import { SprintPicker } from "./SprintPicker";
import { RelationshipManager } from "./RelationshipManager";
import { MemberPicker } from "../team/MemberPicker";
import { PointsPicker } from "../team/PointsPicker";
import type { RequirementItem, RequirementsDocument } from "../../domain/requirementsTypes";
import type { ProgramIncrement } from "../../domain/programIncrements";
import type { TeamDocument } from "../../domain/teamTypes";

interface RequirementCardProps {
  item: RequirementItem;
  doc: RequirementsDocument;
  programIncrements: ProgramIncrement[];
  team?: TeamDocument;
  onUpdateItem: (id: string, patch: Partial<RequirementItem>) => void;
  onDeleteItem: (id: string) => void;
  onNavigateToItem: (itemId: string) => void;
  onCreateAndAssignCategory: (itemId: string, label: string) => void;
  onAddRelationship: (typeId: string, fromItemId: string, toItemId: string) => void;
  onDeleteRelationship: (relationshipId: string) => void;
  /** True briefly after this item was scrolled to via a reference click,
   * so the destination is visually obvious rather than just "the page
   * moved somewhere" - cleared by the parent view after a short timeout. */
  highlighted?: boolean;
}

export function RequirementCard({
  item,
  doc,
  programIncrements,
  team,
  onUpdateItem,
  onDeleteItem,
  onNavigateToItem,
  onCreateAndAssignCategory,
  onAddRelationship,
  onDeleteRelationship,
  highlighted,
}: RequirementCardProps) {
  const [isEditingBody, setIsEditingBody] = useState(false);
  const type = getItemType(doc, item.typeId);

  return (
    <div
      // Used as the scroll-to target for reference navigation - see
      // RequirementsView's onNavigateToItem.
      id={`requirement-${item.id}`}
      className={`requirement-card${highlighted ? " is-highlighted" : ""}`}
    >
      <div className="requirement-card__header">
        <div className="requirement-card__header-row">
          <span className="requirement-card__id" style={{ color: type?.color ?? "var(--chrome-text-dim)" }}>
            {item.id}
          </span>
          {isItemWorkable(doc, item) && (
            <StatusPicker status={item.status} onChange={(status) => onUpdateItem(item.id, { status })} />
          )}
          <CategoryPicker
            doc={doc}
            categoryId={item.categoryId}
            onAssign={(categoryId) => onUpdateItem(item.id, { categoryId })}
            onCreateAndAssign={(label) => onCreateAndAssignCategory(item.id, label)}
            onClear={() => onUpdateItem(item.id, { categoryId: undefined })}
          />
          <SprintPicker
            programIncrements={programIncrements}
            sprintId={item.sprintId}
            onAssign={(sprintId) => onUpdateItem(item.id, { sprintId })}
            onClear={() => onUpdateItem(item.id, { sprintId: undefined })}
          />
          {team && (
            <MemberPicker
              team={team}
              assigneeId={item.assigneeId}
              onAssign={(assigneeId) => onUpdateItem(item.id, { assigneeId })}
              onClear={() => onUpdateItem(item.id, { assigneeId: undefined })}
            />
          )}
          <PointsPicker
            points={item.points}
            onChange={(points) => onUpdateItem(item.id, { points })}
          />
          <button
            type="button"
            className="requirement-card__delete"
            onClick={() => onDeleteItem(item.id)}
            aria-label={`Delete ${item.id}`}
            title={`Delete ${item.id}`}
          >
            <Trash2 size={13} />
          </button>
        </div>
        <input
          className="requirement-card__title"
          value={item.title}
          placeholder="Untitled"
          title={item.title || undefined}
          onChange={(e) => onUpdateItem(item.id, { title: e.target.value })}
        />
      </div>
      {isEditingBody ? (
        <RequirementEditor
          value={item.body}
          onChange={(body) => onUpdateItem(item.id, { body })}
          onDone={() => setIsEditingBody(false)}
          doc={doc}
          autoFocus
          placeholder="Write a description... type # to reference another item"
        />
      ) : (
        <div onDoubleClick={() => setIsEditingBody(true)} className="requirement-card__body-wrap">
          <RequirementBody text={item.body} doc={doc} onNavigateToItem={onNavigateToItem} />
        </div>
      )}
      <RelationshipManager
        itemId={item.id}
        doc={doc}
        onAddRelationship={onAddRelationship}
        onDeleteRelationship={onDeleteRelationship}
        onNavigateToItem={onNavigateToItem}
      />
    </div>
  );
}
