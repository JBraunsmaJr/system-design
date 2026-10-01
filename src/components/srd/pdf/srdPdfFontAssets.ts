/**
 * The browser's source for each PDF font file: Vite asset URLs, so the files
 * are fingerprinted, cached, and fetched only when a PDF first uses them.
 *
 * Static imports, because Vite resolves `?url` at build time and cannot from
 * a computed path. Must list exactly SRD_PDF_FONT_FILES; the check in
 * scripts/verify-srd-pdf-fonts.ts fails the build's tests if they drift.
 */
import inter_400_normal from '@fontsource/inter/files/inter-latin-400-normal.woff?url';
import inter_400_italic from '@fontsource/inter/files/inter-latin-400-italic.woff?url';
import inter_600_normal from '@fontsource/inter/files/inter-latin-600-normal.woff?url';
import inter_600_italic from '@fontsource/inter/files/inter-latin-600-italic.woff?url';
import inter_700_normal from '@fontsource/inter/files/inter-latin-700-normal.woff?url';
import inter_700_italic from '@fontsource/inter/files/inter-latin-700-italic.woff?url';
import jetbrains_mono_400_normal from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff?url';
import jetbrains_mono_400_italic from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-italic.woff?url';
import jetbrains_mono_700_normal from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff?url';

export const SRD_PDF_FONT_URLS: Readonly<Record<string, string>> = {
  'inter/files/inter-latin-400-normal.woff': inter_400_normal,
  'inter/files/inter-latin-400-italic.woff': inter_400_italic,
  'inter/files/inter-latin-600-normal.woff': inter_600_normal,
  'inter/files/inter-latin-600-italic.woff': inter_600_italic,
  'inter/files/inter-latin-700-normal.woff': inter_700_normal,
  'inter/files/inter-latin-700-italic.woff': inter_700_italic,
  'jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff': jetbrains_mono_400_normal,
  'jetbrains-mono/files/jetbrains-mono-latin-400-italic.woff': jetbrains_mono_400_italic,
  'jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff': jetbrains_mono_700_normal,
};
