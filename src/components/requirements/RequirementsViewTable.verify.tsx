/**
 * Checks for the Requirements view's table layout and the coverage line
 * above it.
 *
 * Run with:
 *   npx tsx --tsconfig tsconfig.app.json src/components/requirements/RequirementsViewTable.verify.tsx
 */
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { RequirementsView } from './RequirementsView';
import { RequirementsCoverageBar } from './RequirementsCoverageBar';
import { type ItemViewContext, RequirementItemView } from './RequirementItemView';
import {
  BUILT_IN_ITEM_TYPES,
  BUILT_IN_RELATIONSHIP_TYPES,
} from '../../domain/requirements/requirementsRegistry';
import type { RequirementsDocument } from '../../domain/requirements/requirementsTypes';
import { createLocalRequirementsStore } from '../../collab/stores/requirementsStore';
import type { SubDiagram } from '../../domain/canvas/types';

/** React separates adjacent text pieces with empty comments; they only get
 * in the way of reading the markup as text. */
const renderPlain = (element: React.ReactElement) =>
  renderToStaticMarkup(element).replaceAll('<!-- -->', '');

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
    console.error(`FAIL: ${message}`);
  }
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** The markup of the table row for `itemId`, up to the next row. */
function rowOf(html: string, itemId: string): string {
  const start = html.indexOf(`data-requirement-id="${itemId}"`);
  if (start === -1) return '';
  const next = html.indexOf('data-requirement-id="', start + 1);
  return html.slice(start, next === -1 ? undefined : next);
}

const doc: RequirementsDocument = {
  itemTypes: BUILT_IN_ITEM_TYPES,
  categories: [{ id: 'cat-1', label: 'Checkout', color: '#3b82f6' }],
  relationshipTypes: BUILT_IN_RELATIONSHIP_TYPES,
  items: [
    { id: 'EPIC-1', typeId: 'epic', title: 'Checkout', body: 'The epic.' },
    {
      id: 'REQ-1',
      typeId: 'requirement',
      title: 'Guest checkout',
      priority: 'must',
      lifecycle: 'approved',
      ownerId: 'm-1',
      targetMilestoneId: 'ms-1',
      verificationNote: 'checkout-e2e',
      body: 'Described.\n\n- [x] No account needed\n- [ ] Works on mobile',
      verificationMethod: 'test',
      verificationStatus: 'passing',
    },
    { id: 'REQ-2', typeId: 'requirement', title: 'Saved carts', body: '' },
    {
      id: 'TICKET-1',
      typeId: 'ticket',
      title: 'Build the form',
      body: 'Do it.',
      status: 'in-progress',
      sprintId: 'sp-1',
      assigneeId: 'm-1',
    },
  ],
  relationships: [
    { id: 'r1', typeId: 'parent-of', fromItemId: 'EPIC-1', toItemId: 'REQ-1' },
    { id: 'r2', typeId: 'parent-of', fromItemId: 'EPIC-1', toItemId: 'TICKET-1' },
  ],
  nextSequence: {},
};

const diagramRoot = {
  nodes: [
    {
      id: 'n1',
      type: 'service',
      position: { x: 0, y: 0 },
      data: { label: 'Order Service', linkedRequirementIds: ['REQ-1'] },
    },
  ],
  edges: [],
} as unknown as SubDiagram;

const programIncrements = [
  {
    id: 'pi-1',
    name: 'PI 1',
    startDate: '2026-01-05',
    sprints: [{ id: 'sp-1', name: 'Sprint 1', durationDays: 14 }],
  },
];

const team = {
  members: [{ id: 'm-1', name: 'Ana Ruiz', role: 'Engineer', avatarColor: '#fff' }],
} as unknown as React.ComponentProps<typeof RequirementsView>['team'];

function render(props: Partial<React.ComponentProps<typeof RequirementsView>> = {}): string {
  return renderPlain(
    <RequirementsView
      requirementsStore={createLocalRequirementsStore(doc)}
      programIncrements={programIncrements}
      team={team}
      diagramRoot={diagramRoot}
      {...props}
    />,
  );
}

