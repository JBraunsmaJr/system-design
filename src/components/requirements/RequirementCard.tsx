import { useState } from "react";
import { Trash2 } from "lucide-react";
import { getItemType } from "../../domain/requirementsRegistry";
import { RequirementBody } from "./RequirementBody";
import { RequirementEditor } from "./RequirementEditor";
import { CategoryPicker } from "./CategoryPicker";
import type { RequirementItem, RequirementsDocument } from "../../domain/requirementsTypes";

interface RequirementCardProps {
  item: RequirementItem;
  doc: RequirementsDocument;
  onUpdateItem: (id: string, patch: Partial<RequirementItem>) => void;
  onDeleteItem: (id: string) => void;
  onNavigateToItem: (itemId: string) => void;
  onCreateAndAssignCategory: (itemId: string, label: string) => void;
  /** True briefly after this item was scrolled to via a reference click,
   * so the destination is visually obvious rather than just "the page
   * moved somewhere" - cleared by the parent view after a short timeout. */
  highlighted?: boolean;
}

export function RequirementCard({
  item,
  doc,
  onUpdateItem,
  onDeleteItem,
  onNavigateToItem,
  onCreateAndAssignCategory,
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
          <CategoryPicker
            doc={doc}
            categoryId={item.categoryId}
            onAssign={(categoryId) => onUpdateItem(item.id, { categoryId })}
            onCreateAndAssign={(label) => onCreateAndAssignCategory(item.id, label)}
            onClear={() => onUpdateItem(item.id, { categoryId: undefined })}
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
    </div>
  );
}
