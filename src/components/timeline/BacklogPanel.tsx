import { useEffect, useState, useRef } from 'react';
import { ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import { getItemType, isItemWorkable } from '../../domain/requirements/requirementsRegistry';
import type {
  RequirementItem,
  RequirementsDocument,
} from '../../domain/requirements/requirementsTypes';
import type { TeamDocument } from '../../domain/timeline/teamTypes';
import { MemberPicker } from '../team/MemberPicker';
import { PointsPicker } from '../team/PointsPicker';

interface BacklogPanelProps {
  items: RequirementItem[];
  requirements: RequirementsDocument;
  team?: TeamDocument;
  draggedItemId: string | null;
  blockingItemIds?: Set<string>;
  parentEpicByItemId?: Map<string, RequirementItem>;
  filteredChildItemIds?: Set<string> | null;
  onSelectItem: (itemId: string) => void;
  onDragStartItem: (itemId: string) => void;
  onDragEndItem: () => void;
  onDropItem: (itemId: string) => void;
  onUpdateItem: (id: string, patch: Partial<RequirementItem>) => void;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
}

/**
 * The backlog: every workable item with no sprint, as a column beside the
 * sprints.
 *
 * It used to be a wrapping strip above the program increments, which put
 * the things being dragged a screen away from where they were dropped. As
 * a column it stays next to every sprint however far the board scrolls,
 * and folds down to a narrow rail when the space is wanted for sprints.
 *
 * The whole column is the drop target, folded or not: dropping a card here
 * takes it out of its sprint. That is also why it renders with nothing in
 * it - with every item scheduled there would otherwise be nowhere to drop
 * one to unschedule it.
 *
 * Search and internal scrolling are there for large backlogs (100+ items
 * is not unusual). The drag bookkeeping (counter-based enter/leave,
 * dataTransfer with a state fallback) mirrors SprintBoardColumn's.
 *
 * Not memoized: it re-renders with TimelineView, as it always has.
 */
export function BacklogPanel({
  items,
  requirements,
  team,
  draggedItemId,
  blockingItemIds,
  parentEpicByItemId,
  filteredChildItemIds,
  onSelectItem,
  onDragStartItem,
  onDragEndItem,
  onDropItem,
  onUpdateItem,
  isCollapsed,
  onToggleCollapsed,
}: BacklogPanelProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [query, setQuery] = useState('');
  const dragCounter = useRef(0);

  useEffect(() => {
    if (!draggedItemId) {
      dragCounter.current = 0;
      setIsDragOver(false);
    }
  }, [draggedItemId]);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current += 1;
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDragOver(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragOver(false);
    onDragEndItem();
    const itemId = e.dataTransfer.getData('text/plain') || draggedItemId;
    if (itemId) {
      onDropItem(itemId);
    }
  };

  const q = query.trim().toLowerCase();
  const filteredItems = items.filter((item) => {
    if (filteredChildItemIds && !filteredChildItemIds.has(item.id)) return false;
    if (q === '') return true;
    return item.id.toLowerCase().includes(q) || item.title.toLowerCase().includes(q);
  });

  const countLabel = `${items.length} unscheduled item${items.length === 1 ? '' : 's'}`;
  const dropHandlers = {
    onDragEnter: handleDragEnter,
    onDragLeave: handleDragLeave,
    onDragOver: handleDragOver,
    onDrop: handleDrop,
  };

  if (isCollapsed) {
    return (
      <aside
        className={`backlog-panel is-collapsed${isDragOver ? ' is-drag-over' : ''}`}
        aria-label="Backlog"
        {...dropHandlers}
      >
        <button
          type="button"
          className="backlog-panel__rail"
          onClick={onToggleCollapsed}
          aria-expanded={false}
          aria-label={`Expand backlog (${countLabel})`}
          title={`Backlog - ${countLabel}. Drop a card here to unschedule it.`}
        >
          <ChevronRight size={14} />
          <Inbox size={14} />
          <span className="backlog-panel__count">{items.length}</span>
          <span className="backlog-panel__rail-label">Backlog</span>
        </button>
      </aside>
    );
  }

  return (
    <aside
      className={`backlog-panel${isDragOver ? ' is-drag-over' : ''}`}
      aria-label="Backlog"
      {...dropHandlers}
    >
      <div className="backlog-panel__header">
        <Inbox size={14} className="backlog-panel__icon" />
        <span className="backlog-panel__title">Backlog</span>
        <span className="backlog-panel__count" title={countLabel}>
          {items.length}
        </span>
        <button
          type="button"
          className="backlog-panel__collapse-toggle"
          onClick={onToggleCollapsed}
          aria-expanded={true}
          aria-label="Collapse backlog"
          title="Collapse backlog"
        >
          <ChevronLeft size={14} />
        </button>
      </div>
      <input
        className="backlog-panel__search"
        placeholder="Search backlog..."
        aria-label="Search backlog"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <p className="backlog-panel__hint">
        Drag a card into a sprint to schedule it. Drop one here to unschedule it.
      </p>
      <div className="backlog-panel__items">
        {filteredItems.length === 0 ? (
          <p className="backlog-panel__empty">
            {items.length === 0 ? 'Everything is scheduled.' : 'No backlog items match.'}
          </p>
        ) : (
          filteredItems.map((item) => {
            const type = getItemType(requirements, item.typeId);
            const category = item.categoryId
              ? requirements.categories.find((c) => c.id === item.categoryId)
              : undefined;
            const isDragging = draggedItemId === item.id;
            const isBlocker = blockingItemIds?.has(item.id);
            const parentEpic = parentEpicByItemId?.get(item.id);
            return (
              <div
                key={item.id}
                className={`pi-board-item backlog-panel__item${isDragging ? ' is-dragging' : ''}${isBlocker ? ' is-blocker-highlight' : ''}`}
                draggable={true}
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', item.id);
                  e.dataTransfer.effectAllowed = 'move';
                  requestAnimationFrame(() => onDragStartItem(item.id));
                }}
                onDragEnd={() => onDragEndItem()}
                onClick={() => onSelectItem(item.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectItem(item.id);
                  }
                }}
                title="Click to view description • Drag into a sprint to schedule it"
              >
                <div className="pi-board-item__header">
                  <span
                    className="pi-board-item__id"
                    style={{
                      color: type?.color ?? 'var(--chrome-text-dim)',
                      borderColor: `${type?.color ?? 'var(--chrome-border)'}66`,
                    }}
                  >
                    {item.id}
                  </span>
                  {parentEpic && (
                    <span
                      className="pi-board-item__epic-badge"
                      title={`Epic: ${parentEpic.id} ${parentEpic.title || ''}`}
                    >
                      {parentEpic.id}
                    </span>
                  )}
                  {isBlocker && (
                    <span
                      className="pi-board-item__blocker-badge"
                      title="Blocks the item currently being dragged"
                    >
                      Blocker
                    </span>
                  )}
                  {category && (
                    <span
                      className="pi-board-item__category"
                      style={{
                        color: category.color,
                        borderColor: `${category.color}44`,
                        background: `${category.color}18`,
                      }}
                    >
                      {category.label}
                    </span>
                  )}
                </div>
                <div className="pi-board-item__title">{item.title || 'Untitled'}</div>
                <div className="pi-board-item__footer">
                  {team && isItemWorkable(requirements, item) && (
                    <MemberPicker
                      team={team}
                      assigneeId={item.assigneeId}
                      compact={true}
                      onAssign={(assigneeId) => onUpdateItem(item.id, { assigneeId })}
                      onClear={() => onUpdateItem(item.id, { assigneeId: undefined })}
                    />
                  )}
                  {isItemWorkable(requirements, item) && (
                    <PointsPicker
                      points={item.points}
                      compact={true}
                      onChange={(points) => onUpdateItem(item.id, { points })}
                    />
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