console.log('=== The table is where the view opens ===');
{
  const html = render({ initialGroupBy: 'type' });
  assert(html.includes('role="table"'), 'with no stored preference the table is shown');
  assert(count(html, 'class="requirements-table__row') === 4, 'one line per item');
  assert(!html.includes('class="requirement-card'), 'and no card until a line is opened');
  assert(count(html, 'class="requirements-table__section"') === 3, 'a heading per type in use');

  const req1 = rowOf(html, 'REQ-1');
  assert(req1.includes('Guest checkout'), 'a line has the title');
  assert(req1.includes('Order Service'), 'and the component linked to it');
  assert(!req1.includes('Not linked'), 'which is not flagged');
  assert(rowOf(html, 'REQ-2').includes('Not linked'), 'an unlinked requirement is flagged');

  const ticket = rowOf(html, 'TICKET-1');
  assert(ticket.includes('In Progress'), 'a ticket shows its status');
  assert(!ticket.includes('Not linked'), 'and is not expected on the diagram');
  assert(!rowOf(html, 'EPIC-1').includes('Not linked'), 'neither is an epic');
}

console.log('\n=== Grouped by epic ===');
{
  const html = render({ initialGroupBy: 'epic' });
  assert(count(html, 'class="requirements-table__row') === 4, 'every item has a line');
  assert(
    html.indexOf('data-requirement-id="EPIC-1"') < html.indexOf('data-requirement-id="REQ-1"'),
    'children follow their epic',
  );
  assert(rowOf(html, 'REQ-1').includes('padding-left:18px'), 'indented one step');
  assert(
    rowOf(html, 'EPIC-1').includes('aria-label="Hide the items under EPIC-1"'),
    'the epic can fold them away',
  );
  assert(html.includes('No epic'), 'items under no epic get a heading');
}

