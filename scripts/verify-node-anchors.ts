/**
 * Guards where edges attach to nodes.
 *
 * A node's connection handles are positioned against React Flow's node
 * wrapper. If a stylesheet makes the node's own box (.typed-node) a
 * containing block instead - by positioning it, transforming it, and so on
 * - the handles are placed against the inside of its border, and every
 * edge end moves by about a pixel (1.5px across, 1px down, from the 4px and
 * 1px borders). Nothing looks wrong, but two people at different zoom
 * levels then draw the same edge differently, which is what
 * verify-document-browser's "the same bend once A releases" catches, slowly
 * and without saying why.
 *
 * This reads the stylesheets and says why, in under a second.
 *
 *   npx tsx scripts/verify-node-anchors.ts
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ok: ${message}`);
  } else {
    failures++;
    console.log(`  FAIL: ${message}`);
  }
}

/** Declarations that make an element the containing block for its
 * absolutely positioned descendants. */
const CONTAINING =
  /(^|;|\{)\s*(position\s*:\s*(relative|absolute|fixed|sticky)|transform\s*:(?!\s*none)|filter\s*:(?!\s*none)|backdrop-filter\s*:(?!\s*none)|perspective\s*:(?!\s*none)|contain\s*:\s*[^;]*(layout|paint|strict|content)|will-change\s*:\s*[^;]*(transform|filter|perspective)|container-type\s*:(?!\s*normal))/;

interface Offense {
  file: string;
  line: number;
  selector: string;
  declaration: string;
}

function offensesIn(file: string, css: string): Offense[] {
  const offenses: Offense[] = [];
  // Comments out, keeping line numbers.
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
  for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(',').map((s) => s.trim());
    // Only selectors whose subject is the node box itself: ".typed-node",
    // ".x .typed-node", ".typed-node.is-selected" - not a child or a
    // pseudo-element of it.
    const subjectIsNode = selectors.some((selector) =>
      /\.typed-node(\.[\w-]+|:hover|:focus|:focus-within)*$/.test(selector),
    );
    if (!subjectIsNode) continue;
    const found = CONTAINING.exec(match[2]);
    if (!found) continue;
    offenses.push({
      file,
      line: text.slice(0, match.index + match[0].indexOf('{')).split('\n').length,
      selector: selectors.join(', '),
      declaration: found[2].trim(),
    });
  }
  return offenses;
}

console.log('=== Nothing makes a node its own handles’ containing block ===');
const dir = join('src', 'styles');
const offenses = readdirSync(dir)
  .filter((name) => name.endsWith('.css'))
  .flatMap((name) => offensesIn(join(dir, name), readFileSync(join(dir, name), 'utf8')));

check(offenses.length === 0, 'no rule positions or transforms .typed-node itself');
for (const o of offenses) {
  console.log(
    `    ${o.file}:${o.line}  ${o.selector} { ${o.declaration} }\n` +
      '      Delete this declaration (the whole rule, if it is the only one in it). It moves\n' +
      '      every edge end on the node by about a pixel.',
  );
}

console.log('\n=== The check itself ===');
{
  const sample = (css: string) => offensesIn('x.css', css).length;
  check(
    sample(".canvas[data-lod='overview'] .typed-node {\n  position: relative;\n}") === 1,
    'it catches a positioned node',
  );
  check(
    sample('.a .typed-node.is-selected { transform: scale(1.02); }') === 1,
    'and a transformed one',
  );
  check(
    sample('.typed-node { border: 1px solid red; padding: 9px; }') === 0,
    'but not ordinary styling',
  );
  check(sample('.typed-node__label { position: relative; }') === 0, 'nor a part of the node');
  check(sample('.typed-node::after { position: absolute; }') === 0, 'nor its pseudo-elements');
  check(sample('.typed-node > .x { position: absolute; }') === 0, 'nor its children');
  check(sample('/* .typed-node { position: relative; } */') === 0, 'nor a comment');
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nALL PASSED');
