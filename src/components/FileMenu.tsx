import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, FilePlus2 } from "lucide-react";
import { computeFlippedPosition } from "../domain/popoverPosition";

interface FileMenuProps {
  onNew: () => void;
  onLoadClick: () => void;
  /** Whether a collaborative session is currently active - see
   * Toolbar's own isInSession doc comment for why this disables the
   * Open item specifically (New still works fine mid-session: it just
   * starts a fresh LOCAL diagram, it doesn't touch the active session's
   * own state at all). */
  isInSession: boolean;
}

const DROPDOWN_WIDTH = 150;

// Consolidates New and Open - two of the toolbar's least-frequently-used
// actions - into a single dropdown trigger, matching ExportMenu's own
// established pattern exactly. Save stays a separate, standalone button
// in Toolbar itself: as the single most-used action of the three, it
// benefits from staying a direct, one-click target rather than being
// buried behind an extra click.
export function FileMenu({ onNew, onLoadClick, isInSession }: FileMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
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
  const close = () => setIsOpen(false);

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
  }, [isOpen]);

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
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      close();
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleEscape);
    };
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

  return (
    <div className="export-menu">
      <button ref={triggerRef} type="button" onClick={() => (isOpen ? close() : open())} title="File">
        <FilePlus2 size={14} />
        <span className="toolbar__label">File</span>
        <ChevronDown size={12} />
      </button>
      {isOpen &&
        dropdownPos &&
        createPortal(
          <div
            ref={dropdownRef}
            className="export-menu__dropdown"
            style={{ position: "fixed", top: dropdownPos.top, left: dropdownPos.left, minWidth: DROPDOWN_WIDTH }}
          >
            <button
              type="button"
              onClick={() => {
                onNew();
                close();
              }}
            >
              New
            </button>
            <button
              type="button"
              disabled={isInSession}
              title={isInSession ? "Open is disabled during a collaborative session - loading a file wouldn't be visible until the session ends" : undefined}
              onClick={() => {
                onLoadClick();
                close();
              }}
            >
              Open
            </button>
          </div>,
          document.body
        )}
    </div>
  );
}
