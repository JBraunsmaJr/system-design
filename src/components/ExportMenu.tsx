import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Download } from "lucide-react";
import { computeFlippedPosition } from "../domain/popoverPosition";

interface ExportMenuProps {
  onExportPng: () => void;
  onExportSvg: () => void;
  disabled?: boolean;
}

const DROPDOWN_WIDTH = 150;

export function ExportMenu({ onExportPng, onExportSvg, disabled }: ExportMenuProps) {
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
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => (isOpen ? close() : open())}
        title="Export"
      >
        <Download size={14} />
        <span className="toolbar__label">Export</span>
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
                onExportPng();
                close();
              }}
            >
              Download PNG
            </button>
            <button
              type="button"
              onClick={() => {
                onExportSvg();
                close();
              }}
            >
              Download SVG
            </button>
          </div>,
          document.body
        )}
    </div>
  );
}
