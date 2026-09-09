import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Briefcase, Check, ChevronDown } from "lucide-react";
import { getItemType } from "../../domain/requirementsRegistry";
import { computeFlippedPosition } from "../../domain/popoverPosition";
import type { RequirementsDocument } from "../../domain/requirementsTypes";

interface TypePickerProps {
  doc: RequirementsDocument;
  typeId: string;
  onChange: (newTypeId: string) => void;
  disabled?: boolean;
  className?: string;
}

const DROPDOWN_WIDTH = 220;

export function TypePicker({ doc, typeId, onChange, disabled, className }: TypePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentType = getItemType(doc, typeId);

  const open = () => {
    if (disabled) return;
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setDropdownPos({ top: rect.bottom + 4, left: Math.max(8, rect.left) });
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
    const handler = (event: MouseEvent) => {
      const path = event.composedPath();
      if (triggerRef.current && path.includes(triggerRef.current)) return;
      if (dropdownRef.current && path.includes(dropdownRef.current)) return;
      close();
    };
    document.addEventListener("mousedown", handler);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("mousedown", handler);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [isOpen, reposition]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        className={`type-picker__trigger${className ? ` ${className}` : ""}`}
        style={currentType ? { borderColor: `${currentType.color}55`, color: currentType.color, backgroundColor: `${currentType.color}15` } : undefined}
        onClick={open}
        title={disabled ? undefined : `Type: ${currentType?.label ?? typeId} (Click to convert)`}
        aria-label={`Convert type from ${currentType?.label ?? typeId}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className="type-picker__swatch" style={{ background: currentType?.color ?? "var(--chrome-text-dim)" }} />
        <span className="type-picker__label">{currentType?.label ?? typeId}</span>
        {!disabled && <ChevronDown size={10} className="type-picker__chevron" />}
      </button>

      {isOpen &&
        dropdownPos &&
        createPortal(
          <div
            ref={dropdownRef}
            className="type-picker__dropdown"
            role="listbox"
            style={{ position: "fixed", top: dropdownPos.top, left: dropdownPos.left, width: DROPDOWN_WIDTH }}
          >
            <div className="type-picker__header">
              <span>Convert Type</span>
            </div>
            <div className="type-picker__list">
              {doc.itemTypes.map((type) => {
                const isSelected = type.id === typeId;
                return (
                  <button
                    key={type.id}
                    type="button"
                    className={`type-picker__option${isSelected ? " is-selected" : ""}`}
                    onClick={() => {
                      if (!isSelected) {
                        onChange(type.id);
                      }
                      close();
                    }}
                  >
                    <span className="type-picker__swatch" style={{ background: type.color }} />
                    <span className="type-picker__option-name">{type.label}</span>
                    <span className="type-picker__option-prefix">({type.prefix})</span>
                    {type.isWorkable && (
                      <span title="Workable item" style={{ display: "inline-flex", alignItems: "center" }}>
                        <Briefcase size={11} className="type-picker__workable-icon" />
                      </span>
                    )}
                    {isSelected && <Check size={13} className="type-picker__check" />}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
