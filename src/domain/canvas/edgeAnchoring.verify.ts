/**
 * Verification for drag-to-connect resolution (see edgeAnchoring.ts).
 *
 * Run with: npx tsx --tsconfig tsconfig.app.json src/domain/edgeAnchoring.verify.ts
 */
import {
  closestSide,
  pickAnchor,
  resolveDropTarget,
  sideFromGrabHandleId,
  type Anchor,
  type DropCandidate,
  type Rect,
} from './edgeAnchoring';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

function cardinalAnchors(r: Rect): Anchor[] {
  return [
    { pointId: 'top', side: 'top', x: r.x + r.width / 2, y: r.y },
    { pointId: 'right', side: 'right', x: r.x + r.width, y: r.y + r.height / 2 },
    { pointId: 'bottom', side: 'bottom', x: r.x + r.width / 2, y: r.y + r.height },
    { pointId: 'left', side: 'left', x: r.x, y: r.y + r.height / 2 },
  ];
}

function node(id: string, rect: Rect, isGroup = false): DropCandidate {
  return { id, rect, isGroup, anchors: cardinalAnchors(rect) };
}

const TOL = 8;

// --- closestSide -----------------------------------------------------------
const wide: Rect = { x: 0, y: 0, width: 200, height: 60 };
assert(closestSide(wide, { x: 100, y: 5 }) === 'top', 'inside near top -> top');
assert(closestSide(wide, { x: 195, y: 30 }) === 'right', 'inside near right -> right');
assert(
  closestSide(wide, { x: 20, y: 50 }) === 'bottom',
  'inside near bottom-left -> bottom (closer)',
);
assert(closestSide(wide, { x: 100, y: -4 }) === 'top', 'just outside the top border -> top');
assert(closestSide(wide, { x: 204, y: 30 }) === 'right', 'just outside the right border -> right');
assert(
  closestSide(wide, { x: 30, y: 30 }) === 'top',
  'dead centre vertically on a wide node ties top/bottom -> deterministic top',
);

// --- rule 1: released on a border -> that side ------------------------------
const api = node('api', { x: 0, y: 0, width: 200, height: 60 });
const db = node('db', { x: 400, y: 0, width: 200, height: 60 });

for (const [p, side] of [
  [{ x: 500, y: 2 }, 'top'],
  [{ x: 500, y: -5 }, 'top'],
  [{ x: 598, y: 30 }, 'right'],
  [{ x: 605, y: 30 }, 'right'],
  [{ x: 500, y: 63 }, 'bottom'],
  [{ x: 395, y: 30 }, 'left'],
] as const) {
  const r = resolveDropTarget(p, [api, db], {
    borderTolerance: TOL,
    anchoredNodeId: 'api',
    anchoredSide: 'right',
  });
  assert(
    r?.nodeId === 'db' && r.side === side && r.anchor.pointId === side,
    `border release at (${p.x},${p.y}) -> db:${side}`,
  );
}

// --- rule 2: released over the body -> nearest side --------------------------
{
  const r = resolveDropTarget({ x: 420, y: 30 }, [api, db], {
    borderTolerance: TOL,
    anchoredNodeId: 'api',
    anchoredSide: 'right',
  });
  assert(r?.nodeId === 'db' && r.side === 'left', 'body release near the left -> db:left');
}
{
  const r = resolveDropTarget({ x: 500, y: 45 }, [api, db], {
    borderTolerance: TOL,
    anchoredNodeId: 'api',
    anchoredSide: 'right',
  });
  assert(r?.nodeId === 'db' && r.side === 'bottom', 'body release near the bottom -> db:bottom');
}

// --- empty canvas / too far from a border -> nothing -------------------------
assert(
  resolveDropTarget({ x: 300, y: 30 }, [api, db], {
    borderTolerance: TOL,
    anchoredNodeId: 'api',
    anchoredSide: 'right',
  }) === null,
  'release on empty canvas connects nothing',
);
assert(
  resolveDropTarget({ x: 500, y: -20 }, [api, db], {
    borderTolerance: TOL,
    anchoredNodeId: 'api',
    anchoredSide: 'right',
  }) === null,
  'release beyond border tolerance connects nothing',
);

// --- anchored node: body cancels, a different side's border self-loops ------
assert(
  resolveDropTarget({ x: 100, y: 30 }, [api, db], {
    borderTolerance: TOL,
    anchoredNodeId: 'api',
    anchoredSide: 'right',
  }) === null,
  'release back over the source body cancels (no accidental self-loop)',
);
assert(
  resolveDropTarget({ x: 199, y: 30 }, [api, db], {
    borderTolerance: TOL,
    anchoredNodeId: 'api',
    anchoredSide: 'right',
  }) === null,
  'release on the SAME border it started from cancels',
);
{
  const r = resolveDropTarget({ x: 100, y: 61 }, [api, db], {
    borderTolerance: TOL,
    anchoredNodeId: 'api',
    anchoredSide: 'right',
  });
  assert(
    r?.nodeId === 'api' && r.side === 'bottom',
    'release on a different border of the source makes a self-loop',
  );
}

