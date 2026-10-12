import {useId, useState} from 'react';
import {CheckSquare, Square, Tag, X} from 'lucide-react';
import type {RequirementItem, RequirementsDocument,} from '../../domain/requirements/requirementsTypes';
import {isItemWorkable, REQUIREMENT_STATUSES,} from '../../domain/requirements/requirementsRegistry';
import {collectTags, normalizeTag} from '../../domain/requirements/requirementTags';
import {type BulkItemUpdate, bulkPatches} from '../../domain/requirements/requirementsBulkEdit';
import type {ProgramIncrement} from '../../domain/timeline/programIncrements';
import type {TeamDocument} from '../../domain/timeline/teamTypes';

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
                    <CheckSquare size={12}/> Select all {visibleCount}
                </button>
                <button
                    type="button"
                    className="bulk-edit-bar__link"
                    onClick={onClearSelection}
                    disabled={nothing}
                >
                    <Square size={12}/> Clear
                </button>
            </div>

            <div className="bulk-edit-bar__actions">
                <select
                    className="bulk-edit-bar__select"
                    aria-label="Set status of selected items"
                    value=""
                    disabled={nothing || noWork}
                    title={workTitle}
                    onChange={(e) => {
                        const status = e.target.value as RequirementItem['status'];
                        onApply(bulkPatches.status(doc, selectedItems, status));
                    }}
                >
                    <option value="" disabled>
                        Status…
                    </option>
                    {REQUIREMENT_STATUSES.map((s) => (
                        <option key={s.id} value={s.id}>
                            {s.label}
                        </option>
                    ))}
                </select>

                <select
                    className="bulk-edit-bar__select"
                    aria-label="Move selected items to a sprint"
                    value=""
                    disabled={nothing || noWork}
                    title={workTitle}
                    onChange={(e) => {
                        const value = e.target.value;
                        onApply(bulkPatches.sprint(doc, selectedItems, value === NONE ? undefined : value));
                    }}
                >
                    <option value="" disabled>
                        Sprint…
                    </option>
                    <option value={NONE}>Backlog (no sprint)</option>
                    {programIncrements.map((pi) => (
                        <optgroup key={pi.id} label={pi.name || 'Unnamed PI'}>
                            {pi.sprints.map((s) => (
                                <option key={s.id} value={s.id}>
                                    {s.name || 'Unnamed sprint'}
                                </option>
                            ))}
                        </optgroup>
                    ))}
                </select>

                <select
                    className="bulk-edit-bar__select"
                    aria-label="Set category of selected items"
                    value=""
                    disabled={nothing}
                    onChange={(e) => {
                        const value = e.target.value;
                        onApply(bulkPatches.category(selectedItems, value === NONE ? undefined : value));
                    }}
                >
                    <option value="" disabled>
                        Category…
                    </option>
                    <option value={NONE}>No category</option>
                    {doc.categories.map((c) => (
                        <option key={c.id} value={c.id}>
                            {c.label}
                        </option>
                    ))}
                </select>

                {team && (
                    <select
                        className="bulk-edit-bar__select"
                        aria-label="Assign selected items"
                        value=""
                        disabled={nothing || noWork}
                        title={workTitle}
                        onChange={(e) => {
                            const value = e.target.value;
                            onApply(bulkPatches.assignee(doc, selectedItems, value === NONE ? undefined : value));
                        }}
                    >
                        <option value="" disabled>
                            Assignee…
                        </option>
                        <option value={NONE}>Unassigned</option>
                        {team.members.map((m) => (
                            <option key={m.id} value={m.id}>
                                {m.name || 'Unnamed'}
                            </option>
                        ))}
                    </select>
                )}

                <div className="bulk-edit-bar__tag">
                    <Tag size={11} aria-hidden/>
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
                            <option key={t} value={t}/>
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
                    <select
                        className="bulk-edit-bar__select"
                        aria-label="Remove a tag from selected items"
                        value=""
                        onChange={(e) => onApply(bulkPatches.removeTag(selectedItems, e.target.value))}
                    >
                        <option value="" disabled>
                            Remove tag…
                        </option>
                        {selectedTags.map((t) => (
                            <option key={t} value={t}>
                                {t}
                            </option>
                        ))}
                    </select>
                )}
            </div>

            <button
                type="button"
                className="bulk-edit-bar__exit"
                onClick={onExit}
                title="Stop selecting"
                aria-label="Stop selecting"
            >
                <X size={13}/>
            </button>
        </div>
    );
}
