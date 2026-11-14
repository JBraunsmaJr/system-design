/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/domain/timeline/planBoardPrefs.verify.ts
 */
import { SHOW_EVERYTHING } from './boardFilter';
import { loadPlanBoardPrefs, normalizeBoardFilter, savePlanBoardPrefs } from './planBoardPrefs';

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

const globals = globalThis as unknown as { localStorage?: Storage };

// === No localStorage at all (server render, tests) ===
{
  delete globals.localStorage;
  assert(
    Object.keys(loadPlanBoardPrefs('doc')).length === 0,
    'loading without localStorage returns no preferences',
  );
  savePlanBoardPrefs('doc', { backlogCollapsed: true });
  assert(true, 'saving without localStorage does not throw');
}

// === A working store ===
const entries = new Map<string, string>();
globals.localStorage = {
  getItem: (key: string) => entries.get(key) ?? null,
  setItem: (key: string, value: string) => void entries.set(key, value),
  removeItem: (key: string) => void entries.delete(key),
  clear: () => entries.clear(),
  key: () => null,
  length: 0,
} as Storage;

{
  savePlanBoardPrefs('doc-1', { backlogCollapsed: true });
  savePlanBoardPrefs('doc-1', { filter: { piId: 'pi-a', sprintIds: ['a1', 'a2'] } });
  const prefs = loadPlanBoardPrefs('doc-1');
  assert(prefs.backlogCollapsed === true, 'a saved field survives a later save of another field');
  assert(
    prefs.filter?.piId === 'pi-a' && prefs.filter.sprintIds.join(',') === 'a1,a2',
    'the filter round-trips',
  );
  assert(
    Object.keys(loadPlanBoardPrefs('doc-2')).length === 0,
    'preferences are kept per document',
  );
  savePlanBoardPrefs(undefined, { backlogCollapsed: false });
  assert(
    loadPlanBoardPrefs(undefined).backlogCollapsed === false,
    'a document without an id has its own entry',
  );
}

// === Malformed entries ===
{
  entries.set('system-design-editor:plan-board:bad-json', '{not json');
  assert(
    Object.keys(loadPlanBoardPrefs('bad-json')).length === 0,
    'unparseable JSON returns no preferences',
  );
  entries.set(
    'system-design-editor:plan-board:bad-fields',
    JSON.stringify({ backlogCollapsed: 'yes', filter: { piId: 7, sprintIds: 'a1' } }),
  );
  const prefs = loadPlanBoardPrefs('bad-fields');
  assert(prefs.backlogCollapsed === undefined, 'a non-boolean collapsed flag is dropped');
  assert(prefs.filter === SHOW_EVERYTHING, 'a malformed filter becomes show-everything');
}

// === normalizeBoardFilter ===
{
  assert(normalizeBoardFilter(null) === SHOW_EVERYTHING, 'null is show-everything');
  assert(
    normalizeBoardFilter({ piId: '' }) === SHOW_EVERYTHING,
    'an empty PI id is show-everything',
  );
  const noSprints = normalizeBoardFilter({ piId: 'pi-a' });
  assert(
    noSprints.piId === 'pi-a' && noSprints.sprintIds.length === 0,
    'a PI without a sprint list means all its sprints',
  );
  const mixed = normalizeBoardFilter({ piId: 'pi-a', sprintIds: ['a1', 2] });
  assert(mixed.sprintIds.length === 0, 'a sprint list holding a non-string is discarded whole');
}

if (failures > 0) console.error(`${failures} failure(s)`);
