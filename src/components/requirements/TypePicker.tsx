import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Briefcase, Check, ChevronDown } from 'lucide-react';
import { getItemType } from '../../domain/requirements/requirementsRegistry';
import type { RequirementsDocument } from '../../domain/requirements/requirementsTypes';
import { useOutsideClick } from '../../common/hooks/useOutsideClick';
import { usePositionedDropdown } from '../../common/hooks/usePositionedDropdown';

interface TypePickerProps {
  doc: RequirementsDocument;
  typeId: string;
  onChange: (newTypeId: string) => void;
  disabled?: boolean;
  className?: string;
  /** Dropdown heading - "Convert Type" by default, since the card header
   * uses this to convert an existing item. Pickers that choose a type for
   * something NEW (the child quick-add) say so instead. */
  headerLabel?: string;
  /** Trigger tooltip and accessible name; default to the convert wording. */
  triggerTitle?: string;
  triggerAriaLabel?: string;
  /** Called after the dropdown closes by any route (a pick, Escape or an
   * outside click), e.g. to return focus to a neighboring input. */
  onClosed?: () => void;
}

const DROPDOWN_WIDTH = 220;

export function TypePicker({
  doc,
  typeId,
  onChange,
  disabled,
  className,
  headerLabel = 'Convert Type',
  triggerTitle,
  triggerAriaLabel,
  onClosed,
}: TypePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const uniqueItemTypes = useMemo(() => {
    const seen = new Set<string>();
    return doc.itemTypes.filter((t) => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
  }, [doc.itemTypes]);

  const currentType = getItemType(doc, typeId);

  const onClosedRef = useRef(onClosed);
  useLayoutEffect(() => {
    onClosedRef.current = onClosed;
  }, [onClosed]);

  const close = useCallback(() => {
    setIsOpen(false);
    onClosedRef.current?.();
  }, []);

  const { position: dropdownPos } = usePositionedDropdown({
    triggerRef,
    dropdownRef,
    isOpen,
  });

  useOutsideClick({
    refs: [triggerRef, dropdownRef],
    isOpen,
    onClose: close,
  });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        className={`type-picker__trigger${className ? ` ${className}` : ''}`}
        style={
          currentType
            ? {
                borderColor: `${currentType.color}55`,
                color: currentType.color,
                backgroundColor: `${currentType.color}15`,
              }
            : undefined
        }
        onClick={() => {
          if (!disabled) setIsOpen((prev) => !prev);
        }}
        title={
          disabled
            ? undefined
            : (triggerTitle ?? `Type: ${currentType?.label ?? typeId} (Click to convert)`)
        }
        aria-label={triggerAriaLabel ?? `Convert type from ${currentType?.label ?? typeId}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span
          className="type-picker__swatch"
          style={{ background: currentType?.color ?? 'var(--chrome-text-dim)' }}
        />
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
            style={{
              position: 'fixed',
              top: dropdownPos.top,
              left: dropdownPos.left,
              width: DROPDOWN_WIDTH,
            }}
          >
            <div className="type-picker__header">
              <span>{headerLabel}</span>
            </div>
            <div className="type-picker__list">
              {uniqueItemTypes.map((type) => {
                const isSelected = type.id === typeId;
                return (
                  <button
                    key={type.id}
                    type="button"
                    className={`type-picker__option${isSelected ? ' is-selected' : ''}`}
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
                      <span
                        title="Workable item"
                        style={{ display: 'inline-flex', alignItems: 'center' }}
                      >
                        <Briefcase size={11} className="type-picker__workable-icon" />
                      </span>
                    )}
                    {isSelected && <Check size={13} className="type-picker__check" />}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
