import { useState } from 'react';
import { ChevronDown, ChevronRight, Diamond, Plus } from 'lucide-react';
import type { Milestone } from '../../../domain/timeline/milestones';
import { getMilestoneColor, getMilestoneTypeLabel } from '../../../domain/timeline/milestones';

export interface MilestoneSummaryBarProps {
  milestones: Milestone[];
  onSelectMilestone: (id: string) => void;
  onAddMilestone: () => void;
}

export function MilestoneSummaryBar({
  milestones,
  onSelectMilestone,
  onAddMilestone,
}: MilestoneSummaryBarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <section className="milestones-section">
      <div className="milestones-section__header">
        <button
          type="button"
          className="milestones-section__collapse-toggle"
          onClick={() => setIsCollapsed(!isCollapsed)}
          aria-label={isCollapsed ? 'Expand markers' : 'Collapse markers'}
        >
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
        <Diamond size={14} className="milestones-section__icon" />
        <span className="milestones-section__title">Markers</span>
        <span
          className="milestones-section__count"
          title={`${milestones.length} marker${milestones.length === 1 ? '' : 's'}`}
        >
          {milestones.length}
        </span>
        <button
          type="button"
          className="milestones-section__add-btn"
          onClick={onAddMilestone}
          title="Create a new Marker"
        >
          <Plus size={12} />
          <span>Add Marker</span>
        </button>
      </div>

      {!isCollapsed && (
        <div className="milestones-section__items">
          {milestones.length === 0 ? (
            <p className="milestones-section__empty">
              No markers scheduled yet. Click <strong>Add Marker</strong> to place point-in-time
              outcomes on the timeline.
            </p>
          ) : (
            milestones.map((m) => {
              const color = getMilestoneColor(m);
              const typeLabel = getMilestoneTypeLabel(m.type);
              const relatedCount = m.relatedWorkableItemIds?.length ?? 0;
              return (
                <button
                  key={m.id}
                  type="button"
                  className="milestones-section__card"
                  style={{ borderLeftColor: color }}
                  onClick={() => onSelectMilestone(m.id)}
                  title={`${typeLabel}: ${m.name} \u2022 Scheduled: ${m.scheduledAt}${relatedCount > 0 ? ` \u2022 ${relatedCount} related work item${relatedCount === 1 ? '' : 's'}` : ''}`}
                >
                  <div className="milestones-section__card-header">
                    <span className="milestones-section__card-shape" style={{ color }}>
                      ◆
                    </span>
                    <span className="milestones-section__card-type" style={{ color }}>
                      {typeLabel}
                    </span>
                    {m.version && (
                      <span className="milestones-section__card-version">v{m.version}</span>
                    )}
                  </div>
                  <div className="milestones-section__card-name">{m.name}</div>
                  <div className="milestones-section__card-footer">
                    <span className="milestones-section__card-date">{m.scheduledAt}</span>
                    {relatedCount > 0 && (
                      <span className="milestones-section__card-work-badge">
                        {relatedCount} {relatedCount === 1 ? 'item' : 'items'}
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}
    </section>
  );
}
