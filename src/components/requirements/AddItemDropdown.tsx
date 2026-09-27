import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Plus, Search, Settings2 } from 'lucide-react';
import { useOutsideClick } from '../../common/hooks/useOutsideClick';
import { usePositionedDropdown } from '../../common/hooks/usePositionedDropdown';
import type { RequirementItemType } from '../../domain/requirements/requirementsTypes';

interface AddItemDropdownProps {
  itemTypes: RequirementItemType[];
  onAddItem: (typeId: string) => void;
  onOpenManageTypes: () => void;
  itemCountsByType?: Record<string, number>;
}

const DROPDOWN_WIDTH = 260;

export function AddItemDropdown({
  itemTypes,
  onAddItem,
  onOpenManageTypes,
  itemCountsByType = {},
}: AddItemDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');
  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const uniqueItemTypes = useMemo(() => {
    const seen = new Set<string>();
    return itemTypes.filter((t) => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
  }, [itemTypes]);

  // Keep active type synced if types change or on initial render
  const activeType = uniqueItemTypes.find((t) => t.id === selectedTypeId) ?? uniqueItemTypes[0];

  const close = useCallback(() => {
    setIsOpen(false);
    setFilterQuery('');
  }, []);

  const { position: dropdownPos } = usePositionedDropdown({
    triggerRef: containerRef,
    dropdownRef,
    isOpen,
  });

  useOutsideClick({
    refs: [containerRef, dropdownRef],
    isOpen,
    onClose: close,
  });

  // Focus search when dropdown opens if there are many types
  useEffect(() => {
    if (isOpen && uniqueItemTypes.length > 5) {
      searchInputRef.current?.focus();
    }
  }, [isOpen, uniqueItemTypes.length]);

  const handleQuickAdd = () => {
    if (activeType) {
      onAddItem(activeType.id);
    } else if (uniqueItemTypes.length > 0) {
      onAddItem(uniqueItemTypes[0].id);
    }
  };

  const handleSelectType = (typeId: string) => {
    setSelectedTypeId(typeId);
    onAddItem(typeId);
    close();
  };

  const filteredTypes = uniqueItemTypes.filter((t) => {
    if (!filterQuery.trim()) return true;
    const q = filterQuery.toLowerCase();
    return t.label.toLowerCase().includes(q) || t.prefix.toLowerCase().includes(q);
  });

  return (
    <div className="add-item-dropdown" ref={containerRef}>
      <div className="add-item-dropdown__split-button">
        <button
          type="button"
          className="add-item-dropdown__primary-btn"
          onClick={handleQuickAdd}
          title={
            activeType ? `Add new ${activeType.label} [${activeType.prefix}]` : 'Add requirement'
          }
        >
          <Plus size={14} />
          <span className="add-item-dropdown__primary-label">
            New {activeType?.label ?? 'Requirement'}
          </span>
        </button>
        <button
          type="button"
          className={`add-item-dropdown__toggle-btn ${isOpen ? 'is-open' : ''}`}
          onClick={() => setIsOpen((prev) => !prev)}
          aria-expanded={isOpen}
          aria-label="Choose requirement type to add"
          title="Choose requirement type to add"
        >
          <ChevronDown size={13} />
        </button>
      </div>

      {isOpen &&
        createPortal(
          <div
            ref={dropdownRef}
            className="add-item-dropdown__menu"
            style={{
              position: 'fixed',
              top: `${dropdownPos?.top ?? 0}px`,
              left: `${dropdownPos?.left ?? 0}px`,
              width: `${DROPDOWN_WIDTH}px`,
            }}
          >
            {itemTypes.length > 5 && (
              <div className="add-item-dropdown__search-wrap">
                <Search size={12} className="add-item-dropdown__search-icon" />
                <input
                  ref={searchInputRef}
                  className="add-item-dropdown__search-input"
                  placeholder="Filter types..."
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                />
              </div>
            )}

            <div className="add-item-dropdown__menu-header">Select Requirement Type</div>

            <div className="add-item-dropdown__list">
              {filteredTypes.map((type) => {
                const count = itemCountsByType[type.id] ?? 0;
                return (
                  <button
                    key={type.id}
                    type="button"
                    className={`add-item-dropdown__item ${type.id === activeType?.id ? 'is-active' : ''}`}
                    onClick={() => handleSelectType(type.id)}
                  >
                    <span
                      className="add-item-dropdown__swatch"
                      style={{ background: type.color }}
                    />
                    <span className="add-item-dropdown__item-label">{type.label}</span>
                    <span className="add-item-dropdown__item-prefix">[{type.prefix}]</span>
                    {count > 0 && <span className="add-item-dropdown__item-count">{count}</span>}
                  </button>
                );
              })}

              {filteredTypes.length === 0 && (
                <p className="add-item-dropdown__empty">No matching requirement types</p>
              )}
            </div>

            <div className="add-item-dropdown__footer">
              <button
                type="button"
                className="add-item-dropdown__manage-btn"
                onClick={() => {
                  close();
                  onOpenManageTypes();
                }}
              >
                <Settings2 size={12} />
                <span>Manage Types...</span>
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
