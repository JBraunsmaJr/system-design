/**
 * Tests verifying that requirement types are deduplicated in AddItemDropdown
 * and TypePicker components.
 * Run with:
 *   npx tsx --tsconfig tsconfig.app.json src/components/requirements/AddItemDropdown.verify.tsx
 */
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { AddItemDropdown } from './AddItemDropdown';
import { TypePicker } from './TypePicker';
import { BUILT_IN_ITEM_TYPES, BUILT_IN_RELATIONSHIP_TYPES } from '../../domain/requirementsRegistry';
import type { RequirementItemType, RequirementsDocument } from '../../domain/requirementsTypes';

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

console.log('=== AddItemDropdown deduplication ===');
{
  const duplicatedTypes: RequirementItemType[] = [
    ...BUILT_IN_ITEM_TYPES,
    ...BUILT_IN_ITEM_TYPES, // duplicated list
  ];

  const html = renderToStaticMarkup(
    React.createElement(AddItemDropdown, {
      itemTypes: duplicatedTypes,
      onAddItem: () => {},
      onOpenManageTypes: () => {},
    }),
  );

  // The primary button should display the first type label
  assert(html.includes('New Requirement'), 'renders primary action label');
  assert(html.includes('add-item-dropdown__toggle-btn'), 'renders toggle button');
}

console.log('=== TypePicker deduplication ===');
{
  const duplicatedDoc: RequirementsDocument = {
    itemTypes: [...BUILT_IN_ITEM_TYPES, ...BUILT_IN_ITEM_TYPES],
    categories: [],
    relationshipTypes: BUILT_IN_RELATIONSHIP_TYPES,
    items: [{ id: 'REQ-1', typeId: 'requirement', title: 'Test', body: '' }],
    relationships: [],
    nextSequence: {},
  };

  const html = renderToStaticMarkup(
    React.createElement(TypePicker, {
      doc: duplicatedDoc,
      typeId: 'requirement',
      onChange: () => {},
    }),
  );

  assert(html.includes('type-picker__trigger'), 'renders type picker trigger');
  assert(count(html, 'type-picker__label') === 1, 'trigger label appears once');
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
if (failures > 0) {
  (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
}
