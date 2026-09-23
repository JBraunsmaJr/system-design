import { useEffect, useRef, useState } from 'react';
import { CornerDownLeft, Plus } from 'lucide-react';
import type { RequirementsDocument } from '../../domain/requirementsTypes';

interface ChildQuickAddProps {
  doc: RequirementsDocument;
  parentId: string;
  /** The type preselected for a new child - Ticket by default. The picker
   * stays on whatever was last chosen, so adding several nested epics in a
   * row doesn't mean re-picking Epic every time. */
  defaultTypeId: string;
  onAdd: (parentId: string, typeId: string, title: string) => string | null;
}

const CONFIRMATION_MS = 2500;

/**
 * A single-line "type a title, press Enter" row for decomposing an item
 * into children without leaving it. Deliberately does NOT scroll to the
 * new item the way the toolbar's Add does: the whole point is to stay put
 * and keep adding. The input keeps focus and clears after each add, and a
 * short confirmation names the new id - useful when grouping by type,
 * where the new child lands in a different section, out of sight.
 */
export function ChildQuickAdd({ doc, parentId, defaultTypeId, onAdd }: ChildQuickAddProps) {
  const [title, setTitle] = useState('');
  const [typeId, setTypeId] = useState(defaultTypeId);
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (confirmationTimer.current) clearTimeout(confirmationTimer.current);
    },
    [],
  );

  // A type deleted out from under the picker (e.g. by a collaborator)
  // falls back to the default rather than submitting an unknown type.
  const effectiveTypeId = doc.itemTypes.some((t) => t.id === typeId) ? typeId : defaultTypeId;

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const newId = onAdd(parentId, effectiveTypeId, trimmed);
    if (!newId) return;
    setTitle('');
    setLastAddedId(newId);
    if (confirmationTimer.current) clearTimeout(confirmationTimer.current);
    confirmationTimer.current = setTimeout(() => setLastAddedId(null), CONFIRMATION_MS);
    inputRef.current?.focus();
  };

  return (
    <div className="child-quick-add">
      <Plus size={12} className="child-quick-add__icon" aria-hidden />
      <select
        className="child-quick-add__type"
        value={effectiveTypeId}
        onChange={(e) => setTypeId(e.target.value)}
        aria-label={`Type of new child for ${parentId}`}
      >
        {doc.itemTypes.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
      <input
        ref={inputRef}
        className="child-quick-add__input"
        value={title}
        placeholder={`Add a child to ${parentId}...`}
        aria-label={`Title of new child for ${parentId}`}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setTitle('');
            inputRef.current?.blur();
          }
        }}
      />
      {lastAddedId ? (
        <span className="child-quick-add__confirmation" role="status">
          Added {lastAddedId}
        </span>
      ) : (
        <span className="child-quick-add__hint" aria-hidden>
          <CornerDownLeft size={11} />
        </span>
      )}
    </div>
  );
}
