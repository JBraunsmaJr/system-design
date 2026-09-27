import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Users,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  ShieldAlert,
} from 'lucide-react';
import { useOutsideClick } from '../../common/hooks/useOutsideClick';
import { usePositionedDropdown } from '../../common/hooks/usePositionedDropdown';
import type { SprintCapacitySummary } from '../../domain/timeline/teamTypes';

interface SprintCapacityBarProps {
  summary: SprintCapacitySummary;
  compact?: boolean;
}

/**
 * The expanded member breakdown portals to document.body instead of
 * expanding inline. It used to push the sprint column's item list
 * further down the page every time it opened - with enough team members,
 * that meant scrolling past a tall breakdown just to see the actual
 * stories, and on a narrow viewport there wasn't a height cap that didn't
 * eventually eat into that same problem. A capped height with its own
 * scroll (tried first) bounds how tall the inline content gets, but the
 * items list still has to make room for the header size, whatever it is.
 * The only fix that keeps the items list's position completely
 * unaffected by whether the breakdown is open is to take the breakdown
 * out of the column's layout flow entirely - same portal + flip-
 * positioning approach as every other dropdown in this app (see
 * CategoryPicker for the full reasoning), which also sidesteps
 * .pi-board-column's own overflow:hidden clipping a plain
 * position:absolute overlay would otherwise risk for a short column.
 */
