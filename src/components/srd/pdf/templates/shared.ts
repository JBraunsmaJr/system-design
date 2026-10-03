/**
 * Building blocks every template's slots use, so templates differ in their
 * choices rather than in how they make them.
 */
import type { PdfStyle } from '../srdPdfMarkdown';
import { PDF_PALETTE as P, mixColors } from '../srdPdfPalette';

export const PAGE_MARGIN = 48;
export const HEADER_BAND = 34;
export const FOOTER_BAND = 40;

/**
 * A text size with its line height, always declared together. react-pdf
 * turns a unitless line height into points where it is declared, using that
 * style's own font size - or 18pt when it has none - and children inherit
 * the points. So a line height without a size (or a size without one, under
 * an inherited line height) gives small text a tall line: chips and badges
 * once stood twice their height with the text at the top.
 */
export function type(fontSize: number, leading: number): PdfStyle {
  return { fontSize, lineHeight: leading };
}

/** A pill's colors: a light tint of `base` with darker text and border,
 * mixed like CSS color-mix (see mixColors). */
export function tone(base: string, bg: number, fg: number, border: number): PdfStyle {
  return {
    backgroundColor: mixColors(base, bg, P.white),
    color: mixColors(base, fg, P.black),
    borderColor: mixColors(base, border, P.white),
  };
}

/** A pill in a solid color with white text - bolder than tone(). */
export function solidTone(base: string): PdfStyle {
  return { backgroundColor: base, color: P.white, borderColor: base };
}
