import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface PickerOption<T> {
  value: T;
  label: string;
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface BasePickerProps<T> {
  options: PickerOption<T>[];
  selectedValue: T;
  onSelect: (value: T) => void;
  trigger?: (selectedOption: PickerOption<T> | undefined, isOpen: boolean) => ReactNode;
  placeholder?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  className?: string;
  dropdownWidth?: number | string;
  disabled?: boolean;
}

/**
 * Reusable zero-dependency Picker / Select dropdown component.
 * Standardizes click-outside closing, keyboard navigation, and search filtering.
 */
export function BasePicker<T>({
  options,
  selectedValue,
  onSelect,
  trigger,
  placeholder = 'Select...',
  searchable = false,
  searchPlaceholder = 'Search...',
  className = '',
  dropdownWidth = '100%',
  disabled = false,
}: BasePickerProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === selectedValue);

  const filteredOptions = searchable && searchTerm.trim()
    ? options.filter((opt) =>
        opt.label.toLowerCase().includes(searchTerm.toLowerCase().trim()),
      )
    : options;

  const handleOpenToggle = () => {
    if (disabled) return;
    setIsOpen((prev) => {
      if (prev) {
        setSearchTerm('');
      }
      return !prev;
    });
  };

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearchTerm('');
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        setSearchTerm('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleSelect = (value: T, optDisabled?: boolean) => {
    if (optDisabled) return;
    onSelect(value);
    setIsOpen(false);
    setSearchTerm('');
  };

  return (
    <div
      ref={containerRef}
      className={`base-picker ${className}`.trim()}
      style={{ position: 'relative', display: 'inline-block' }}
    >
      <div
        onClick={handleOpenToggle}
        style={{ cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1 }}
      >
        {trigger ? (
          trigger(selectedOption, isOpen)
        ) : (
          <button
            type="button"
            className="base-picker__trigger"
            disabled={disabled}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 10px',
              borderRadius: 4,
              border: '1px solid var(--border, #2d3342)',
              background: 'var(--bg-input, #15181e)',
              color: 'var(--text, #e7e9ee)',
              fontSize: 13,
            }}
          >
            {selectedOption?.icon}
            <span>{selectedOption ? selectedOption.label : placeholder}</span>
          </button>
        )}
      </div>

      {isOpen && (
        <div
          className="base-picker__dropdown"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            zIndex: 1000,
            width: dropdownWidth,
            minWidth: 160,
            maxHeight: 240,
            overflowY: 'auto',
            background: 'var(--bg-panel, #1e222b)',
            border: '1px solid var(--border, #2d3342)',
            borderRadius: 6,
            boxShadow: '0 6px 16px rgba(0,0,0,0.4)',
            padding: 4,
          }}
        >
          {searchable && (
            <div style={{ padding: '4px 6px', borderBottom: '1px solid var(--border, #2d3342)' }}>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={searchPlaceholder}
                autoFocus
                style={{
                  width: '100%',
                  padding: '4px 6px',
                  fontSize: 12,
                  borderRadius: 4,
                  border: '1px solid var(--border, #2d3342)',
                  background: 'var(--bg-input, #15181e)',
                  color: 'var(--text, #e7e9ee)',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          )}
          <div style={{ padding: '2px 0' }}>
            {filteredOptions.length === 0 ? (
              <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text-dim, #8a919e)' }}>
                No options found
              </div>
            ) : (
              filteredOptions.map((opt, i) => {
                const isSelected = opt.value === selectedValue;
                return (
                  <div
                    key={i}
                    onClick={() => handleSelect(opt.value, opt.disabled)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 10px',
                      fontSize: 13,
                      borderRadius: 4,
                      cursor: opt.disabled ? 'not-allowed' : 'pointer',
                      opacity: opt.disabled ? 0.5 : 1,
                      background: isSelected ? 'var(--bg-active, #2a303c)' : 'transparent',
                      color: isSelected ? 'var(--accent, #63a4ff)' : 'var(--text, #e7e9ee)',
                    }}
                    onMouseEnter={(e) => {
                      if (!opt.disabled && !isSelected) {
                        e.currentTarget.style.background = 'var(--bg-hover, #242934)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!opt.disabled && !isSelected) {
                        e.currentTarget.style.background = 'transparent';
                      }
                    }}
                  >
                    {opt.icon}
                    <div style={{ flex: 1 }}>
                      <div>{opt.label}</div>
                      {opt.description && (
                        <div style={{ fontSize: 11, color: 'var(--text-dim, #8a919e)' }}>
                          {opt.description}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
