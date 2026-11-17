/**
 * Verification that filled controls keep readable text.
 *
 * White text on the accent used to be 3.7:1. Filled controls now use
 * --accent-fill, and this keeps both the token and its use from slipping
 * back: a rule that puts white text on a fill must not use the lighter
 * --accent as that fill.
 *
 * Run with: npx tsx scripts/verify-contrast.ts
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

let failed = 0;
function check(condition: boolean, name: string) {
  if (!condition) failed += 1;
  console.log(`  ${condition ? '✓' : '✗'} ${name}`);
}

/** WCAG 2 relative luminance of a #rrggbb color. */
function luminance(hex: string): number {
  const channel = (index: number) => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

const root = readFileSync('src/index.css', 'utf8');
const token = (name: string) =>
  new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\b`).exec(root)?.[1] ?? null;

console.log('\n=== The tokens ===');
const fill = token('accent-fill');
const text = token('accent-text');
check(fill !== null && text !== null, 'the fill and its text color are defined as plain colors');
if (fill && text) {
  const ratio = contrast(fill, text);
  check(ratio >= 4.5, `text on a filled control is at least 4.5:1 (${ratio.toFixed(2)}:1)`);
}
check(contrast('#ffffff', '#000000') > 20.9, 'the arithmetic gives 21:1 for white on black');

console.log('\n=== Their use ===');
const offenders: string[] = [];
const sheets = [
  'src/index.css',
  ...readdirSync('src/styles')
    .filter((name) => name.endsWith('.css'))
    .map((name) => join('src/styles', name)),
];
for (const path of sheets) {
  const css = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, selector, body] = match;
    const lightFill = /background(-color)?:\s*var\(--accent\)\s*;/.test(body);
    const whiteText = /(^|[;\s])color:\s*var\(--(accent-text|white)\)/.test(body);
    if (lightFill && whiteText) offenders.push(`${path}: ${selector.trim().split('\n').pop()}`);
  }
}
check(
  offenders.length === 0,
  `no rule puts white text on the lighter accent${offenders.length ? `:\n      ${offenders.join('\n      ')}` : ''}`,
);

if (failed > 0) console.error(`${failed} check(s) failed`);
