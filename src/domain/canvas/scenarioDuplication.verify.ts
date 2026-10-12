/**
 * Verification for copying scenarios and steps (scenarioDuplication.ts).
 *
 * Run with: npx tsx --tsconfig tsconfig.app.json src/domain/canvas/scenarioDuplication.verify.ts
 */
import {copyTitle, duplicateScenario, withScenarioDuplicated, withStepDuplicated,} from './scenarioDuplication';
import type {Scenario} from './types';

let failures = 0;

function assert(condition: boolean, message: string) {
    if (condition) {
        console.log(`ok: ${message}`);
    } else {
        failures++;
        console.error(`FAIL: ${message}`);
    }
}

function sample(): Scenario[] {
    return [
        {
            id: 'sc-1',
            title: 'Login',
            steps: [
                {
                    id: 'st-1',
                    title: 'Client calls API',
                    narration: 'The browser posts credentials.',
                    path: [],
                    focusNodeIds: ['n1', 'n2'],
                    focusEdgeIds: ['e1'],
                },
                {
                    id: 'st-2',
                    title: '',
                    path: ['n2'],
                    focusNodeIds: ['n9'],
                    focusEdgeIds: [],
                },
            ],
        },
        {id: 'sc-2', title: 'Logout', steps: []},
    ];
}

function idGen(prefix: string) {
    let n = 0;
    return () => `${prefix}-${++n}`;
}

// --- copyTitle ---
{
    assert(copyTitle('Login', []) === 'Login (copy)', 'first copy gets " (copy)"');
    assert(copyTitle('Login', ['Login (copy)']) === 'Login (copy 2)', 'second copy is numbered');
    assert(
        copyTitle('Login (copy)', ['Login', 'Login (copy)']) === 'Login (copy 2)',
        'copying a copy numbers from the base name instead of stacking "(copy)"',
    );
    assert(
        copyTitle('Login (copy 2)', ['Login (copy)', 'Login (copy 2)']) === 'Login (copy 3)',
        'copying a numbered copy picks the next free number',
    );
    assert(copyTitle('', []) === '(copy)', 'an empty title still gets a distinct name');
}

// --- duplicateScenario ---
{
    const [original] = sample();
    const copy = duplicateScenario(original, ['Login', 'Logout'], {
        scenarioId: 'sc-new',
        nextStepId: idGen('step'),
    });
    assert(copy.id === 'sc-new', 'the copy has the given id');
    assert(copy.title === 'Login (copy)', 'the copy is titled apart from the original');
    assert(copy.steps.length === 2, 'every step is copied');
    assert(
        copy.steps[0].id === 'step-1' && copy.steps[1].id === 'step-2',
        'every step gets a fresh id',
    );
    assert(
        copy.steps[0].title === 'Client calls API' &&
        copy.steps[0].narration === 'The browser posts credentials.' &&
        copy.steps[1].path[0] === 'n2',
        'step titles, narration and levels are kept',
    );
    assert(
        copy.steps[0].focusNodeIds !== original.steps[0].focusNodeIds &&
        copy.steps[0].focusEdgeIds !== original.steps[0].focusEdgeIds &&
        copy.steps[1].path !== original.steps[1].path,
        'the copy shares no arrays with the original',
    );
    copy.steps[0].focusNodeIds.push('n3');
    assert(original.steps[0].focusNodeIds.length === 2, 'editing the copy leaves the original alone');
}

// --- withScenarioDuplicated ---
{
    const list = sample();
    const next = withScenarioDuplicated(list, 'sc-1', {
        scenarioId: 'sc-new',
        nextStepId: idGen('step'),
    });
    assert(
        next.map((s) => s.id).join(',') === 'sc-1,sc-new,sc-2',
        'the copy is inserted right after its original',
    );
    assert(list.length === 2, 'the input list is not mutated');
    assert(
        withScenarioDuplicated(list, 'missing', {scenarioId: 'x', nextStepId: idGen('s')}) === list,
        'an unknown scenario leaves the list as it was',
    );
}

// --- withStepDuplicated ---
{
    const list = sample();
    const next = withStepDuplicated(list, 'sc-1', 'st-1', 'st-copy');
    const steps = next[0].steps;
    assert(
        steps.map((s) => s.id).join(',') === 'st-1,st-copy,st-2',
        'the step copy is inserted right after its original',
    );
    assert(steps[1].title === 'Client calls API (copy)', 'a titled step copy is marked as a copy');
    assert(
        steps[1].focusNodeIds.join(',') === 'n1,n2' && steps[1].focusNodeIds !== steps[0].focusNodeIds,
        'the step copy highlights the same elements, in its own array',
    );
    assert(next[1] === list[1], 'other scenarios keep their identity');

    const untitled = withStepDuplicated(list, 'sc-1', 'st-2', 'st-copy2');
    assert(
        untitled[0].steps[2].title === '',
        'an untitled step copy stays untitled, so it shows its own step number',
    );
    assert(
        withStepDuplicated(list, 'sc-1', 'missing', 'x')[0] === list[0],
        'an unknown step leaves its scenario as it was',
    );
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
if (failures > 0) {
    (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
}
