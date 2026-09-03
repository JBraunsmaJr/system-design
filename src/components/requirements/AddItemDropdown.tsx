import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Plus, Search, Settings2 } from "lucide-react";
import type { RequirementItemType } from "../../domain/requirementsTypes";

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
  const [filterQuery, setFilterQuery] = useState("");
  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Keep active type synced if types change or on initial render
  const activeType = itemTypes.find((t) => t.id === selectedTypeId) ?? itemTypes[0];

  const close = useCallback(() => {
    setIsOpen(false);
    setFilterQuery("");
    setDropdownPos(null);
  }, []);

  const open = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    // Initial guess
    setDropdownPos({ top: rect.bottom + 4, left: Math.max(8, rect.left) });
    setIsOpen(true);
  }, []);

  // Sync position using popover flip logic
  useLayoutEffect(() => {
    if (!isOpen || !containerRef.current || !dropdownRef.current) return;
    const container = containerRef.current.getBoundingClientRect();
    const dropdown = dropdownRef.current.getBoundingClientRect();

    const left = Math.max(8, Math.min(container.left, window.innerWidth - dropdown.width - 8));
    const spaceBelow = window.innerHeight - container.bottom;
    const spaceAbove = container.top;

    let top: number;
    if (spaceBelow >= dropdown.height + 4 || spaceBelow >= spaceAbove) {
      top = container.bottom + 4;
    } else {
      top = Math.max(8, container.top - dropdown.height - 4);
    }

    setDropdownPos({ top, left });
  }, [isOpen, filterQuery]);

  // Focus search when dropdown opens if there are many types
  useEffect(() => {
    if (isOpen && itemTypes.length > 5) {
      searchInputRef.current?.focus();
    }
  }, [isOpen, itemTypes.length]);

  // Handle outside click & escape key
  useEffect(() => {
    if (!isOpen) return;

    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target) || dropdownRef.current?.contains(target)) {
        return;
      }
      close();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
      }
    };

    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, close]);

  const handleQuickAdd = () => {
    if (activeType) {
      onAddItem(activeType.id);
    } else if (itemTypes.length > 0) {
      onAddItem(itemTypes[0].id);
    }
  };

  const handleSelectType = (typeId: string) => {
    setSelectedTypeId(typeId);
    onAddItem(typeId);
    close();
  };

  const filteredTypes = itemTypes.filter((t) => {
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
          title={activeType ? `Add new ${activeType.label} [${activeType.prefix}]` : "Add requirement"}
        >
          <Plus size={14} />
          <span>New {activeType?.label ?? "Requirement"}</span>
        </button>
        <button
          type="button"
          className={`add-item-dropdown__toggle-btn ${isOpen ? "is-open" : ""}`}
          onClick={() => (isOpen ? close() : open())}
          aria-expanded={isOpen}
          title="Choose requirement type to add"
        >
          <ChevronDown size={13} />
        </button>
      </div>

      {isOpen &&
        dropdownPos &&
        createPortal(
          <div
            ref={dropdownRef}
            className="add-item-dropdown__menu"
            style={{
              position: "fixed",
              top: `${dropdownPos.top}px`,
              left: `${dropdownPos.left}px`,
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
                    className={`add-item-dropdown__item ${type.id === activeType?.id ? "is-active" : ""}`}
                    onClick={() => handleSelectType(type.id)}
                  >
                    <span className="add-item-dropdown__swatch" style={{ background: type.color }} />
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
          document.body
        )}
    </div>
  );
}
