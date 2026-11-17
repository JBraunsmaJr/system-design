/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/app/planNavigation.verify.ts
 */
import {
  PLAN_SECTIONS,
  isPlanView,
  planSectionFor,
  planTargetFor,
  type PlanChartMode,
} from './planNavigation';
import type { ViewMode } from './hooks/useViewNavigation';

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

// === Which views belong to the Plan tab ===
{
  const plan: ViewMode[] = ['timeline', 'team', 'dependencies'];
  const other: ViewMode[] = ['diagram', 'requirements', 'srd'];
  assert(plan.every(isPlanView), 'timeline, team and dependencies are Plan views');
  assert(!other.some(isPlanView), 'diagram, requirements and srd are not');
}

// === Section shown for a view ===
{
  assert(planSectionFor('timeline', 'board') === 'board', 'timeline in board mode is Board');
  assert(planSectionFor('timeline', 'gantt') === 'gantt', 'timeline in gantt mode is Gantt');
  assert(
    planSectionFor('team', 'gantt') === 'team' && planSectionFor('team', 'board') === 'team',
    'team is Team whatever the timeline last showed',
  );
  assert(
    planSectionFor('dependencies', 'board') === 'dependencies',
    'dependencies is Dependencies',
  );
  assert(
    planSectionFor('diagram', 'board') === null && planSectionFor('srd', 'gantt') === null,
    'views outside Plan have no section',
  );
}

// === Every section round-trips through its target ===
{
  for (const { id } of PLAN_SECTIONS) {
    for (const previous of ['board', 'gantt'] as PlanChartMode[]) {
      const target = planTargetFor(id);
      const chartMode = target.chartMode ?? previous;
      assert(
        planSectionFor(target.viewMode, chartMode) === id,
        `opening ${id} (timeline last on ${previous}) shows ${id}`,
      );
      assert(isPlanView(target.viewMode), `${id} opens a Plan view`);
    }
  }
  assert(
    planTargetFor('team').chartMode === undefined &&
      planTargetFor('dependencies').chartMode === undefined,
    'Team and Dependencies leave the timeline mode alone',
  );
  assert(
    new Set(PLAN_SECTIONS.map((s) => s.id)).size === PLAN_SECTIONS.length &&
      PLAN_SECTIONS.length === 4,
    'four distinct sections',
  );
}

if (failures > 0) console.error(`${failures} failure(s)`);
