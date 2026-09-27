import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarRange, X } from 'lucide-react';
import { computeSprintDateRanges, type ProgramIncrement } from '../../domain/timeline/programIncrements';
import { useOutsideClick } from '../../common/hooks/useOutsideClick';
import { usePositionedDropdown } from '../../common/hooks/usePositionedDropdown';

interface SprintPickerProps {
  programIncrements: ProgramIncrement[];
  sprintId: string | undefined;
  onAssign: (sprintId: string) => void;
  onClear: () => void;
}

const DROPDOWN_WIDTH = 240;

/** Locates a sprint by id across every PI, along with its parent PI and
 * computed date range - a requirement item only stores the bare sprintId,
 * so anything that wants to *display* the assignment (a PI name, a date
 * range) has to look it back up like this each render. A sprintId that no
 * longer resolves to anything (its sprint was deleted without going
 * through the cleanup path, or the file was hand-edited) simply doesn't
 * match, and the picker falls back to its unassigned appearance. */
function findSprint(pis: ProgramIncrement[], sprintId: string | undefined) {
  if (!sprintId) return undefined;
  for (const pi of pis) {
    const sprint = pi.sprints.find((s) => s.id === sprintId);
    if (sprint) {
      const range = computeSprintDateRanges(pi).find((r) => r.sprintId === sprintId);
      return { pi, sprint, range };
    }
  }
  return undefined;
}

/** Same portal + flip-positioning approach as CategoryPicker. */
export function SprintPicker({
  programIncrements,
  sprintId,
  onAssign,
  onClear,
}: SprintPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const current = findSprint(programIncrements, sprintId);

  const close = () => {
    setIsOpen(false);
    setQuery('');
  };

  const { position: dropdownPos } = usePositionedDropdown({
    triggerRef,
    dropdownRef,
    isOpen,
    dependencies: [query],
  });

  useOutsideClick({
    refs: [triggerRef, dropdownRef],
    isOpen,
    onClose: close,
  });

  const q = query.trim().toLowerCase();
  const groups = programIncrements
    .map((pi) => {
      const ranges = computeSprintDateRanges(pi);
      const sprints = pi.sprints
        .filter(
          (s) => q === '' || s.name.toLowerCase().includes(q) || pi.name.toLowerCase().includes(q),
        )
        .map((s) => ({ sprint: s, range: ranges.find((r) => r.sprintId === s.id) }));
      return { pi, sprints };
    })
    .filter((g) => g.sprints.length > 0);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`sprint-picker__trigger${current ? '' : ' is-empty'}`}
        onClick={() => (isOpen ? close() : setIsOpen(true))}
        title={
          current
            ? `${current.pi.name} \u2022 ${current.range?.startDate} \u2013 ${current.range?.endDate}`
            : 'Unassigned'
        }
      >
        <CalendarRange size={11} />
        {current ? current.sprint.name : 'Sprint'}
      </button>

      {isOpen &&
        dropdownPos &&
        createPortal(
          <div
            ref={dropdownRef}
            className="sprint-picker__dropdown"
            style={{
              position: 'fixed',
              top: dropdownPos.top,
              left: dropdownPos.left,
              width: DROPDOWN_WIDTH,
            }}
          >
            <input
              autoFocus
              className="sprint-picker__search"
              placeholder="Search sprints..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') close();
              }}
            />
            <div className="sprint-picker__list">
              {current && (
                <button
                  type="button"
                  className="sprint-picker__option sprint-picker__option--clear"
                  onClick={() => {
                    onClear();
                    close();
                  }}
                >
                  <X size={11} />
                  Unassigned
                </button>
              )}
              {groups.map(({ pi, sprints }) => (
                <div key={pi.id} className="sprint-picker__group">
                  <div className="sprint-picker__group-label">{pi.name}</div>
                  {sprints.map(({ sprint, range }) => (
                    <button
                      key={sprint.id}
                      type="button"
                      className="sprint-picker__option"
                      onClick={() => {
                        onAssign(sprint.id);
                        close();
                      }}
                    >
                      <span className="sprint-picker__option-name">{sprint.name}</span>
                      {range && (
                        <span className="sprint-picker__option-range">
                          {range.startDate} – {range.endDate}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              ))}
              {groups.length === 0 && (
                <p className="sprint-picker__empty">
                  {programIncrements.length === 0
                    ? 'No program increments yet.'
                    : 'No matching sprints.'}
                </p>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
