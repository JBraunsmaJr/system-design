/**
 * Verification for "Group selection" geometry (grouping.ts).
 *
 * Run with: npx tsx --tsconfig tsconfig.app.json src/domain/canvas/grouping.verify.ts
 */
import type {Node} from '@xyflow/react';
import {GROUP_HEADER_PADDING, GROUP_MIN_HEIGHT, GROUP_MIN_WIDTH, GROUP_PADDING, planGroup,} from './grouping';
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

function node(
    id: string,
    x: number,
    y: number,
    w: number,
    h: number,
    extra: Partial<Node<ArchNodeData>> = {},
): Node<ArchNodeData> {
    return {
        id,
        type: 'typed',
        position: {x, y},
        width: w,
        height: h,
        data: {nodeType: 'microservice', label: id, properties: {}, tags: []},
        ...extra,
    };
}

// 1. Two loose nodes: the group wraps both with padding, at the top level.
{
    const nodes = [node('a', 100, 100, 200, 80), node('b', 500, 300, 200, 80)];
    const plan = planGroup(['a', 'b'], nodes)!;
    assert(plan !== null, 'plans a group for two nodes');
    assert(plan.parentId === undefined, 'top-level nodes get a top-level group');
    assert(
        plan.position.x === 100 - GROUP_PADDING && plan.position.y === 100 - GROUP_HEADER_PADDING,
        'group starts padding/header above-left of the topmost-leftmost node',
    );
    assert(plan.width === 600 + GROUP_PADDING * 2, 'width spans both nodes plus side padding');
    assert(
        plan.height === 280 + GROUP_PADDING + GROUP_HEADER_PADDING,
        'height spans both nodes plus header and bottom padding',
    );
    const a = plan.members.find((m) => m.id === 'a')!;
    assert(
        a.position.x === GROUP_PADDING && a.position.y === GROUP_HEADER_PADDING,
        "members' new positions are relative to the group",
    );
}

// 2. A small selection still gets a boundary GroupNode can resize.
{
    const plan = planGroup(['a'], [node('a', 0, 0, 40, 30)])!;
    assert(plan.width >= GROUP_MIN_WIDTH, 'width is at least the resizer minimum');
    assert(plan.height >= GROUP_MIN_HEIGHT, 'height is at least the resizer minimum');
}

// 3. Nodes inside a boundary: the new group goes inside it, and members
//    keep their absolute positions on screen.
{
    const vpc = node('vpc', 1000, 1000, 800, 600, {type: 'group'});
    const a = node('a', 50, 80, 100, 50, {parentId: 'vpc'});
    const b = node('b', 300, 200, 100, 50, {parentId: 'vpc'});
    const nodes = [vpc, a, b];
    const plan = planGroup(['a', 'b'], nodes)!;
    assert(plan.parentId === 'vpc', 'group is created inside the shared boundary');
    const groupAbs = toAbsolutePosition({position: plan.position}, nodes, plan.parentId);
    for (const m of plan.members) {
        const original = nodes.find((n) => n.id === m.id)!;
        const before = toAbsolutePosition(original, nodes, original.parentId);
        const after = {x: groupAbs.x + m.position.x, y: groupAbs.y + m.position.y};
        assert(
            before.x === after.x && before.y === after.y,
            `member ${m.id} stays exactly where it was on the canvas`,
        );
    }
}

// 4. Members in different boundaries: nearest common ancestor.
{
    const outer = node('outer', 0, 0, 2000, 2000, {type: 'group'});
    const left = node('left', 100, 100, 500, 500, {type: 'group', parentId: 'outer'});
    const right = node('right', 900, 100, 500, 500, {type: 'group', parentId: 'outer'});
    const a = node('a', 20, 60, 100, 50, {parentId: 'left'});
    const b = node('b', 20, 60, 100, 50, {parentId: 'right'});
    const plan = planGroup(['a', 'b'], [outer, left, right, a, b])!;
    assert(plan.parentId === 'outer', 'members in sibling boundaries group under their common one');
}

// 5. A selected boundary and a node inside it: only the boundary becomes a
//    member - the node travels with it.
{
    const g = node('g', 0, 0, 400, 300, {type: 'group'});
    const inner = node('inner', 40, 60, 100, 50, {parentId: 'g'});
    const loose = node('loose', 600, 0, 100, 50);
    const plan = planGroup(['g', 'inner', 'loose'], [g, inner, loose])!;
    const ids = plan.members.map((m) => m.id).sort();
    assert(
        ids.length === 2 && ids[0] === 'g' && ids[1] === 'loose',
        'a node inside a selected boundary is not pulled out of it',
    );
}

// 6. Nothing to group.
{
    assert(planGroup([], []) === null, 'empty selection plans nothing');
    assert(planGroup(['ghost'], [node('a', 0, 0, 10, 10)]) === null, 'unknown ids plan nothing');
    assert(
        planGroup(['p'], [node('p', 0, 0, 10, 10, {type: 'port'})]) === null,
        'boundary ports are never grouped',
    );
}

// 7. Unmeasured content-sized nodes fall back to a measured size, then a guess.
{
    const measured = node('m', 0, 0, 0, 0, {width: undefined, height: undefined});
    measured.measured = {width: 300, height: 100};
    const plan = planGroup(['m'], [measured])!;
    assert(
        plan.width === 300 + GROUP_PADDING * 2,
        'uses the measured width when there is no explicit one',
    );
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
if (failures > 0) {
    (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
}
