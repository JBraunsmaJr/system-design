import { type ReactNode, useState } from 'react';
import { Check, FlaskConical, Pencil, Workflow } from 'lucide-react';
import type {
  RequirementItem,
  RequirementsDocument,
} from '../../domain/requirements/requirementsTypes';
import type { DiagramPath, LinkedNodeRef } from '../../domain/canvas/subDiagramTree';
import {
  getItemType,
  getOtherItemId,
  getRelationshipLabelForItem,
  getRelationshipsForItem,
  getStatusMeta,
  isItemWorkable,
} from '../../domain/requirements/requirementsRegistry';
import {
  getVerificationMethodMeta,
  getVerificationStatusMeta,
  isVerifiable,
  splitAcceptanceCriteria,
  toggleAcceptanceCriterion,
} from '../../domain/requirements/verification';
import { isExpectedOnDiagram } from '../../domain/requirements/requirementsFilter';
import { RequirementBody } from './RequirementBody';

interface RequirementRowDetailProps {
  doc: RequirementsDocument;
  item: RequirementItem;
  linkedNodes: readonly LinkedNodeRef[];
  sprintName?: string;
  assigneeName?: string;
  onUpdateItem: (id: string, patch: Partial<RequirementItem>) => void;
  onNavigateToItem: (itemId: string) => void;
  onNavigateToNode?: (path: DiagramPath, nodeId: string) => void;
  /** The full editing card for this item. */
  renderEditor: () => ReactNode;
  /** Open straight into the editor - a new item has nothing to read yet. */
  startEditing?: boolean;
  searchQuery?: string;
}

/**
 * What a table row opens into: the item laid out for reading. On the left
 * what it states and the criteria that say when it holds, which can be
 * ticked here; on the right what it relates to, where it is on the
 * diagram, and how it is verified. Everything is one click from the row
 * and none of it is an input until you ask - **Edit** swaps in the full
 * card, where every field can be changed.
 */
export function RequirementRowDetail({
  doc,
  item,
  linkedNodes,
  sprintName,
  assigneeName,
  onUpdateItem,
  onNavigateToItem,
  onNavigateToNode,
  renderEditor,
  startEditing = false,
  searchQuery,
}: RequirementRowDetailProps) {
  const [isEditing, setIsEditing] = useState(startEditing);

  if (isEditing) {
    return (
      <div className="requirement-detail requirement-detail--editing">
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

  const { statement, criteria } = splitAcceptanceCriteria(item.body);
  const met = criteria.filter((c) => c.met).length;
  const verifiable = isVerifiable(doc, item);
  const onDiagram = isExpectedOnDiagram(doc, item) || linkedNodes.length > 0;
  const workable = isItemWorkable(doc, item);
  const relationships = getRelationshipsForItem(doc, item.id);
  const method = getVerificationMethodMeta(item.verificationMethod);
  const status = getVerificationStatusMeta(item.verificationStatus);

  return (
    <div className="requirement-detail">
      <div className="requirement-detail__column">
        <section className="requirement-detail__section">
          <h4 className="requirement-detail__label">Statement</h4>
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

        {(verifiable || criteria.length > 0) && (
          <section className="requirement-detail__section">
            <h4 className="requirement-detail__label">
              Acceptance criteria
              {criteria.length > 0 && ` · ${met} of ${criteria.length} met`}
            </h4>
            {criteria.length === 0 ? (
              <p className="requirement-detail__empty requirement-detail__empty--gap">
                None yet. Edit the description and add a line like "- [ ] what must hold".
              </p>
            ) : (
              <ul className="requirement-detail__criteria">
                {criteria.map((criterion, index) => (
                  <li key={index}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={criterion.met}
                      className={`requirement-detail__criterion${criterion.met ? ' is-met' : ''}`}
                      onClick={() =>
                        onUpdateItem(item.id, {
                          body: toggleAcceptanceCriterion(item.body, index),
                        })
                      }
                    >
                      <span className="requirement-detail__box" aria-hidden>
                        {criterion.met && <Check size={10} strokeWidth={3} />}
                      </span>
                      <span>{criterion.text}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      <div className="requirement-detail__column">
        {relationships.length > 0 && (
          <section className="requirement-detail__section">
            <h4 className="requirement-detail__label">Relationships · {relationships.length}</h4>
            <div className="requirement-detail__chips">
              {relationships.map((relationship) => {
                const other = doc.items.find((i) => i.id === getOtherItemId(relationship, item.id));
                const type = doc.relationshipTypes.find((t) => t.id === relationship.typeId);
                if (!other || !type) return null;
                return (
                  <button
                    key={relationship.id}
                    type="button"
                    className="requirement-detail__relation"
                    onClick={() => onNavigateToItem(other.id)}
                    title={`Go to ${other.id}`}
                  >
                    <span className="requirement-detail__relation-kind">
                      {getRelationshipLabelForItem(relationship, type, item.id).toLowerCase()}
                    </span>
                    <span
                      className="requirement-detail__relation-id"
                      style={{ color: getItemType(doc, other.typeId)?.color }}
                    >
                      {other.id}
                    </span>
                    <span className="requirement-detail__relation-title">
                      {other.title || 'Untitled'}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {onDiagram && (
          <section className="requirement-detail__section">
            <h4 className="requirement-detail__label">
              On the diagram{linkedNodes.length > 0 && ` · ${linkedNodes.length}`}
            </h4>
            {linkedNodes.length === 0 ? (
              <p className="requirement-detail__empty requirement-detail__empty--gap">
                No component is linked to this. Select a component on the diagram and add it under
                Requirements.
              </p>
            ) : (
              <div className="requirement-detail__chips">
                {linkedNodes.map((ref) => (
                  <button
                    key={`${ref.path.join('/')}/${ref.nodeId}`}
                    type="button"
                    className="requirement-detail__node"
                    onClick={() => onNavigateToNode?.(ref.path, ref.nodeId)}
                    title="Show on the diagram"
                  >
                    <Workflow size={11} aria-hidden />
                    {ref.label || 'Untitled'}
                  </button>
                ))}
                {onNavigateToNode && (
                  <button
                    type="button"
                    className="requirement-detail__link"
                    onClick={() => onNavigateToNode(linkedNodes[0].path, linkedNodes[0].nodeId)}
                  >
                    Show on diagram
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        {verifiable && (
          <section className="requirement-detail__section">
            <h4 className="requirement-detail__label">Verification</h4>
            <p className="requirement-detail__verification">
              <FlaskConical size={13} style={{ color: status.color }} aria-hidden />
              {method ? method.label : 'No method chosen'}
              <span aria-hidden>·</span>
              <span style={{ color: status.color }}>{status.label.toLowerCase()}</span>
            </p>
          </section>
        )}

        {workable && (
          <section className="requirement-detail__section">
            <h4 className="requirement-detail__label">Planning</h4>
            <p className="requirement-detail__verification">
              <span style={{ color: getStatusMeta(item.status).color }}>
                {getStatusMeta(item.status).label}
              </span>
              <span aria-hidden>·</span>
              {sprintName ?? 'No sprint'}
              <span aria-hidden>·</span>
              {assigneeName ?? 'Unassigned'}
              {item.points !== undefined && (
                <>
                  <span aria-hidden>·</span>
                  {item.points} {item.points === 1 ? 'point' : 'points'}
                </>
              )}
            </p>
          </section>
        )}

        <div className="requirement-detail__actions">
          <button
            type="button"
            className="requirement-detail__action"
            onClick={() => setIsEditing(true)}
          >
            <Pencil size={12} /> Edit
          </button>
        </div>
      </div>
    </div>
  );
}