console.log('\n=== The other layouts are still there ===');
{
  const cards = render({ initialLayout: 'list', initialGroupBy: 'type' });
  assert(
    cards.includes('title="Verification: Test - Verified') &&
      cards.includes('title="Verification: Not verified'),
    'cards: a requirement has a verification control',
  );
  assert(
    (cards.match(/title="Verification:/g) ?? []).length === 2,
    'cards: and only requirements do',
  );
  assert(cards.includes('No criteria'), 'cards: a requirement with no criteria is flagged');
  assert(!cards.includes('role="table"'), 'cards: no table');
  assert(
    (cards.match(/class="requirement-card[ "]/g) ?? []).length === 4,
    'cards: a card per item',
  );
  const split = render({ initialLayout: 'split', initialGroupBy: 'type' });
  assert(split.includes('requirements-split'), 'split: the outline and detail');

  /** The outline row for `itemId`, up to the next row. */
  const outlineRow = (itemId: string) => {
    const start = split.indexOf(`data-outline-id="${itemId}"`);
    const next = split.indexOf('data-outline-id="', start + 1);
    // The last row ends where the legend starts, before the detail pane.
    const end = next === -1 ? split.indexOf('requirements-outline__legend') : next;
    return start === -1 ? '' : split.slice(start, end);
  };
  assert(
    outlineRow('REQ-1').includes('aria-label="On the diagram"'),
    'split: a linked requirement is marked as on the diagram',
  );
  assert(
    outlineRow('REQ-2').includes('aria-label="Not on the diagram"'),
    'split: an unlinked one is flagged',
  );
  assert(
    !outlineRow('TICKET-1').includes('the diagram"') &&
      !outlineRow('EPIC-1').includes('the diagram"'),
    'split: work and epics carry neither mark',
  );
  assert(split.includes('requirements-outline__legend'), 'split: the marks are explained');
}

console.log('\n=== Coverage ===');
{
  const html = render({ initialGroupBy: 'type' });
  assert(html.includes('requirements-coverage'), 'the coverage line is shown');
  assert(/On the diagram.*?>1<.*?\/2</s.test(html), 'one of two requirements is on the diagram');
  assert(/Work done.*?>0<.*?\/1</s.test(html), 'none of the one ticket is done');
  assert(/Acceptance criteria.*?>1<.*?\/2</s.test(html), 'one of two requirements has criteria');
  assert(/Verified.*?>1<.*?\/2</s.test(html), 'and one of two is verified');

  /** The count on the gap chip labeled `label`, or null if it isn't shown. */
  const chip = (label: string) =>
    new RegExp(`requirements-view__gap"[^>]*>${label}<span[^>]*>(\\d+)<`).exec(html)?.[1] ?? null;
  assert(chip('Not on diagram') === '1', 'a chip offers the one requirement not on the diagram');
  assert(chip('Not verified') === '1', 'the one not verified');
  assert(chip('No acceptance criteria') === '1', 'the one with no criteria');
  assert(chip('No description') === '1', 'and the one item with nothing written');
  assert(!html.includes('aria-pressed="true" class="requirements-view__gap'), 'none is on yet');

  const req1 = rowOf(html, 'REQ-1');
  assert(
    req1.includes('is-ok') && req1.includes('Test passing') && req1.includes('>1/2<'),
    'a verified requirement shows how it is verified and its criteria',
  );
  assert(
    req1.includes('Must') && req1.includes('Approved'),
    'a requirement shows its priority and its own status',
  );
  const req2 = rowOf(html, 'REQ-2');
  assert(
    req2.includes('is-warning') && req2.includes('No method'),
    'one with no method chosen says so',
  );
  assert(
    !rowOf(html, 'TICKET-1').includes('requirements-table__verification is-'),
    'a ticket has no verification',
  );
  assert(/Requirements<.*?50% verified/s.test(html), 'a group says how much of it is verified');
  assert(count(html, '% verified') === 1, 'a group with nothing to verify does not');

  const empty = renderPlain(
    <RequirementsView
      requirementsStore={createLocalRequirementsStore({ ...doc, items: [], relationships: [] })}
      programIncrements={[]}
    />,
  );
  assert(!empty.includes('requirements-coverage'), 'an empty document shows no coverage line');

  const complete = renderPlain(
    <RequirementsCoverageBar
      coverage={{
        total: 2,
        described: 2,
        descriptive: 2,
        onDiagram: 2,
        workable: 0,
        done: 0,
        verifiable: 0,
        withCriteria: 0,
        verified: 0,
      }}
    />,
  );
  assert(!complete.includes('Work done'), 'with no work items there is no work measure');
  assert(!complete.includes('Verified'), 'and with nothing to verify, no verification measures');
}

const context: ItemViewContext = {
  doc,
  programIncrements,
  team,
  members: [{ id: 'm-1', name: 'Ana Ruiz' }],
  milestones: [{ id: 'ms-1', name: 'Release 2.4' }],
  tagSuggestions: [],
  onUpdateItem: () => undefined,
  onDeleteItem: () => undefined,
  onCreateAndAssignCategory: () => undefined,
  onDeleteCategory: () => undefined,
  onAddRelationship: () => null,
  onDeleteRelationship: () => undefined,
  onNavigateToNode: () => undefined,
  onCreateLinkedNode: () => undefined,
  preferredVerbKeyFor: () => undefined,
  peers: [],
};
const open = (id: string, variant: 'row' | 'page', linked = false) =>
  renderPlain(
    <RequirementItemView
      variant={variant}
      item={doc.items.find((i) => i.id === id)!}
      linkedNodes={
        linked ? [{ nodeId: 'n1', label: 'Order Service', path: [], hasSubDiagram: false }] : []
      }
      context={context}
      onNavigateToItem={() => undefined}
    />,
  );
/** What the menu labeled `label` shows as chosen. */
const chosen = (html: string, label: string) =>
  new RegExp(`aria-label="${label}: ([^"]*)"`).exec(html)?.[1];

console.log('\n=== An opened item is edited where it stands ===');
for (const variant of ['row', 'page'] as const) {
  const html = open('REQ-1', variant, true);
  assert(!html.includes('class="requirement-card'), `${variant}: it is not a card`);
  assert(!/>\s*(Edit|Done)\s*</.test(html), `${variant}: there is no edit mode to enter or leave`);
  assert(
    /<input[^>]*class="requirement-item__title[^"]*"[^>]*value="Guest checkout"/.test(html),
    `${variant}: the title is a text box`,
  );
  assert(
    html.includes('type-picker') && html.includes('aria-label="Delete REQ-1"'),
    `${variant}: its type can be changed and it can be deleted`,
  );
  assert(
    html.includes('>Statement') && html.includes('Described.'),
    `${variant}: shows the statement`,
  );
  assert(
    html.includes('aria-label="Edit the description of REQ-1"'),
    `${variant}: which can be edited`,
  );
  assert(html.includes('1 of 2 met'), `${variant}: counts the criteria`);
  assert(count(html, 'role="checkbox"') === 2, `${variant}: each is a box to check`);
  assert(count(html, 'aria-label="Remove the criterion') === 2, `${variant}: and can be removed`);
  assert(
    html.includes('aria-label="Add an acceptance criterion to REQ-1"'),
    `${variant}: one can be added`,
  );
  assert(html.includes('Add relationship'), `${variant}: relationships are added in place`);
  assert(
    html.includes('Order Service') && html.includes('New component'),
    `${variant}: components are listed, and one can be created`,
  );
  assert(
    html.includes('title="Verification: Test - Verified'),
    `${variant}: verification is set in place`,
  );
  assert(html.includes('value="checkout-e2e"'), `${variant}: with its note`);
  assert(chosen(html, 'Status') === 'Approved', `${variant}: status`);
  assert(chosen(html, 'Priority') === 'Must', `${variant}: priority`);
  assert(chosen(html, 'Owner') === 'Ana Ruiz', `${variant}: owner, a team member`);
  assert(chosen(html, 'Target') === 'Release 2.4', `${variant}: target milestone`);
  assert(!html.includes('<select'), `${variant}: the menus are the app's own, not the browser's`);
}
{
  const page = open('REQ-1', 'page', true);
  assert(page.includes('Show on diagram'), 'the page has the way to the diagram');
  for (const panel of ['Acceptance criteria', 'Verification', 'On the diagram', 'Relationships']) {
    assert(page.includes(`requirement-panel__title">${panel}<`), `the page has a ${panel} panel`);
  }

  const req2 = open('REQ-2', 'page');
  assert(!req2.includes('Show on diagram'), 'an unlinked item has no way to the diagram');
  assert(req2.includes('No component is linked to this yet'), 'and says what is missing');
  assert(req2.includes('Write a description'), 'an item with nothing written offers to write it');
  assert(
    chosen(req2, 'Status') === 'Draft' &&
      chosen(req2, 'Priority') === 'Not set' &&
      chosen(req2, 'Owner') === 'No owner' &&
      chosen(req2, 'Target') === 'No target',
    'with nothing set it reads as a draft with no priority, owner or target',
  );

  const ticket = open('TICKET-1', 'row');
  assert(
    ticket.includes('In Progress') && ticket.includes('Sprint 1') && ticket.includes('Ana Ruiz'),
    'a ticket has its status, sprint and assignee pickers',
  );
  assert(
    !ticket.includes('requirement-attributes') &&
      !ticket.includes('title="Verification:') &&
      !ticket.includes('On the diagram'),
    'and no requirement values, verification or diagram part',
  );

  const split = render({ initialLayout: 'split', initialGroupBy: 'type' });
  assert(
    split.includes('class="requirement-page"') && !split.includes('class="requirement-card'),
    'the split view opens the item as a page, with no card anywhere',
  );
  const epic = render({ initialLayout: 'split', initialGroupBy: 'epic' });
  assert(
    epic.includes('requirement-children__row') && epic.includes('title="Open REQ-1"'),
    "an epic's children are listed as rows that open",
  );
  assert(epic.includes('class="child-quick-add"'), 'and a child can be added under it');
}

