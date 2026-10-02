/**
 * The print palette for PDF output. react-pdf cannot read CSS variables, so
 * these mirror the tokens in src/index.css (--print-*, and the semantic
 * colors the HTML preview's badges mix from). Keep the two in step.
 */
export const PDF_PALETTE = {
  paper: '#ffffff',
  ink50: '#f8fafc',
  ink100: '#f1f5f9',
  ink200: '#e2e8f0',
  ink300: '#cbd5e1',
  ink400: '#94a3b8',
  ink500: '#64748b',
  ink600: '#475569',
  ink700: '#334155',
  ink800: '#1e293b',
  ink900: '#0f172a',
  white: '#ffffff',
  black: '#000000',
  info: '#38bdf8',
  success: '#10b981',
  warning: '#f59e0b',
  violet: '#9061f9',
  danger: '#f0578c',
} as const;

function channels(hex: string): [number, number, number] {
  const full = hex.length === 4 ? hex.replace(/[0-9a-f]/gi, (c) => c + c).slice(1) : hex.slice(1);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

/**
 * `color-mix(in srgb, a pct%, b)`: `pct` percent of `a`, the rest `b` - the
 * same mixing the HTML preview's CSS uses, so the PDF's badges match it.
 */
export function mixColors(a: string, pct: number, b: string): string {
  const [ca, cb] = [channels(a), channels(b)];
  const w = pct / 100;
  return (
    '#' +
    ca
      .map((v, i) => Math.round(v * w + cb[i] * (1 - w)))
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  );
}
