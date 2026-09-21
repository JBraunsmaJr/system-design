/** WS8-R9: finding this deployment's documentation from the editor. */
import { getDocsUrl } from './docsLocation.ts';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

const at = (base: string, configured: string | null = null) => getDocsUrl({ base, configured });

assert(
  at('https://example.gov/') === 'https://example.gov/docs/',
  'an editor at a domain root finds docs at /docs/',
);
assert(
  at('https://example.gov/system-design/?doc=3f6e') === 'https://example.gov/system-design/docs/',
  'behind a prefix, the docs are beside the editor - and the open document does not leak into the link',
);
assert(
  at('https://example.gov/system-design/index.html') === 'https://example.gov/system-design/docs/',
  'opened as index.html, the same',
);
assert(
  at('https://example.gov/', 'https://docs.example.gov/editor/') ===
    'https://docs.example.gov/editor/',
  'DOCS_URL wins where a deployment serves the docs elsewhere',
);
assert(
  at('https://example.gov/', '__DOCS_URL__') === 'https://example.gov/docs/',
  'an unreplaced placeholder is ignored',
);
assert(
  at('https://example.gov/', '   ') === 'https://example.gov/docs/',
  'and so is a blank value',
);

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
} else {
  console.log('\nAll documentation location checks passed.');
}
