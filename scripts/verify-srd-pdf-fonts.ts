/**
 * The PDF font registry (srdPdfFonts.ts) and the browser's asset map
 * (srdPdfFontAssets.ts) must list the same files, and every file must exist.
 * The asset map cannot be derived from the registry - Vite needs static
 * imports - so this keeps them from drifting apart, as they once did when
 * the registry moved from WOFF2 to WOFF.
 *
 * Run with: npx tsx scripts/verify-srd-pdf-fonts.ts
 */
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { SRD_PDF_FONT_FILES } from '../src/components/srd/pdf/srdPdfFonts';

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

const assets = readFileSync(resolve('src/components/srd/pdf/srdPdfFontAssets.ts'), 'utf8');
const imported = [...assets.matchAll(/from '@fontsource\/([^'?]+)\?url'/g)].map((m) => m[1]);
const keyed = [...assets.matchAll(/^\s+'([^']+)':/gm)].map((m) => m[1]);
const registered = SRD_PDF_FONT_FILES.map((f) => f.file);
const sorted = (list: string[]) => [...list].sort().join('\n');

check(
  sorted(imported) === sorted(registered),
  'the asset map imports exactly the registered fonts',
);
check(
  sorted(keyed) === sorted(registered),
  'the asset map is keyed by exactly the registered fonts',
);
const missing = registered.filter((file) => !existsSync(join('node_modules/@fontsource', file)));
check(
  missing.length === 0,
  `every registered font file exists (${missing.join(', ') || 'all present'})`,
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll SRD PDF font checks passed.');
