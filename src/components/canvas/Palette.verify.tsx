import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Palette } from './Palette';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

// === Part 1: Default rendering verification ===
{
  const html = renderToStaticMarkup(React.createElement(Palette));

  assert(html.includes('palette__mode-selector'), 'renders mode selector wrapper');
  assert(html.includes('palette__mode-trigger'), 'renders mode selector dropdown trigger button');
  assert(html.includes('System'), 'renders System as default selected category');
  assert(html.includes('palette__mode-trigger-chevron'), 'renders dropdown chevron icon');
  assert(html.includes('palette__list'), 'renders palette list area');
}

// === Part 2: Verify component structure & styling hooks ===
{
  const html = renderToStaticMarkup(React.createElement(Palette));

  assert(
    html.includes('aria-haspopup="listbox"'),
    'has accessible listbox popup indicator on trigger',
  );
  assert(
    html.includes('aria-label="Select shape category"'),
    'has accessible aria-label on trigger',
  );
}

console.log('Palette verification passed successfully!');
