/**
 * Sprint/PI goal and notes: the pure patch helper, and that both fields
 * survive a save -> load round trip through the diagram file format.
 *
 *   npx tsx src/domain/timeline/planningDetails.verify.ts
 */
import {applyPlanningDetails, type ProgramIncrement, type Sprint} from './programIncrements';
import {parseDiagramFile, toDiagramFile} from '../canvas/serialization';
import {EMPTY_REQUIREMENTS_DOCUMENT} from '../requirements/requirementsTypes';
import {EMPTY_TEAM_DOCUMENT} from './teamTypes';

let failures = 0;

function assert(cond: boolean, msg: string) {
    if (!cond) {
        (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
        console.error('FAIL:', msg);
        failures++;
    } else {
        console.log('ok:', msg);
    }
}

// --- applyPlanningDetails ---
{
    const base: Sprint = {id: 's', name: 'S', durationDays: 14, goal: 'G', notes: 'N'};
    const goalOnly = applyPlanningDetails(base, {goal: 'G2'});
    assert(goalOnly.goal === 'G2' && goalOnly.notes === 'N', 'absent keys are left alone');
    const cleared = applyPlanningDetails(base, {notes: ''});
    assert(!('notes' in cleared) && cleared.goal === 'G', "'' removes the field");
    const blank = applyPlanningDetails(base, {goal: '  \n '});
    assert(!('goal' in blank), 'whitespace-only removes the field');
    assert(base.goal === 'G' && base.notes === 'N', 'the input object is not mutated');
}

// --- file round trip ---
{
    const pis: ProgramIncrement[] = [
        {
            id: 'pi-1',
            name: 'PI 1',
            startDate: '2026-10-01',
            goal: 'Launch checkout v2',
            notes: 'Line one\nLine two',
            sprints: [
                {id: 'sp-1', name: 'Sprint 1', durationDays: 14, goal: 'Card flow'},
                {id: 'sp-2', name: 'Sprint 2', durationDays: 14},
            ],
        },
    ];
    const file = toDiagramFile(
        'Plan',
        [],
        [],
        [],
        EMPTY_REQUIREMENTS_DOCUMENT,
        pis,
        EMPTY_TEAM_DOCUMENT,
    );
    const loaded = parseDiagramFile(JSON.stringify(file)).programIncrements[0];
    assert(loaded.goal === 'Launch checkout v2', 'PI goal survives save/load');
    assert(loaded.notes === 'Line one\nLine two', 'PI notes (multi-line) survive save/load');
    assert(loaded.sprints[0].goal === 'Card flow', 'sprint goal survives save/load');
    assert(
        !('goal' in loaded.sprints[1]) && !('notes' in loaded.sprints[1]),
        'a sprint without goal/notes loads without empty fields',
    );

    const legacy = JSON.parse(JSON.stringify(file));
    legacy.programIncrements[0].goal = 42;
    legacy.programIncrements[0].sprints[0].notes = {bad: true};
    const fromLegacy = parseDiagramFile(JSON.stringify(legacy)).programIncrements[0];
    assert(
        !('goal' in fromLegacy) && !('notes' in fromLegacy.sprints[0]),
        'non-string goal/notes are dropped on load instead of reaching the stores',
    );
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
