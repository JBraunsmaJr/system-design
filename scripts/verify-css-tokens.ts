/**
 * Design-token hygiene for the app's stylesheets.
 *
 * 1. Every `var(--name)` used in src/ (CSS, TS, TSX) must resolve to
 *    something: a custom property declared in a stylesheet, or one a
 *    component sets at runtime through an inline style ('--name': value).
 *    An undefined variable fails silently in the browser - the declaration
 *    is dropped, so a border disappears or text inherits the wrong color.
 *
 * 2. Stylesheets use tokens, not literals: no hex/rgb/hsl colors, no px/rem
 *    font sizes and no numeric border radii outside the token definitions
 *    in index.css's :root block. Derive color variants with color-mix()
 *    from a token instead (see the comment in index.css).
 */
import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

const SRC = 'src';
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}
const files = walk(SRC).filter((f) => /\.(css|tsx?)$/.test(f) && !/\.(verify|test|spec)\./.test(f));
const cssFiles = files.filter((f) => f.endsWith('.css'));
// Blank out comments but keep newlines, so reported line numbers stay right.
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

// --- 1. Undefined variables ------------------------------------------------
const defined = new Set<string>();
for (const f of files) {
  const text = stripComments(readFileSync(f, 'utf8'));
  const declared = f.endsWith('.css')
    ? text.matchAll(/(--[\w-]+)\s*:/g) // stylesheet declarations
    : text.matchAll(/['"](--[\w-]+)['"]\s*:/g); // inline-style runtime props
  for (const m of declared) defined.add(m[1]);
}

const undefinedUses: string[] = [];
for (const f of files) {
  const raw = readFileSync(f, 'utf8');
  const lines = (f.endsWith('.css') ? stripComments(raw) : raw).split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/var\((--[\w-]+)/g)) {
      if (!defined.has(m[1])) undefinedUses.push(`${relative('.', f)}:${i + 1} ${m[1]}`);
    }
  });
}
undefinedUses.forEach((u) => console.error(`    ${u}`));
check(
  undefinedUses.length === 0,
  'every var(--name) resolves to a declared or runtime-set property',
);

// --- 2. Literals in stylesheets ------------------------------------------------
const rules: [RegExp, string][] = [
  [/#[0-9a-fA-F]{3,8}\b/, 'hex color'],
  [/\b(rgba?|hsla?)\(/, 'rgb/hsl color'],
  [/font-size\s*:\s*[\d.]+(px|rem)\b/, 'font-size literal'],
  [/radius\s*:[^;]*\b\d*\.?\d+(px|%)/, 'border-radius literal'],
];
const literalHits: string[] = [];
for (const f of cssFiles) {
  let text = stripComments(readFileSync(f, 'utf8'));
  // The token definitions themselves are the one place literals belong.
  if (f.endsWith('index.css'))
    text = text.replace(/:root\s*\{[^}]*\}/, (m) => m.replace(/[^\n]/g, ' '));
  text.split('\n').forEach((line, i) => {
    for (const [re, label] of rules) {
      if (re.test(line)) literalHits.push(`${relative('.', f)}:${i + 1} ${label}: ${line.trim()}`);
    }
  });
}
literalHits.forEach((h) => console.error(`    ${h}`));
check(literalHits.length === 0, 'stylesheets use design tokens instead of color/size literals');

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll CSS token checks passed.');
