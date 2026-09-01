import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link2, X } from "lucide-react";
import { getItemType } from "../../domain/requirementsRegistry";
import { computeFlippedPosition } from "../../domain/popoverPosition";
import type { RequirementsDocument } from "../../domain/requirementsTypes";

interface RequirementLinkerProps {
  linkedIds: string[];
  doc: RequirementsDocument;
  onLink: (itemId: string) => void;
  onUnlink: (itemId: string) => void;
  onNavigate: (itemId: string) => void;
}

const DROPDOWN_WIDTH = 240;

/**
 * Same portal + flip-positioning approach as CategoryPicker (see that
 * component's comments for the full "why a portal" reasoning - the short
 * version: this renders from inside the Inspector panel, and a normally-
 * positioned dropdown would risk the same overflow-clipping problem
 * that's already been fixed twice elsewhere in this app). The one real
 * difference from CategoryPicker: this is multi-select and search-only
 * (no "create"), so the dropdown deliberately stays open after each
 * selection rather than closing - linking several requirements to one
 * node in a row shouldn't require reopening the list every time.
 */
export function RequirementLinker({ linkedIds, doc, onLink, onUnlink, onNavigate }: RequirementLinkerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Only items that still exist are shown - see the doc comment on
  // ArchNodeData.linkedRequirementIds for why a stale id is left in the
  // underlying data rather than actively cleaned up.
  const linkedItems = linkedIds
    .map((id) => doc.items.find((i) => i.id === id))
    .filter((item): item is NonNullable<typeof item> => !!item);

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
  }, [isOpen, query, linkedIds.length]);

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

  const q = query.trim().toLowerCase();
  const candidates = doc.items
    .filter((item) => !linkedIds.includes(item.id))
    .filter((item) => q === "" || item.id.toLowerCase().includes(q) || item.title.toLowerCase().includes(q))
    .slice(0, 20);

  return (
    <div className="requirement-linker">
      {linkedItems.length > 0 && (
        <div className="requirement-linker__pills">
          {linkedItems.map((item) => {
            const type = getItemType(doc, item.typeId);
            return (
              <span
                key={item.id}
                className="requirement-linker__pill"
                style={{ borderColor: `${type?.color ?? "#8b90a0"}66` }}
              >
                <button
                  type="button"
                  className="requirement-linker__pill-label"
                  onClick={() => onNavigate(item.id)}
                  style={{ color: type?.color ?? "var(--chrome-text)" }}
                  title={`Go to ${item.id}`}
                >
                  {item.id}
                  {item.title ? `: ${item.title}` : ""}
                </button>
                <button
                  type="button"
                  className="requirement-linker__pill-remove"
                  onClick={() => onUnlink(item.id)}
                  aria-label={`Unlink ${item.id}`}
                  title={`Unlink ${item.id}`}
                >
                  <X size={10} />
                </button>
              </span>
            );
          })}
        </div>
      )}

      <button
        ref={triggerRef}
        type="button"
        className="requirement-linker__add"
        onClick={() => (isOpen ? close() : open())}
      >
        <Link2 size={11} />
        Link requirement
      </button>

      {isOpen &&
        dropdownPos &&
        createPortal(
          <div
            ref={dropdownRef}
            className="requirement-linker__dropdown"
            style={{ position: "fixed", top: dropdownPos.top, left: dropdownPos.left }}
          >
            <input
              autoFocus
              className="requirement-linker__search"
              placeholder="Search requirements..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") close();
              }}
            />
            <div className="requirement-linker__list">
              {candidates.map((item) => {
                const type = getItemType(doc, item.typeId);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="requirement-linker__option"
                    // mousedown + preventDefault keeps focus on the search
                    // input through the click, so linking several items in
                    // a row doesn't require re-focusing between each one -
                    // same technique used for the reference popover's
                    // options, for the same underlying reason (a plain
                    // click would otherwise shift focus away first).
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onLink(item.id);
                      setQuery("");
                    }}
                  >
                    <span
                      className="requirement-linker__option-id"
                      style={{ color: type?.color ?? "var(--chrome-text-dim)" }}
                    >
                      {item.id}
                    </span>
                    <span className="requirement-linker__option-title">{item.title || "(untitled)"}</span>
                  </button>
                );
              })}
              {candidates.length === 0 && (
                <p className="requirement-linker__empty">
                  {doc.items.length === 0 ? "No requirements exist yet." : "No matching requirements."}
                </p>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
