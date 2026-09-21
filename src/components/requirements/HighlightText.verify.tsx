/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/components/requirements/HighlightText.verify.tsx
 */
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { HighlightedText, HighlightedTitle } from './HighlightText';
import { highlightInReactNode } from '../../domain/reactHighlight';

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

console.log('=== HighlightedText ===');
{
  const html = renderToStaticMarkup(
    React.createElement(HighlightedText, { text: 'Requirement REQ-42 details', search: 'req-42' }),
  );
  assert(
    html.includes('<mark class="search-highlight">REQ-42</mark>'),
    'case-insensitive search wrapped in mark',
  );
}

{
  const html = renderToStaticMarkup(
    React.createElement(HighlightedText, { text: 'Plain text', search: '' }),
  );
  assert(!html.includes('<mark'), 'empty search has no mark');
  assert(html.includes('Plain text'), 'contains original text');
}

console.log('\n=== HighlightedTitle ===');
// Test 1: Full title fits without truncation
{
  const html = renderToStaticMarkup(
    React.createElement(HighlightedTitle, {
      text: 'Short title',
      search: 'title',
      fallbackMaxChars: 50,
    }),
  );
  assert(
    html.includes('<mark class="search-highlight">title</mark>'),
    'matches inside short title are highlighted',
  );
  assert(!html.includes('...'), 'no ellipsis when title fits');
}

// Test 2: Truncated title with match in visible portion only
{
  const html = renderToStaticMarkup(
    React.createElement(HighlightedTitle, {
      text: 'User authentication system with OAuth2 and SAML',
      search: 'User',
      fallbackMaxChars: 20,
    }),
  );
  assert(
    html.includes('<mark class="search-highlight">User</mark>'),
    'visible portion match is highlighted',
  );
  assert(
    html.includes('<span class="search-ellipsis">...</span>'),
    'ellipsis is plain when match is only in visible part',
  );
  assert(!html.includes('search-highlight--ellipsis'), 'ellipsis is not highlighted');
}

// Test 3: Truncated title with match in the cut-off portion (reformatted to show searched text with context)
{
  const html = renderToStaticMarkup(
    React.createElement(HighlightedTitle, {
      text: 'User authentication system with OAuth2 and SAML',
      search: 'SAML',
      fallbackMaxChars: 20,
    }),
  );
  assert(
    html.includes('<mark class="search-highlight">SAML</mark>'),
    'searched term in cut-off portion is rendered and highlighted',
  );
  assert(
    html.includes('<span class="search-ellipsis">...</span>'),
    'leading ellipsis is rendered before the context',
  );
  assert(html.includes('OAuth2 and'), 'context before the searched match is rendered');
}

// Test 4: Truncated title with match in the middle of long text
{
  const html = renderToStaticMarkup(
    React.createElement(HighlightedTitle, {
      text: 'User authentication system with OAuth2 and SAML 2.0 Single Sign-On',
      search: 'OAuth2',
      fallbackMaxChars: 25,
    }),
  );
  assert(
    html.includes('<mark class="search-highlight">OAuth2</mark>'),
    'OAuth2 match in middle is rendered and highlighted',
  );
  assert(
    html.includes('<span class="search-ellipsis">...</span>'),
    'ellipses are rendered around the context snippet',
  );
}

// Test 5: Truncated title with matches both at beginning and later
{
  const html = renderToStaticMarkup(
    React.createElement(HighlightedTitle, {
      text: 'Auth service with Auth token verification',
      search: 'Auth',
      fallbackMaxChars: 20,
    }),
  );
  assert(
    html.includes('<mark class="search-highlight">Auth</mark>'),
    'visible Auth match is highlighted',
  );
  assert(
    html.includes('<span class="search-ellipsis">...</span>'),
    'trailing ellipsis is rendered',
  );
}

// Test 6: Truncated title with no match in title
{
  const html = renderToStaticMarkup(
    React.createElement(HighlightedTitle, {
      text: 'User authentication system with OAuth2 and SAML',
      search: 'Database',
      fallbackMaxChars: 20,
    }),
  );
  assert(!html.includes('search-highlight'), 'no highlight anywhere when no match');
}

console.log('\n=== highlightInReactNode ===');
{
  const node = React.createElement('div', {}, 'Hello world with query match');
  const result = highlightInReactNode(node, 'world');
  const html = renderToStaticMarkup(result as React.ReactElement);
  assert(
    html.includes('<mark class="search-highlight">world</mark>'),
    'recursively highlights inside React element children',
  );
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
