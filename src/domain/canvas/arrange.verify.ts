/**
 * Verification for align / distribute / match size (arrange.ts).
 *
 * Run with: npx tsx --tsconfig tsconfig.app.json src/domain/canvas/arrange.verify.ts
 */
import type {Node} from '@xyflow/react';
import {alignBoxes, type ArrangeBox, canArrange, distributeBoxes, matchBoxSizes, planArrange,} from './arrange';
import {toAbsolutePosition} from './graphUtils';
import type {ArchNodeData} from './types';

let failures = 0;

function assert(condition: boolean, message: string) {
    if (condition) {
        console.log(`ok: ${message}`);
    } else {
        failures++;
        console.error(`FAIL: ${message}`);
    }
}

const box = (id: string, x: number, y: number, width: number, height: number): ArrangeBox => ({
    id,
    x,
    y,
    width,
    height,
});

function node(
    id: string,
    x: number,
    y: number,
    w: number,
    h: number,
    extra: Partial<Node<ArchNodeData>> = {},
    data: Partial<ArchNodeData> = {},
): Node<ArchNodeData> {
    return {
        id,
        type: 'shape',
        position: {x, y},
        width: w,
        height: h,
        data: {nodeType: 'rectangle', label: id, properties: {}, tags: [], ...data},
        ...extra,
    };
}

// --- align -----------------------------------------------------------------
{
    const boxes = [box('a', 10, 0, 100, 50), box('b', 200, 80, 50, 30), box('c', 60, 300, 80, 20)];
    const left = alignBoxes(boxes, 'left');
    assert(
        left.get('b')?.x === 10 && left.get('c')?.x === 10,
        'left: every box to the leftmost edge',
    );
    assert(!left.has('a'), 'left: a box already there is not rewritten');
    assert(left.get('b')?.y === 80, 'left: vertical position is untouched');

    const right = alignBoxes(boxes, 'right');
    assert(right.get('a')?.x === 150 && right.get('c')?.x === 170, 'right: right edges at 250');

    const center = alignBoxes(boxes, 'center');
    // bounds 10..250 -> center 130
    assert(
        center.get('a')?.x === 80 && center.get('b')?.x === 105 && center.get('c')?.x === 90,
        'center: centers on the selection center',
    );

    const bottom = alignBoxes(boxes, 'bottom');
    assert(bottom.get('a')?.y === 270 && !bottom.has('c'), 'bottom: bottom edges at 320');
    const middle = alignBoxes(boxes, 'middle');
    assert(middle.get('a')?.y === 135, 'middle: centers on the selection middle (160)');

    const fixed = alignBoxes(boxes, 'left', new Set(['a']));
    assert(!fixed.has('a') && fixed.get('b')?.x === 10, 'a fixed box anchors without moving');
    const anchored = alignBoxes(
        [box('locked', 500, 0, 10, 10), box('free', 0, 0, 10, 10)],
        'right',
        new Set(['locked']),
    );
    assert(anchored.get('free')?.x === 500, 'a locked box can be the thing others line up with');

    assert(alignBoxes([box('a', 0, 0, 1, 1)], 'left').size === 0, 'one box: nothing to align');
}

// --- distribute ------------------------------------------------------------
{
    const boxes = [
        box('a', 0, 0, 100, 40),
        box('c', 500, 0, 100, 40),
        box('b', 120, 0, 50, 40),
        box('d', 410, 0, 30, 40),
    ];
    const out = distributeBoxes(boxes, 'horizontal');
    // span 0..600, occupied 280 -> gap 320/3
    const gap = 320 / 3;
    assert(!out.has('a') && !out.has('c'), 'the two outermost boxes stay put');
    assert(out.get('b')?.x === Math.round(100 + gap), 'second box sits one gap after the first');
    assert(out.get('d')?.x === Math.round(100 + gap + 50 + gap), 'order is kept (by center)');
    assert(out.get('b')?.y === 0, 'distributing horizontally never moves vertically');
    assert(distributeBoxes(boxes.slice(0, 2), 'horizontal').size === 0, 'two boxes: nothing to do');

    const v = distributeBoxes(
        [box('a', 0, 0, 10, 10), box('b', 0, 15, 10, 10), box('c', 0, 100, 10, 10)],
        'vertical',
    );
    assert(v.get('b')?.y === 50, 'vertical: middle box centered between the outer two');
}

