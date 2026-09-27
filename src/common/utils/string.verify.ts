import { sanitizeFileName } from './string';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

// 1. Basic slugification
assert(sanitizeFileName('My Project Plan') === 'my-project-plan', 'Sanitizes spaces and casing');

// 2. Strips special characters
assert(
  sanitizeFileName('Architecture & Design v1.0!') === 'architecture-design-v1-0',
  'Strips special characters and punctuation',
);

// 3. Trims leading and trailing dashes
assert(
  sanitizeFileName('---leading-trailing---') === 'leading-trailing',
  'Trims leading and trailing dashes',
);

// 4. Handles empty string with default fallback
assert(sanitizeFileName('') === 'file', 'Uses default fallback for empty input');
assert(sanitizeFileName('   ', 'custom') === 'custom', 'Uses custom fallback for whitespace');
assert(sanitizeFileName('###!@#', 'diagram') === 'diagram', 'Uses fallback when no alphanumerics remain');

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
if (failures > 0) throw new Error(`${failures} test(s) failed`);
