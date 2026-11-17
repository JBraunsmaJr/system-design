import { Palmtree, Plus, Trash2 } from 'lucide-react';
import { initials } from '../../common/utils/string';
import type { TeamMember } from '../../domain/timeline/teamTypes';
import { calculateTotalPtoDays } from '../../domain/timeline/teamCapacity';

interface TeamMemberCardProps {
  member: TeamMember;
  /** The team-wide rate, shown as the placeholder when the member has no
   * rate of their own. */
  defaultPointsPerDay: number;
  onUpdate: (patch: Partial<TeamMember>) => void;
  onDelete: () => void;
  /** Opens the time-off dialog for this member. */
  onAddPto: () => void;
  onDeletePto: (ptoSpanId: string) => void;
}

/**
 * One team member: name, role, capacity rate and time off.
 *
 * Moved unchanged out of TeamView.tsx, which had grown past a thousand
 * lines; the only edits are the callbacks, which no longer need the
 * member's id passed back to them.
 */
export function TeamMemberCard({
  member,
  defaultPointsPerDay,
  onUpdate,
  onDelete,
  onAddPto,
  onDeletePto,
}: TeamMemberCardProps) {
  const totalPto = calculateTotalPtoDays(member);

  return (
    <div className="team-member-card">
      <div className="team-member-card__header">
        <div className="team-member-card__identity">
          <span
            className="team-member-card__avatar"
            style={{ backgroundColor: member.avatarColor ?? '#5b7cfa' }}
          >
            {initials(member.name)}
          </span>
          <div>
            <input
              className="team-member-card__name-input"
              value={member.name}
              onChange={(e) => onUpdate({ name: e.target.value })}
            />
            <input
              className="team-member-card__role-input"
              placeholder="Add role..."
              value={member.role ?? ''}
              onChange={(e) => onUpdate({ role: e.target.value || undefined })}
            />
          </div>
        </div>

        <button
          type="button"
          className="team-member-card__delete-btn"
          onClick={() => onDelete()}
          title={`Remove ${member.name}`}
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Points / Rate Settings */}
      <div className="team-member-card__rate-row">
        <span className="team-member-card__rate-label">Capacity Rate:</span>
        <div className="team-member-card__rate-control">
          <input
            type="number"
            step="0.1"
            min="0"
            max="50"
            className="team-member-card__rate-input"
            value={member.defaultPointsPerDay ?? ''}
            placeholder={`${defaultPointsPerDay}`}
            onChange={(e) => {
              const val = e.target.value.trim();
              onUpdate({
                defaultPointsPerDay: val !== '' ? parseFloat(val) : undefined,
              });
            }}
          />
          <span className="team-member-card__rate-unit">pts/day</span>
        </div>
        <span className="team-member-card__pto-total-badge" title="Total PTO days across all spans">
          <Palmtree size={12} /> {totalPto}
        </span>
      </div>

      {/* PTO Spans List */}
      <div className="team-member-card__pto-section">
        <div className="team-member-card__pto-header">
          <span className="team-member-card__pto-title">
            <Palmtree size={13} />
            <span>PTO Spans ({member.ptoSpans.length})</span>
          </span>
          <button
            type="button"
            className="team-member-card__add-pto-btn"
            onClick={() => onAddPto()}
          >
            <Plus size={12} /> Add PTO
          </button>
        </div>

        {member.ptoSpans.length === 0 ? (
          <div className="team-member-card__pto-empty">No PTO scheduled</div>
        ) : (
          <div className="team-member-card__pto-list">
            {member.ptoSpans.map((span) => {
              const isSingle = span.startDate === span.endDate;
              const isHalf =
                isSingle && (span.startHalfDay === 'morning' || span.startHalfDay === 'afternoon');

              return (
                <div key={span.id} className="pto-span-chip">
                  <div className="pto-span-chip__info">
                    <div className="pto-span-chip__dates">
                      {isSingle ? (
                        <span>{span.startDate}</span>
                      ) : (
                        <span>
                          {span.startDate} → {span.endDate}
                        </span>
                      )}
                      <span
                        className={`pto-span-chip__badge${
                          isHalf || span.startHalfDay !== 'full' || span.endHalfDay !== 'full'
                            ? ' is-half'
                            : ''
                        }`}
                      >
                        {isSingle
                          ? span.startHalfDay === 'morning'
                            ? 'AM (0.5d)'
                            : span.startHalfDay === 'afternoon'
                              ? 'PM (0.5d)'
                              : 'Full Day (1d)'
                          : `${
                              span.startHalfDay === 'afternoon' ? 'Start PM • ' : ''
                            }${span.endHalfDay === 'morning' ? 'End AM' : 'Full'}`}
                      </span>
                    </div>
                    {span.note && (
                      <div className="pto-span-chip__note" title={span.note}>
                        {span.note}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="pto-span-chip__remove"
                    onClick={() => onDeletePto(span.id)}
                    title="Delete PTO span"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
