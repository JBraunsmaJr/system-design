/**
 * Checks for the coverage counts above the Requirements view and the gap
 * filter they switch on. Run with:
 *
 *   npx tsx src/domain/requirements/requirementsCoverage.verify.ts
 */
import { computeCoverage, percentOf } from './requirementsCoverage.ts';
import {
  activeFilterCount,
  isExpectedOnDiagram,
  isFilterActive,
  itemHasGap,
  itemMatchesFilter,
  normalizeFilter,
  toggleFilterValue,
} from './requirementsFilter.ts';
import { BUILT_IN_ITEM_TYPES, BUILT_IN_RELATIONSHIP_TYPES } from './requirementsRegistry.ts';
import type { RequirementItem, RequirementsDocument } from './requirementsTypes.ts';

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

const items: RequirementItem[] = [
  { id: 'REQ-1', typeId: 'requirement', title: 'Linked and described', body: 'Text' },
  { id: 'REQ-2', typeId: 'requirement', title: 'Described only', body: 'Text' },
  { id: 'GOAL-1', typeId: 'goal', title: 'Neither', body: '   ' },
  { id: 'EPIC-1', typeId: 'epic', title: 'An epic', body: 'Text' },
  { id: 'TICKET-1', typeId: 'ticket', title: 'Done work', body: 'Text', status: 'done' },
  { id: 'TICKET-2', typeId: 'ticket', title: 'Open work', body: '' },
];
const doc: RequirementsDocument = {
  itemTypes: BUILT_IN_ITEM_TYPES,
  categories: [],
  items,
  relationshipTypes: BUILT_IN_RELATIONSHIP_TYPES,
  relationships: [],
  nextSequence: {},
};
const byId = (id: string) => items.find((i) => i.id === id)!;
// TICKET-1 is linked too: a component may point at a ticket, it just isn't
// expected to.
const linkedItemIds = new Set(['REQ-1', 'TICKET-1']);
const context = { doc, linkedItemIds, existingSprintIds: new Set<string>() };

console.log('=== What is expected on the diagram ===');
assert(isExpectedOnDiagram(doc, byId('REQ-1')), 'a requirement is');
assert(isExpectedOnDiagram(doc, byId('GOAL-1')), 'a goal is');
assert(!isExpectedOnDiagram(doc, byId('TICKET-1')), 'a ticket is not');
assert(!isExpectedOnDiagram(doc, byId('EPIC-1')), 'an epic is not');

console.log('\n=== Gaps ===');
assert(!itemHasGap(byId('REQ-1'), 'not-on-diagram', context), 'a linked requirement has no gap');
assert(itemHasGap(byId('REQ-2'), 'not-on-diagram', context), 'an unlinked requirement does');
assert(!itemHasGap(byId('TICKET-2'), 'not-on-diagram', context), 'an unlinked ticket does not');
assert(!itemHasGap(byId('EPIC-1'), 'not-on-diagram', context), 'an unlinked epic does not');
assert(
  itemHasGap(byId('REQ-2'), 'not-on-diagram', { doc }),
  'with no diagram at all, nothing counts as linked',
);
assert(itemHasGap(byId('GOAL-1'), 'no-description', context), 'a blank body is no description');
assert(itemHasGap(byId('TICKET-2'), 'no-description', context), 'for a ticket as well');
assert(!itemHasGap(byId('REQ-1'), 'no-description', context), 'a body is a description');

console.log('\n=== Coverage ===');
{
  const c = computeCoverage(doc, linkedItemIds);
  assert(c.total === 6, 'every item is counted');
  assert(c.descriptive === 3 && c.onDiagram === 1, 'one of three descriptive items is linked');
  assert(c.described === 4, 'four items have a description');
  assert(c.workable === 2 && c.done === 1, 'one of two work items is done');
  const empty = computeCoverage({ ...doc, items: [] }, new Set());
  assert(empty.total === 0 && empty.descriptive === 0, 'an empty document counts nothing');
  assert(percentOf(1, 3) === 33, 'a percentage is rounded');
  assert(percentOf(0, 0) === 100, 'nothing to count reads as complete');
}

console.log('\n=== The gap filter ===');
{
  const matching = (gaps: ('not-on-diagram' | 'no-description')[]) =>
    items.filter((i) => itemMatchesFilter(i, { gaps }, context)).map((i) => i.id);
  assert(
    matching(['not-on-diagram']).join() === 'REQ-2,GOAL-1',
    'not on the diagram: the unlinked descriptive items',
  );
  assert(
    matching(['no-description']).join() === 'GOAL-1,TICKET-2',
    'no description: items of any kind',
  );
  assert(
    matching(['not-on-diagram', 'no-description']).join() === 'REQ-2,GOAL-1,TICKET-2',
    'two gaps are alternatives, like the values of any one dimension',
  );
  const both = items
    .filter((i) => itemMatchesFilter(i, { gaps: ['no-description'], statuses: ['todo'] }, context))
    .map((i) => i.id);
  assert(both.join() === 'TICKET-2', 'a gap and a status both have to hold');

  assert(isFilterActive({ gaps: ['no-description'] }), 'a gap makes the filter active');
  assert(activeFilterCount({ gaps: ['no-description'], tags: ['a'] }) === 2, 'and is counted');
  const on = toggleFilterValue({}, 'gaps', 'not-on-diagram');
  assert(on.gaps?.join() === 'not-on-diagram', 'toggling a gap on');
  assert(toggleFilterValue(on, 'gaps', 'not-on-diagram').gaps === undefined, 'and off again');
  assert(
    normalizeFilter({ gaps: ['no-description', 'made-up', 3] }).gaps?.join() === 'no-description',
    'a stored filter keeps only the gaps that exist',
  );
  assert(normalizeFilter({ gaps: ['made-up'] }).gaps === undefined, 'and drops an empty list');
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
