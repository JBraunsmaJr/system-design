import { type FocusEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { Pencil, Plus, Trash2, Workflow } from 'lucide-react';
import type {
  RequirementItem,
  RequirementsDocument,
} from '../../domain/requirements/requirementsTypes';
import type { ItemMarkdownField } from '../../domain/requirements/requirementsRegistry';
import { getItemType, isItemWorkable } from '../../domain/requirements/requirementsRegistry';
import type { DiagramPath, LinkedNodeRef } from '../../domain/canvas/subDiagramTree';
import type { ProgramIncrement } from '../../domain/timeline/programIncrements';
import type { TeamDocument } from '../../domain/timeline/teamTypes';
import { isDecisionItem } from '../../domain/requirements/decisionRecords';
import { isVerifiable, splitAcceptanceCriteria } from '../../domain/requirements/verification';
import { isExpectedOnDiagram } from '../../domain/requirements/requirementsFilter';
import { RequirementBody } from './RequirementBody';
import { RequirementEditor } from './RequirementEditor';
import { TypePicker } from './TypePicker';
import { CategoryPicker } from './CategoryPicker';
import { TagEditor } from './TagEditor';
import { StatusPicker } from './StatusPicker';
import { SprintPicker } from './SprintPicker';
import { DecisionStatusPicker } from './DecisionStatusPicker';
import { DecisionSections } from './DecisionSections';
import { VerificationPicker } from './VerificationPicker';
import { RelationshipManager } from './RelationshipManager';
import { MemberPicker } from '../team/MemberPicker';
import { PointsPicker } from '../team/PointsPicker';
import { type AttributeOption, RequirementAttributeFields } from './RequirementAttributeFields';
import { AddCriterion, CriteriaList, VerificationNote } from './RequirementDetailParts';
import { PeerBadges } from './PeerBadges';
import type { PresenceInfo } from '../../collab/sync/session';

/** Everything an item view needs that is the same for every item: the
 * document, the lists its menus offer, and the ways to change things.
 * Built once by the Requirements view and handed to each item it opens. */
export interface ItemViewContext {
  doc: RequirementsDocument;
  programIncrements: ProgramIncrement[];
  team?: TeamDocument;
  members: readonly AttributeOption[];
  milestones: readonly AttributeOption[];
  tagSuggestions: string[];
  searchQuery?: string;
  onUpdateItem: (id: string, patch: Partial<RequirementItem>) => void;
  onConvertItemType?: (id: string, newTypeId: string) => void;
  onDeleteItem: (id: string) => void;
  onCreateAndAssignCategory: (itemId: string, label: string) => void;
  onDeleteCategory: (categoryId: string) => void;
  onAddRelationship: (typeId: string, fromItemId: string, toItemId: string) => string | null;
  onDeleteRelationship: (relationshipId: string) => void;
  onNavigateToNode?: (path: DiagramPath, nodeId: string) => void;
  onCreateLinkedNode?: (itemId: string, label: string) => void;
  /** The relationship verb to offer first for this item - see
   * RelationshipManager. */
  preferredVerbKeyFor: (item: RequirementItem) => string | undefined;
  onVerbUsed?: (itemTypeId: string, verbKey: string) => void;
  /** Everyone else in the collaborative session; empty outside one. */
  peers: readonly PresenceInfo[];
  /** Tells the session this person started or stopped editing an item, so
   * the others see it. */
  onEditingChange?: (itemId: string, isEditing: boolean) => void;
}

interface RequirementItemViewProps {
  /** `row`: under a table line, in two columns. `page`: the split view's
   * pane, with a heading and a panel per part. */
  variant: 'row' | 'page';
  item: RequirementItem;
  linkedNodes: readonly LinkedNodeRef[];
  context: ItemViewContext;
  onNavigateToItem: (itemId: string) => void;
  /** Written to data-section-key so navigation can tell this copy of the
   * item from a row elsewhere. */
  sectionKey?: string;
}

/**
 * An item, opened. One layout for reading and for editing: every part is
 * changed where it stands - the title is a text box, the pickers are the
 * same ones used everywhere else, criteria tick and are added and removed
 * in their list, relationships are added and removed in theirs, and the
 * statement turns into the Markdown editor when you click its pencil or
 * double-click it. There is no separate edit mode to enter or leave.
 */
export function RequirementItemView({
  variant,
  item,
  linkedNodes,
  context,
  onNavigateToItem,
  sectionKey,
}: RequirementItemViewProps) {
  const { doc, onUpdateItem, searchQuery } = context;
  // A new item has nothing to read, so its statement starts as the editor.
  const [isEditingBody, setIsEditingBody] = useState(false);
  const [editingField, setEditingField] = useState<ItemMarkdownField | null>(null);

  /*
   * "Editing" for the people watching: the cursor is somewhere in this
   * item - its title, its description, a criterion being typed, a note. The
   * card only counted its description editor, but here every part is
   * edited in place, so focus is the honest signal. Reported on change
   * only, and withdrawn if the item closes while still focused.
   */
  const { onEditingChange } = context;
  const isFocusedRef = useRef(false);
  const reportFocus = (focused: boolean) => {
    if (isFocusedRef.current === focused) return;
    isFocusedRef.current = focused;
    onEditingChange?.(item.id, focused);
  };
  const onFocus = () => reportFocus(true);
  const onBlur = (event: FocusEvent<HTMLElement>) => {
    // Moving between two fields of the same item isn't leaving it.
    if (event.currentTarget.contains(event.relatedTarget)) return;
    reportFocus(false);
  };
  const rootRef = useRef<HTMLElement | null>(null);
  useEffect(
    () => {
      // A new item is focused as it mounts (its title has autoFocus), and
      // that focus happens before these handlers can hear it - so ask.
      if (rootRef.current?.contains(document.activeElement)) reportFocus(true);
      return () => {
        // Through reportFocus so the flag is cleared too: React runs this
        // pair twice in development, and a stale "already reported" flag
        // would swallow the second mount's report.
        reportFocus(false);
      };
    },
    // Only on mount and unmount: item.id is fixed for a mounted view (it
    // is keyed by it), and the callback is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const peersHere = context.peers.filter((p) => p.focusedItemId === item.id);

  const type = getItemType(doc, item.typeId);
  const isDecision = isDecisionItem(item);
  const verifiable = isVerifiable(doc, item);
  const workable = isItemWorkable(doc, item);
  const showDiagram = isExpectedOnDiagram(doc, item) || linkedNodes.length > 0;
  const { statement, criteria } = splitAcceptanceCriteria(item.body);
  const met = criteria.filter((c) => c.met).length;
  const isPage = variant === 'page';

  /** A titled part: a bordered panel on the page, a plain section in a row. */
  const part = (title: string, aside: ReactNode, children: ReactNode) =>
    isPage ? (
      <section className="requirement-panel">
        <header className="requirement-panel__header">
          <h3 className="requirement-panel__title">{title}</h3>
          {aside !== undefined && aside !== null && (
            <span className="requirement-panel__aside">{aside}</span>
          )}
        </header>
        <div className="requirement-panel__body">{children}</div>
      </section>
    ) : (
      <section className="requirement-detail__section">
        <h4 className="requirement-detail__label">
          {title}
          {aside !== undefined && aside !== null && <> · {aside}</>}
        </h4>
        {children}
      </section>
    );

  const identity = (
    <div className="requirement-item__identity">
      {isPage && (
        <span className="requirement-page__id" style={{ color: type?.color }}>
          {item.id}
        </span>
      )}
      <TypePicker
        doc={doc}
        typeId={item.typeId}
        onChange={(newTypeId) => {
          if (context.onConvertItemType) context.onConvertItemType(item.id, newTypeId);
          else onUpdateItem(item.id, { typeId: newTypeId });
        }}
      />
      <PeerBadges peers={peersHere} />
      <CategoryPicker
        doc={doc}
        categoryId={item.categoryId}
        onAssign={(categoryId) => onUpdateItem(item.id, { categoryId })}
        onCreateAndAssign={(label) => context.onCreateAndAssignCategory(item.id, label)}
        onClear={() => onUpdateItem(item.id, { categoryId: undefined })}
        onDelete={context.onDeleteCategory}
        searchQuery={searchQuery}
      />
      <TagEditor
        itemId={item.id}
        tags={item.tags}
        suggestions={context.tagSuggestions}
        onChange={(tags) => onUpdateItem(item.id, { tags })}
        searchQuery={searchQuery}
      />
      <span className="requirement-item__spacer" />
      {isPage && linkedNodes.length > 0 && context.onNavigateToNode && (
        <button
          type="button"
          className="requirement-page__button"
          onClick={() => context.onNavigateToNode?.(linkedNodes[0].path, linkedNodes[0].nodeId)}
        >
          <Workflow size={13} /> Show on diagram
        </button>
      )}
      <button
        type="button"
        className="requirement-item__delete"
        onClick={() => context.onDeleteItem(item.id)}
        aria-label={`Delete ${item.id}`}
        title={`Delete ${item.id}`}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );

  const title = (
    <input
      className={`requirement-item__title${isPage ? ' requirement-item__title--page' : ''}`}
      value={item.title}
      placeholder="Untitled"
      aria-label={`Title of ${item.id}`}
      // A brand-new item: start in the one thing it needs first.
      autoFocus={!item.title && !item.body}
      onChange={(e) => onUpdateItem(item.id, { title: e.target.value })}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
      }}
    />
  );

  const values = (
    <>
      {verifiable && (
        <RequirementAttributeFields
          item={item}
          members={context.members}
          milestones={context.milestones}
          onUpdateItem={onUpdateItem}
        />
      )}
      {(workable || isDecision) && (
        <div className="requirement-item__pickers">
          {workable && (
            <StatusPicker
              status={item.status}
              onChange={(status) => onUpdateItem(item.id, { status })}
            />
          )}
          {isDecision && (
            <DecisionStatusPicker
              status={item.decisionStatus}
              onChange={(decisionStatus) => onUpdateItem(item.id, { decisionStatus })}
            />
          )}
          {workable && (
            <SprintPicker
              programIncrements={context.programIncrements}
              sprintId={item.sprintId}
              onAssign={(sprintId) => onUpdateItem(item.id, { sprintId })}
              onClear={() => onUpdateItem(item.id, { sprintId: undefined })}
            />
          )}
          {workable && context.team && (
            <MemberPicker
              team={context.team}
              assigneeId={item.assigneeId}
              onAssign={(assigneeId) => onUpdateItem(item.id, { assigneeId })}
              onClear={() => onUpdateItem(item.id, { assigneeId: undefined })}
            />
          )}
          {workable && (
            <PointsPicker
              points={item.points}
              onChange={(points) => onUpdateItem(item.id, { points })}
            />
          )}
        </div>
      )}
    </>
  );

  const body = isDecision ? (
    // A decision's write-up is four sections, each edited in place.
    <DecisionSections
      item={item}
      doc={doc}
      editingField={editingField}
      onEditField={setEditingField}
      onUpdateItem={onUpdateItem}
      onNavigateToItem={onNavigateToItem}
      searchQuery={searchQuery}
    />
  ) : (
    <section className="requirement-detail__section requirement-item__statement">
      <h4 className="requirement-detail__label">
        Statement
        {!isEditingBody && (
          <button
            type="button"
            className="requirement-item__edit"
            onClick={() => setIsEditingBody(true)}
            aria-label={`Edit the description of ${item.id}`}
            title="Edit the description (or double-click it)"
          >
            <Pencil size={11} />
          </button>
        )}
      </h4>
      {isEditingBody ? (
        // The whole description, criteria lines included: it is one piece
        // of Markdown, and editing it whole loses nothing.
        <RequirementEditor
          value={item.body}
          onChange={(value) => onUpdateItem(item.id, { body: value })}
          onDone={() => setIsEditingBody(false)}
          doc={doc}
          autoFocus
          placeholder="Write a description... type # to reference another item"
        />
      ) : statement ? (
        <div className="requirement-detail__statement" onDoubleClick={() => setIsEditingBody(true)}>
          <RequirementBody
            text={statement}
            doc={doc}
            onNavigateToItem={onNavigateToItem}
            searchQuery={searchQuery}
          />
        </div>
      ) : (
        <button
          type="button"
          className="requirement-item__write"
          onClick={() => setIsEditingBody(true)}
        >
          Write a description
        </button>
      )}
    </section>
  );

  const criteriaPart =
    (verifiable || criteria.length > 0) &&
    part(
      'Acceptance criteria',
      criteria.length > 0 ? `${met} of ${criteria.length} met` : null,
      <>
        {criteria.length === 0 ? (
          <p className="requirement-detail__empty requirement-detail__empty--gap">
            None yet. Say what must hold for this to be done.
          </p>
        ) : (
          <CriteriaList item={item} criteria={criteria} onUpdateItem={onUpdateItem} />
        )}
        <AddCriterion item={item} onUpdateItem={onUpdateItem} />
      </>,
    );

  const verificationPart =
    verifiable &&
    part(
      'Verification',
      null,
      <>
        <VerificationPicker
          method={item.verificationMethod}
          status={item.verificationStatus}
          onChange={(patch) => onUpdateItem(item.id, patch)}
        />
        <VerificationNote item={item} onUpdateItem={onUpdateItem} />
      </>,
    );

  const diagramPart =
    showDiagram &&
    part(
      'On the diagram',
      linkedNodes.length || null,
      <>
        {linkedNodes.length === 0 ? (
          <p className="requirement-detail__empty requirement-detail__empty--gap">
            No component is linked to this yet.
          </p>
        ) : (
          <div className={isPage ? 'requirement-page__nodes' : 'requirement-detail__chips'}>
            {linkedNodes.map((ref) => (
              <button
                key={`${ref.path.join('/')}/${ref.nodeId}`}
                type="button"
                className={isPage ? 'requirement-page__node' : 'requirement-detail__node'}
                onClick={() => context.onNavigateToNode?.(ref.path, ref.nodeId)}
                title="Show on the diagram"
              >
                <Workflow size={isPage ? 14 : 11} aria-hidden />
                <span>{ref.label || 'Untitled'}</span>
              </button>
            ))}
          </div>
        )}
        {context.onCreateLinkedNode && (
          <button
            type="button"
            className="requirement-item__add"
            onClick={() => context.onCreateLinkedNode?.(item.id, item.title || item.id)}
            title="Add a component to the diagram that is linked to this"
          >
            <Plus size={11} /> New component
          </button>
        )}
      </>,
    );

  const relationshipsPart = part(
    'Relationships',
    null,
    <RelationshipManager
      itemId={item.id}
      doc={doc}
      onAddRelationship={context.onAddRelationship}
      onDeleteRelationship={context.onDeleteRelationship}
      onNavigateToItem={onNavigateToItem}
      preferredVerbKey={context.preferredVerbKeyFor(item)}
      onVerbUsed={
        context.onVerbUsed ? (verbKey) => context.onVerbUsed?.(item.typeId, verbKey) : undefined
      }
    />,
  );

  if (isPage) {
    return (
      <article
        className={`requirement-page${peersHere.length > 0 ? ' has-peers' : ''}`}
        data-requirement-id={item.id}
        data-section-key={sectionKey}
        ref={rootRef}
        onFocus={onFocus}
        onBlur={onBlur}
      >
        <header className="requirement-page__header">
          {identity}
          {title}
        </header>
        {values}
        {body}
        <div className="requirement-page__panels">
          {criteriaPart}
          {verificationPart}
          {diagramPart}
          {relationshipsPart}
        </div>
      </article>
    );
  }

  return (
    <div
      className={`requirement-detail${peersHere.length > 0 ? ' has-peers' : ''}`}
      ref={(element) => {
        rootRef.current = element;
      }}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <div className="requirement-detail__wide">
        {identity}
        {title}
        {values}
      </div>
      <div className="requirement-detail__column">
        {body}
        {criteriaPart}
      </div>
      <div className="requirement-detail__column">
        {relationshipsPart}
        {diagramPart}
        {verificationPart}
      </div>
    </div>
  );
}
