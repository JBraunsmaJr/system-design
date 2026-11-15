import { type FormEvent, useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import type { RequirementItem } from '../../domain/requirements/requirementsTypes';
import {
  type AcceptanceCriterion,
  addAcceptanceCriterion,
  removeAcceptanceCriterion,
  toggleAcceptanceCriterion,
} from '../../domain/requirements/verification';

/*
 * The pieces an item is read through, shared by the table's open row and
 * the split view's page: criteria that tick and can be removed, a box to
 * add one, and the verification note.
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
          <button
            type="button"
            className="requirement-detail__criterion-remove"
            onClick={() =>
              onUpdateItem(item.id, { body: removeAcceptanceCriterion(item.body, index) })
            }
            aria-label={`Remove the criterion "${criterion.text}"`}
            title="Remove this criterion"
          >
            <X size={11} />
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
