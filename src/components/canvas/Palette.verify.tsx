import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Palette } from './Palette';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

// === Part 1: the rail and the open palette ===
{
  const html = renderToStaticMarkup(React.createElement(Palette));

  assert(html.includes('class="palette-rail"'), 'renders the rail');
  for (const label of ['System', 'Cloud', 'Shapes', 'Code', 'Git', 'Fragments']) {
    assert(html.includes(`aria-label="${label}"`), `the rail has a ${label} button`);
  }
  assert(html.includes('aria-label="Find a component"'), 'and a search button');
  assert(
    (html.match(/aria-pressed="true"/g) ?? []).length === 1 &&
      /aria-pressed="true"[^>]*aria-label="System"/.test(html),
    'System is the open palette',
  );
  assert(html.includes('class="palette__title">System<'), 'the list is headed with its name');
  assert(html.includes('palette__list'), 'renders the palette list');
  assert(html.includes('palette__search-input'), 'renders the search box');
}

// === Part 2: folded to the rail ===
{
  const html = renderToStaticMarkup(React.createElement(Palette, { collapsed: true }));

  assert(html.includes('class="palette-rail"'), 'the rail stays when the palette is folded');
  assert(!html.includes('palette__list'), 'the list does not');
  assert(!html.includes('aria-pressed="true"'), 'and no palette is marked open');
}

console.log('Palette verification passed successfully!');
