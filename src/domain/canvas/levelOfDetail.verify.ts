/**
 * Checks for the canvas's level of detail. Run with:
 *
 *   npx tsx src/domain/canvas/levelOfDetail.verify.ts
 */
import { lodForZoom, MAX_LOD_SCALE, OVERVIEW_ZOOM } from './levelOfDetail.ts';

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

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

assert(lodForZoom(1).lod === 'detail' && lodForZoom(1).scale === 1, 'full size is full detail');
assert(lodForZoom(OVERVIEW_ZOOM).lod === 'detail', 'the threshold itself is still detail');
assert(lodForZoom(OVERVIEW_ZOOM - 0.01).lod === 'overview', 'just under it is the overview');
assert(near(lodForZoom(0.4).scale, 2.1), 'at 40% names are drawn 2.1 times larger');
assert(
  lodForZoom(0.3).scale > lodForZoom(0.5).scale,
  'the further out the view, the larger the names',
);
assert(near(lodForZoom(0.05).scale, MAX_LOD_SCALE), 'up to a limit');
assert(
  near(lodForZoom(0.401).scale, lodForZoom(0.399).scale),
  'a small change in zoom keeps the same step',
);
assert(
  lodForZoom(0).lod === 'detail' && lodForZoom(Number.NaN).lod === 'detail',
  'a zoom that makes no sense is detail',
);
// What the name measures on screen: its size at 100% times scale times zoom.
for (const zoom of [0.55, 0.45, 0.35, 0.31]) {
  const onScreen = lodForZoom(zoom).scale * zoom;
  assert(onScreen >= 0.74, `at ${zoom * 100}% a name is at least 74% of full size on screen`);
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
