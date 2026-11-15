import { type ReactNode, useState } from 'react';
import { Check, Pencil, Workflow } from 'lucide-react';
import type {
  RequirementItem,
  RequirementsDocument,
} from '../../domain/requirements/requirementsTypes';
import type { DiagramPath, LinkedNodeRef } from '../../domain/canvas/subDiagramTree';
import {
  getItemType,
  getRelationshipsForItem,
  isItemWorkable,
} from '../../domain/requirements/requirementsRegistry';
import {
  getVerificationStatusMeta,
  isVerifiable,
  splitAcceptanceCriteria,
} from '../../domain/requirements/verification';
import { isExpectedOnDiagram } from '../../domain/requirements/requirementsFilter';
import { RequirementBody } from './RequirementBody';
import { StatusPicker } from './StatusPicker';
import { VerificationPicker } from './VerificationPicker';
import { type AttributeOption, RequirementAttributeFields } from './RequirementAttributeFields';
import { VerificationNote } from './RequirementDetailParts';
import { AddCriterion, CriteriaList, RelationshipChips } from './RequirementDetailParts';

interface RequirementSplitDetailProps {
  doc: RequirementsDocument;
  item: RequirementItem;
  linkedNodes: readonly LinkedNodeRef[];
  sprintName?: string;
  assigneeName?: string;
  members: readonly AttributeOption[];
  milestones: readonly AttributeOption[];
  onUpdateItem: (id: string, patch: Partial<RequirementItem>) => void;
  onNavigateToItem: (itemId: string) => void;
  onNavigateToNode?: (path: DiagramPath, nodeId: string) => void;
  /** The full editing card for this item. */
  renderEditor: () => ReactNode;
  /** Open straight into the editor - a new item has nothing to read yet. */
  startEditing?: boolean;
  searchQuery?: string;
  /** Written to data-section-key, which navigation uses to find this pane's
   * copy of the item rather than a row elsewhere. */
  sectionKey?: string;
}

/** One titled panel of the detail pane. */
function Panel({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="requirement-panel">
      <header className="requirement-panel__header">
        <h3 className="requirement-panel__title">{title}</h3>
        {aside !== undefined && <span className="requirement-panel__aside">{aside}</span>}
      </header>
      <div className="requirement-panel__body">{children}</div>
    </section>
  );
}

/**
 * The split view's right-hand pane: the selected item as a page. Its id,
 * kind and title at the top with the way to the diagram; the few values
 * that are set rather than written; the statement; and then a panel for
 * each thing that hangs off it - acceptance criteria, verification, the
 * components it is on, its relationships - each changeable where it
 * stands. **Edit** swaps in the full card for everything else.
 */
