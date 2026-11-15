import { useId, useState } from 'react';
import { CheckSquare, Square, Tag, X } from 'lucide-react';
import type {
  RequirementItem,
  RequirementsDocument,
} from '../../domain/requirements/requirementsTypes';
import {
  isItemWorkable,
  REQUIREMENT_STATUSES,
} from '../../domain/requirements/requirementsRegistry';
import { collectTags, normalizeTag } from '../../domain/requirements/requirementTags';
import { MenuPicker } from './MenuPicker';
import { type BulkItemUpdate, bulkPatches } from '../../domain/requirements/requirementsBulkEdit';
import type { ProgramIncrement } from '../../domain/timeline/programIncrements';
import type { TeamDocument } from '../../domain/timeline/teamTypes';

/** A native select value meaning "none" - can't collide with an id. */
const NONE = '__none__';

interface BulkEditBarProps {
  doc: RequirementsDocument;
  /** The selected items that are currently shown. */
  selectedItems: RequirementItem[];
  /** How many items are shown - what "Select all" would select. */
  visibleCount: number;
  team?: TeamDocument;
  programIncrements: ProgramIncrement[];
  /** Every tag in the document, suggested when adding one. */
  allTags: string[];
  onSelectAll: () => void;
  onClearSelection: () => void;
  onApply: (updates: BulkItemUpdate[]) => void;
  onExit: () => void;
}

/**
 * Shown while selecting items in the Requirements view: what's selected,
 * and changes to make to all of it at once. Each change is one store
 * operation - one undo step - however many items it touches.
 *
 * The controls are native selects: picking a value applies it right away
 * and the select returns to its label, ready for the next change.
 */
export function BulkEditBar({
  doc,
  selectedItems,
  visibleCount,
  team,
  programIncrements,
  allTags,
  onSelectAll,
  onClearSelection,
  onApply,
  onExit,
}: BulkEditBarProps) {
  const [tagDraft, setTagDraft] = useState('');
  const tagListId = useId();
  const count = selectedItems.length;
  const workableCount = selectedItems.filter((i) => isItemWorkable(doc, i)).length;
  const nothing = count === 0;
  const noWork = workableCount === 0;
  const selectedTags = collectTags(selectedItems);
  const workTitle = noWork
    ? 'Only work items have this - none are selected'
    : workableCount < count
      ? `Applies to the ${workableCount} work ${workableCount === 1 ? 'item' : 'items'} selected`
      : undefined;

  const addTag = () => {
    const tag = normalizeTag(tagDraft);
    if (!tag) return;
    onApply(bulkPatches.addTag(selectedItems, tag));
    setTagDraft('');
  };

  return (
    <div className="bulk-edit-bar" role="toolbar" aria-label="Bulk edit">
      <div className="bulk-edit-bar__selection">
        <strong aria-live="polite">{count} selected</strong>
        <button
          type="button"
          className="bulk-edit-bar__link"
          onClick={onSelectAll}
          disabled={visibleCount === 0 || count === visibleCount}
        >
          <CheckSquare size={12} /> Select all {visibleCount}
        </button>
        <button
          type="button"
          className="bulk-edit-bar__link"
          onClick={onClearSelection}
          disabled={nothing}
        >
          <Square size={12} /> Clear
        </button>
      </div>

      <div className="bulk-edit-bar__actions">
        <MenuPicker
          label="Set status of selected items"
          value=""
          placeholder="Status"
          options={REQUIREMENT_STATUSES}
          disabled={nothing || noWork}
          title={workTitle}
          onChange={(id) =>
            onApply(bulkPatches.status(doc, selectedItems, id as RequirementItem['status']))
          }
        />

        <MenuPicker
          label="Move selected items to a sprint"
          value=""
          placeholder="Sprint"
          width={220}
          options={[
            { id: NONE, label: 'Backlog (no sprint)' },
            ...programIncrements.flatMap((pi) =>
              pi.sprints.map((sp) => ({
                id: sp.id,
                label: sp.name || 'Unnamed sprint',
                group: pi.name || 'Unnamed PI',
              })),
            ),
          ]}
          disabled={nothing || noWork}
          title={workTitle}
          onChange={(id) =>
            onApply(bulkPatches.sprint(doc, selectedItems, id === NONE ? undefined : id))
          }
        />

        <MenuPicker
          label="Set category of selected items"
          value=""
          placeholder="Category"
          width={200}
          options={[
            { id: NONE, label: 'No category' },
            ...doc.categories.map((c) => ({ id: c.id, label: c.label, color: c.color })),
          ]}
          disabled={nothing}
          onChange={(id) =>
            onApply(bulkPatches.category(selectedItems, id === NONE ? undefined : id))
          }
        />

        {team && (
          <MenuPicker
            label="Assign selected items"
            value=""
            placeholder="Assignee"
            width={210}
            options={[
              { id: NONE, label: 'Unassigned' },
              ...team.members.map((m) => ({ id: m.id, label: m.name || 'Unnamed' })),
            ]}
            disabled={nothing || noWork}
            title={workTitle}
            onChange={(id) =>
              onApply(bulkPatches.assignee(doc, selectedItems, id === NONE ? undefined : id))
            }
          />
        )}

        <div className="bulk-edit-bar__tag">
          <Tag size={11} aria-hidden />
          <input
            className="bulk-edit-bar__tag-input"
            value={tagDraft}
            placeholder="Add tag"
            list={tagListId}
            disabled={nothing}
            aria-label="Add a tag to selected items"
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addTag();
              }
            }}
          />
          <datalist id={tagListId}>
            {allTags.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <button
            type="button"
            className="bulk-edit-bar__tag-add"
            disabled={nothing || !normalizeTag(tagDraft)}
            onClick={addTag}
          >
            Add
          </button>
        </div>

        {selectedTags.length > 0 && (
          <MenuPicker
            label="Remove a tag from selected items"
            value=""
            placeholder="Remove tag"
            options={selectedTags.map((t) => ({ id: t, label: t }))}
            onChange={(tag) => onApply(bulkPatches.removeTag(selectedItems, tag))}
          />
        )}
      </div>

      <button
        type="button"
        className="bulk-edit-bar__exit"
        onClick={onExit}
        title="Stop selecting"
        aria-label="Stop selecting"
      >
        <X size={13} />
      </button>
    </div>
  );
}
