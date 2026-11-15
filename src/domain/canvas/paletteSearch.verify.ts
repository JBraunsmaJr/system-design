/**
 * Checks for palette search and the recently-used list. Run with:
 *
 *   npx tsx src/domain/canvas/paletteSearch.verify.ts
 */
import {
  MAX_RECENT_PALETTE_ENTRIES,
  type PaletteEntry,
  paletteEntryKey,
  searchPalette,
  withRecentPaletteKey,
} from './paletteSearch.ts';

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

const entry = (label: string, group: string): PaletteEntry => ({
  key: paletteEntryKey('node', label),
  id: label,
  label,
  color: '#fff',
  mimeType: 'node',
  group,
});
const entries = [
  entry('Relational Database', 'Data'),
  entry('Message Queue', 'Messaging'),
  entry('Queue Worker', 'Compute'),
  entry('SQS', 'AWS'),
  entry('Dequeue step', 'Logic / Flow'),
  entry('Event Stream', 'Messaging'),
];
const labels = (query: string, limit?: number) =>
  searchPalette(entries, query, limit).map((e) => e.label);

console.log('=== Search ===');
assert(labels('').length === 0 && labels('   ').length === 0, 'an empty query finds nothing');
assert(
  labels('que').join() === 'Queue Worker,Message Queue,Dequeue step',
  'label start, then word start, then anywhere in the label',
);
assert(labels('QUEUE')[0] === 'Queue Worker', 'case is ignored');
assert(
  labels('messaging').join() === 'Message Queue,Event Stream',
  'a group name finds what is filed under it, in palette order',
);
assert(labels('aws').join() === 'SQS', 'including an item whose label says nothing of it');
assert(
  labels('messaging queue').join() === 'Message Queue',
  'every word has to match, in the label or the group',
);
assert(labels('zzz').length === 0, 'no match is an empty list');
assert(labels('e', 2).length === 2, 'results stop at the limit');

console.log('\n=== Recently used ===');
{
  assert(withRecentPaletteKey([], 'a').join() === 'a', 'the first use starts the list');
  assert(withRecentPaletteKey(['a', 'b'], 'c').join() === 'c,a,b', 'the newest goes first');
  assert(withRecentPaletteKey(['a', 'b', 'c'], 'b').join() === 'b,a,c', 'a repeat moves up');
  const full = Array.from({ length: MAX_RECENT_PALETTE_ENTRIES }, (_, i) => `k${i}`);
  const next = withRecentPaletteKey(full, 'new');
  assert(
    next.length === MAX_RECENT_PALETTE_ENTRIES && next[0] === 'new' && !next.includes('k5'),
    'the oldest drops off the end',
  );
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
