import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';
import { useOutsideClick } from '../../common/hooks/useOutsideClick';
import { usePositionedDropdown } from '../../common/hooks/usePositionedDropdown';
import { GEOMETRY_OPTIONS } from './geometryOptions';
export type { GeometryOption } from './geometryOptions';

interface GeometryPickerProps {
  value: string;
  onChange: (value: string) => void;
}

export function GeometryPicker({ value, onChange }: GeometryPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedOption = GEOMETRY_OPTIONS.find((opt) => opt.id === value) || GEOMETRY_OPTIONS[0];

  const { position: dropdownPos } = usePositionedDropdown({
    triggerRef,
    dropdownRef,
    isOpen,
  });

  const close = () => {
    setIsOpen(false);
  };

  useOutsideClick({
    refs: [triggerRef, dropdownRef],
    isOpen,
    onClose: close,
  });

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '6px 10px',
          background: 'var(--bg-field, #1b1e27)',
          border: '1px solid var(--border, #2a2e3a)',
          borderRadius: 4,
          color: '#fff',
          fontSize: 13,
          cursor: 'pointer',
          outline: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
          <span style={{ display: 'flex', alignItems: 'center', color: 'var(--accent, #5b7cfa)' }}>
            {selectedOption.renderIcon()}
          </span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
              position: 'fixed',
              top: dropdownPos?.top ?? 0,
              left: dropdownPos?.left ?? 0,
              minWidth: 220,
              maxHeight: 280,
              overflowY: 'auto',
              background: 'var(--chrome-bg-raised, #1b1e27)',
              border: '1px solid var(--chrome-border, #2a2e3a)',
              borderRadius: 6,
              boxShadow: '0 6px 20px rgba(0, 0, 0, 0.45)',
              zIndex: 9999,
              padding: '4px 0',
              colorScheme: 'dark',
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
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    padding: '7px 10px',
                    background: isSelected
                      ? 'var(--bg-active, rgba(91, 124, 250, 0.15))'
                      : 'transparent',
                    color: isSelected ? 'var(--accent, #5b7cfa)' : 'var(--chrome-text, #e7e9ee)',
                    border: 'none',
                    borderRadius: 0,
                    fontSize: 12.5,
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background 0.1s ease',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        opacity: isSelected ? 1 : 0.8,
                      }}
                    >
                      {opt.renderIcon()}
                    </span>
                    <span>{opt.label}</span>
                  </div>
                  {isSelected && <Check size={14} />}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
