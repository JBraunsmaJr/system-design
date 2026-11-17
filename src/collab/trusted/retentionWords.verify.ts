/**
 * Verification for retentionWords.ts.
 * Run with: npx tsx src/collab/trusted/retentionWords.verify.ts
 */
import { deletedFirstByRecency, describeRetention } from './retentionWords.ts';

let failed = 0;
function check(condition: boolean, name: string) {
  if (!condition) failed += 1;
  console.log(`  ${condition ? '✓' : '✗'} ${name}`);
}

const now = new Date('2026-11-14T12:00:00Z');
const iso = (date: Date) => date.toISOString().slice(0, 10);
const deleted = (purgeAfter: string | null, hold: string | null = null) => ({
  deletedAt: '2026-11-10T00:00:00Z',
  purgeAfter,
  legalHold: hold ? { reason: hold, placedAt: '2026-11-11T00:00:00Z' } : null,
});
const words = (purgeAfter: string | null, hold: string | null = null) =>
  describeRetention(deleted(purgeAfter, hold), now, iso);

console.log('\n=== How long a deleted document is kept ===');
check(
  words('2026-12-10T00:00:00Z') === 'Can be restored until 2026-12-10 (26 days left).',
  'a date, and the days left, rounded up',
);
check(words('2026-11-15T06:00:00Z').endsWith('(1 day left).'), 'one day is singular');
check(
  words('2026-11-14T13:00:00Z').endsWith('(1 day left).'),
  'less than a day still counts as one, never zero',
);
check(/Due to be removed/.test(words('2026-11-14T11:00:00Z')), 'past its date: due for removal');
check(words(null) === 'Kept until an administrator removes it.', 'no retention period');
check(/Kept until an administrator/.test(words('not a date')), 'an unreadable date is not shown');
check(
  /^On hold/.test(words('2026-11-01T00:00:00Z', 'Contract review')) &&
    words('2026-11-01T00:00:00Z', 'Contract review').endsWith('Reason: Contract review'),
  'a hold outranks the date, even a past one, and gives its reason',
);

console.log('\n=== Listing ===');
const list = deletedFirstByRecency([
  { docId: 'a', deletedAt: '2026-11-01T00:00:00Z' },
  { docId: 'live', deletedAt: null },
  { docId: 'b', deletedAt: '2026-11-12T00:00:00Z' },
  { docId: 'c', deletedAt: '2026-11-05T00:00:00Z' },
]);
check(
  list.map((d) => d.docId).join(',') === 'b,c,a',
  'only deleted documents, most recently deleted first',
);

if (failed > 0) console.error(`${failed} check(s) failed`);
