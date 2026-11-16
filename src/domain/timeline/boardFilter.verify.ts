/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/domain/timeline/boardFilter.verify.ts
 */
import {
  SHOW_EVERYTHING,
  filteredProgramIncrement,
  selectProgramIncrement,
  toggleSprint,
  visibleProgramIncrements,
  visibleSprintIds,
  type BoardFilter,
} from './boardFilter';
import type { ProgramIncrement } from './programIncrements';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1; // run-tests.ts reads the exit status
    console.error(`FAIL: ${message}`);
  }
}

const pi = (id: string, sprintIds: string[]): ProgramIncrement => ({
  id,
  name: id,
  startDate: '2026-07-13',
  sprints: sprintIds.map((s) => ({ id: s, name: s, durationDays: 14 })),
});
const A = pi('pi-a', ['a1', 'a2', 'a3']);
const B = pi('pi-b', ['b1', 'b2']);
const ALL = [A, B];
const ids = (set: Set<string> | null) => (set === null ? 'all' : [...set].join(','));

// === Default: everything ===
{
  assert(visibleProgramIncrements(ALL, SHOW_EVERYTHING).length === 2, 'no filter shows every PI');
  assert(visibleSprintIds(A, SHOW_EVERYTHING) === null, 'no filter shows every sprint');
  assert(filteredProgramIncrement(ALL, SHOW_EVERYTHING) === null, 'no filter names no PI');
}

// === One program increment ===
{
  const f = selectProgramIncrement('pi-b');
  const shown = visibleProgramIncrements(ALL, f);
  assert(shown.length === 1 && shown[0] === B, 'selecting a PI shows only it');
  assert(visibleSprintIds(B, f) === null, 'and all of its sprints');
  assert(selectProgramIncrement(null) === SHOW_EVERYTHING, 'selecting none returns to everything');
}

// === Sprints within it ===
{
  let f: BoardFilter = selectProgramIncrement('pi-a');
  f = toggleSprint(f, A, 'a2');
  assert(ids(visibleSprintIds(A, f)) === 'a2', 'from all, checking one sprint focuses on it alone');
  f = toggleSprint(f, A, 'a1');
  assert(
    ids(visibleSprintIds(A, f)) === 'a1,a2',
    'checking another adds it, kept in the PI order not click order',
  );
  f = toggleSprint(f, A, 'a2');
  assert(ids(visibleSprintIds(A, f)) === 'a1', 'unchecking removes it');
  f = toggleSprint(f, A, 'a1');
  assert(
    f.sprintIds.length === 0 && visibleSprintIds(A, f) === null,
    'unchecking the last one returns to all sprints',
  );

  let g: BoardFilter = selectProgramIncrement('pi-a');
  for (const s of ['a1', 'a2', 'a3']) g = toggleSprint(g, A, s);
  assert(
    g.sprintIds.length === 0 && visibleSprintIds(A, g) === null,
    'checking every sprint is stored as all sprints',
  );
  assert(toggleSprint(f, A, 'b1') === f, "a sprint from another PI doesn't change the filter");
}

// === A filter never applies to another program increment ===
{
  const f: BoardFilter = { piId: 'pi-a', sprintIds: ['a1'] };
  assert(visibleSprintIds(B, f) === null, "one PI's sprint selection does not hide another's");
}

// === Things deleted from under the filter ===
{
  const gone: BoardFilter = { piId: 'pi-deleted', sprintIds: ['x'] };
  assert(
    visibleProgramIncrements(ALL, gone).length === 2,
    'a filter naming a deleted PI shows everything, not an empty board',
  );
  const staleSprint: BoardFilter = { piId: 'pi-a', sprintIds: ['a-deleted'] };
  assert(
    visibleSprintIds(A, staleSprint) === null,
    'a selection holding only deleted sprints shows every sprint',
  );
  const partlyStale: BoardFilter = { piId: 'pi-a', sprintIds: ['a-deleted', 'a3'] };
  assert(ids(visibleSprintIds(A, partlyStale)) === 'a3', 'deleted sprints are ignored');
  const afterToggle = toggleSprint(partlyStale, A, 'a1');
  assert(
    afterToggle.sprintIds.join(',') === 'a1,a3',
    'and dropped from the selection on the next change',
  );
  const empty = pi('pi-empty', []);
  assert(
    visibleSprintIds(empty, { piId: 'pi-empty', sprintIds: ['x'] }) === null,
    'a PI with no sprints has nothing to hide',
  );
}

if (failures > 0) console.error(`${failures} failure(s)`);
