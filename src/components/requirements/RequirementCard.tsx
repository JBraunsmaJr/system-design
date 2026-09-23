import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ListPlus, Trash2 } from 'lucide-react';
import { getItemType, isItemWorkable } from '../../domain/requirementsRegistry';
import type { LinkedNodeRef, DiagramPath } from '../../domain/subDiagramTree';
import { RequirementBody } from './RequirementBody';
import { peerBadgesAreEqual } from '../../domain/presenceComparison';
import { LinkedDiagramsSection } from './LinkedDiagramsSection';
import { RequirementEditor } from './RequirementEditor';
import { CategoryPicker } from './CategoryPicker';
import { StatusPicker } from './StatusPicker';
import { TypePicker } from './TypePicker';
import { SprintPicker } from './SprintPicker';
import { RelationshipManager } from './RelationshipManager';
import { ChildQuickAdd } from './ChildQuickAdd';
import { isEpicItem } from '../../domain/requirementsHierarchy';
import { MemberPicker } from '../team/MemberPicker';
import { PointsPicker } from '../team/PointsPicker';
import { HighlightedText, HighlightedTitle } from './HighlightText';
import type { RequirementItem, RequirementsDocument } from '../../domain/requirementsTypes';
import type { ProgramIncrement } from '../../domain/programIncrements';
import type { TeamDocument } from '../../domain/teamTypes';
import type { SubDiagram } from '../../domain/types';
import type { PresenceInfo } from '../../collab/session';

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
  onConvertItemType?: (id: string, newTypeId: string) => void;
  onDeleteItem: (id: string) => void;
  /** The second argument is this card's sectionKey, so that when the
   * target item is shown in several places (a ticket under two epics) the
   * view can prefer the copy in the section the click came from. */
  onNavigateToItem: (itemId: string, fromSectionKey?: string) => void;
  onCreateAndAssignCategory: (itemId: string, label: string) => void;
  onDeleteCategory: (categoryId: string) => void;
  onAddRelationship: (typeId: string, fromItemId: string, toItemId: string) => string | null;
  onDeleteRelationship: (relationshipId: string) => void;
  /** True briefly after this item was scrolled to via a reference click,
   * so the destination is visually obvious rather than just "the page
   * moved somewhere" - cleared by the parent view after a short timeout. */
  highlighted?: boolean;
  /** Other people in a collaborative session currently editing THIS
   * specific item - already filtered by the parent view. Empty outside
   * of a session, or when no one else has this item open. */
  peersHere?: PresenceInfo[];
  /** Reports whenever this card's own editing state changes, so the
   * parent view can broadcast "I'm now editing item X" (or "no longer
   * editing anything") via presence. */
  /** Takes the item id so the parent can define ONE stable callback for
   * the whole list rather than a per-card closure over item.id. That
   * matters directly for propsAreEqual below: a per-card arrow is a new
   * function identity on every render, so comparing it would disable
   * memoization for every card, permanently. */
  onEditingChange?: (itemId: string, isEditing: boolean) => void;
  searchQuery?: string;
  /** DOM id for this card. Defaults to `requirement-<id>`; the epic
   * grouping passes a distinct one for each extra copy of an item that
   * appears under several parents, since DOM ids must be unique. */
  domId?: string;
  /** Which section this copy sits in (the top-level epic's id when
   * grouping by epic). Written to data-section-key for navigation. */
  sectionKey?: string;
  /** Identifies this particular copy for selection - defaults to the item
   * id, which is unique outside the epic grouping. */
  cardKey?: string;
  /** Whether this copy is the selected card - shows the child quick-add on
   * epics. Passed as a boolean (not the selected key) so selecting a card
   * only re-renders the card losing and the card gaining selection. */
  isSelected?: boolean;
  onSelect?: (cardKey: string | null) => void;
  /** Shown only because something beneath it matched a search. */
  isContext?: boolean;
  onAddChildItem?: (parentId: string, typeId: string, title: string) => string | null;
  defaultChildTypeId?: string;
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
  onConvertItemType,
  onDeleteItem,
  onNavigateToItem,
  onCreateAndAssignCategory,
  onDeleteCategory,
  onAddRelationship,
  onDeleteRelationship,
  highlighted,
  peersHere = [],
  onEditingChange,
  searchQuery,
  domId,
  sectionKey,
  cardKey,
  isSelected,
  onSelect,
  isContext,
  onAddChildItem,
  defaultChildTypeId,
}: RequirementCardProps) {
  const [isEditingBody, setIsEditingBody] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const pointerIsDownRef = useRef(false);
  const selectionKey = cardKey ?? item.id;
  const navigateFromHere = useCallback(
    (targetId: string) => onNavigateToItem(targetId, sectionKey),
    [onNavigateToItem, sectionKey],
  );
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  // Reports every genuine transition, not the initial mount - a card
  // that's never been edited shouldn't fire a spurious "not editing"
  // the moment it renders, since nothing changed yet.
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    onEditingChange?.(item.id, isEditingBody);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditingBody]);
  const type = getItemType(doc, item.typeId);
  const canAddChildren =
    Boolean(onAddChildItem) && Boolean(defaultChildTypeId) && isEpicItem(doc, item);

  return (
    <div
      // Used as the scroll-to target for reference navigation - see
      // RequirementsView's onNavigateToItem.
      ref={cardRef}
      id={domId ?? `requirement-${item.id}`}
      data-requirement-id={item.id}
      data-section-key={sectionKey}
      className={`requirement-card${highlighted ? ' is-highlighted' : ''}${
        isSelected ? ' is-selected' : ''
      }${isContext ? ' is-context' : ''}`}
      // Selection changes layout (the previously selected epic's
      // quick-add row disappears), so it must never happen between a mouse
      // press and its release - the content would shift under the pointer
      // and the click would land on a different element (e.g. a title
      // would never enter edit mode). So a mouse selects on CLICK, and
      // focus only selects when no pointer is down (keyboard navigation).
      // Capture phase, so it runs before the clicked control's own handler.
      // Re-selecting the selected card is a no-op update in the parent.
      onPointerDownCapture={
        onSelect
          ? () => {
              pointerIsDownRef.current = true;
              window.addEventListener(
                'pointerup',
                () => {
                  pointerIsDownRef.current = false;
                },
                { once: true, capture: true },
              );
            }
          : undefined
      }
      onClickCapture={onSelect ? () => onSelect(selectionKey) : undefined}
      onFocusCapture={
        onSelect
          ? () => {
              if (!pointerIsDownRef.current) onSelect(selectionKey);
            }
          : undefined
      }
    >
      <div className="requirement-card__header">
        <div className="requirement-card__header-row">
          <span
            className="requirement-card__id"
            style={{ color: type?.color ?? 'var(--chrome-text-dim)' }}
          >
            <HighlightedText text={item.id} search={searchQuery} />
          </span>
          <TypePicker
            doc={doc}
            typeId={item.typeId}
            onChange={(newTypeId) => {
              if (onConvertItemType) {
                onConvertItemType(item.id, newTypeId);
              } else {
                onUpdateItem(item.id, { typeId: newTypeId });
              }
            }}
          />
          {peersHere.length > 0 && (
            <span
              className="requirement-card__peers"
              title={`${peersHere.map((p) => p.name).join(', ')} ${peersHere.length === 1 ? 'is' : 'are'} editing this`}
            >
              {peersHere.map((p) => (
                <span
                  key={p.clientId}
                  className="requirement-card__peer-dot"
                  style={{ backgroundColor: p.color }}
                >
                  {p.name.charAt(0).toUpperCase()}
                </span>
              ))}
            </span>
          )}
          {isItemWorkable(doc, item) && (
            <StatusPicker
              status={item.status}
              onChange={(status) => onUpdateItem(item.id, { status })}
            />
          )}
          <CategoryPicker
            doc={doc}
            categoryId={item.categoryId}
            onAssign={(categoryId) => onUpdateItem(item.id, { categoryId })}
            onCreateAndAssign={(label) => onCreateAndAssignCategory(item.id, label)}
            onClear={() => onUpdateItem(item.id, { categoryId: undefined })}
            onDelete={onDeleteCategory}
            searchQuery={searchQuery}
          />
          {isItemWorkable(doc, item) && (
            <SprintPicker
              programIncrements={programIncrements}
              sprintId={item.sprintId}
              onAssign={(sprintId) => onUpdateItem(item.id, { sprintId })}
              onClear={() => onUpdateItem(item.id, { sprintId: undefined })}
            />
          )}
          {team && isItemWorkable(doc, item) && (
            <MemberPicker
              team={team}
              assigneeId={item.assigneeId}
              onAssign={(assigneeId) => onUpdateItem(item.id, { assigneeId })}
              onClear={() => onUpdateItem(item.id, { assigneeId: undefined })}
            />
          )}
          {isItemWorkable(doc, item) && (
            <PointsPicker
              points={item.points}
              onChange={(points) => onUpdateItem(item.id, { points })}
            />
          )}
          {canAddChildren && (
            <button
              type="button"
              className="requirement-card__add-child"
              onClick={() => {
                onSelect?.(selectionKey);
                // The row only mounts once the parent re-renders this card
                // as selected, so focus it on the next frame.
                requestAnimationFrame(() =>
                  cardRef.current
                    ?.querySelector<HTMLInputElement>('.child-quick-add__input')
                    ?.focus(),
                );
              }}
              aria-label={`Add a child to ${item.id}`}
              title={`Add a child to ${item.id}`}
            >
              <ListPlus size={13} />
              <span>Child</span>
            </button>
          )}
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
        {isEditingTitle ? (
          <input
            className="requirement-card__title"
            autoFocus
            value={item.title}
            placeholder="Untitled"
            title={item.title || undefined}
            onChange={(e) => onUpdateItem(item.id, { title: e.target.value })}
            onBlur={() => setIsEditingTitle(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') {
                setIsEditingTitle(false);
              }
            }}
          />
        ) : (
          <div
            className="requirement-card__title requirement-card__title--display"
            tabIndex={0}
            role="textbox"
            aria-label={`Title for ${item.id}`}
            onClick={() => setIsEditingTitle(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setIsEditingTitle(true);
              }
            }}
            title={item.title || undefined}
          >
            <HighlightedTitle text={item.title} search={searchQuery} />
          </div>
        )}
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
          <RequirementBody
            text={item.body}
            doc={doc}
            onNavigateToItem={navigateFromHere}
            searchQuery={searchQuery}
          />
        </div>
      )}
      <RelationshipManager
        itemId={item.id}
        doc={doc}
        onAddRelationship={onAddRelationship}
        onDeleteRelationship={onDeleteRelationship}
        onNavigateToItem={navigateFromHere}
      />
      {canAddChildren && isSelected && onAddChildItem && defaultChildTypeId && (
        <ChildQuickAdd
          doc={doc}
          parentId={item.id}
          defaultTypeId={defaultChildTypeId}
          onAdd={onAddChildItem}
        />
      )}
      {diagramRoot && (
        <LinkedDiagramsSection
          itemId={item.id}
          itemTitle={item.title}
          linkedNodes={linkedNodes}
          onNavigateToNode={onNavigateToNode}
          onCreateLinkedNode={onCreateLinkedNode}
        />
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
    prev.searchQuery === next.searchQuery &&
    prev.onNavigateToNode === next.onNavigateToNode &&
    prev.onCreateLinkedNode === next.onCreateLinkedNode &&
    prev.onUpdateItem === next.onUpdateItem &&
    prev.onDeleteItem === next.onDeleteItem &&
    prev.onNavigateToItem === next.onNavigateToItem &&
    prev.onCreateAndAssignCategory === next.onCreateAndAssignCategory &&
    prev.onDeleteCategory === next.onDeleteCategory &&
    prev.onAddRelationship === next.onAddRelationship &&
    prev.onDeleteRelationship === next.onDeleteRelationship &&
    prev.onEditingChange === next.onEditingChange &&
    prev.domId === next.domId &&
    prev.sectionKey === next.sectionKey &&
    prev.cardKey === next.cardKey &&
    prev.isSelected === next.isSelected &&
    prev.onSelect === next.onSelect &&
    prev.isContext === next.isContext &&
    prev.onAddChildItem === next.onAddChildItem &&
    prev.defaultChildTypeId === next.defaultChildTypeId &&
    // Not identity: peersHere is rebuilt by a filter on every parent
    // render, and its elements are rebuilt on every presence update -
    // including cursor movement, which no badge here renders. See
    // peerBadgesAreEqual for why both of those rule out ===.
    peerBadgesAreEqual(prev.peersHere, next.peersHere)
  );
}

export const RequirementCard = memo(RequirementCardImpl, propsAreEqual);
