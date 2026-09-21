/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/components/requirements/RequirementCard.verify.tsx
 */
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { RequirementCard } from './RequirementCard';
import {
  EMPTY_REQUIREMENTS_DOCUMENT,
  type RequirementsDocument,
  type RequirementItem,
} from '../../domain/requirementsTypes';

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

const item: RequirementItem = {
  id: 'REQ-101',
  typeId: 'requirement',
  title: 'Implement user authentication with OAuth2 and SAML',
  body: 'This requirement describes the auth flow and session token management.',
  categoryId: 'cat-sec',
};

const doc: RequirementsDocument = {
  ...EMPTY_REQUIREMENTS_DOCUMENT,
  items: [item],
  categories: [{ id: 'cat-sec', label: 'Security', color: '#f0578c' }],
};

const baseProps = {
  item,
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

console.log('=== RequirementCard search highlighting ===');
// Test 1: Highlighting ID
{
  const html = renderToStaticMarkup(
    React.createElement(RequirementCard, {
      ...baseProps,
      searchQuery: 'REQ-101',
    }),
  );
  assert(
    html.includes('<mark class="search-highlight">REQ-101</mark>'),
    'ID is highlighted when matching search',
  );
}

// Test 2: Highlighting Title
{
  const html = renderToStaticMarkup(
    React.createElement(RequirementCard, {
      ...baseProps,
      searchQuery: 'authentication',
    }),
  );
  assert(
    html.includes('<mark class="search-highlight">authentication</mark>'),
    'Title match is highlighted',
  );
}

// Test 3: Highlighting Body
{
  const html = renderToStaticMarkup(
    React.createElement(RequirementCard, {
      ...baseProps,
      searchQuery: 'session token',
    }),
  );
  assert(
    html.includes('<mark class="search-highlight">session token</mark>'),
    'Body match is highlighted in rendered markdown',
  );
}

// Test 4: Highlighting Category
{
  const html = renderToStaticMarkup(
    React.createElement(RequirementCard, {
      ...baseProps,
      searchQuery: 'Security',
    }),
  );
  assert(
    html.includes('<mark class="search-highlight">Security</mark>'),
    'Category badge is highlighted when matching search',
  );
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
