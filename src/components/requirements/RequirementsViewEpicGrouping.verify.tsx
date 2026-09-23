/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/components/requirements/RequirementsViewEpicGrouping.verify.tsx
 */
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { RequirementsView } from './RequirementsView';
import { RequirementCard } from './RequirementCard';
import {
  BUILT_IN_ITEM_TYPES,
  BUILT_IN_RELATIONSHIP_TYPES,
} from '../../domain/requirementsRegistry';
import type { RequirementsDocument } from '../../domain/requirementsTypes';
import { createLocalRequirementsStore } from '../../collab/requirementsStore';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const testDoc: RequirementsDocument = {
  itemTypes: BUILT_IN_ITEM_TYPES,
  categories: [],
  relationshipTypes: BUILT_IN_RELATIONSHIP_TYPES,
  items: [
    { id: 'EPIC-1', typeId: 'epic', title: 'Checkout', body: '' },
    { id: 'EPIC-2', typeId: 'epic', title: 'Payments', body: '' },
    { id: 'EPIC-3', typeId: 'epic', title: 'Refunds', body: '' },
    { id: 'TICKET-1', typeId: 'ticket', title: 'Shared validation', body: '', status: 'todo' },
    { id: 'TICKET-2', typeId: 'ticket', title: 'Refund endpoint', body: '', status: 'todo' },
    { id: 'REQ-1', typeId: 'requirement', title: 'PCI compliance', body: '' },
  ],
  relationships: [
    { id: 'r1', typeId: 'parent-of', fromItemId: 'EPIC-1', toItemId: 'TICKET-1' },
    { id: 'r2', typeId: 'parent-of', fromItemId: 'EPIC-2', toItemId: 'TICKET-1' },
    { id: 'r3', typeId: 'parent-of', fromItemId: 'EPIC-2', toItemId: 'EPIC-3' },
    { id: 'r4', typeId: 'parent-of', fromItemId: 'EPIC-3', toItemId: 'TICKET-2' },
  ],
  nextSequence: {},
};

function render(props: Partial<React.ComponentProps<typeof RequirementsView>> = {}) {
  return renderToStaticMarkup(
    React.createElement(RequirementsView, {
      requirementsStore: createLocalRequirementsStore(testDoc),
      programIncrements: [],
      initialGroupBy: 'epic',
      ...props,
    }),
  );
}

console.log('=== Group: Epic ===');
{
  const html = render();
  assert(html.includes('>Epic</span>'), 'the grouping toggle offers an Epic option');
  assert(
    count(html, 'class="epic-tree__header"') === 3,
    'each epic (including the nested one) gets a sticky header',
  );
  assert(
    html.includes('--epic-depth:1'),
    'the nested epic header is offset one level down so it stacks below its parent',
  );
  assert(
    count(html, 'data-requirement-id="TICKET-1"') === 2,
    'a ticket under two epics is shown under each',
  );
  assert(
    html.includes('id="requirement-TICKET-1"') && html.includes('id="requirement-TICKET-1--2"'),
    'the two copies get distinct DOM ids',
  );
  assert(
    html.includes('data-section-key="EPIC-1"') && html.includes('data-section-key="EPIC-2"'),
    'each copy records which top-level epic it sits under',
  );
  assert(html.includes('>No epic</h3>'), 'items outside any epic are gathered under "No epic"');
  assert(html.includes('6 items'), 'the toolbar count still counts items, not cards');
}

console.log('=== Group: Epic with a search ===');
{
  const html = render({ initialSearch: 'refund endpoint' });
  assert(html.includes('1 of 1'), 'the match counter counts the item once');
  assert(
    html.includes('data-requirement-id="EPIC-2"') && html.includes('data-requirement-id="EPIC-3"'),
    'the ancestors of a match stay visible for context',
  );
  assert(
    count(html, 'requirement-card is-context') === 2,
    'ancestors shown only for context are dimmed',
  );
  assert(!html.includes('data-requirement-id="EPIC-1"'), 'unrelated epics are hidden');

  const shared = render({ initialSearch: 'shared validation' });
  assert(shared.includes('1 of 1'), 'an item matched in two places still counts as one match');
}

console.log('=== Child quick-add on epic cards ===');
{
  const baseProps = {
    doc: testDoc,
    programIncrements: [],
    onUpdateItem: () => {},
    onDeleteItem: () => {},
    onNavigateToItem: () => {},
    onCreateAndAssignCategory: () => {},
    onDeleteCategory: () => {},
    onAddRelationship: () => null,
    onDeleteRelationship: () => {},
    onAddChildItem: () => 'TICKET-9',
    defaultChildTypeId: 'ticket',
  };
  const epic = testDoc.items[0];
  const ticket = testDoc.items[3];

  const expanded = renderToStaticMarkup(
    React.createElement(RequirementCard, {
      ...baseProps,
      item: epic,
      onToggleCollapsed: () => {},
    }),
  );
  assert(
    expanded.includes('aria-label="Add a child to EPIC-1"'),
    'an epic card has an "Add child" button in its header',
  );
  assert(
    expanded.includes('class="child-quick-add"'),
    'an expanded epic always shows the quick-add row',
  );
  assert(
    expanded.includes('aria-label="Type of new child for EPIC-1"') &&
      expanded.includes('class="type-picker__trigger child-quick-add__type"') &&
      expanded.includes('<span class="type-picker__label">Ticket</span>'),
    "the child's type uses the app's shared type picker, defaulting to Ticket",
  );
  assert(!expanded.includes('<select'), 'no native select is used for the child type');

  const collapsed = renderToStaticMarkup(
    React.createElement(RequirementCard, {
      ...baseProps,
      item: epic,
      isCollapsed: true,
      onToggleCollapsed: () => {},
    }),
  );
  assert(
    !collapsed.includes('child-quick-add'),
    'a collapsed epic hides the quick-add until it is selected',
  );
  const collapsedSelected = renderToStaticMarkup(
    React.createElement(RequirementCard, {
      ...baseProps,
      item: epic,
      isCollapsed: true,
      isSelected: true,
      onToggleCollapsed: () => {},
    }),
  );
  assert(
    collapsedSelected.includes('class="child-quick-add"'),
    'selecting a collapsed epic shows its quick-add',
  );

  const ticketCard = renderToStaticMarkup(
    React.createElement(RequirementCard, { ...baseProps, item: ticket, isSelected: true }),
  );
  assert(
    !ticketCard.includes('child-quick-add') && !ticketCard.includes('Add a child to'),
    'non-epic cards never show the quick-add',
  );
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
if (failures > 0) {
  throw new Error(`${failures} test(s) failed`);
}
