import { Fragment, type ReactNode, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { useOutsideClick } from '../../common/hooks/useOutsideClick';
import { usePositionedDropdown } from '../../common/hooks/usePositionedDropdown';

export interface MenuOption {
  id: string;
  label: string;
  /** Colors the option and, when chosen, the trigger. */
  color?: string;
  /** Shown as the option's tooltip. */
  description?: string;
  /** A heading the option sits under ("PI 1" over its sprints). Options
   * sharing a group must be adjacent. */
  group?: string;
}

interface MenuPickerProps {
  /** What this menu sets, for screen readers and the tooltip: "Priority". */
  label: string;
  /** The chosen option's id; '' or an unknown id shows the placeholder. */
  value: string;
  options: readonly MenuOption[];
  onChange: (id: string) => void;
  /** Shown on the trigger when nothing is chosen. */
  placeholder: string;
  /** An icon ahead of the label. */
  icon?: ReactNode;
  width?: number;
  disabled?: boolean;
  /** Replaces the tooltip - for saying why the menu is disabled. */
  title?: string;
}

/**
 * A one-of-several menu in the look every other picker on an item has (the
 * `status-picker` classes StatusPicker and DecisionStatusPicker use):
 * a pill showing the choice, opening a list in a portal. Used throughout
 * the Requirements view in place of the browser's own menu. With `value`
 * left empty it is an action menu: the trigger always shows the
 * placeholder, and choosing an option does something rather than setting
 * a value (the bulk edit bar).
 */
export function MenuPicker({
  label,
  value,
  options,
  onChange,
  placeholder,
  icon,
  width = 180,
  disabled = false,
  title,
}: MenuPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const chosen = options.find((o) => o.id === value);

  const { position } = usePositionedDropdown({ triggerRef, dropdownRef, isOpen });
  useOutsideClick({ refs: [triggerRef, dropdownRef], isOpen, onClose: () => setIsOpen(false) });

  return (
    <div className="status-picker" onClick={(e) => e.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        className={`status-picker__trigger${chosen ? '' : ' is-unset'}`}
        style={
          chosen?.color ? { color: chosen.color, borderColor: `${chosen.color}66` } : undefined
        }
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={`${label}: ${chosen?.label ?? placeholder}`}
        title={
          title ??
          (chosen?.description ? `${label}: ${chosen.label} - ${chosen.description}` : label)
        }
        disabled={disabled}
        onClick={() => setIsOpen((open) => !open)}
      >
        {icon}
        <span>{chosen?.label ?? placeholder}</span>
        <ChevronDown size={10} className="status-picker__chevron" />
      </button>

      {isOpen &&
        position &&
        createPortal(
          <div
            ref={dropdownRef}
            className="status-picker__dropdown"
            role="menu"
            style={{ position: 'fixed', top: position.top, left: position.left, width }}
          >
            {options.map((option, index) => (
              <Fragment key={option.id}>
                {option.group !== undefined && option.group !== options[index - 1]?.group && (
                  <div className="status-picker__heading">{option.group}</div>
                )}
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={option.id === value}
                  className={`status-picker__option${option.id === value ? ' is-selected' : ''}`}
                  style={{ color: option.color ?? 'var(--chrome-text)' }}
                  title={option.description}
                  onClick={() => {
                    onChange(option.id);
                    setIsOpen(false);
                  }}
                >
                  {option.label}
                </button>
              </Fragment>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
