import { Font } from '@react-pdf/renderer';

/**
 * Fonts for the react-pdf renderer.
 *
 * react-pdf embeds its own fonts rather than using the browser's, so the
 * families a template names must be registered here. Only the variants used
 * are ever downloaded: react-pdf fetches a file when text first needs it.
 *
 * Latin subsets: text outside Latin renders with missing glyphs. Adding the
 * latin-ext and other subsets is a matter of more entries below.
 */
export const PDF_FONT_SANS = 'Inter';
export const PDF_FONT_MONO = 'JetBrains Mono';

/** PDF's built-in families, which need no registration. */
const BUILTIN_SANS = 'Helvetica';
const BUILTIN_SERIF = 'Times-Roman';
const BUILTIN_MONO = 'Courier';

export interface SrdPdfFontFile {
  family: string;
  fontWeight: 400 | 600 | 700;
  fontStyle: 'normal' | 'italic';
  /** Path inside node_modules/@fontsource/, which the browser build maps
   * to an asset URL (srdPdfFontAssets.ts) and tests to a file path. */
  file: string;
}

const variant = (
  family: string,
  pkg: string,
  fontWeight: SrdPdfFontFile['fontWeight'],
  fontStyle: SrdPdfFontFile['fontStyle'],
): SrdPdfFontFile => ({
  family,
  fontWeight,
  fontStyle,
  file: `${pkg}/files/${pkg}-latin-${fontWeight}-${fontStyle}.woff`,
});

export const SRD_PDF_FONT_FILES: readonly SrdPdfFontFile[] = [
  variant(PDF_FONT_SANS, 'inter', 400, 'normal'),
  variant(PDF_FONT_SANS, 'inter', 400, 'italic'),
  variant(PDF_FONT_SANS, 'inter', 600, 'normal'),
  variant(PDF_FONT_SANS, 'inter', 600, 'italic'),
  variant(PDF_FONT_SANS, 'inter', 700, 'normal'),
  variant(PDF_FONT_SANS, 'inter', 700, 'italic'),
  variant(PDF_FONT_MONO, 'jetbrains-mono', 400, 'normal'),
  variant(PDF_FONT_MONO, 'jetbrains-mono', 400, 'italic'),
  variant(PDF_FONT_MONO, 'jetbrains-mono', 700, 'normal'),
];

let registered = false;

/**
 * Registers the SRD's fonts once per page load. `srcFor` maps each file to
 * where it can be loaded from: an asset URL in the browser, a path in tests.
 */
export function registerSrdPdfFonts(srcFor: (file: string) => string): void {
  if (registered) return;
  const families = new Map<string, SrdPdfFontFile[]>();
  for (const font of SRD_PDF_FONT_FILES) {
    families.set(font.family, [...(families.get(font.family) ?? []), font]);
  }
  for (const [family, fonts] of families) {
    Font.register({
      family,
      fonts: fonts.map(({ fontWeight, fontStyle, file }) => ({
        src: srcFor(file),
        fontWeight,
        fontStyle,
      })),
    });
  }
  // react-pdf hyphenates English by default, which splits identifiers such
  // as REQ-12 or service names mid-word. Words wrap whole instead.
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}

export function areSrdPdfFontsRegistered(): boolean {
  return registered;
}

const SANS_NAMES = new Set(['sans-serif', 'system-ui', 'helvetica', 'arial', '-apple-system']);
const SERIF_NAMES = new Set(['serif', 'georgia', 'times', 'times new roman']);
const MONO_NAMES = new Set(['monospace', 'courier', 'courier new', 'menlo', 'consolas']);

/**
 * The PDF font family for a theme's CSS font stack: the first entry this
 * renderer can draw, as a browser would pick the first installed font.
 * Registered families are used only once registered; until then, and for
 * stacks naming nothing known, PDF's built-in Helvetica.
 */
export function resolvePdfFontFamily(cssStack: string, fontsRegistered = registered): string {
  for (const raw of cssStack.split(',')) {
    const name = raw
      .trim()
      .replace(/^['"]|['"]$/g, '')
      .toLowerCase();
    if (fontsRegistered && name === PDF_FONT_SANS.toLowerCase()) return PDF_FONT_SANS;
    if (fontsRegistered && name === PDF_FONT_MONO.toLowerCase()) return PDF_FONT_MONO;
    if (SANS_NAMES.has(name)) return BUILTIN_SANS;
    if (SERIF_NAMES.has(name)) return BUILTIN_SERIF;
    if (MONO_NAMES.has(name)) return fontsRegistered ? PDF_FONT_MONO : BUILTIN_MONO;
  }
  return BUILTIN_SANS;
}

/** The family for code: the registered monospace, else PDF's built-in. */
export function pdfMonoFamily(fontsRegistered = registered): string {
  return fontsRegistered ? PDF_FONT_MONO : BUILTIN_MONO;
}
