import {
  filteredProgramIncrement,
  selectProgramIncrement,
  toggleSprint,
  visibleSprintIds,
  type BoardFilter,
} from '../../domain/timeline/boardFilter';
import type { ProgramIncrement } from '../../domain/timeline/programIncrements';

interface BoardFilterBarProps {
  programIncrements: readonly ProgramIncrement[];
  filter: BoardFilter;
  onChange: (filter: BoardFilter) => void;
}

const ALL = '__all__';

/**
 * Narrows the board to one program increment and, within it, to any set of
 * sprints - one sprint for a team that plans sprint by sprint, several side
 * by side for one that plans further ahead. The rules live in
 * boardFilter.ts; this only draws them.
 */
export function BoardFilterBar({ programIncrements, filter, onChange }: BoardFilterBarProps) {
  if (programIncrements.length === 0) return null;
  const pi = filteredProgramIncrement(programIncrements, filter);
  const shown = pi ? visibleSprintIds(pi, filter) : null;

  return (
    <div className="board-filter">
      <label className="board-filter__label" htmlFor="board-filter-pi">
        Show
      </label>
      <select
        id="board-filter-pi"
        className="board-filter__select"
        value={pi?.id ?? ALL}
        onChange={(e) =>
          onChange(selectProgramIncrement(e.target.value === ALL ? null : e.target.value))
        }
        title="Show every program increment, or just one"
      >
        <option value={ALL}>All program increments</option>
        {programIncrements.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name || 'Untitled PI'}
          </option>
        ))}
      </select>

      {pi && pi.sprints.length > 1 && (
        <div className="board-filter__sprints" role="group" aria-label="Sprints to show">
          <button
            type="button"
            className={`board-filter__chip${shown === null ? ' is-on' : ''}`}
            aria-pressed={shown === null}
            onClick={() => onChange(selectProgramIncrement(pi.id))}
          >
            All sprints
          </button>
          {pi.sprints.map((sprint) => {
            const isOn = shown !== null && shown.has(sprint.id);
            return (
              <button
                key={sprint.id}
                type="button"
                className={`board-filter__chip${isOn ? ' is-on' : ''}`}
                aria-pressed={isOn}
                onClick={() => onChange(toggleSprint(filter, pi, sprint.id))}
                title={
                  isOn
                    ? `Hide ${sprint.name}`
                    : shown === null
                      ? `Show only ${sprint.name}`
                      : `Also show ${sprint.name}`
                }
              >
                {sprint.name || 'Untitled sprint'}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
