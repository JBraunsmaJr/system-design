import { useState } from "react";
import { Users, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2, Calendar } from "lucide-react";
import type { SprintCapacitySummary } from "../../domain/teamTypes";

interface SprintCapacityBarProps {
  summary: SprintCapacitySummary;
  compact?: boolean;
}

export function SprintCapacityBar({ summary, compact = false }: SprintCapacityBarProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const {
    totalCapacityPoints,
    totalAssignedPoints,
    unassignedPoints,
    remainingCapacityPoints,
    sprintBusinessDays,
    memberBreakdown,
  } = summary;

  const hasCapacity = totalCapacityPoints > 0;
  const percent = hasCapacity ? Math.round((totalAssignedPoints / totalCapacityPoints) * 100) : 0;
  const isOverCapacity = totalAssignedPoints > totalCapacityPoints && hasCapacity;
  const isAtCapacity = totalAssignedPoints === totalCapacityPoints && hasCapacity;

  let barColorClass = "sprint-capacity-bar__fill--normal";
  if (isOverCapacity) {
    barColorClass = "sprint-capacity-bar__fill--danger";
  } else if (percent >= 90) {
    barColorClass = "sprint-capacity-bar__fill--warning";
  }

  const getInitials = (name: string) => {
    return name
      .trim()
      .split(/\s+/)
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <div className={`sprint-capacity-bar${compact ? " sprint-capacity-bar--compact" : ""}`}>
      <div
        className="sprint-capacity-bar__header"
        onClick={() => setIsExpanded((prev) => !prev)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
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
              <Calendar size={11} /> {sprintBusinessDays} b-days
            </span>
          </div>
        </div>

        <button
          type="button"
          className="sprint-capacity-bar__toggle-btn"
          aria-label={isExpanded ? "Collapse member breakdown" : "Expand member breakdown"}
        >
          {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>

      {isExpanded && (
        <div className="sprint-capacity-bar__breakdown">
          <div className="sprint-capacity-bar__breakdown-title">Member Capacity Breakdown</div>
          {memberBreakdown.length === 0 ? (
            <div className="sprint-capacity-bar__breakdown-empty">
              No team members configured yet. Visit the Team tab to add members.
            </div>
          ) : (
            <div className="sprint-capacity-bar__member-list">
              {memberBreakdown.map((m) => {
                const memberPercent = m.capacityPoints > 0 ? Math.round((m.assignedPoints / m.capacityPoints) * 100) : 0;
                const memberOver = m.assignedPoints > m.capacityPoints && m.capacityPoints > 0;
                return (
                  <div key={m.memberId} className="sprint-capacity-bar__member-item">
                    <div className="sprint-capacity-bar__member-top">
                      <div className="sprint-capacity-bar__member-info">
                        <span
                          className="sprint-capacity-bar__member-avatar"
                          style={{ backgroundColor: m.avatarColor ?? "#5b7cfa" }}
                        >
                          {getInitials(m.memberName)}
                        </span>
                        <div className="sprint-capacity-bar__member-names">
                          <span className="sprint-capacity-bar__member-name">{m.memberName}</span>
                          <span className="sprint-capacity-bar__member-sub">
                            {m.workingDays}d work {m.ptoDays > 0 ? `(${m.ptoDays}d PTO)` : ""}
                          </span>
                        </div>
                      </div>

                      <div className="sprint-capacity-bar__member-stats">
                        <span className="sprint-capacity-bar__member-pts">
                          <strong>{m.assignedPoints}</strong> / {m.capacityPoints} pts
                        </span>
                        <span
                          className={`sprint-capacity-bar__member-remaining${
                            memberOver ? " is-over" : m.remainingPoints === 0 ? " is-exact" : " is-available"
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
                            ? " sprint-capacity-bar__fill--danger"
                            : memberPercent >= 90
                            ? " sprint-capacity-bar__fill--warning"
                            : " sprint-capacity-bar__fill--normal"
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
        </div>
      )}
    </div>
  );
}
