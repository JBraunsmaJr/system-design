/**
 * Collapsible cards, remembered relationship types, the split view, stored
 * view preferences and peek excerpts. Run with:
 *
 *   npx tsx --tsconfig tsconfig.app.json src/components/requirements/RequirementsViewLayout.verify.tsx
 */
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { RequirementsView } from './RequirementsView';
import { RequirementCard } from './RequirementCard';
import { RelationshipManager } from './RelationshipManager';
import { RequirementsOutline } from './RequirementsOutline';
import { buildEpicTree } from '../../domain/requirementsHierarchy';
import {
  BUILT_IN_ITEM_TYPES,
  BUILT_IN_RELATIONSHIP_TYPES,
} from '../../domain/requirementsRegistry';
import type { RequirementsDocument } from '../../domain/requirementsTypes';
import { createLocalRequirementsStore } from '../../collab/requirementsStore';
import {
  loadRequirementsViewPrefs,
  saveRequirementsViewPrefs,
} from '../../domain/requirementsViewPrefs';
import { markdownExcerpt } from '../../domain/markdownExcerpt';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

const doc: RequirementsDocument = {
  itemTypes: BUILT_IN_ITEM_TYPES,
  categories: [],
  relationshipTypes: BUILT_IN_RELATIONSHIP_TYPES,
  items: [
    { id: 'EPIC-1', typeId: 'epic', title: 'Checkout', body: 'The **whole** checkout flow' },
    { id: 'EPIC-2', typeId: 'epic', title: 'Refunds', body: '' },
    { id: 'TICKET-1', typeId: 'ticket', title: 'Cart page', body: '', status: 'todo' },
    { id: 'TICKET-2', typeId: 'ticket', title: 'Refund API', body: '', status: 'done' },
  ],
  relationships: [
    { id: 'r1', typeId: 'parent-of', fromItemId: 'EPIC-1', toItemId: 'EPIC-2' },
    { id: 'r2', typeId: 'parent-of', fromItemId: 'EPIC-1', toItemId: 'TICKET-1' },
    { id: 'r3', typeId: 'parent-of', fromItemId: 'EPIC-2', toItemId: 'TICKET-2' },
  ],
  nextSequence: {},
};

const cardProps = {
  doc,
  programIncrements: [],
  onUpdateItem: () => {},
  onDeleteItem: () => {},
  onNavigateToItem: () => {},
  onCreateAndAssignCategory: () => {},
  onDeleteCategory: () => {},
  onAddRelationship: () => null,
  onDeleteRelationship: () => {},
};

console.log('=== Collapsible cards ===');
{
  const expanded = renderToStaticMarkup(
    React.createElement(RequirementCard, {
      ...cardProps,
      item: doc.items[0],
      onToggleCollapsed: () => {},
    }),
  );
  assert(
    expanded.includes('aria-label="Collapse EPIC-1"') && expanded.includes('aria-expanded="true"'),
    'a collapsible card has a collapse toggle in its header',
  );
  assert(expanded.includes('relationship-manager'), 'an expanded card shows its relationships');

  const collapsed = renderToStaticMarkup(
    React.createElement(RequirementCard, {
      ...cardProps,
      item: doc.items[0],
      isCollapsed: true,
      onToggleCollapsed: () => {},
    }),
  );
  assert(
    collapsed.includes('requirement-card is-collapsed') &&
      collapsed.includes('aria-label="Expand EPIC-1"'),
    'a collapsed card is marked collapsed and offers Expand',
  );
  assert(
    collapsed.includes('Checkout') &&
      !collapsed.includes('requirement-body') &&
      !collapsed.includes('relationship-manager'),
    'a collapsed card keeps its title but hides the body and relationships',
  );

  const notCollapsible = renderToStaticMarkup(
    React.createElement(RequirementCard, { ...cardProps, item: doc.items[0], isCollapsed: true }),
  );
  assert(
    notCollapsible.includes('requirement-body') && !notCollapsible.includes('Collapse EPIC-1'),
    'without onToggleCollapsed (the split view’s open item) a card is always expanded',
  );

  const openable = renderToStaticMarkup(
    React.createElement(RequirementCard, {
      ...cardProps,
      item: doc.items[2],
      onOpenItem: () => {},
    }),
  );
  assert(openable.includes('aria-label="Open TICKET-1"'), 'child cards can offer an Open button');
}

