import { useState, type KeyboardEvent } from 'react';
import { Field } from './InspectorCommon';

export interface TagEditorProps {
  tags: string[];
  onChange: (tags: string[]) => void;
}

/**
 * Chip-style tag editor. This is a fully controlled component (chips are
 * rendered directly from the `tags` prop on every render).
 */
export function TagEditor({ tags, onChange }: TagEditorProps) {
  const [draft, setDraft] = useState('');

  const commit = () => {
    const value = draft.trim();
    if (value && !tags.includes(value)) {
      onChange([...tags, value]);
    }
    setDraft('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Backspace' && draft === '' && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  };

  return (
    <Field label="Tags">
      <div className="tag-editor">
        {tags.map((tag) => (
          <span className="tag-chip" key={tag}>
            {tag}
            <button
              type="button"
              onClick={() => onChange(tags.filter((t) => t !== tag))}
              aria-label={`Remove tag ${tag}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          className="tag-editor__input"
          value={draft}
          placeholder={tags.length === 0 ? 'env:prod, team:payments...' : 'Add tag...'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commit}
        />
      </div>
    </Field>
  );
}
