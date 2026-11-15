import { type FormEvent, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import type {
  RequirementItem,
  RequirementsDocument,
} from '../../domain/requirements/requirementsTypes';
import {
  getItemType,
  getOtherItemId,
  getRelationshipLabelForItem,
  getRelationshipsForItem,
} from '../../domain/requirements/requirementsRegistry';
import {
  type AcceptanceCriterion,
  addAcceptanceCriterion,
  toggleAcceptanceCriterion,
} from '../../domain/requirements/verification';

/*
 * The pieces an item is read through, shared by the table's open row and
 * the split view's detail pane so the two can't drift apart: criteria that
 * tick, a box to add one, and relationships as chips.
 */

type UpdateItem = (id: string, patch: Partial<RequirementItem>) => void;

/** An item's acceptance criteria as boxes. Ticking one rewrites only that
 * box in the description. */
export function CriteriaList({
  item,
  criteria,
  onUpdateItem,
}: {
  item: RequirementItem;
  criteria: AcceptanceCriterion[];
  onUpdateItem: UpdateItem;
}) {
  return (
    <ul className="requirement-detail__criteria">
      {criteria.map((criterion, index) => (
        <li key={index}>
          <button
            type="button"
            role="checkbox"
            aria-checked={criterion.met}
            className={`requirement-detail__criterion${criterion.met ? ' is-met' : ''}`}
            onClick={() =>
              onUpdateItem(item.id, { body: toggleAcceptanceCriterion(item.body, index) })
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
  );
}

/** A one-line box that appends a criterion to the description. */
export function AddCriterion({
  item,
  onUpdateItem,
}: {
  item: RequirementItem;
  onUpdateItem: UpdateItem;
}) {
  const [text, setText] = useState('');
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    onUpdateItem(item.id, { body: addAcceptanceCriterion(item.body, text) });
    setText('');
  };
  return (
    <form className="requirement-detail__add" onSubmit={onSubmit}>
      <Plus size={12} aria-hidden />
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a criterion and press Enter"
        aria-label={`Add an acceptance criterion to ${item.id}`}
      />
    </form>
  );
}

/** An item's relationships as chips reading "kind · id · title", each a
 * link to the other item. Null when it has none. */
export function RelationshipChips({
  doc,
  item,
  onNavigateToItem,
}: {
  doc: RequirementsDocument;
  item: RequirementItem;
  onNavigateToItem: (itemId: string) => void;
}) {
  const relationships = getRelationshipsForItem(doc, item.id);
  if (relationships.length === 0) return null;
  return (
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
            <span className="requirement-detail__relation-title">{other.title || 'Untitled'}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The one line that says what verifies an item or where that stands. It
 * is written when you leave the box or press Enter, not on every key. */
export function VerificationNote({
  item,
  onUpdateItem,
}: {
  item: RequirementItem;
  onUpdateItem: UpdateItem;
}) {
  const [draft, setDraft] = useState(item.verificationNote ?? '');
  const commit = () => {
    const note = draft.trim();
    if (note !== (item.verificationNote ?? '')) {
      onUpdateItem(item.id, { verificationNote: note || undefined });
    }
  };
  return (
    <input
      type="text"
      className="requirement-detail__note"
      value={draft}
      placeholder="What verifies it: a suite, a link, the last result"
      aria-label={`Verification note for ${item.id}`}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}