console.log('=== Remembered relationship type ===');
{
  // The picker's label is only rendered while it's open, so check the
  // choice logic through what the closed manager exposes: nothing breaks
  // with or without a preference, and an unknown preference is ignored.
  const withPreference = renderToStaticMarkup(
    React.createElement(RelationshipManager, {
      itemId: 'EPIC-1',
      doc,
      onAddRelationship: () => null,
      onDeleteRelationship: () => {},
      onNavigateToItem: () => {},
      preferredVerbKey: 'parent-of::forward',
    }),
  );
  const withUnknown = renderToStaticMarkup(
    React.createElement(RelationshipManager, {
      itemId: 'EPIC-1',
      doc,
      onAddRelationship: () => null,
      onDeleteRelationship: () => {},
      onNavigateToItem: () => {},
      preferredVerbKey: 'no-such-type::forward',
    }),
  );
  assert(
    withPreference.includes('Add relationship') && withUnknown.includes('Add relationship'),
    'the relationship manager renders with a remembered verb, and ignores one that no longer exists',
  );
  assert(
    !withPreference.includes(' title="Go to'),
    'relationship chips use the hover peek rather than a native tooltip',
  );
}

console.log('=== Split view ===');
{
  const html = renderToStaticMarkup(
    React.createElement(RequirementsView, {
      requirementsStore: createLocalRequirementsStore(doc),
      programIncrements: [],
      initialGroupBy: 'epic',
      initialLayout: 'split',
    }),
  );
  assert(html.includes('class="requirements-split"'), 'the split layout renders');
  assert(
    html.includes('role="tree"') &&
      html.includes('data-outline-id="EPIC-1"') &&
      html.includes('data-outline-id="TICKET-2"'),
    'the outline lists every item, nested epics included',
  );
  assert(
    html.includes('padding-left:34px'),
    'outline rows are indented by depth (TICKET-2 is two levels down)',
  );
  assert(
    /aria-selected="true"[^>]*data-outline-id="EPIC-1"/.test(html),
    'with nothing chosen, the first item is open',
  );
  assert(
    html.includes('data-section-key="__detail__"') && html.includes('data-requirement-id="EPIC-1"'),
    'the open item is shown in full in the detail pane',
  );
  assert(
    html.includes('Children <span class="requirements-split__children-count">2</span>') &&
      html.includes('class="requirements-split__children-toggle"') &&
      html.includes('aria-label="Open EPIC-2"') &&
      html.includes('aria-label="Open TICKET-1"'),
    "the open item's children are listed beneath it, each with an Open button",
  );
  assert(
    html.includes('class="child-quick-add"'),
    'the open epic has its quick-add row, so tickets can be added right under it',
  );
  assert(
    html.includes('>List</span>') && html.includes('>Split</span>'),
    'the toolbar offers List and Split',
  );
  assert(
    html.includes('aria-label="Collapse all cards"') &&
      html.includes('aria-label="Expand all cards"'),
    'the toolbar offers Collapse all and Expand all',
  );
}

