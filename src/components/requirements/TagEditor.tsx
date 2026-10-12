import {useId, useState} from 'react';
import {Plus, Tag, X} from 'lucide-react';
import {hasTag, MAX_TAG_LENGTH, withTagAdded, withTagRemoved,} from '../../domain/requirements/requirementTags';
import {HighlightedText} from '../../common/components/highlight/HighlightText';

interface TagEditorProps {
    itemId: string;
    tags: string[] | undefined;
    /** Every tag in the document, offered as suggestions while typing. Must
     * be stable between edits that don't change the tag set - it's compared
     * in RequirementCard's memo check. */
    suggestions: string[];
    /** Receives the whole new tag list (undefined when it's now empty). */
    onChange: (tags: string[] | undefined) => void;
    searchQuery?: string;
}

/**
 * A requirement card's tags: chips with a remove button each, and an
 * "Add tag" control that becomes a text field with suggestions from the
 * rest of the document. Enter or comma adds the tag and keeps the field
 * open for the next one; Escape or leaving the field closes it.
 */
export function TagEditor({itemId, tags, suggestions, onChange, searchQuery}: TagEditorProps) {
    const [isAdding, setIsAdding] = useState(false);
    const [draft, setDraft] = useState('');
    const listId = useId();
    const current = tags ?? [];

    const commit = () => {
        if (draft.trim()) onChange(withTagAdded(tags, draft));
        setDraft('');
    };

    const available = suggestions.filter((s) => !hasTag({tags}, s));

    return (
        <div className="requirement-tags" aria-label={`Tags for ${itemId}`}>
            {current.map((tag) => (
                <span key={tag} className="requirement-tags__chip">
          <Tag size={9} aria-hidden/>
          <HighlightedText text={tag} search={searchQuery}/>
          <button
              type="button"
              className="requirement-tags__remove"
              onClick={() => onChange(withTagRemoved(tags, tag))}
              aria-label={`Remove tag ${tag} from ${itemId}`}
              title="Remove tag"
          >
            <X size={9}/>
          </button>
        </span>
            ))}
            {isAdding ? (
                <>
                    <input
                        className="requirement-tags__input"
                        autoFocus
                        value={draft}
                        maxLength={MAX_TAG_LENGTH}
                        placeholder="tag"
                        list={listId}
                        aria-label={`New tag for ${itemId}`}
                        onChange={(e) => {
                            const value = e.target.value;
                            // Typing a comma finishes a tag, so "a, b, c" adds three.
                            if (value.includes(',')) {
                                let next = tags;
                                for (const part of value.split(',').slice(0, -1)) {
                                    if (part.trim()) next = withTagAdded(next, part);
                                }
                                if (next !== tags) onChange(next);
                                setDraft(value.split(',').pop() ?? '');
                            } else {
                                setDraft(value);
                            }
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                commit();
                            } else if (e.key === 'Escape') {
                                e.preventDefault();
                                setDraft('');
                                setIsAdding(false);
                            } else if (e.key === 'Backspace' && draft === '' && current.length > 0) {
                                onChange(withTagRemoved(tags, current[current.length - 1]));
                            }
                        }}
                        onBlur={() => {
                            commit();
                            setIsAdding(false);
                        }}
                    />
                    <datalist id={listId}>
                        {available.map((s) => (
                            <option key={s} value={s}/>
                        ))}
                    </datalist>
                </>
            ) : (
                <button
                    type="button"
                    className="requirement-tags__add"
                    onClick={() => setIsAdding(true)}
                    aria-label={`Add a tag to ${itemId}`}
                    title="Add a tag"
                >
                    <Plus size={10}/>
                    {current.length === 0 && <span>Tag</span>}
                </button>
            )}
        </div>
    );
}