export function SprintCapacityBar({ summary, compact = false }: SprintCapacityBarProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const breakdownRef = useRef<HTMLDivElement>(null);

  const close = () => setIsExpanded(false);

  const { position: breakdownPos } = usePositionedDropdown({
    triggerRef,
    dropdownRef: breakdownRef,
    isOpen: isExpanded,
  });

  useOutsideClick({
    refs: [triggerRef, breakdownRef],
    isOpen: isExpanded,
    onClose: close,
  });

  const {
    grossCapacityPoints = summary.totalCapacityPoints,
    totalReservedPoints = 0,
    totalCapacityPoints,
    totalAssignedPoints,
    unassignedPoints,
    remainingCapacityPoints,
    sprintBusinessDays,
    appliedReservations = [],
    memberBreakdown,
  } = summary;

  const hasCapacity = totalCapacityPoints > 0;
  const percent = hasCapacity ? Math.round((totalAssignedPoints / totalCapacityPoints) * 100) : 0;
  const isOverCapacity = totalAssignedPoints > totalCapacityPoints && hasCapacity;

  let barColorClass = 'sprint-capacity-bar__fill--normal';
  if (isOverCapacity) {
    barColorClass = 'sprint-capacity-bar__fill--danger';
  } else if (percent >= 90) {
    barColorClass = 'sprint-capacity-bar__fill--warning';
  }

  const getInitials = (name: string) => {
    return name
      .trim()
      .split(/\s+/)
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <div className={`sprint-capacity-bar${compact ? ' sprint-capacity-bar--compact' : ''}`}>
      <div
        ref={triggerRef}
        className="sprint-capacity-bar__header"
        onClick={() => setIsExpanded((prev) => !prev)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsExpanded((prev) => !prev);
          }
        }}
        title="Click to toggle team capacity breakdown"
      >
        <div className="sprint-capacity-bar__stats">
          <div className="sprint-capacity-bar__title-row">
            <span className="sprint-capacity-bar__label">
              <Users size={12} />
              <span>Team Capacity</span>
            </span>
            <span className="sprint-capacity-bar__points">
              <strong>{totalAssignedPoints}</strong> / {totalCapacityPoints} pts
              {totalReservedPoints > 0 && (
                <span
                  className="sprint-capacity-bar__reserved-pill"
                  title={`Gross: ${grossCapacityPoints} pts, Reserved: ${totalReservedPoints} pts`}
                >
                  <ShieldAlert size={10} /> -{totalReservedPoints} res
                </span>
              )}
            </span>
          </div>

          <div className="sprint-capacity-bar__track">
            <div
              className={`sprint-capacity-bar__fill ${barColorClass}`}
              style={{ width: `${Math.min(100, percent)}%` }}
            />
          </div>

          <div className="sprint-capacity-bar__meta-row">
            <span className="sprint-capacity-bar__status">
              {isOverCapacity ? (
                <span className="sprint-capacity-bar__danger-text">
                  <AlertTriangle size={11} /> Over by {Math.abs(remainingCapacityPoints)} pts
                </span>
              ) : hasCapacity ? (
                <span className="sprint-capacity-bar__available-text">
                  <CheckCircle2 size={11} /> {remainingCapacityPoints} pts available
                </span>
              ) : (
                <span className="sprint-capacity-bar__dim-text">No capacity defined</span>
              )}
            </span>
            <span className="sprint-capacity-bar__days-badge">
              <Calendar size={12} />{' '}
              <span className="sprint-capacity-bar__b-days">{sprintBusinessDays} b-days</span>
            </span>
          </div>
        </div>

        <button
          type="button"
          className="sprint-capacity-bar__toggle-btn"
          aria-label={isExpanded ? 'Collapse member breakdown' : 'Expand member breakdown'}
        >
          {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>

      {isExpanded &&
        createPortal(
          <div
            ref={breakdownRef}
            className="sprint-capacity-bar__breakdown"
            style={{
              position: 'fixed',
              top: breakdownPos?.top ?? 0,
              left: breakdownPos?.left ?? 0,
              width: breakdownPos?.width,
            }}
          >
            <div className="sprint-capacity-bar__breakdown-title">Sprint Capacity Breakdown</div>

            {totalReservedPoints > 0 && (
              <div className="sprint-capacity-bar__reservations-summary">
                <div className="sprint-capacity-bar__reservations-header">
                  <span className="sprint-capacity-bar__reservations-title">
                    <ShieldAlert size={11} /> Active Reservations (-{totalReservedPoints} pts)
                  </span>
                  <span className="sprint-capacity-bar__reservations-math">
                    {grossCapacityPoints} gross → {totalCapacityPoints} net
                  </span>
                </div>
                <div className="sprint-capacity-bar__reservations-tags">
                  {appliedReservations.map((r) => (
                    <span key={r.id} className="sprint-capacity-bar__res-tag">
                      {r.name}: {r.value}
                      {r.unit === 'percentage' ? '%' : ' pts'}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {memberBreakdown.length === 0 ? (
              <div className="sprint-capacity-bar__breakdown-empty">
                No team members configured yet. Visit the Team tab to add members.
              </div>
            ) : (
              <div className="sprint-capacity-bar__member-list">
                {memberBreakdown.map((m) => {
                  const memberPercent =
                    m.capacityPoints > 0
                      ? Math.round((m.assignedPoints / m.capacityPoints) * 100)
                      : 0;
                  const memberOver = m.assignedPoints > m.capacityPoints && m.capacityPoints > 0;
                  return (
                    <div key={m.memberId} className="sprint-capacity-bar__member-item">
                      <div className="sprint-capacity-bar__member-top">
                        <div className="sprint-capacity-bar__member-info">
                          <span
                            className="sprint-capacity-bar__member-avatar"
                            style={{ backgroundColor: m.avatarColor ?? '#5b7cfa' }}
                          >
                            {getInitials(m.memberName)}
                          </span>
                          <div className="sprint-capacity-bar__member-names">
                            <span className="sprint-capacity-bar__member-name">{m.memberName}</span>
                            <span className="sprint-capacity-bar__member-sub">
                              {m.workingDays}d work {m.ptoDays > 0 ? `(${m.ptoDays}d PTO)` : ''}
                              {m.reservedPoints > 0 && ` • -${m.reservedPoints} res`}
                            </span>
                          </div>
                        </div>

                        <div className="sprint-capacity-bar__member-stats">
                          <span className="sprint-capacity-bar__member-pts">
                            <strong>{m.assignedPoints}</strong> / {m.capacityPoints} pts
                          </span>
                          <span
                            className={`sprint-capacity-bar__member-remaining${
                              memberOver
                                ? ' is-over'
                                : m.remainingPoints === 0
                                  ? ' is-exact'
                                  : ' is-available'
                            }`}
                          >
                            {memberOver
                              ? `${Math.abs(m.remainingPoints)} pts over`
                              : `${m.remainingPoints} pts free`}
                          </span>
                        </div>
                      </div>

                      <div className="sprint-capacity-bar__member-track">
                        <div
                          className={`sprint-capacity-bar__member-fill${
                            memberOver
                              ? ' sprint-capacity-bar__fill--danger'
                              : memberPercent >= 90
                                ? ' sprint-capacity-bar__fill--warning'
                                : ' sprint-capacity-bar__fill--normal'
                          }`}
                          style={{ width: `${Math.min(100, memberPercent)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}

                {unassignedPoints > 0 && (
                  <div className="sprint-capacity-bar__unassigned-row">
                    <span>Unassigned items</span>
                    <strong>{unassignedPoints} pts</strong>
                  </div>
                )}
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
