import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";
import { computeFlippedPosition } from "../domain/popoverPosition";

export interface GeometryOption {
  id: string;
  label: string;
  renderIcon: () => React.ReactNode;
}

export const GEOMETRY_OPTIONS: GeometryOption[] = [
  {
    id: "rounded-rectangle",
    label: "Rounded Rectangle",
    renderIcon: () => (
      <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="1.5" y="2.5" width="15" height="13" rx="3.5" />
      </svg>
    ),
  },
  {
    id: "rectangle",
    label: "Rectangle",
    renderIcon: () => (
      <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="1.5" y="2.5" width="15" height="13" />
      </svg>
    ),
  },
  {
    id: "circle",
    label: "Circle / Ellipse",
    renderIcon: () => (
      <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="9" cy="9" r="6.5" />
      </svg>
    ),
  },
  {
    id: "cylinder",
    label: "Cylinder (Database)",
    renderIcon: () => (
      <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M 2.5 4.5 C 2.5 3 15.5 3 15.5 4.5 L 15.5 13.5 C 15.5 15 2.5 15 2.5 13.5 Z" />
        <path d="M 2.5 4.5 C 2.5 6 15.5 6 15.5 4.5" />
      </svg>
    ),
  },
  {
    id: "diamond",
    label: "Diamond (Decision)",
    renderIcon: () => (
      <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
        <polygon points="9,2 16,9 9,16 2,9" />
      </svg>
    ),
  },
  {
    id: "hexagon",
    label: "Hexagon",
    renderIcon: () => (
      <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
        <polygon points="4.5,2 13.5,2 16.5,9 13.5,16 4.5,16 1.5,9" />
      </svg>
    ),
  },
  {
    id: "parallelogram",
    label: "Parallelogram",
    renderIcon: () => (
      <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
        <polygon points="4.5,3 16.5,3 13.5,15 1.5,15" />
      </svg>
    ),
  },
  {
    id: "document",
    label: "Document",
    renderIcon: () => (
      <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M 2.5 2.5 L 11.5 2.5 L 15.5 6.5 L 15.5 15.5 C 11.5 13.5 6.5 16.5 2.5 14.5 Z" />
      </svg>
    ),
  },
  {
    id: "cloud",
    label: "Cloud",
    renderIcon: () => (
      <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M 3.5 13 C 1.5 13 1.5 10 3.5 9.5 C 3 6.5 7 5 9 6.5 C 11 4.5 15 6 14.5 9 C 16.5 9.5 16.5 13 14.5 13 Z" />
      </svg>
    ),
  },
  {
    id: "actor",
    label: "Actor (User)",
    renderIcon: () => (
      <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="9" cy="5" r="2.5" />
        <path d="M 2.5 15.5 C 2.5 11 15.5 11 15.5 15.5" />
      </svg>
    ),
  },
  {
    id: "path",
    label: "Custom SVG Path",
    renderIcon: () => (
      <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M 2.5 14.5 L 6.5 3.5 L 11.5 14.5 L 15.5 7.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

interface GeometryPickerProps {
  value: string;
  onChange: (value: string) => void;
}

export function GeometryPicker({ value, onChange }: GeometryPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const [dropdownWidth, setDropdownWidth] = useState<number>(220);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedOption = GEOMETRY_OPTIONS.find((opt) => opt.id === value) || GEOMETRY_OPTIONS[0];

  const open = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setDropdownWidth(Math.max(220, rect.width));
    setDropdownPos({ top: rect.bottom + 4, left: rect.left });
    setIsOpen(true);
  };

  const close = () => {
    setIsOpen(false);
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
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
      }
    };
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [isOpen, reposition]);

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (isOpen ? close() : open())}
        aria-expanded={isOpen}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "6px 10px",
          background: "var(--bg-field, #1b1e27)",
          border: "1px solid var(--border, #2a2e3a)",
          borderRadius: 4,
          color: "#fff",
          fontSize: 13,
          cursor: "pointer",
          outline: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, overflow: "hidden" }}>
          <span style={{ display: "flex", alignItems: "center", color: "var(--accent, #5b7cfa)" }}>
            {selectedOption.renderIcon()}
          </span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {selectedOption.label}
          </span>
        </div>
        <ChevronDown size={14} style={{ opacity: 0.6, flexShrink: 0 }} />
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={dropdownRef}
            style={{
              position: "fixed",
              top: dropdownPos?.top ?? 0,
              left: dropdownPos?.left ?? 0,
              width: dropdownWidth,
              maxHeight: 280,
              overflowY: "auto",
              background: "var(--chrome-bg-raised, #1b1e27)",
              border: "1px solid var(--chrome-border, #2a2e3a)",
              borderRadius: 6,
              boxShadow: "0 6px 20px rgba(0, 0, 0, 0.45)",
              zIndex: 9999,
              padding: "4px 0",
              colorScheme: "dark",
            }}
          >
            {GEOMETRY_OPTIONS.map((opt) => {
              const isSelected = opt.id === value;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    onChange(opt.id);
                    close();
                  }}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    padding: "7px 10px",
                    background: isSelected ? "var(--bg-active, rgba(91, 124, 250, 0.15))" : "transparent",
                    color: isSelected ? "var(--accent, #5b7cfa)" : "var(--chrome-text, #e7e9ee)",
                    border: "none",
                    borderRadius: 0,
                    fontSize: 12.5,
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "background 0.1s ease",
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = "rgba(255, 255, 255, 0.06)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = "transparent";
                    }
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ display: "flex", alignItems: "center", opacity: isSelected ? 1 : 0.8 }}>
                      {opt.renderIcon()}
                    </span>
                    <span>{opt.label}</span>
                  </div>
                  {isSelected && <Check size={14} />}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </div>
  );
}
