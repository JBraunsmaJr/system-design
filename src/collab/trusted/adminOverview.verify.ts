/**
 * What the store administration page works out from the store's replies.
 *
 *   npx tsx src/collab/trusted/adminOverview.verify.ts
 */
import {
  describeMembership,
  describeWhen,
  groupsAcross,
  inBatches,
  peopleAcross,
  sortWorkspaceRows,
  summarizeWorkspace,
  type WorkspaceDetail,
} from './adminOverview.ts';
import type { TrustedDocument, TrustedWorkspace } from './trustedStoreClient.ts';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ok: ${message}`);
  } else {
    failures++;
    console.log(`  FAIL: ${message}`);
  }
}

const workspace = (
  id: string,
  name: string,
  archivedAt: string | null = null,
): TrustedWorkspace => ({
  workspaceId: id,
  name,
  createdAt: '2026-01-01T00:00:00Z',
  archivedAt,
  role: 'owner',
  via: { kind: 'admin' },
});
const doc = (id: string, updatedAt: string, deletedAt: string | null = null): TrustedDocument => ({
  docId: id,
  workspaceId: 'w',
  title: id,
  createdAt: '2026-01-02T00:00:00Z',
  version: 1,
  updatedAt,
  deletedAt,
  purgeAfter: null,
  legalHold: null,
});
const member = (
  userId: string,
  displayName: string | null,
  role: 'viewer' | 'editor' | 'owner',
) => ({
  userId,
  displayName,
  role,
  addedAt: '2026-01-01T00:00:00Z',
});
const mapping = (group: string, role: 'viewer' | 'editor' | 'owner') => ({
  group,
  role,
  addedAt: '2026-01-01T00:00:00Z',
});

const platform: WorkspaceDetail = {
  workspace: workspace('p', 'Platform'),
  members: [member('u1', 'Ada', 'owner'), member('u2', null, 'viewer')],
  groups: [mapping('/platform-eng', 'editor')],
  documents: [
    doc('a', '2026-03-01T10:00:00Z'),
    doc('b', '2026-02-01T10:00:00Z', '2026-03-05T10:00:00Z'),
  ],
};
const payments: WorkspaceDetail = {
  workspace: workspace('q', 'Payments'),
  members: [member('u1', 'Ada', 'editor')],
  groups: [mapping('/platform-eng', 'viewer'), mapping('/pay', 'owner')],
  documents: [],
};
const old: WorkspaceDetail = {
  workspace: workspace('o', 'Archive me', '2026-02-10T00:00:00Z'),
  members: [member('u3', 'Zed', 'owner')],
  groups: [mapping('/old', 'owner')],
  documents: [],
};

console.log('=== A workspace in one line ===');
{
  const row = summarizeWorkspace(platform);
  assert(row.memberCount === 2 && row.groupCount === 1, 'people and groups are counted apart');
  assert(row.documentCount === 1 && row.deletedCount === 1, 'deleted documents are not documents');
  assert(row.lastActivity === '2026-03-05T10:00:00Z', 'a deletion is activity too');
  assert(
    summarizeWorkspace(payments).lastActivity === '2026-01-01T00:00:00Z',
    'an empty workspace was last active when it was created',
  );
  assert(summarizeWorkspace(old).archived, 'an archived workspace says so');
  assert(
    summarizeWorkspace(old).lastActivity === '2026-02-10T00:00:00Z',
    'and archiving it was its last activity',
  );
  assert(
    sortWorkspaceRows([old, platform, payments].map(summarizeWorkspace))
      .map((r) => r.name)
      .join() === 'Payments,Platform,Archive me',
    'active workspaces by name, archived ones last',
  );
}

console.log('\n=== The Members column ===');
assert(describeMembership({ memberCount: 12, groupCount: 2 }) === '12 people, 2 groups', 'both');
assert(describeMembership({ memberCount: 1, groupCount: 0 }) === '1 person', 'one person');
assert(describeMembership({ memberCount: 0, groupCount: 1 }) === '1 group', 'only a group');
assert(describeMembership({ memberCount: 0, groupCount: 0 }) === '0 people', 'nobody');

console.log('\n=== People and groups across the store ===');
{
  const people = peopleAcross([platform, payments, old]);
  assert(people.length === 2, 'each person once; none from an archived workspace');
  assert(people[0].displayName === 'Ada', 'by name');
  assert(
    people[0].grants.map((g) => `${g.workspaceName}:${g.role}`).join() ===
      'Payments:editor,Platform:owner',
    'with every workspace they are in and their role there',
  );
  const groups = groupsAcross([platform, payments, old]);
  assert(groups.map((g) => g.group).join() === '/pay,/platform-eng', 'each group once, by name');
  assert(
    groups[1].grants.map((g) => `${g.workspaceName}:${g.role}`).join() ===
      'Payments:viewer,Platform:editor',
    'with the role it gives in each workspace',
  );
}

console.log('\n=== When ===');
{
  const now = new Date('2026-03-10T12:00:00Z');
  const ago = (ms: number) => describeWhen(new Date(now.getTime() - ms).toISOString(), now);
  const MIN = 60000;
  const DAY = 24 * 60 * MIN;
  assert(ago(10000) === 'Just now', 'seconds');
  assert(ago(MIN) === '1 minute ago' && ago(2 * MIN) === '2 minutes ago', 'minutes');
  assert(ago(3 * 60 * MIN) === '3 hours ago', 'hours');
  assert(ago(DAY) === 'Yesterday' && ago(3 * DAY) === '3 days ago', 'days');
  assert(ago(21 * DAY) === '3 weeks ago', 'weeks');
  assert(ago(90 * DAY) === '3 months ago', 'months');
  assert(ago(-5 * MIN) === 'Just now', 'a clock a little ahead is not the future');
  assert(describeWhen('nonsense', now) === '', 'no date, no words');
}

console.log('\n=== A few at a time ===');
{
  let running = 0;
  let most = 0;
  const results = await inBatches([5, 1, 4, 2, 3, 6, 7], 3, async (n) => {
    running++;
    most = Math.max(most, running);
    await new Promise((resolve) => setTimeout(resolve, n));
    running--;
    return n * 2;
  });
  assert(results.join() === '10,2,8,4,6,12,14', 'results keep the order asked');
  assert(most === 3, 'never more than the limit at once');
  assert((await inBatches([], 3, async (n: number) => n)).length === 0, 'nothing is nothing');
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  throw new Error('adminOverview checks failed');
}
console.log('\nALL PASSED');