console.log('=== Outline folding ===');
{
  const base = {
    doc,
    groups: [
      { key: 'epic', label: 'Epics', color: '#a0f', items: doc.items.slice(0, 2) },
      { key: 'ticket', label: 'Tickets', color: '#0af', items: doc.items.slice(2) },
    ],
    sectionKeyPrefix: 'type',
    noEpicSectionKey: '__no-epic__',
    selectedId: null,
    onSelect: () => {},
    foldedIds: new Set<string>(),
    onToggleFolded: () => {},
    collapsedSectionKeys: new Set<string>(),
    onToggleSection: () => {},
    onCollapseAll: () => {},
    onExpandAll: () => {},
  };
  const open = renderToStaticMarkup(React.createElement(RequirementsOutline, base));
  assert(
    open.includes('aria-expanded="true"') && open.includes('>Tickets</span>'),
    'each group has a foldable header',
  );
  assert(open.includes('4 of 4 shown'), 'the outline header counts visible rows');

  const sectionFolded = renderToStaticMarkup(
    React.createElement(RequirementsOutline, {
      ...base,
      collapsedSectionKeys: new Set(['type:ticket']),
    }),
  );
  assert(
    !sectionFolded.includes('data-outline-id="TICKET-1"') &&
      sectionFolded.includes('data-outline-id="EPIC-1"') &&
      sectionFolded.includes('2 of 4 shown'),
    'folding a group hides only its rows',
  );

  const tree = buildEpicTree(doc);
  const treeOpen = renderToStaticMarkup(
    React.createElement(RequirementsOutline, { ...base, groups: [], epicTree: tree }),
  );
  assert(
    treeOpen.includes('requirements-outline__row is-pinned') &&
      treeOpen.includes('top:34px') &&
      treeOpen.includes('top:62px'),
    'unfolded parents are pinned, nested ones one row lower',
  );
  const treeFolded = renderToStaticMarkup(
    React.createElement(RequirementsOutline, {
      ...base,
      groups: [],
      epicTree: tree,
      foldedIds: new Set(['EPIC-2']),
    }),
  );
  assert(
    !treeFolded.includes('data-outline-id="TICKET-2"') &&
      treeFolded.includes('data-outline-id="EPIC-2"'),
    'folding a parent hides the items under it',
  );
  const searching = renderToStaticMarkup(
    React.createElement(RequirementsOutline, {
      ...base,
      groups: [],
      epicTree: tree,
      foldedIds: new Set(['EPIC-1', 'EPIC-2']),
      searchQuery: 'refund',
    }),
  );
  assert(
    searching.includes('data-outline-id="TICKET-2"'),
    'a search shows matches inside folded parents',
  );
  assert(
    /<button[^>]*disabled=""[^>]*title="Fold every group/.test(searching) ||
      /title="Fold every group[^"]*"[^>]*disabled=""/.test(searching),
    'Collapse all is disabled while searching',
  );
}

console.log('=== Stored view preferences ===');
{
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  };
  saveRequirementsViewPrefs('doc-a', { groupBy: 'epic', collapsedIds: ['EPIC-1'] });
  saveRequirementsViewPrefs('doc-a', {
    layout: 'split',
    lastVerbByTypeId: { epic: 'blocks::forward' },
  });
  const a = loadRequirementsViewPrefs('doc-a');
  assert(
    a.groupBy === 'epic' &&
      a.layout === 'split' &&
      a.collapsedIds?.[0] === 'EPIC-1' &&
      a.lastVerbByTypeId?.epic === 'blocks::forward',
    'preferences merge across saves and round-trip',
  );
  assert(
    Object.keys(loadRequirementsViewPrefs('doc-b')).length === 0,
    'preferences are kept per document',
  );
  store.set(
    'system-design-editor:requirements-view:doc-c',
    JSON.stringify({ groupBy: 'nonsense', layout: 'split', collapsedIds: 'not-a-list' }),
  );
  const c = loadRequirementsViewPrefs('doc-c');
  assert(
    c.groupBy === undefined && c.layout === 'split' && c.collapsedIds === undefined,
    'a malformed field is dropped without discarding the valid ones',
  );
  store.set('system-design-editor:requirements-view:doc-d', '{not json');
  assert(
    Object.keys(loadRequirementsViewPrefs('doc-d')).length === 0,
    'unreadable preferences fall back to defaults',
  );
}

console.log('=== Peek excerpts ===');
{
  assert(
    markdownExcerpt('# Heading\n\nSome **bold** and [a link](http://x) with `code`.') ===
      'Heading Some bold and a link with code.',
    'markdown is reduced to plain text',
  );
  const long = markdownExcerpt('word '.repeat(100), 40);
  assert(long.length <= 40 && long.endsWith('…'), 'long bodies are truncated with an ellipsis');
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
if (failures > 0) {
  throw new Error(`${failures} test(s) failed`);
}
