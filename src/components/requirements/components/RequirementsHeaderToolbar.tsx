import React from 'react';
import {
  ChevronDown,
  ChevronUp,
  ChevronsDownUp,
  ChevronsUpDown,
  Columns2,
  LayoutList,
  ListTree,
  Rows3,
  Search,
  Settings2,
  Tags,
  Waypoints,
  X,
} from 'lucide-react';
import { AddItemDropdown } from '../AddItemDropdown';
import type {
  RequirementItem,
  RequirementsDocument,
} from '../../../domain/requirements/requirementsTypes';
import type {
  RequirementsGroupBy,
  RequirementsLayout,
} from '../../../domain/requirements/requirementsViewPrefs';

export interface RequirementsHeaderToolbarProps {
  doc: RequirementsDocument;
  search: string;
  setSearch: (s: string) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  activeMatchItemId: string | null;
  setActiveMatchItemId: (id: string | null) => void;
  visibleItems: RequirementItem[];
  activeIndex: number;
  goToPrevMatch: () => void;
  goToNextMatch: () => void;
  handleSearchKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  groupBy: RequirementsGroupBy;
  setGroupBy: (g: RequirementsGroupBy) => void;
  layout: RequirementsLayout;
  setLayout: (l: RequirementsLayout) => void;
  itemCountsByType: Record<string, number>;
  onAddItem: (typeId: string) => void;
  onOpenManageTypes: () => void;
  onOpenManageRelationshipTypes: () => void;
  onCollapseAllCards: () => void;
  onExpandAllCards: () => void;
}

export function RequirementsHeaderToolbar({
  doc,
  search,
  setSearch,
  searchInputRef,
  setActiveMatchItemId,
  visibleItems,
  activeIndex,
  goToPrevMatch,
  goToNextMatch,
  handleSearchKeyDown,
  groupBy,
  setGroupBy,
  layout,
  setLayout,
  itemCountsByType,
  onAddItem,
  onOpenManageTypes,
  onOpenManageRelationshipTypes,
  onCollapseAllCards,
  onExpandAllCards,
}: RequirementsHeaderToolbarProps) {
  return (
    <div className="requirements-view__toolbar">
      <div className="requirements-view__toolbar-left">
        <AddItemDropdown
          itemTypes={doc.itemTypes}
          onAddItem={onAddItem}
          onOpenManageTypes={onOpenManageTypes}
          itemCountsByType={itemCountsByType}
        />
        <div className={`requirements-view__search-wrap${search.trim() ? ' has-query' : ''}`}>
          <Search size={13} className="requirements-view__search-icon" />
          <input
            ref={searchInputRef}
            className="requirements-view__search-input"
            placeholder="Search requirements..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (!e.target.value.trim()) {
                setActiveMatchItemId(null);
              }
            }}
            onKeyDown={handleSearchKeyDown}
          />
          {search.trim().length > 0 && (
            <div className="requirements-view__search-actions">
              <span className="requirements-view__search-counter">
                {visibleItems.length > 0
                  ? `${activeIndex + 1} of ${visibleItems.length}`
                  : '0 of 0'}
              </span>
              <button
                type="button"
                className="requirements-view__search-nav-btn"
                onClick={goToPrevMatch}
                onMouseDown={(e) => e.preventDefault()}
                disabled={visibleItems.length === 0}
                title="Previous match (Shift+Enter, Shift+F3)"
                aria-label="Previous match"
              >
                <ChevronUp size={13} />
              </button>
              <button
                type="button"
                className="requirements-view__search-nav-btn"
                onClick={goToNextMatch}
                onMouseDown={(e) => e.preventDefault()}
                disabled={visibleItems.length === 0}
                title="Next match (Enter, F3)"
                aria-label="Next match"
              >
                <ChevronDown size={13} />
              </button>
              <button
                type="button"
                className="requirements-view__search-clear"
                onClick={() => {
                  setSearch('');
                  setActiveMatchItemId(null);
                  searchInputRef.current?.focus();
                }}
                title="Clear search (Escape)"
                aria-label="Clear search"
              >
                <X size={12} />
              </button>
            </div>
          )}
          {search.length > 0 && search.trim().length === 0 && (
            <button
              type="button"
              className="requirements-view__search-clear"
              onClick={() => {
                setSearch('');
                setActiveMatchItemId(null);
              }}
              title="Clear search"
              aria-label="Clear search"
            >
              <X size={12} />
            </button>
          )}
        </div>
        {!search.trim() && doc.items.length > 0 && (
          <span className="requirements-view__count-badge">
            {doc.items.length} {doc.items.length === 1 ? 'item' : 'items'}
          </span>
        )}
      </div>

      <div className="requirements-view__toolbar-right">
        <div className="requirements-view__group-control">
          <span className="requirements-view__toolbar-label">Group:</span>
          <div className="requirements-view__group-toggle">
            <button
              type="button"
              className={groupBy === 'type' ? 'active' : undefined}
              aria-pressed={groupBy === 'type'}
              onClick={() => setGroupBy('type')}
              title="Group by item type"
            >
              <LayoutList size={12} />
              <span>Type</span>
            </button>
            <button
              type="button"
              className={groupBy === 'category' ? 'active' : undefined}
              aria-pressed={groupBy === 'category'}
              onClick={() => setGroupBy('category')}
              title="Group by category"
            >
              <Tags size={12} />
              <span>Category</span>
            </button>
            <button
              type="button"
              className={groupBy === 'epic' ? 'active' : undefined}
              aria-pressed={groupBy === 'epic'}
              onClick={() => setGroupBy('epic')}
              title="Group by epic, with each epic's children nested beneath it"
            >
              <ListTree size={12} />
              <span>Epic</span>
            </button>
          </div>
        </div>

        <div className="requirements-view__group-control">
          <span className="requirements-view__toolbar-label">View:</span>
          <div className="requirements-view__group-toggle">
            <button
              type="button"
              className={layout === 'list' ? 'active' : undefined}
              aria-pressed={layout === 'list'}
              onClick={() => setLayout('list')}
              title="One scrolling list of cards"
            >
              <Rows3 size={12} />
              <span>List</span>
            </button>
            <button
              type="button"
              className={layout === 'split' ? 'active' : undefined}
              aria-pressed={layout === 'split'}
              onClick={() => setLayout('split')}
              title="An outline on the left, the open item and its children on the right"
            >
              <Columns2 size={12} />
              <span>Split</span>
            </button>
          </div>
          <div className="requirements-view__group-toggle">
            <button
              type="button"
              onClick={onCollapseAllCards}
              title="Collapse all cards to their headers"
              aria-label="Collapse all cards"
            >
              <ChevronsDownUp size={12} />
            </button>
            <button
              type="button"
              onClick={onExpandAllCards}
              title="Expand all cards and show every epic's children"
              aria-label="Expand all cards"
            >
              <ChevronsUpDown size={12} />
            </button>
          </div>
        </div>

        <div className="requirements-view__toolbar-divider" />

        <div className="requirements-view__manage-group">
          <button
            type="button"
            className="requirements-view__manage-btn"
            onClick={onOpenManageTypes}
            title="Manage requirement types"
          >
            <Settings2 size={13} />
            <span>Types</span>
          </button>
          <button
            type="button"
            className="requirements-view__manage-btn"
            onClick={onOpenManageRelationshipTypes}
            title="Manage relationship types"
          >
            <Waypoints size={13} />
            <span>Relationships</span>
          </button>
        </div>
      </div>
    </div>
  );
}
