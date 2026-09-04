import { memo, useState } from "react";
import { FileText, Plus, Trash2, Workflow } from "lucide-react";
import { getItemType, isItemWorkable } from "../../domain/requirementsRegistry";
import type { LinkedNodeRef, DiagramPath } from "../../domain/subDiagramTree";
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
import type { SubDiagram } from "../../domain/types";

interface RequirementCardProps {
  item: RequirementItem;
  doc: RequirementsDocument;
  programIncrements: ProgramIncrement[];
  team?: TeamDocument;
  /** For finding/navigating to diagram nodes that link back to this item.
   * Computed once for ALL items by the parent (see findAllLinkedNodes)
   * rather than this card walking the whole diagram tree itself - with
   * many cards rendered at once, N independent per-card tree walks scale
   * far worse than one shared walk up front. Both optional purely for
   * prop-drilling convenience; the "Linked Diagrams" section simply
   * doesn't render without diagramRoot. */
  diagramRoot?: SubDiagram;
  linkedNodes?: LinkedNodeRef[];
  onNavigateToNode?: (path: DiagramPath, nodeId: string) => void;
  onCreateLinkedNode?: (itemId: string, label: string) => void;
  onUpdateItem: (id: string, patch: Partial<RequirementItem>) => void;
  onDeleteItem: (id: string) => void;
  onNavigateToItem: (itemId: string) => void;
  onCreateAndAssignCategory: (itemId: string, label: string) => void;
  onAddRelationship: (typeId: string, fromItemId: string, toItemId: string) => string | null;
  onDeleteRelationship: (relationshipId: string) => void;
  /** True briefly after this item was scrolled to via a reference click,
   * so the destination is visually obvious rather than just "the page
   * moved somewhere" - cleared by the parent view after a short timeout. */
  highlighted?: boolean;
}

function RequirementCardImpl({
  item,
  doc,
  programIncrements,
  team,
  diagramRoot,
  linkedNodes = [],
  onNavigateToNode,
  onCreateLinkedNode,
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
          {isItemWorkable(doc, item) && (
            <SprintPicker
              programIncrements={programIncrements}
              sprintId={item.sprintId}
              onAssign={(sprintId) => onUpdateItem(item.id, { sprintId })}
              onClear={() => onUpdateItem(item.id, { sprintId: undefined })}
            />
          )}
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
      {diagramRoot && (
        <div className="requirement-card__diagrams">
          <div className="requirement-card__diagrams-header">
            <span>Linked Diagrams</span>
            {onCreateLinkedNode && (
              <button
                type="button"
                className="requirement-card__diagrams-add"
                onClick={() => onCreateLinkedNode(item.id, item.title || item.id)}
                title="Create a new diagram node linked to this item"
              >
                <Plus size={11} /> New
              </button>
            )}
          </div>
          {linkedNodes.length === 0 ? (
            <p className="requirement-card__diagrams-empty">No linked diagram nodes yet.</p>
          ) : (
            <div className="requirement-card__diagrams-list">
              {linkedNodes.map((ref) => (
                <button
                  key={ref.nodeId}
                  type="button"
                  className="requirement-card__diagram-chip"
                  onClick={() => onNavigateToNode?.(ref.path, ref.nodeId)}
                  title={`Go to "${ref.label || "Untitled"}" in the diagram`}
                >
                  <Workflow size={11} />
                  <span>{ref.label || "Untitled"}</span>
                  {ref.hasSubDiagram && (
                    <FileText size={10} className="requirement-card__diagram-chip-doc" aria-label="Has sub-diagram documentation" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Memoized with a custom comparator rather than the default shallow-prop
 * check, because `doc` (the whole requirements document) changes
 * reference on EVERY edit to ANY item - a default React.memo would still
 * see "doc changed" for every card on every keystroke, regardless of
 * which item was actually edited, and never skip a re-render at all.
 *
 * Instead this compares the specific parts of `doc` each card actually
 * depends on for its OWN rendering (itemTypes, categories,
 * relationshipTypes, relationships - which only change when someone edits a type,
 * category, or relationship, not on every item edit) plus `item` itself by reference,
 * which is the key guarantee this relies on: editing item B's title
 * produces a new items array where every OTHER item keeps its exact
 * previous object reference (see requirementsRegistry/onUpdateDoc's
 * `.map()` pattern) - so this card only re-renders when it's actually
 * its own item that changed, or when a genuinely shared, rarely-changing
 * part of the document changed.
 *
 * `doc.items` as a WHOLE is deliberately not
 * compared - RelationshipManager (rendered inside this card) uses the
 * full doc to search all other items and show current relationships, so
 * in principle another item's title change could leave this card's
 * relationship search briefly stale until it next re-renders for an
 * unrelated reason. That's an accepted, narrow trade-off: the
 * alternative is every card re-rendering on every keystroke anywhere in
 * the list, which is the actual performance problem this exists to fix.
 */
function propsAreEqual(prev: RequirementCardProps, next: RequirementCardProps): boolean {
  return (
    prev.item === next.item &&
    prev.doc.itemTypes === next.doc.itemTypes &&
    prev.doc.categories === next.doc.categories &&
    prev.doc.relationshipTypes === next.doc.relationshipTypes &&
    prev.doc.relationships === next.doc.relationships &&
    prev.programIncrements === next.programIncrements &&
    prev.team === next.team &&
    prev.diagramRoot === next.diagramRoot &&
    prev.linkedNodes === next.linkedNodes &&
    prev.highlighted === next.highlighted &&
    prev.onNavigateToNode === next.onNavigateToNode &&
    prev.onCreateLinkedNode === next.onCreateLinkedNode &&
    prev.onUpdateItem === next.onUpdateItem &&
    prev.onDeleteItem === next.onDeleteItem &&
    prev.onNavigateToItem === next.onNavigateToItem &&
    prev.onCreateAndAssignCategory === next.onCreateAndAssignCategory &&
    prev.onAddRelationship === next.onAddRelationship &&
    prev.onDeleteRelationship === next.onDeleteRelationship
  );
}

export const RequirementCard = memo(RequirementCardImpl, propsAreEqual);
