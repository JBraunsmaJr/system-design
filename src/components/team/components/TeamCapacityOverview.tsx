import { CalendarRange, ShieldAlert } from 'lucide-react';
import type { TeamDocument, SprintCapacitySummary } from '../../../domain/timeline/teamTypes';
import type { ProgramIncrement } from '../../../domain/timeline/programIncrements';
import { getInitials } from '../teamUiUtils';

export interface TeamCapacityOverviewProps {
  team: TeamDocument;
  allSprintSummaries: Array<{
    pi: ProgramIncrement;
    summary: SprintCapacitySummary;
  }>;
  onManageReservations: (piId: string) => void;
}

export function TeamCapacityOverview({
  team,
  allSprintSummaries,
  onManageReservations,
}: TeamCapacityOverviewProps) {
  return (
    <div className="sprint-matrix-view">
      {allSprintSummaries.length === 0 ? (
        <div className="team-view__empty-state">
          <CalendarRange size={36} className="team-view__empty-icon" />
          <h3>No Sprints Defined Yet</h3>
          <p>
            Create Program Increments and Sprints in the Timeline view to see full capacity
            planning.
          </p>
        </div>
      ) : (
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
                {team.members.map((m) => (
                  <th key={m.id} className="sprint-matrix-table__member-col">
                    <div className="sprint-matrix-table__member-header">
                      <span
                        className="sprint-matrix-table__avatar"
                        style={{ backgroundColor: m.avatarColor ?? '#5b7cfa' }}
                      >
                        {getInitials(m.name)}
                      </span>
                      <span>{m.name}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allSprintSummaries.map(({ pi, summary }) => {
                const percent =
                  summary.totalCapacityPoints > 0
                    ? Math.round(
                        (summary.totalAssignedPoints / summary.totalCapacityPoints) * 100,
                      )
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
                              {pi.reservations?.length
                                ? `${pi.reservations.length} res`
                                : 'Reserve'}
                            </span>
                          </button>
                        </div>
                        <span className="sprint-matrix-cell__sprint-name">
                          {summary.sprintName}
                        </span>
                        {summary.startDate && summary.endDate && (
                          <span className="sprint-matrix-cell__sprint-dates">
                            {summary.startDate} → {summary.endDate}
                          </span>
                        )}
                      </div>
                    </td>

                    <td>
                      <span className="sprint-matrix-cell__days">
                        {summary.sprintBusinessDays} days
                      </span>
                    </td>

                    <td>
                      <span className="sprint-matrix-cell__points">
                        {summary.grossCapacityPoints} pts
                      </span>
                    </td>

                    <td>
                      <span
                        className={`sprint-matrix-cell__reserved${
                          summary.totalReservedPoints > 0 ? ' has-reserved' : ''
                        }`}
                      >
                        {summary.totalReservedPoints > 0
                          ? `-${summary.totalReservedPoints} pts`
                          : '0 pts'}
                      </span>
                    </td>

                    <td>
                      <span className="sprint-matrix-cell__net-points">
                        {summary.totalCapacityPoints} pts
                      </span>
                    </td>

                    <td>
                      <span className="sprint-matrix-cell__assigned">
                        {summary.totalAssignedPoints} pts
                      </span>
                    </td>

                    <td>
                      <span
                        className={`sprint-matrix-cell__remaining${
                          summary.remainingCapacityPoints < 0 ? ' is-negative' : ''
                        }`}
                      >
                        {summary.remainingCapacityPoints} pts
                      </span>
                    </td>

                    <td>
                      <div className="sprint-matrix-cell__utilization">
                        <div className="sprint-matrix-cell__progress-bar">
                          <div
                            className={`sprint-matrix-cell__progress-fill${
                              isOver ? ' is-over' : ''
                            }`}
                            style={{ width: `${Math.min(100, percent)}%` }}
                          />
                        </div>
                        <span
                          className={`sprint-matrix-cell__percent${
                            isOver ? ' is-over' : ''
                          }`}
                        >
                          {percent}%
                        </span>
                      </div>
                    </td>

                    {team.members.map((m) => {
                      const mb = summary.memberBreakdown.find((b) => b.memberId === m.id);
                      if (!mb) {
                        return (
                          <td key={m.id} className="sprint-matrix-cell__member-val empty">
                            -
                          </td>
                        );
                      }
                      return (
                        <td key={m.id} className="sprint-matrix-cell__member-val">
                          <div className="sprint-matrix-cell__member-breakdown">
                            <span className="sprint-matrix-cell__member-net">
                              {mb.capacityPoints} pts
                            </span>
                            <div className="sprint-matrix-cell__member-subs">
                              {mb.ptoDays > 0 && (
                                <span
                                  className="sprint-matrix-cell__member-sub pto"
                                  title={`${mb.ptoDays} PTO days`}
                                >
                                  -{mb.ptoDays}d PTO
                                </span>
                              )}
                              {mb.reservedPoints > 0 && (
                                <span
                                  className="sprint-matrix-cell__member-sub res"
                                  title={`${mb.reservedPoints} reserved points`}
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
      )}
    </div>
  );
}