console.log('\n=== Who else is editing ===');
{
  const peer = (clientId: number, name: string, focusedItemId: string | null) =>
    ({
      clientId,
      name,
      color: '#f00',
      focusedItemId,
    }) as unknown as ItemViewContext['peers'][number];
  const withPeers = (id: string, variant: 'row' | 'page') =>
    renderPlain(
      <RequirementItemView
        variant={variant}
        item={doc.items.find((i) => i.id === id)!}
        linkedNodes={[]}
        context={{
          ...context,
          peers: [peer(1, 'Ben', 'REQ-1'), peer(2, 'Cara', 'REQ-1'), peer(3, 'Dev', 'REQ-2')],
        }}
        onNavigateToItem={() => undefined}
      />,
    );
  for (const variant of ['row', 'page'] as const) {
    const html = withPeers('REQ-1', variant);
    assert(
      html.includes('title="Ben, Cara are editing this"'),
      `${variant}: names the people editing this item`,
    );
    assert(count(html, 'requirement-card__peer-dot') === 2, `${variant}: one badge each`);
    assert(!html.includes('Dev'), `${variant}: and not someone on another item`);
    assert(html.includes('has-peers'), `${variant}: the item is marked as being edited`);
  }
  assert(
    withPeers('REQ-2', 'row').includes('title="Dev is editing this"'),
    'one person reads in the singular',
  );
  assert(
    !open('REQ-1', 'row').includes('requirement-card__peers'),
    'outside a session there is nothing',
  );

  const table = render({
    initialGroupBy: 'type',
    peers: [peer(1, 'Ben', 'REQ-1'), peer(2, 'Cara', 'REQ-1'), peer(3, 'Dev', null)],
  });
  assert(
    rowOf(table, 'REQ-1').includes('aria-label="Ben, Cara are editing this"'),
    'a table line shows a dot for the people editing its item',
  );
  assert(count(table, 'requirements-table__editing') === 1, 'and only that line does');
  assert(
    !render({ initialGroupBy: 'type' }).includes('requirements-table__editing'),
    'outside a session no line has one',
  );
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
if (failures > 0) {
  (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
}
