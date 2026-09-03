import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus } from "lucide-react";
import { getItemType } from "../../domain/requirementsRegistry";
import { computeFlippedPosition } from "../../domain/popoverPosition";
import type { RequirementItem, RequirementsDocument } from "../../domain/requirementsTypes";

interface SprintQuickAddProps {
  backlogItems: RequirementItem[];
  requirements: RequirementsDocument;
  onAssign: (itemId: string) => void;
}

const DROPDOWN_WIDTH = 240;

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
  const [query, setQuery] = useState("");
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [isOpen, reposition]);

  const q = query.trim().toLowerCase();
  const candidates =
    q === ""
      ? backlogItems
      : backlogItems.filter((item) => item.id.toLowerCase().includes(q) || item.title.toLowerCase().includes(q));

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="sprint-quick-add__trigger"
        onClick={(e) => {
          e.stopPropagation();
          if (isOpen) {
            close();
          } else {
            open();
          }
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
            style={{ position: "fixed", top: dropdownPos.top, left: dropdownPos.left }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <input
              autoFocus
              className="sprint-quick-add__search"
              placeholder="Search backlog..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") close();
              }}
            />
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
                      onAssign(item.id);
                      close();
                    }}
                  >
                    <span className="sprint-quick-add__option-id" style={{ color: type?.color ?? "var(--chrome-text-dim)" }}>
                      {item.id}
                    </span>
                    <span className="sprint-quick-add__option-title">{item.title || "(untitled)"}</span>
                  </button>
                );
              })}
              {candidates.length === 0 && (
                <p className="sprint-quick-add__empty">
                  {backlogItems.length === 0 ? "Backlog is empty." : "No matching items."}
                </p>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
