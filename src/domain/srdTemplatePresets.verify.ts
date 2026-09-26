/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/domain/srdTemplatePresets.verify.ts
 */
import {
  BUILTIN_SRD_TEMPLATES,
  ENTERPRISE_FORMAL_TEMPLATE,
  cloneTemplateConfig,
  serializeTemplateConfig,
  parseTemplateConfig,
} from './srdTemplatePresets';

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

console.log('Testing SRD Template Presets & Serialization...');

// --- Test 1: Preset availability ---
{
  assert(BUILTIN_SRD_TEMPLATES.length === 3, '3 built-in templates available');
  const ids = BUILTIN_SRD_TEMPLATES.map((t) => t.id);
  assert(ids.includes('enterprise_formal'), 'Includes Enterprise Formal');
  assert(ids.includes('agile_engineering'), 'Includes Agile Engineering');
  assert(ids.includes('executive_summary'), 'Includes Executive Summary');

  console.log('✓ Test 1: Built-in presets verified');
}

// --- Test 2: Serialization and Deserialization Round-trip ---
{
  const cloned = cloneTemplateConfig(ENTERPRISE_FORMAL_TEMPLATE);
  cloned.name = 'Custom Corporate SRD';
  cloned.theme.primaryColor = '#059669';

  const json = serializeTemplateConfig(cloned);
  const restored = parseTemplateConfig(json);

  assert(restored.name === 'Custom Corporate SRD', 'Restored name matches');
  assert(restored.theme.primaryColor === '#059669', 'Restored theme color matches');
  assert(restored.sections.length === 5, 'Restored all sections');

  console.log('✓ Test 2: Serialization round-trip passed');
}

// --- Test 3: Invalid JSON rejection ---
{
  let errorThrown = false;
  try {
    parseTemplateConfig('{"invalid": true}');
  } catch {
    errorThrown = true;
  }
  assert(errorThrown, 'Invalid schema threw an error');

  console.log('✓ Test 3: Invalid JSON rejection passed');
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
} else {
  console.log('All srdTemplatePresets tests passed successfully!\n');
}
