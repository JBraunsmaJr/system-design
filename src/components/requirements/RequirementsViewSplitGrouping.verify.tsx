/**
 * Tests verifying that swapping between group by epic, category, and type
 * in split view (and list view) does not produce duplicate items or duplicate
 * group sections.
 *
 * Run with:
 *   npx tsx --tsconfig tsconfig.app.json src/components/requirements/RequirementsViewSplitGrouping.verify.tsx
 */
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import * as Y from 'yjs';
import { RequirementsView } from './RequirementsView';
import {
  BUILT_IN_ITEM_TYPES,
  BUILT_IN_RELATIONSHIP_TYPES,
} from '../../domain/requirementsRegistry';
import type { RequirementsDocument } from '../../domain/requirementsTypes';
import { createLocalRequirementsStore } from '../../collab/requirementsStore';
import {
  createYjsRequirementsStore,
  seedYjsRequirementsDoc,
} from '../../collab/yjsRequirementsStore';

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

const testDocWithDuplicates: RequirementsDocument = {
  itemTypes: [
    ...BUILT_IN_ITEM_TYPES,
    ...BUILT_IN_ITEM_TYPES, // duplicated item types
  ],
  categories: [
    { id: 'cat-1', label: 'Frontend', color: '#3b82f6' },
    { id: 'cat-2', label: 'Backend', color: '#10b981' },
    { id: 'cat-1', label: 'Frontend', color: '#3b82f6' }, // duplicated category
  ],
  relationshipTypes: BUILT_IN_RELATIONSHIP_TYPES,
  items: [
    { id: 'EPIC-1', typeId: 'epic', title: 'User Onboarding', body: '', categoryId: 'cat-1' },
    { id: 'REQ-1', typeId: 'requirement', title: 'Sign-up form', body: '', categoryId: 'cat-1' },
    {
      id: 'REQ-2',
      typeId: 'requirement',
      title: 'Email verification',
      body: '',
      categoryId: 'cat-2',
    },
    {
      id: 'TICKET-1',
      typeId: 'ticket',
      title: 'Build form component',
      body: '',
      categoryId: 'cat-1',
    },
  ],
  relationships: [
    { id: 'r1', typeId: 'parent-of', fromItemId: 'EPIC-1', toItemId: 'REQ-1' },
    { id: 'r2', typeId: 'parent-of', fromItemId: 'EPIC-1', toItemId: 'TICKET-1' },
  ],
  nextSequence: {},
};

console.log('=== Split view grouping: Epic ===');
{
  const store = createLocalRequirementsStore(testDocWithDuplicates);
  const html = renderToStaticMarkup(
    React.createElement(RequirementsView, {
      requirementsStore: store,
      programIncrements: [],
      initialLayout: 'split',
      initialGroupBy: 'epic',
    }),
  );

  assert(html.includes('requirements-split'), 'renders split view container');
  assert(html.includes('requirements-outline'), 'renders outline pane');
  assert(
    count(html, 'data-outline-id="REQ-1"') === 1,
    'REQ-1 appears exactly once in epic outline',
  );
  assert(
    count(html, 'data-outline-id="REQ-2"') === 1,
    'REQ-2 appears exactly once in epic outline (under No epic)',
  );
  assert(
    count(html, 'data-outline-id="TICKET-1"') === 1,
    'TICKET-1 appears exactly once in epic outline',
  );
  assert(
    count(html, 'data-outline-id="EPIC-1"') === 1,
    'EPIC-1 appears exactly once in epic outline',
  );
}

console.log('=== Split view grouping: Type ===');
{
  const store = createLocalRequirementsStore(testDocWithDuplicates);
  const html = renderToStaticMarkup(
    React.createElement(RequirementsView, {
      requirementsStore: store,
      programIncrements: [],
      initialLayout: 'split',
      initialGroupBy: 'type',
    }),
  );

  // Group section headers in outline should not be duplicated
  assert(
    count(html, 'class="requirements-outline__section-label">Requirements</span>') === 1,
    'Requirements outline section header appears exactly once',
  );
  assert(
    count(html, 'class="requirements-outline__section-label">Epics</span>') === 1,
    'Epics outline section header appears exactly once',
  );
  assert(
    count(html, 'class="requirements-outline__section-label">Tickets</span>') === 1,
    'Tickets outline section header appears exactly once',
  );

  // Items should not be duplicated in the outline
  assert(
    count(html, 'data-outline-id="REQ-1"') === 1,
    'REQ-1 appears exactly once in type outline',
  );
  assert(
    count(html, 'data-outline-id="REQ-2"') === 1,
    'REQ-2 appears exactly once in type outline',
  );
  assert(
    count(html, 'data-outline-id="TICKET-1"') === 1,
    'TICKET-1 appears exactly once in type outline',
  );
  assert(
    count(html, 'data-outline-id="EPIC-1"') === 1,
    'EPIC-1 appears exactly once in type outline',
  );
}

console.log('=== Split view grouping: Category ===');
{
  const store = createLocalRequirementsStore(testDocWithDuplicates);
  const html = renderToStaticMarkup(
    React.createElement(RequirementsView, {
      requirementsStore: store,
      programIncrements: [],
      initialLayout: 'split',
      initialGroupBy: 'category',
    }),
  );

  // Category section headers in outline should not be duplicated
  assert(
    count(html, 'class="requirements-outline__section-label">Frontend</span>') === 1,
    'Frontend category outline section header appears exactly once',
  );
  assert(
    count(html, 'class="requirements-outline__section-label">Backend</span>') === 1,
    'Backend category outline section header appears exactly once',
  );

  // Items should not be duplicated in the outline
  assert(
    count(html, 'data-outline-id="REQ-1"') === 1,
    'REQ-1 appears exactly once in category outline',
  );
  assert(
    count(html, 'data-outline-id="REQ-2"') === 1,
    'REQ-2 appears exactly once in category outline',
  );
  assert(
    count(html, 'data-outline-id="TICKET-1"') === 1,
    'TICKET-1 appears exactly once in category outline',
  );
  assert(
    count(html, 'data-outline-id="EPIC-1"') === 1,
    'EPIC-1 appears exactly once in category outline',
  );
}

console.log('=== Yjs store deduplication on categories and types ===');
{
  const ydoc = new Y.Doc();
  seedYjsRequirementsDoc(ydoc, testDocWithDuplicates);

  // Force duplicate order entries
  ydoc.getArray('itemTypeOrder').push(['requirement']);
  ydoc.getArray('categoryOrder').push(['cat-1']);

  const store = createYjsRequirementsStore(ydoc);
  const snap = store.getSnapshot();

  const reqTypeCount = snap.itemTypes.filter((t) => t.id === 'requirement').length;
  assert(reqTypeCount === 1, 'snapshot itemTypes has deduplicated requirement type');

  const cat1Count = snap.categories.filter((c) => c.id === 'cat-1').length;
  assert(cat1Count === 1, 'snapshot categories has deduplicated cat-1 category');

  // Check that store repairs the underlying Y.Array order
  assert(
    ydoc
      .getArray<string>('itemTypeOrder')
      .toArray()
      .filter((id) => id === 'requirement').length === 1,
    'Y.Array itemTypeOrder is repaired to have no duplicates',
  );
  assert(
    ydoc
      .getArray<string>('categoryOrder')
      .toArray()
      .filter((id) => id === 'cat-1').length === 1,
    'Y.Array categoryOrder is repaired to have no duplicates',
  );
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
if (failures > 0) {
  (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
}
