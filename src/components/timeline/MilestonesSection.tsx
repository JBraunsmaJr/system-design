import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Diamond } from 'lucide-react';
import type { Milestone } from '../../domain/timeline/milestones';
import { getMilestoneColor, getMilestoneTypeLabel } from '../../domain/timeline/milestones';

interface MilestonesSectionProps {
  milestones: Milestone[];
  onSelectMilestone: (id: string) => void;
  onAddMilestone: () => void;
}

/**
 * The markers (milestones) above the board, as one strip of chips.
 *
 * They used to be a block of cards that took most of a screen before the
 * first sprint. A marker is a date, a kind and a name, which fits on a
 * chip; the rest is in its detail dialog, one click away.
 *
 * Not memoized: it re-renders with TimelineView, as it always has.
 */
export function MilestonesSection({
  milestones,
  onSelectMilestone,
  onAddMilestone,
}: MilestonesSectionProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <section className="milestones-section">
      <button
        type="button"
        className="milestones-section__collapse-toggle"
        onClick={() => setIsCollapsed(!isCollapsed)}
        aria-expanded={!isCollapsed}
        aria-label={isCollapsed ? 'Show markers' : 'Hide markers'}
      >
        {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        <Diamond size={13} className="milestones-section__icon" />
        <span className="milestones-section__title">Markers</span>
        <span
          className="milestones-section__count"
          title={`${milestones.length} marker${milestones.length === 1 ? '' : 's'}`}
        >
          {milestones.length}
        </span>
      </button>

      {!isCollapsed &&
        (milestones.length === 0 ? (
          <span className="milestones-section__empty">
            None yet. Markers place releases, deadlines and other dates on the timeline.
          </span>
        ) : (
          milestones.map((m) => {
            const color = getMilestoneColor(m);
            const typeLabel = getMilestoneTypeLabel(m.type);
            const relatedCount = m.relatedWorkableItemIds?.length ?? 0;
            return (
              <button
                key={m.id}
                type="button"
                className="milestones-section__chip"
                style={{ borderColor: `color-mix(in srgb, ${color} 55%, transparent)` }}
                onClick={() => onSelectMilestone(m.id)}
                title={`${typeLabel}: ${m.name} \u2022 Scheduled: ${m.scheduledAt}${relatedCount > 0 ? ` \u2022 ${relatedCount} related work item${relatedCount === 1 ? '' : 's'}` : ''}`}
              >
                <span className="milestones-section__chip-date">{m.scheduledAt}</span>
                <span className="milestones-section__chip-type" style={{ color }}>
                  {typeLabel}
                </span>
                <span className="milestones-section__chip-name">{m.name}</span>
                {m.version && (
                  <span className="milestones-section__chip-version">v{m.version}</span>
                )}
                {relatedCount > 0 && (
                  <span className="milestones-section__chip-count">{relatedCount}</span>
                )}
              </button>
            );
          })
        ))}

      <button
        type="button"
        className="milestones-section__add-btn"
        onClick={onAddMilestone}
        title="Create a new Marker"
      >
        <Plus size={12} />
        <span>Add Marker</span>
      </button>
    </section>
  );
}
