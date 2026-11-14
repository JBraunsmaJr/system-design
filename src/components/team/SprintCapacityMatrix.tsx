import { Palmtree, ShieldAlert } from 'lucide-react';
import { initials } from '../../common/utils/string';
import type { ProgramIncrement } from '../../domain/timeline/programIncrements';
import type { SprintCapacitySummary, TeamMember } from '../../domain/timeline/teamTypes';

export interface SprintSummaryRow {
  pi: ProgramIncrement;
  summary: SprintCapacitySummary;
}

interface SprintCapacityMatrixProps {
  members: TeamMember[];
  sprintSummaries: SprintSummaryRow[];
  /** Opens the reservations dialog for a program increment. */
  onManageReservations: (piId: string) => void;
}

/**
 * Capacity for every sprint: totals, then one column per team member.
 *
 * Moved unchanged out of TeamView.tsx. It only draws what it is given;
 * TeamView still computes the summaries.
 */
export function SprintCapacityMatrix({
  members,
  sprintSummaries,
  onManageReservations,
}: SprintCapacityMatrixProps) {
  return (
    <div className="sprint-matrix-table-wrap">
      <table className="sprint-matrix-table">
        <thead>
          <tr>
            <th>Sprint & Timeline</th>
            <th>Business Days</th>
            <th>Gross Capacity</th>
            <th>Reserved</th>
            <th>Net Available</th>
            <th>Assigned Points</th>
            <th>Remaining</th>
            <th>Utilization</th>
            {members.map((m) => (
              <th key={m.id} className="sprint-matrix-table__member-col">
                <div className="sprint-matrix-table__member-header">
                  <span
                    className="sprint-matrix-table__avatar"
                    style={{ backgroundColor: m.avatarColor ?? '#5b7cfa' }}
                  >
                    {initials(m.name)}
                  </span>
                  <span>{m.name}</span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sprintSummaries.map(({ pi, summary }) => {
            const percent =
              summary.totalCapacityPoints > 0
                ? Math.round((summary.totalAssignedPoints / summary.totalCapacityPoints) * 100)
                : 0;
            const isOver =
              summary.totalAssignedPoints > summary.totalCapacityPoints &&
              summary.totalCapacityPoints > 0;

            return (
              <tr key={summary.sprintId}>
                <td>
                  <div className="sprint-matrix-cell__sprint-info">
                    <div className="sprint-matrix-cell__pi-row">
                      <span className="sprint-matrix-cell__pi-badge">{pi.name}</span>
                      <button
                        type="button"
                        className="sprint-matrix-cell__manage-res-btn"
                        onClick={() => onManageReservations(pi.id)}
                        title={`Manage Capacity Reservations for ${pi.name}`}
                      >
                        <ShieldAlert size={10} />
                        <span>
                          {pi.reservations?.length ? `${pi.reservations.length} res` : 'Reserve'}
                        </span>
                      </button>
                    </div>
                    <strong className="sprint-matrix-cell__sprint-name">
                      {summary.sprintName}
                    </strong>
                    <span className="sprint-matrix-cell__dates">
                      {summary.startDate} → {summary.endDate}
                    </span>
                  </div>
                </td>
                <td>
                  <strong>{summary.sprintBusinessDays}</strong> b-days
                </td>
                <td>
                  <strong>{summary.grossCapacityPoints}</strong> pts
                </td>
                <td>
                  {summary.totalReservedPoints > 0 ? (
                    <div
                      className="sprint-matrix-cell__reserved-box"
                      title={summary.appliedReservations
                        .map(
                          (r) => `${r.name}: ${r.value}${r.unit === 'percentage' ? '%' : ' pts'}`,
                        )
                        .join(', ')}
                    >
                      <span className="sprint-matrix-cell__reserved-pill">
                        <ShieldAlert size={10} /> -{summary.totalReservedPoints} pts
                      </span>
                      <span className="sprint-matrix-cell__reserved-count">
                        {summary.appliedReservations.length} active
                      </span>
                    </div>
                  ) : (
                    <span className="sprint-matrix-cell__dim-dash">—</span>
                  )}
                </td>
                <td>
                  <strong>{summary.totalCapacityPoints}</strong> pts
                </td>
                <td>
                  <strong>{summary.totalAssignedPoints}</strong> pts
                  {summary.unassignedPoints > 0 && (
                    <span className="sprint-matrix-cell__unassigned">
                      ({summary.unassignedPoints} unassigned)
                    </span>
                  )}
                </td>
                <td>
                  <span
                    className={`sprint-matrix-cell__available-badge${
                      isOver
                        ? ' is-over'
                        : summary.remainingCapacityPoints === 0
                          ? ' is-zero'
                          : ' is-available'
                    }`}
                  >
                    {isOver
                      ? `${Math.abs(summary.remainingCapacityPoints)} pts over`
                      : `${summary.remainingCapacityPoints} pts`}
                  </span>
                </td>
                <td>
                  <div className="sprint-matrix-cell__progress-wrap">
                    <div className="sprint-matrix-cell__progress-bar">
                      <div
                        className={`sprint-matrix-cell__progress-fill${
                          isOver ? ' is-danger' : percent >= 90 ? ' is-warning' : ' is-normal'
                        }`}
                        style={{ width: `${Math.min(100, percent)}%` }}
                      />
                    </div>
                    <span className="sprint-matrix-cell__percent">{percent}%</span>
                  </div>
                </td>

                {/* Member specific cells */}
                {members.map((m) => {
                  const mb = summary.memberBreakdown.find((x) => x.memberId === m.id);
                  if (!mb) {
                    return <td key={m.id}>—</td>;
                  }
                  const mbOver = mb.assignedPoints > mb.capacityPoints && mb.capacityPoints > 0;
                  return (
                    <td key={m.id} className="sprint-matrix-table__member-cell">
                      <div className="member-capacity-cell">
                        <div className="member-capacity-cell__top">
                          <span>
                            <strong>{mb.assignedPoints}</strong> / {mb.capacityPoints} pts
                          </span>
                          <span
                            className={`member-capacity-cell__status${
                              mbOver ? ' is-over' : ' is-available'
                            }`}
                          >
                            {mbOver ? `-${Math.abs(mb.remainingPoints)}` : `+${mb.remainingPoints}`}
                          </span>
                        </div>
                        <div className="member-capacity-cell__meta">
                          <span>{mb.workingDays}d work</span>
                          {mb.ptoDays > 0 && (
                            <span className="member-capacity-cell__pto">
                              <Palmtree size={10} /> {mb.ptoDays}d PTO
                            </span>
                          )}
                          {mb.reservedPoints > 0 && (
                            <span
                              className="member-capacity-cell__res"
                              title={`Gross: ${mb.grossCapacityPoints} pts, Reserved: ${mb.reservedPoints} pts`}
                            >
                              -{mb.reservedPoints} res
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
