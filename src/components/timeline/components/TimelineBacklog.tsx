import { useRef, useState, type DragEvent } from 'react';
import { ChevronDown, ChevronRight, Inbox } from 'lucide-react';
import type {
  RequirementItem,
  RequirementsDocument,
} from '../../../domain/requirements/requirementsTypes';
import type { TeamDocument } from '../../../domain/timeline/teamTypes';
import { getItemType, isItemWorkable } from '../../../domain/requirements/requirementsRegistry';
import { MemberPicker } from '../../team/MemberPicker';
import { PointsPicker } from '../../team/PointsPicker';

export interface TimelineBacklogProps {
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
}

export function TimelineBacklog({
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
}: TimelineBacklogProps) {
  const [internalIsDragOver, setIsDragOver] = useState(false);
  const isDragOver = Boolean(draggedItemId) && internalIsDragOver;
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [query, setQuery] = useState('');
  const dragCounter = useRef(0);

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    dragCounter.current += 1;
    setIsDragOver(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDragOver(false);
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: DragEvent) => {
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

  return (
    <section className="backlog-section">
      <div className="backlog-section__header">
        <button
          type="button"
          className="backlog-section__collapse-toggle"
          onClick={() => setIsCollapsed(!isCollapsed)}
          aria-label={isCollapsed ? 'Expand backlog' : 'Collapse backlog'}
        >
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
        <Inbox size={14} className="backlog-section__icon" />
        <span className="backlog-section__title">Backlog</span>
        <span
          className="backlog-section__count"
          title={`${items.length} unassigned item${items.length === 1 ? '' : 's'}`}
        >
          {items.length}
        </span>
        {!isCollapsed && (
          <>
            <input
              className="backlog-section__search"
              placeholder="Search backlog..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <span className="backlog-section__hint">Drag into a sprint below to schedule it</span>
          </>
        )}
      </div>
      {!isCollapsed && (
        <div
          className={`backlog-section__items${isDragOver ? ' is-drag-over' : ''}`}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {filteredItems.length === 0 ? (
            <p className="backlog-section__empty">No backlog items match criteria.</p>
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
                  className={`pi-board-item backlog-section__item${isDragging ? ' is-dragging' : ''}${isBlocker ? ' is-blocker-highlight' : ''}`}
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
      )}
    </section>
  );
}
