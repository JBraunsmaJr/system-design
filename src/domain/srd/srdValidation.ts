import type { SrdSectionId } from './srdTypes';

/**
 * Validation primitives shared by the strict template-JSON parser
 * (srdTemplatePresets.ts) and the lenient document reader (srdSettings.ts).
 *
 * Kept apart from both so neither has to import the other's module.
 */

// Values that end up in CSS custom properties must be tightly constrained so
// an imported template - or a peer's edit to a shared document - cannot
// inject arbitrary declarations.
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const FONT_FAMILY_PATTERN = /^[A-Za-z0-9 ,'"_.-]+$/;
const MAX_FONT_FAMILY_LENGTH = 200;

export const SRD_SECTION_IDS: readonly SrdSectionId[] = [
  'executive_summary',
  'architecture',
  'requirements',
  'traceability',
  'roadmap',
];

const SECTION_ID_SET: ReadonlySet<string> = new Set(SRD_SECTION_IDS);

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isSrdSectionId(value: unknown): value is SrdSectionId {
  return typeof value === 'string' && SECTION_ID_SET.has(value);
}

export function isSafeHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value);
}

export function isSafeFontFamily(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= MAX_FONT_FAMILY_LENGTH &&
    FONT_FAMILY_PATTERN.test(value)
  );
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
