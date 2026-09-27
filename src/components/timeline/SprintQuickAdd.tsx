import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus } from 'lucide-react';
import { getItemType } from '../../domain/requirements/requirementsRegistry';
import type { RequirementItem, RequirementsDocument } from '../../domain/requirements/requirementsTypes';
import { HighlightedText, HighlightedTitle } from '../../common/components/highlight/HighlightText';
import { useOutsideClick } from '../../common/hooks/useOutsideClick';
import { usePositionedDropdown } from '../../common/hooks/usePositionedDropdown';

interface SprintQuickAddProps {
  backlogItems: RequirementItem[];
  requirements: RequirementsDocument;
  onAssign: (itemId: string) => string | null;
}

/**
 * A small "+" trigger in each sprint column's header that opens a
 * searchable list of backlog (unassigned) items, so scheduling an item
 * into a specific sprint doesn't require scrolling all the way up to the
 * Backlog section and dragging it back down - useful in general, and
 * especially with a large backlog where the target sprint may be well
 * out of view by the time you've scrolled to find the item. Same portal +
 * flip-positioning approach as SprintPicker/CategoryPicker; see those for
 * the full reasoning on why a portal is needed here (this trigger lives
 * inside a sprint column, which - like a requirement card - can end up
 * inside a clipped/scrolling ancestor).
 */
export function SprintQuickAdd({ backlogItems, requirements, onAssign }: SprintQuickAddProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const close = () => {
    setIsOpen(false);
    setQuery('');
    setErrorMessage(null);
  };

  const { position: dropdownPos } = usePositionedDropdown({
    triggerRef,
    dropdownRef,
    isOpen,
    dependencies: [query],
  });

  useOutsideClick({
    refs: [triggerRef, dropdownRef],
    isOpen,
    onClose: close,
  });

  const q = query.trim().toLowerCase();
  const candidates =
    q === ''
      ? backlogItems
      : backlogItems.filter(
          (item) => item.id.toLowerCase().includes(q) || item.title.toLowerCase().includes(q),
        );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="sprint-quick-add__trigger"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen((prev) => !prev);
        }}
        title="Add an item from the backlog to this sprint"
        aria-label="Add item from backlog"
      >
        <Plus size={13} strokeWidth={2.5} />
      </button>

      {isOpen &&
        dropdownPos &&
        createPortal(
          <div
            ref={dropdownRef}
            className="sprint-quick-add__dropdown"
            style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <input
              autoFocus
              className="sprint-quick-add__search"
              placeholder="Search backlog..."
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setErrorMessage(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') close();
              }}
            />
            {errorMessage && <p className="sprint-quick-add__error">{errorMessage}</p>}
            <div className="sprint-quick-add__list">
              {candidates.map((item) => {
                const type = getItemType(requirements, item.typeId);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="sprint-quick-add__option"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      const error = onAssign(item.id);
                      if (error) {
                        setErrorMessage(error);
                      } else {
                        close();
                      }
                    }}
                  >
                    <span
                      className="sprint-quick-add__option-id"
                      style={{ color: type?.color ?? 'var(--chrome-text-dim)' }}
                    >
                      <HighlightedText text={item.id} search={q} />
                    </span>
                    <HighlightedTitle
                      className="sprint-quick-add__option-title"
                      text={item.title || '(untitled)'}
                      search={q}
                    />
                  </button>
                );
              })}
              {candidates.length === 0 && (
                <p className="sprint-quick-add__empty">
                  {backlogItems.length === 0 ? 'Backlog is empty.' : 'No matching items.'}
                </p>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
