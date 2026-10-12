/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/domain/scenarioExport/scenarioExportPlan.verify.ts
 */
import type {Edge, Node} from '@xyflow/react';
import type {Scenario} from '../canvas/types';
import {
    buildTimeline,
    CROSSFADE_FRAMES,
    exportFileName,
    FRAME_HEIGHT,
    frameLayout,
    MAX_NARRATION_LINES,
    MP4_FPS,
    planScenarioFrames,
    safeFileName,
    stepFileName,
    stepHoldSeconds,
    videoFrameCounts,
    wrapText,
} from './scenarioExportPlan';

let failures = 0;
function assert(condition: boolean, message: string) {
    if (condition) {
        console.log(`ok: ${message}`);
    } else {
        failures++;
        (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
        console.error(`FAIL: ${message}`);
    }
}

const node = (id: string, parentPath: string[] = [], parentId?: string): Node =>
    ({id, position: {x: 0, y: 0}, parentId, data: {parentPath}}) as Node;
const edge = (id: string, source: string, target: string, parentPath: string[] = []): Edge =>
    ({id, source, target, data: {parentPath}}) as Edge;

// Root: gateway -> auth (e1), a group with a child. Inside auth: a -> b.
const nodes = [
    node('gateway'),
    node('auth'),
    node('group'),
    node('child', [], 'group'),
    node('a', ['auth']),
    node('b', ['auth']),
];
const edges = [edge('e1', 'gateway', 'auth'), edge('sub-e', 'a', 'b', ['auth'])];
const label = (path: string[]) => (path.length === 0 ? 'Root' : path.join(' › '));

const scenario: Scenario = {
    id: 's',
    title: 'Login',
    steps: [
        {
            id: '1',
            title: 'Arrive',
            narration: ' Hi ',
            path: [],
            focusNodeIds: ['gateway'],
            focusEdgeIds: [],
        },
        {id: '2', title: '', path: [], focusNodeIds: [], focusEdgeIds: ['e1']},
        {
            id: '3',
            title: 'Inside',
            path: ['auth'],
            focusNodeIds: ['a', 'gone'],
            focusEdgeIds: ['sub-e', 'e1'],
        },
        {id: '4', title: 'Empty focus', path: [], focusNodeIds: [], focusEdgeIds: []},
        {id: '5', title: 'Deleted level', path: ['deleted'], focusNodeIds: ['x'], focusEdgeIds: []},
        // 'a' is a real node, but not at the root: the path is wrong for it.
        {id: '6', title: 'Bad path', path: ['a'], focusNodeIds: [], focusEdgeIds: []},
    ],
};

console.log('Testing scenario export planning...');
{
    const plans = planScenarioFrames(scenario, nodes, edges, label);
    assert(plans.length === 6, 'one plan per step');
    assert(
        plans[0].title === 'Arrive' && plans[0].narration === 'Hi',
        'title kept, narration trimmed',
    );
    assert(plans[0].frameNodeIds.join() === 'gateway', 'frames the focused nodes');
    assert(plans[1].title === 'Step 2', 'an untitled step is named by its number');
    assert(
        plans[1].frameNodeIds.sort().join() === 'auth,gateway',
        'an edge-only step frames the ends of its edges',
    );
    assert(
        plans[2].focusNodeIds.join() === 'a' && plans[2].focusEdgeIds.join() === 'sub-e',
        'focus is limited to what exists at the step’s own level',
    );
    assert(plans[2].missingCount === 2, 'deleted and other-level ids are counted as missing');
    assert(plans[2].levelLabel === 'auth', 'the level label comes from the path');
    assert(
        plans[3].frameNodeIds.sort().join() === 'auth,gateway,group',
        'a step with no focus frames the whole level, top-level nodes only',
    );
    assert(
        !plans[4].levelExists && plans[4].frameNodeIds.length === 0,
        'a deleted level shows nothing',
    );
    assert(plans[4].levelLabel === 'Deleted sub-diagram', 'a deleted level is labeled as such');
    assert(!plans[5].levelExists, 'a path whose node lives elsewhere does not resolve');
}

console.log('Testing frame layout...');
{
    const none = frameLayout(false, 3);
    assert(
        none.headerHeight === 0 && none.diagram.height === FRAME_HEIGHT,
        'no captions: the diagram fills the frame',
    );
    const one = frameLayout(true, 1);
    const many = frameLayout(true, 99);
    assert(many.narrationLines === MAX_NARRATION_LINES, 'narration lines are capped');
    assert(one.diagram.height > many.diagram.height, 'longer narration takes room from the diagram');
    assert(
        many.diagram.y + many.diagram.height === many.caption.y &&
        many.caption.y + many.caption.height === FRAME_HEIGHT,
        'header, diagram and caption tile the frame exactly',
    );
}

console.log('Testing text wrapping...');
{
    const measure = (s: string) => s.length; // one unit per character
    assert(wrapText('aa bb cc', 5, measure).join('|') === 'aa bb|cc', 'wraps at word boundaries');
    assert(wrapText('one\n\ntwo', 10, measure).join('|') === 'one||two', 'keeps hard line breaks');
    assert(
        wrapText('abcdefghij', 4, measure).join('|') === 'abcd|efgh|ij',
        'breaks a word too long for any line',
    );
    const cut = wrapText('aa bb cc dd ee', 5, measure, 2);
    assert(
        cut.length === 2 && cut[1].endsWith('…') && cut[1].length <= 5,
        `ellipsis on the last kept line (${cut.join('|')})`,
    );
    assert(wrapText('', 10, measure).length === 0, 'empty text has no lines');
    assert(
        wrapText('trailing\n\n', 20, measure).join('|') === 'trailing',
        'drops trailing blank lines',
    );
}

console.log('Testing timing...');
{
    assert(stepHoldSeconds({title: '', narration: ''}, 'auto') === 3, 'auto has a floor');
    assert(
        stepHoldSeconds({title: '', narration: 'x'.repeat(5000)}, 'auto') === 15,
        'auto has a ceiling',
    );
    const mid = stepHoldSeconds({title: '', narration: 'x'.repeat(100)}, 'auto');
    assert(mid > 3 && mid < 15, `auto grows with narration (${mid}s)`);
    assert(
        stepHoldSeconds({title: '', narration: 'long'.repeat(100)}, 5) === 5,
        'a fixed pace ignores the text',
    );

    const steps = [
        {title: 'a', narration: ''},
        {title: 'b', narration: ''},
        {title: 'c', narration: ''},
    ];
    const cut = buildTimeline(steps, {secondsPerStep: 3, crossfade: false});
    assert(
        cut.length === 3 && cut.every((f) => f.kind === 'hold'),
        'no crossfade: one frame per step',
    );
    const end = (t: typeof cut) => t[t.length - 1].start + t[t.length - 1].duration;
    assert(Math.abs(end(cut) - 9) < 1e-6, 'total is the sum of the steps');
    const faded = buildTimeline(steps, {secondsPerStep: 3, crossfade: true}, CROSSFADE_FRAMES.gif);
    assert(faded.length === 3 + 2 * CROSSFADE_FRAMES.gif, 'fades between steps, not after the last');
    assert(Math.abs(end(faded) - 9) < 1e-3, 'crossfades do not change the length');
    assert(
        faded.every(
            (f, i) => i === 0 || Math.abs(f.start - (faded[i - 1].start + faded[i - 1].duration)) < 1e-3,
        ),
        'frames are contiguous',
    );
    const mixes = faded.filter((f) => f.kind === 'fade').map((f) => (f.kind === 'fade' ? f.mix : 0));
    assert(
        mixes.every((m) => m > 0 && m < 1),
        'fade frames are strictly between the two steps',
    );
}

console.log('Testing constant-rate video frames...');
{
    const steps = [
        {title: 'a', narration: ''},
        {title: 'b', narration: ''},
        {title: 'c', narration: ''},
    ];
    const timeline = buildTimeline(
        steps,
        {secondsPerStep: 3, crossfade: true},
        CROSSFADE_FRAMES.mp4,
    );
    const counts = videoFrameCounts(timeline, MP4_FPS);
    assert(
        counts.reduce((a, b) => a + b, 0) === 9 * MP4_FPS,
        `frames add up to the full length (${counts.reduce((a, b) => a + b, 0)} at ${MP4_FPS} fps)`,
    );
    assert(
        counts.every((c) => c >= 1),
        'every timeline frame is shown',
    );
    assert(
        timeline.every((f, i) => f.kind === 'hold' || counts[i] === 1),
        'each crossfade frame is exactly one video frame',
    );
    assert(counts[0] === Math.round((3 - 0.5) * MP4_FPS), 'a held step repeats for its whole hold');
    const odd = buildTimeline([{title: 'x'.repeat(7), narration: 'y'.repeat(13)}], {
        secondsPerStep: 'auto',
        crossfade: false,
    });
    const oddEnd = odd[0].start + odd[0].duration;
    assert(
        videoFrameCounts(odd, MP4_FPS)[0] === Math.round(oddEnd * MP4_FPS),
        'an uneven length rounds to the nearest frame',
    );
}

console.log('Testing file names...');
{
    assert(safeFileName('  Login / Flow!! ') === 'login-flow', 'file names are slugged');
    assert(safeFileName('???') === 'scenario', 'an unusable title falls back');
    assert(
        stepFileName({index: 2, title: 'Check creds'}, 12) === '03-check-creds.png',
        'numbered and padded',
    );
    assert(
        stepFileName({index: 2, title: 'x'}, 120) === '003-x.png',
        'padding grows with the step count',
    );
    assert(exportFileName('Login', 'png') === 'login-steps.zip', 'PNGs come zipped');
    assert(exportFileName('Login', 'mp4') === 'login.mp4', 'other formats keep their extension');
}

if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
} else {
    console.log('All scenario export planning tests passed.\n');
}
