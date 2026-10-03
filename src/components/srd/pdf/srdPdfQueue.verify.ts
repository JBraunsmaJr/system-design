/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/components/srd/pdf/srdPdfQueue.verify.ts
 */
import { SupersededError, createRenderQueue } from './srdPdfQueue';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) console.log(`ok: ${message}`);
  else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

/** A renderer whose renders finish only when the test finishes them. */
function controlledRenderer() {
  const started: string[] = [];
  const finishers = new Map<string, { ok: () => void; fail: (e: Error) => void }>();
  const run = (input: string) =>
    new Promise<string>((resolve, reject) => {
      started.push(input);
      finishers.set(input, { ok: () => resolve(`pdf:${input}`), fail: reject });
    });
  return {
    run,
    started,
    finish: (input: string) => finishers.get(input)!.ok(),
    fail: (input: string, e: Error) => finishers.get(input)!.fail(e),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

console.log('=== 1. One render at a time ===');
{
  const r = controlledRenderer();
  const request = createRenderQueue(r.run);
  const a = request('A');
  const b = request('B');
  await settle();
  assert(r.started.join() === 'A', 'the second waits while the first runs');
  r.finish('A');
  assert((await a) === 'pdf:A', 'the first resolves with its own PDF');
  await settle();
  assert(r.started.join() === 'A,B', 'then the second starts');
  r.finish('B');
  assert((await b) === 'pdf:B', 'and resolves with its own');
}

console.log('=== 2. A burst of preview renders renders once, for the latest ===');
{
  const r = controlledRenderer();
  const request = createRenderQueue(r.run);
  const first = request('v1', { supersedable: true });
  const outcomes: string[] = [];
  const v2 = request('v2', { supersedable: true }).catch((e) => {
    outcomes.push(e instanceof SupersededError ? 'v2 superseded' : 'v2 failed');
  });
  const v3 = request('v3', { supersedable: true }).catch((e) => {
    outcomes.push(e instanceof SupersededError ? 'v3 superseded' : 'v3 failed');
  });
  const v4 = request('v4', { supersedable: true });
  await settle();
  assert(
    outcomes.join() === 'v2 superseded,v3 superseded',
    'versions overtaken while waiting are dropped',
  );
  r.finish('v1');
  await first;
  await settle();
  assert(r.started.join() === 'v1,v4', 'only the running and the latest render');
  r.finish('v4');
  assert((await v4) === 'pdf:v4', 'and the latest resolves');
  await Promise.all([v2, v3]);
}

console.log('=== 3. An export is never dropped ===');
{
  const r = controlledRenderer();
  const request = createRenderQueue(r.run);
  const preview = request('p1', { supersedable: true });
  const exported = request('export');
  const dropped = request('p2', { supersedable: true }).catch((e) => e);
  const latest = request('p3', { supersedable: true });
  r.finish('p1');
  await preview;
  await settle();
  r.finish('export');
  assert((await exported) === 'pdf:export', 'the export renders, between previews');
  assert((await dropped) instanceof SupersededError, 'a preview overtaken behind it is dropped');
  await settle();
  r.finish('p3');
  await latest;
  assert(r.started.join() === 'p1,export,p3', 'in request order');
}

console.log('=== 4. A failed render does not stop the queue ===');
{
  const r = controlledRenderer();
  const request = createRenderQueue(r.run);
  const bad = request('bad').catch((e: Error) => e.message);
  const good = request('good');
  r.fail('bad', new Error('layout failed'));
  assert((await bad) === 'layout failed', 'its error reaches its caller');
  await settle();
  r.finish('good');
  assert((await good) === 'pdf:good', 'and the next render still runs');
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
if (failures > 0) throw new Error(`${failures} test(s) failed`);