// --- boundaries --------------------------------------------------------------
const vpc = node('vpc', { x: 300, y: -100, width: 400, height: 300 }, true);
{
  const r = resolveDropTarget({ x: 320, y: 150 }, [api, vpc], {
    borderTolerance: TOL,
    anchoredNodeId: 'api',
    anchoredSide: 'right',
  });
  assert(
    r === null,
    "release in a boundary's empty interior connects nothing (interior is click-through)",
  );
}
{
  const r = resolveDropTarget({ x: 500, y: -103 }, [api, vpc], {
    borderTolerance: TOL,
    anchoredNodeId: 'api',
    anchoredSide: 'right',
  });
  assert(
    r?.nodeId === 'vpc' && r.side === 'top',
    "release on a boundary's border connects to the boundary",
  );
}
{
  const r = resolveDropTarget({ x: 500, y: 30 }, [api, vpc, db], {
    borderTolerance: TOL,
    anchoredNodeId: 'api',
    anchoredSide: 'right',
  });
  assert(r?.nodeId === 'db', 'a node inside a boundary wins over the boundary');
}
{
  // db's left border sits 100px inside vpc's left border; a release on
  // vpc's border near db should still go to vpc.
  const r = resolveDropTarget({ x: 301, y: 30 }, [api, vpc, db], {
    borderTolerance: TOL,
    anchoredNodeId: 'api',
    anchoredSide: 'right',
  });
  assert(
    r?.nodeId === 'vpc' && r.side === 'left',
    'boundary border still reachable next to a child node',
  );
}

// --- overlapping nodes: most specific (smallest) wins -------------------------
{
  const big = node('big', { x: 0, y: 200, width: 300, height: 200 });
  const small = node('small', { x: 50, y: 250, width: 100, height: 50 });
  const r = resolveDropTarget({ x: 100, y: 270 }, [big, small], { borderTolerance: TOL });
  assert(r?.nodeId === 'small', 'smaller overlapping node wins');
}

// --- nodes with no anchors (e.g. text annotations) are skipped ---------------
{
  const text: DropCandidate = {
    id: 'note',
    rect: { x: 400, y: 0, width: 200, height: 60 },
    isGroup: false,
    anchors: [],
  };
  assert(
    resolveDropTarget({ x: 500, y: 30 }, [text], { borderTolerance: TOL }) === null,
    'node without anchors is not a target',
  );
}

// --- custom connection points --------------------------------------------------
{
  const r: Rect = { x: 0, y: 0, width: 100, height: 100 };
  const eightWay: Anchor[] = [
    { pointId: 'top-left', side: 'top', x: 0, y: 0 },
    { pointId: 'top', side: 'top', x: 50, y: 0 },
    { pointId: 'top-right', side: 'top', x: 100, y: 0 },
    { pointId: 'right', side: 'right', x: 100, y: 50 },
  ];
  assert(
    pickAnchor(eightWay, 'top', { x: 90, y: 2 })?.pointId === 'top-right',
    'picks the top anchor nearest the pointer',
  );
  assert(
    pickAnchor(eightWay, 'top', { x: 45, y: 2 })?.pointId === 'top',
    'picks the middle top anchor near the middle',
  );
  assert(
    pickAnchor(eightWay, 'bottom', { x: 90, y: 98 })?.pointId === 'right',
    'no anchor on that side -> nearest overall',
  );
  const shape: DropCandidate = { id: 's', rect: r, isGroup: false, anchors: eightWay };
  const res = resolveDropTarget({ x: 8, y: 20 }, [shape], { borderTolerance: TOL });
  assert(
    res?.side === 'left' && res.anchor.pointId === 'top-left',
    'custom shape: nearest side, then nearest anchor',
  );
}

// --- grab handle ids ------------------------------------------------------------
assert(sideFromGrabHandleId('grab-left') === 'left', 'grab-left -> left');
assert(sideFromGrabHandleId('source-left') === null, 'anchor ids are not grab ids');
assert(sideFromGrabHandleId('grab-diagonal') === null, 'unknown side rejected');
assert(sideFromGrabHandleId(null) === null, 'null handle id');

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
// Same exit-status convention as edgeReconnect.verify.ts: reached through
// globalThis because tsconfig.app.json doesn't include node's types.
if (failures > 0) {
  (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
}
