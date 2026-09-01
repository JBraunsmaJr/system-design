import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Tag, X } from "lucide-react";
import { findCategoryByLabel, getCategory } from "../../domain/requirementsRegistry";
import { computeFlippedPosition } from "../../domain/popoverPosition";
import type { RequirementsDocument } from "../../domain/requirementsTypes";

interface CategoryPickerProps {
  doc: RequirementsDocument;
  categoryId: string | undefined;
  onAssign: (categoryId: string) => void;
  onCreateAndAssign: (label: string) => void;
  onClear: () => void;
}

const DROPDOWN_WIDTH = 220;

/**
 * Renders its dropdown through a portal into document.body rather than as
 * a normal in-place absolutely-positioned child. This isn't just a style
 * choice: RequirementCard (which hosts the trigger button) has
 * `overflow: hidden` for its own rounded-corner clipping, and its parent
 * scroll container has `overflow: auto` - a normally-positioned dropdown
 * would get silently clipped by either of those the moment it extended
 * past the card's or the scroll area's own bounds, which is exactly the
 * "the dropdown appears hidden" bug this replaced. A portal sidesteps
 * ancestor clipping entirely by rendering outside that DOM subtree, with
 * position computed from the trigger's actual on-screen location instead
 * of relying on CSS positioning context.
 *
 * Positioning happens in two steps: opening sets a naive "below the
 * trigger" guess so the dropdown actually renders somewhere and becomes
 * measurable, then a useLayoutEffect measures its real size and corrects
 * the position - flipping above the trigger if there isn't enough room
 * below (e.g. the trigger is near the bottom of the screen). useLayoutEffect
 * specifically (not useEffect) is what keeps this flicker-free: it runs
 * synchronously after the DOM commits but before the browser paints, so
 * any correction happens invisibly rather than as a visible jump.
 */
export function CategoryPicker({ doc, categoryId, onAssign, onCreateAndAssign, onClear }: CategoryPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const current = getCategory(doc, categoryId);

  const open = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setDropdownPos({ top: rect.bottom + 4, left: Math.max(8, rect.right - DROPDOWN_WIDTH) });
    setIsOpen(true);
  };
  const close = () => {
    setIsOpen(false);
    setQuery("");
  };

  // Measures the dropdown's real rendered size (only possible once it's
  // actually in the DOM, which is why `open` above uses a naive guess
  // first) and flips it above the trigger if it doesn't fit below.
  // Re-runs when `query` changes too, since filtering the category list
  // changes the dropdown's height.
  useLayoutEffect(() => {
    if (!isOpen) return;
    const trigger = triggerRef.current;
    const dropdown = dropdownRef.current;
    if (!trigger || !dropdown) return;
    const triggerRect = trigger.getBoundingClientRect();
    const dropdownRect = dropdown.getBoundingClientRect();
    const next = computeFlippedPosition(
      triggerRect,
      { width: dropdownRect.width, height: dropdownRect.height },
      { width: window.innerWidth, height: window.innerHeight }
    );
    setDropdownPos((prev) => (prev && prev.top === next.top && prev.left === next.left ? prev : next));
  }, [isOpen, query]);

  // Same measure-and-flip logic, reused for scroll/resize while open -
  // the dropdown is already rendered by this point, so there's no need
  // for the naive-guess step `open` uses.
  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    const dropdown = dropdownRef.current;
    if (!trigger || !dropdown) return;
    const triggerRect = trigger.getBoundingClientRect();
    const dropdownRect = dropdown.getBoundingClientRect();
    setDropdownPos(
      computeFlippedPosition(
        triggerRect,
        { width: dropdownRect.width, height: dropdownRect.height },
        { width: window.innerWidth, height: window.innerHeight }
      )
    );
  }, []);

  // Click-outside-to-close needs to check both the trigger AND the
  // portaled dropdown - they're no longer DOM siblings under one wrapper
  // the way a non-portaled version would be, so a click inside the
  // dropdown (now living directly under <body>) would otherwise look
  // identical to a click "outside" from this listener's perspective.
  useEffect(() => {
    if (!isOpen) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  // A portaled, fixed-position dropdown doesn't automatically track the
  // trigger's on-screen position the way an in-flow absolutely-positioned
  // one would - it has to be explicitly recomputed as the card's scroll
  // container moves it around. Capture phase (the `true` third argument)
  // is what catches scroll events from the nested scrollable content
  // area, since scroll events don't bubble the way most DOM events do.
  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [isOpen, reposition]);

  const filtered = doc.categories.filter((c) => c.label.toLowerCase().includes(query.trim().toLowerCase()));
  const exactMatch = findCategoryByLabel(doc, query);
  const canCreate = query.trim().length > 0 && !exactMatch;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`category-picker__trigger${current ? "" : " is-empty"}`}
        style={current ? { borderColor: `${current.color}66`, color: current.color } : undefined}
        onClick={() => (isOpen ? close() : open())}
      >
        <Tag size={11} />
        {current ? current.label : "Category"}
      </button>

      {isOpen &&
        dropdownPos &&
        createPortal(
          <div
            ref={dropdownRef}
            className="category-picker__dropdown"
            style={{ position: "fixed", top: dropdownPos.top, left: dropdownPos.left }}
          >
            <input
              autoFocus
              className="category-picker__search"
              placeholder="Search or create..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canCreate) {
                  onCreateAndAssign(query.trim());
                  close();
                } else if (e.key === "Escape") {
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
              {filtered.map((c) => (
                <button
                  key={c.id}
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
              ))}
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
                <p className="category-picker__empty">No categories yet - type a name to create one.</p>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
