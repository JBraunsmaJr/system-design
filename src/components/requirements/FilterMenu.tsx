import {useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Check, ChevronDown} from 'lucide-react';
import {useOutsideClick} from '../../common/hooks/useOutsideClick';
import {usePositionedDropdown} from '../../common/hooks/usePositionedDropdown';
import type {FilterMenuOption} from '../../domain/requirements/requirementsFilterOptions';

interface FilterMenuProps {
    label: string;
    options: FilterMenuOption[];
    selected: readonly string[];
    onToggle: (value: string) => void;
    onClear: () => void;
    /** Shown instead of the list when there's nothing to pick from. */
    emptyText?: string;
}

const DROPDOWN_WIDTH = 230;

/**
 * One filter dimension as a button that opens a checklist. The button
 * names what's chosen ("Status: To Do", "Sprint: 3 selected"), so the
 * whole filter can be read off the bar without opening anything. Same
 * portal + flip positioning as the item pickers.
 */
export function FilterMenu({
                               label,
                               options,
                               selected,
                               onToggle,
                               onClear,
                               emptyText = 'Nothing to filter by yet.',
                           }: FilterMenuProps) {
    const [isOpen, setIsOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const {position} = usePositionedDropdown({triggerRef, dropdownRef, isOpen});
    useOutsideClick({
        refs: [triggerRef, dropdownRef],
        isOpen,
        onClose: () => setIsOpen(false),
    });

    const chosen = options.filter((o) => selected.includes(o.value));
    // A value can be selected without being offered any more (a deleted
    // sprint, a tag no item has now) - still counted, so it can be cleared.
    const count = selected.length;
    const summary =
        count === 0
            ? 'Any'
            : count === 1 && chosen.length === 1
                ? chosen[0].label
                : `${count} selected`;

    return (
        <div className="filter-menu">
            <button
                ref={triggerRef}
                type="button"
                className={`filter-menu__trigger${count > 0 ? ' is-active' : ''}`}
                onClick={() => setIsOpen((prev) => !prev)}
                aria-expanded={isOpen}
                aria-haspopup="true"
                aria-label={`Filter by ${label.toLowerCase()}: ${summary}`}
            >
                <span className="filter-menu__label">{label}:</span>
                <span className="filter-menu__summary">{summary}</span>
                <ChevronDown size={11} className="filter-menu__chevron"/>
            </button>
            {isOpen &&
                position &&
                createPortal(
                    <div
                        ref={dropdownRef}
                        className="filter-menu__dropdown"
                        role="group"
                        aria-label={`Filter by ${label.toLowerCase()}`}
                        style={{
                            position: 'fixed',
                            top: position.top,
                            left: position.left,
                            width: DROPDOWN_WIDTH,
                        }}
                    >
                        {options.length === 0 ? (
                            <p className="filter-menu__empty">{emptyText}</p>
                        ) : (
                            <div className="filter-menu__options">
                                {options.map((option) => {
                                    const isOn = selected.includes(option.value);
                                    return (
                                        <button
                                            key={option.value}
                                            type="button"
                                            role="menuitemcheckbox"
                                            aria-checked={isOn}
                                            className={`filter-menu__option${isOn ? ' is-selected' : ''}`}
                                            onClick={() => onToggle(option.value)}
                                        >
                      <span className="filter-menu__check" aria-hidden>
                        {isOn && <Check size={11}/>}
                      </span>
                                            {option.color && (
                                                <span
                                                    className="filter-menu__swatch"
                                                    style={{background: option.color}}
                                                    aria-hidden
                                                />
                                            )}
                                            <span className="filter-menu__option-text">
                        <span className="filter-menu__option-label">{option.label}</span>
                                                {option.detail && (
                                                    <span className="filter-menu__option-detail">{option.detail}</span>
                                                )}
                      </span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                        {count > 0 && (
                            <button type="button" className="filter-menu__clear" onClick={onClear}>
                                Clear {label.toLowerCase()} filter
                            </button>
                        )}
                    </div>,
                    document.body,
                )}
        </div>
    );
}
