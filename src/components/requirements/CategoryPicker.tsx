import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Tag, Trash2, X } from 'lucide-react';
import {
  countItemsUsingCategory,
  findCategoryByLabel,
  getCategory,
} from '../../domain/requirements/requirementsRegistry';
import type { RequirementsDocument } from '../../domain/requirements/requirementsTypes';
import { HighlightedText } from '../../common/components/highlight/HighlightText';
import { useOutsideClick } from '../../common/hooks/useOutsideClick';
import { usePositionedDropdown } from '../../common/hooks/usePositionedDropdown';

interface CategoryPickerProps {
  doc: RequirementsDocument;
  categoryId: string | undefined;
  onAssign: (categoryId: string) => void;
  onCreateAndAssign: (label: string) => void;
  onClear: () => void;
  /** Optional: hosts that can't delete (a read-only view, or one with no
   * store to hand) simply omit it and no delete affordance is rendered,
   * rather than showing a button that does nothing. */
  onDelete?: (categoryId: string) => void;
  searchQuery?: string;
}

const DROPDOWN_WIDTH = 220;

/**
 * Renders its dropdown through a portal into document.body rather than as
 * a normal in-place absolutely-positioned child. This isn't just a style
 * choice: RequirementCard (which hosts the trigger button) has
 * `overflow: hidden` for its own rounded-corner clipping, and its parent
 * scroll container has `overflow: auto` - a normally-positioned dropdown
 * would get silently clipped by either of those the moment it extended
 * past the card's or the scroll area's own bounds.
 */
export function CategoryPicker({
  doc,
  categoryId,
  onAssign,
  onCreateAndAssign,
  onClear,
  onDelete,
  searchQuery,
}: CategoryPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  // Which row is showing its inline "really delete?" strip.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const current = getCategory(doc, categoryId);

  const close = () => {
    setIsOpen(false);
    setQuery('');
    setPendingDeleteId(null);
  };

  const { position: dropdownPos } = usePositionedDropdown({
    triggerRef,
    dropdownRef,
    isOpen,
    dependencies: [query, pendingDeleteId],
  });

  useOutsideClick({
    refs: [triggerRef, dropdownRef],
    isOpen,
    onClose: close,
  });

  const uniqueCategories = useMemo(() => {
    const seen = new Set<string>();
    return doc.categories.filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  }, [doc.categories]);

  const filtered = uniqueCategories.filter((c) =>
    c.label.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const exactMatch = findCategoryByLabel(doc, query);
  const canCreate = query.trim().length > 0 && !exactMatch;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`category-picker__trigger${current ? '' : ' is-empty'}`}
        style={current ? { borderColor: `${current.color}66`, color: current.color } : undefined}
        onClick={() => (isOpen ? close() : setIsOpen(true))}
      >
        <Tag size={11} />
        {current ? <HighlightedText text={current.label} search={searchQuery} /> : 'Category'}
      </button>

      {isOpen &&
        dropdownPos &&
        createPortal(
          <div
            ref={dropdownRef}
            className="category-picker__dropdown"
            style={{
              position: 'fixed',
              top: dropdownPos.top,
              left: dropdownPos.left,
              width: DROPDOWN_WIDTH,
            }}
          >
            <input
              autoFocus
              className="category-picker__search"
              placeholder="Search or create..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canCreate) {
                  onCreateAndAssign(query.trim());
                  close();
                } else if (e.key === 'Escape') {
                  close();
                }
              }}
            />
            <div className="category-picker__list">
              {current && (
                <button
                  type="button"
                  className="category-picker__option category-picker__option--clear"
                  onClick={() => {
                    onClear();
                    close();
                  }}
                >
                  <X size={11} />
                  Uncategorized
                </button>
              )}
              {filtered.map((c) =>
                pendingDeleteId === c.id ? (
                  <div key={c.id} className="category-picker__confirm">
                    <span className="category-picker__confirm-text">
                      Delete "{c.label}"?
                      {(() => {
                        const inUse = countItemsUsingCategory(doc, c.id);
                        return inUse === 0
                          ? " It isn't used by anything."
                          : ` ${inUse} item${inUse === 1 ? '' : 's'} will become uncategorized.`;
                      })()}
                    </span>
                    <div className="category-picker__confirm-actions">
                      <button
                        type="button"
                        className="category-picker__confirm-cancel"
                        onClick={() => setPendingDeleteId(null)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="category-picker__confirm-delete"
                        onClick={() => {
                          onDelete?.(c.id);
                          setPendingDeleteId(null);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ) : (
                  <div key={c.id} className="category-picker__row">
                    <button
                      type="button"
                      className="category-picker__option"
                      onClick={() => {
                        onAssign(c.id);
                        close();
                      }}
                    >
                      <span className="category-picker__swatch" style={{ background: c.color }} />
                      {c.label}
                    </button>
                    {onDelete && (
                      <button
                        type="button"
                        className="category-picker__delete"
                        aria-label={`Delete ${c.label} category`}
                        title="Delete this category"
                        onClick={() => setPendingDeleteId(c.id)}
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                ),
              )}
              {canCreate && (
                <button
                  type="button"
                  className="category-picker__option category-picker__option--create"
                  onClick={() => {
                    onCreateAndAssign(query.trim());
                    close();
                  }}
                >
                  Create "{query.trim()}"
                </button>
              )}
              {filtered.length === 0 && !canCreate && (
                <p className="category-picker__empty">
                  No categories yet - type a name to create one.
                </p>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