// --- match size --------------------------------------------------------------
{
    const boxes = [box('a', 0, 0, 100, 40), box('b', 0, 0, 60, 90), box('t', 0, 0, 180, 30)];
    const resizable = new Set(['a', 'b']);
    const w = matchBoxSizes(boxes, 'width', resizable);
    assert(
        w.get('a')?.width === 180 && w.get('a')?.height === 40,
        'width: to the widest, height kept',
    );
    assert(!w.has('t'), 'a non-resizable box is never resized');
    const both = matchBoxSizes(boxes, 'both', resizable);
    assert(
        both.get('b')?.width === 180 && both.get('b')?.height === 90,
        'both: to the largest of each',
    );
    const h = matchBoxSizes(boxes, 'height', resizable);
    assert(h.get('a')?.height === 90 && !h.has('b'), 'height: to the tallest');
}

// --- planArrange: absolute alignment across boundaries ------------------------
{
    const vpc = node('vpc', 1000, 0, 600, 400, {type: 'group'});
    const inside = node('inside', 50, 120, 100, 50, {parentId: 'vpc'});
    const outside = node('outside', 200, 300, 100, 50);
    const nodes = [vpc, inside, outside];
    const plan = planArrange({kind: 'align', edge: 'top'}, ['inside', 'outside'], nodes);
    const pos = plan.positions.get('outside')!;
    assert(pos.y === 120, 'a top-level node lines up with a nested one on screen (abs 120)');
    assert(!plan.positions.has('inside'), 'the topmost node stays');

    const left = planArrange({kind: 'align', edge: 'left'}, ['inside', 'outside'], nodes);
    const insideAt = left.positions.get('inside')!;
    const abs = toAbsolutePosition({position: insideAt}, nodes, 'vpc');
    assert(
        abs.x === 200 && insideAt.x === -800,
        'a nested node gets its parent-relative position back',
    );

    // A boundary and its own child selected: only the boundary moves.
    const g = planArrange({kind: 'align', edge: 'left'}, ['vpc', 'inside', 'outside'], nodes);
    assert(!g.positions.has('inside'), 'a node inside a selected boundary moves with it, not alone');
    assert(g.positions.get('vpc')?.x === 200, 'the boundary itself is aligned');
}

// --- planArrange: locks and content-sized nodes -------------------------------
{
    const a = node('a', 0, 0, 100, 40, {}, {locked: true});
    const b = node('b', 300, 50, 100, 40);
    const plan = planArrange({kind: 'align', edge: 'left'}, ['a', 'b'], [a, b]);
    assert(!plan.positions.has('a'), 'a locked node never moves');
    assert(plan.positions.get('b')?.x === 0, 'others line up with the locked node');

    const typed = node('t', 0, 0, 0, 0, {type: 'typed', width: undefined, height: undefined});
    typed.measured = {width: 240, height: 70};
    const shape = node('s', 0, 100, 100, 40);
    const m = planArrange({kind: 'matchSize', dimension: 'width'}, ['t', 's'], [typed, shape]);
    assert(m.sizes.get('s')?.width === 240, "a component node's measured size is the size to match");
    assert(!m.sizes.has('t'), 'a component node, which sizes to its content, is not resized');

    assert(
        !canArrange(
            {kind: 'matchSize', dimension: 'both'},
            ['t', 't2'],
            [typed, {...typed, id: 't2'}],
        ),
        'match size is unavailable when nothing selected can be resized',
    );
    assert(
        !canArrange({kind: 'distribute', axis: 'horizontal'}, ['a', 'b', 's'], [a, b, shape]),
        'distribute needs three unlocked nodes',
    );
    assert(
        canArrange({kind: 'align', edge: 'left'}, ['a', 'b'], [a, b]),
        'align works with a locked anchor and one free node',
    );
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
if (failures > 0) {
    (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
}