export function RequirementSplitDetail({
  doc,
  item,
  linkedNodes,
  sprintName,
  assigneeName,
  members,
  milestones,
  onUpdateItem,
  onNavigateToItem,
  onNavigateToNode,
  renderEditor,
  startEditing = false,
  searchQuery,
  sectionKey,
}: RequirementSplitDetailProps) {
  const [isEditing, setIsEditing] = useState(startEditing);

  if (isEditing) {
    return (
      <div className="requirement-page requirement-page--editing">
        {renderEditor()}
        <div className="requirement-detail__actions">
          <button
            type="button"
            className="requirement-detail__action"
            onClick={() => setIsEditing(false)}
          >
            <Check size={12} /> Done
          </button>
        </div>
      </div>
    );
  }

  const type = getItemType(doc, item.typeId);
  const category = doc.categories.find((c) => c.id === item.categoryId);
  const { statement, criteria } = splitAcceptanceCriteria(item.body);
  const met = criteria.filter((c) => c.met).length;
  const verifiable = isVerifiable(doc, item);
  const workable = isItemWorkable(doc, item);
  const showDiagram = isExpectedOnDiagram(doc, item) || linkedNodes.length > 0;
  const relationshipCount = getRelationshipsForItem(doc, item.id).length;
  const verification = getVerificationStatusMeta(item.verificationStatus);

  return (
    <article
      className="requirement-page"
      data-requirement-id={item.id}
      data-section-key={sectionKey}
    >
      <header className="requirement-page__header">
        <div className="requirement-page__heading">
          <p className="requirement-page__kicker">
            <span className="requirement-page__id" style={{ color: type?.color }}>
              {item.id}
            </span>
            {[category?.label, type?.label].filter(Boolean).join(' · ')}
          </p>
          <h2 className="requirement-page__title">{item.title || 'Untitled'}</h2>
        </div>
        {linkedNodes.length > 0 && onNavigateToNode && (
          <button
            type="button"
            className="requirement-page__button"
            onClick={() => onNavigateToNode(linkedNodes[0].path, linkedNodes[0].nodeId)}
          >
            <Workflow size={13} /> Show on diagram
          </button>
        )}
        <button
          type="button"
          className="requirement-page__button"
          onClick={() => setIsEditing(true)}
        >
          <Pencil size={13} /> Edit
        </button>
      </header>

      {workable && (
        <dl className="requirement-page__meta">
          <div>
            <dt>Status</dt>
            <dd>
              <StatusPicker
                status={item.status}
                onChange={(status) => onUpdateItem(item.id, { status })}
              />
            </dd>
          </div>
          <div>
            <dt>Sprint</dt>
            <dd>{sprintName ?? 'None'}</dd>
          </div>
          <div>
            <dt>Assignee</dt>
            <dd>{assigneeName ?? 'Unassigned'}</dd>
          </div>
          {item.points !== undefined && (
            <div>
              <dt>Points</dt>
              <dd>{item.points}</dd>
            </div>
          )}
        </dl>
      )}

      {verifiable && (
        <RequirementAttributeFields
          item={item}
          members={members}
          milestones={milestones}
          onUpdateItem={onUpdateItem}
        />
      )}

      <section className="requirement-page__statement">
        <h3 className="requirement-detail__label">Statement</h3>
        {statement ? (
          <div className="requirement-detail__statement">
            <RequirementBody
              text={statement}
              doc={doc}
              onNavigateToItem={onNavigateToItem}
              searchQuery={searchQuery}
            />
          </div>
        ) : (
          <p className="requirement-detail__empty">Nothing written yet.</p>
        )}
      </section>

      <div className="requirement-page__panels">
        {(verifiable || criteria.length > 0) && (
          <Panel
            title="Acceptance criteria"
            aside={criteria.length > 0 ? `${met} of ${criteria.length} met` : undefined}
          >
            {criteria.length === 0 ? (
              <p className="requirement-detail__empty requirement-detail__empty--gap">
                None yet. Say what must hold for this to be done.
              </p>
            ) : (
              <CriteriaList item={item} criteria={criteria} onUpdateItem={onUpdateItem} />
            )}
            <AddCriterion item={item} onUpdateItem={onUpdateItem} />
          </Panel>
        )}

        {verifiable && (
          <Panel title="Verification">
            <VerificationPicker
              method={item.verificationMethod}
              status={item.verificationStatus}
              onChange={(patch) => onUpdateItem(item.id, patch)}
            />
            <p className="requirement-detail__empty">{verification.description}</p>
            <VerificationNote item={item} onUpdateItem={onUpdateItem} />
          </Panel>
        )}

        {showDiagram && (
          <Panel title="On the diagram" aside={linkedNodes.length || undefined}>
            {linkedNodes.length === 0 ? (
              <p className="requirement-detail__empty requirement-detail__empty--gap">
                No component is linked to this. Select a component on the diagram and add it under
                Requirements.
              </p>
            ) : (
              <div className="requirement-page__nodes">
                {linkedNodes.map((ref) => (
                  <button
                    key={`${ref.path.join('/')}/${ref.nodeId}`}
                    type="button"
                    className="requirement-page__node"
                    onClick={() => onNavigateToNode?.(ref.path, ref.nodeId)}
                    title="Show on the diagram"
                  >
                    <Workflow size={14} aria-hidden />
                    <span>{ref.label || 'Untitled'}</span>
                  </button>
                ))}
              </div>
            )}
          </Panel>
        )}

        <Panel title="Relationships" aside={relationshipCount || undefined}>
          {relationshipCount === 0 ? (
            <p className="requirement-detail__empty">
              None yet. Use Edit to relate this to another item.
            </p>
          ) : (
            <RelationshipChips doc={doc} item={item} onNavigateToItem={onNavigateToItem} />
          )}
        </Panel>
      </div>
    </article>
  );
}
