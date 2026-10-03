/**
 * The SRD as document content: what is stored, how it is read back, and how
 * it is compacted for storage.
 *
 * Two rules make this safe to share between collaborators and files:
 *
 *  1. Reading never trusts its input. A value comes from a peer's edit, a file
 *     from any version, or a corrupted replica, and some of it ends up in CSS.
 *     Every field is sanitized on its own, and an unusable field falls back to
 *     its default without affecting the others.
 *
 *  2. Only differences from the defaults are stored. An absent field reads as
 *     its default, so a document whose SRD was never touched stores nothing.
 *     The consequence is that DEFAULT_SRD_DOCUMENT_STATE is part of the file
 *     format: changing a default changes every document that relies on it.
 *     Treat it as append-only, like the schema migrations - add fields with
 *     defaults that preserve today's output, never alter existing ones.
 */
import type {
  RequirementItemViewModel,
  SrdDataContext,
  SrdDocumentSettings,
  SrdDocumentState,
  SrdMetadataOverrides,
  SrdSectionConfig,
  SrdSnapshotFraming,
  SrdTemplateConfig,
  SrdTemplateHeadersAndFooters,
  SrdTemplateId,
  SrdTemplateTheme,
} from './srdTypes';
import {
  BUILTIN_SRD_TEMPLATES,
  DEFAULT_SRD_TEMPLATE,
  mergeTemplateWithDefaults,
} from './srdTemplatePresets';
import {
  isFiniteNumber,
  isPlainObject,
  isSafeFontFamily,
  isSafeHexColor,
  isSrdSectionId,
} from './srdValidation';

// --- Templates and presets ----------------------------------------------------

export const SRD_TEMPLATE_IDS: readonly SrdTemplateId[] = ['classic', 'engineering', 'briefing'];
export const DEFAULT_SRD_TEMPLATE_ID: SrdTemplateId = 'classic';

/** presetId once the settings no longer match any preset. */
export const CUSTOM_PRESET_ID = 'custom';

export function isSrdTemplateId(value: unknown): value is SrdTemplateId {
  return typeof value === 'string' && (SRD_TEMPLATE_IDS as readonly string[]).includes(value);
}

/** The complete settings a preset (or imported template file) describes. */
export function settingsFromPreset(preset: SrdTemplateConfig): SrdDocumentSettings {
  const merged = mergeTemplateWithDefaults(preset);
  return sanitizeSettings(merged);
}

/** The document state that applying `preset` produces, keeping the
 * document's own metadata and framing. */
export function stateWithPreset(
  state: SrdDocumentState,
  preset: SrdTemplateConfig,
  presetId: string = preset.id,
): SrdDocumentState {
  return {
    ...state,
    templateId: isSrdTemplateId(preset.templateId) ? preset.templateId : DEFAULT_SRD_TEMPLATE_ID,
    presetId,
    settings: settingsFromPreset(preset),
  };
}

export function findBuiltinPreset(presetId: string): SrdTemplateConfig | undefined {
  return BUILTIN_SRD_TEMPLATES.find((t) => t.id === presetId);
}

/**
 * What the PDF engine and the Markdown export draw from: the document's
 * settings and template, with its preset's name.
 */
export function toRenderConfig(
  state: Pick<SrdDocumentState, 'presetId' | 'templateId' | 'settings'>,
): SrdTemplateConfig {
  const preset = findBuiltinPreset(state.presetId);
  return {
    id: state.presetId,
    name: preset?.name ?? 'Custom',
    description: preset?.description,
    templateId: state.templateId,
    ...state.settings,
  };
}

// --- Defaults -----------------------------------------------------------------

/**
 * The framing key of the architecture diagram, alongside requirement items'
 * keys. Requirement ids never start with '@' (they are a type prefix and a
 * sequence number), so it cannot collide with one.
 */
export const SRD_DIAGRAM_FRAMING_KEY = '@diagram';

export const DEFAULT_SNAPSHOT_FRAMING: Readonly<SrdSnapshotFraming> = Object.freeze({
  offsetX: 0,
  offsetY: 0,
  zoom: 1,
});

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** See rule 2 at the top of this file before changing anything here. */
export const DEFAULT_SRD_DOCUMENT_STATE: Readonly<SrdDocumentState> = deepFreeze({
  templateId: DEFAULT_SRD_TEMPLATE_ID,
  presetId: DEFAULT_SRD_TEMPLATE.id,
  settings: rawSettingsFromPreset(DEFAULT_SRD_TEMPLATE),
  metadata: {},
  framing: {},
});

// Built without sanitizing, because the sanitizers fall back to these
// defaults and so cannot run before they exist.
function rawSettingsFromPreset(preset: SrdTemplateConfig): SrdDocumentSettings {
  const merged = mergeTemplateWithDefaults(preset);
  return {
    requirementsLayout: merged.requirementsLayout ?? 'table',
    includeComponentTable: merged.includeComponentTable ?? false,
    includeConnectionsTable: merged.includeConnectionsTable ?? false,
    theme: { ...merged.theme },
    headersAndFooters: { ...merged.headersAndFooters },
    sections: merged.sections.map((s) => ({ ...s })),
  };
}

// --- Stored fields ------------------------------------------------------------

/**
 * The SRD's stored fields, flat. Each is replaced as a whole, so this split is
 * also the granularity of concurrent edits: two collaborators changing
 * different fields never overwrite each other, while two changing the same
 * field resolve last-writer-wins. Snapshot framing is stored per requirement
 * item, separately from these.
 */
export interface SrdStoredFields extends SrdDocumentSettings {
  templateId: SrdTemplateId;
  presetId: string;
  metadata: SrdMetadataOverrides;
}

export type SrdField = keyof SrdStoredFields;

const DEFAULT_FIELDS: Readonly<SrdStoredFields> = Object.freeze({
  templateId: DEFAULT_SRD_DOCUMENT_STATE.templateId,
  presetId: DEFAULT_SRD_DOCUMENT_STATE.presetId,
  metadata: DEFAULT_SRD_DOCUMENT_STATE.metadata,
  ...DEFAULT_SRD_DOCUMENT_STATE.settings,
});

/** Every stored field, in a fixed order. */
export const SRD_FIELDS = Object.keys(DEFAULT_FIELDS) as SrdField[];

const MAX_SHORT_TEXT = 500;
const MAX_LONG_TEXT = 20_000;
const MAX_AUTHORS = 100;
const MAX_ZOOM = 10;
const MIN_ZOOM = 0.1;
const MAX_OFFSET = 10_000;

function shortText(value: unknown): string | undefined {
  return typeof value === 'string' ? value.slice(0, MAX_SHORT_TEXT) : undefined;
}

function sanitizeTheme(raw: unknown): SrdTemplateTheme | undefined {
  if (!isPlainObject(raw)) return undefined;
  const base = DEFAULT_FIELDS.theme;
  return {
    primaryColor: isSafeHexColor(raw.primaryColor) ? raw.primaryColor : base.primaryColor,
    secondaryColor: isSafeHexColor(raw.secondaryColor) ? raw.secondaryColor : base.secondaryColor,
    accentColor: isSafeHexColor(raw.accentColor) ? raw.accentColor : base.accentColor,
    fontFamily: isSafeFontFamily(raw.fontFamily) ? raw.fontFamily : base.fontFamily,
    tableDense: typeof raw.tableDense === 'boolean' ? raw.tableDense : base.tableDense,
    pageOrientation:
      raw.pageOrientation === 'portrait' || raw.pageOrientation === 'landscape'
        ? raw.pageOrientation
        : base.pageOrientation,
  };
}

const HEADER_TEXT_KEYS = [
  'headerLeft',
  'headerRight',
  'footerLeft',
  'footerRight',
  'classificationBanner',
] as const;

function sanitizeHeadersAndFooters(raw: unknown): SrdTemplateHeadersAndFooters | undefined {
  if (!isPlainObject(raw)) return undefined;
  const result: SrdTemplateHeadersAndFooters = {
    showPageNumbers:
      typeof raw.showPageNumbers === 'boolean'
        ? raw.showPageNumbers
        : DEFAULT_FIELDS.headersAndFooters.showPageNumbers,
  };
  for (const key of HEADER_TEXT_KEYS) {
    const text = shortText(raw[key]);
    if (text !== undefined) result[key] = text;
  }
  return result;
}

function sanitizeSections(raw: unknown): SrdSectionConfig[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const sections: SrdSectionConfig[] = [];
  raw.forEach((entry, index) => {
    if (!isPlainObject(entry) || !isSrdSectionId(entry.id) || seen.has(entry.id)) return;
    seen.add(entry.id);
    const section: SrdSectionConfig = {
      id: entry.id,
      title: shortText(entry.title) ?? '',
      enabled: typeof entry.enabled === 'boolean' ? entry.enabled : true,
      order: isFiniteNumber(entry.order) ? entry.order : index + 1,
    };
    if (typeof entry.customIntroText === 'string') {
      section.customIntroText = entry.customIntroText.slice(0, MAX_LONG_TEXT);
    }
    sections.push(section);
  });
  return sections.length > 0 ? sections : undefined;
}

function sanitizeAuthors(raw: unknown): SrdMetadataOverrides['authors'] {
  if (!Array.isArray(raw)) return undefined;
  const authors: NonNullable<SrdMetadataOverrides['authors']> = [];
  for (const entry of raw.slice(0, MAX_AUTHORS)) {
    if (!isPlainObject(entry)) continue;
    const name = shortText(entry.name);
    if (!name) continue;
    const author: (typeof authors)[number] = { name };
    const email = shortText(entry.email);
    const role = shortText(entry.role);
    if (email !== undefined) author.email = email;
    if (role !== undefined) author.role = role;
    authors.push(author);
  }
  return authors;
}

function sanitizeMetadata(raw: unknown): SrdMetadataOverrides | undefined {
  if (!isPlainObject(raw)) return undefined;
  const result: SrdMetadataOverrides = {};
  const title = shortText(raw.title);
  const generatedAt = shortText(raw.generatedAt);
  const version = shortText(raw.version);
  const organization = shortText(raw.organization);
  const authors = sanitizeAuthors(raw.authors);
  if (title !== undefined) result.title = title;
  if (typeof raw.description === 'string') {
    result.description = raw.description.slice(0, MAX_LONG_TEXT);
  }
  if (generatedAt !== undefined) result.generatedAt = generatedAt;
  if (version !== undefined) result.version = version;
  if (authors !== undefined) result.authors = authors;
  if (organization !== undefined) result.organization = organization;
  return result;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function sanitizeFraming(raw: unknown): SrdSnapshotFraming | undefined {
  if (!isPlainObject(raw)) return undefined;
  const { offsetX, offsetY, zoom } = raw;
  if (!isFiniteNumber(offsetX) || !isFiniteNumber(offsetY) || !isFiniteNumber(zoom)) {
    return undefined;
  }
  const framing: SrdSnapshotFraming = {
    offsetX: clamp(offsetX, -MAX_OFFSET, MAX_OFFSET),
    offsetY: clamp(offsetY, -MAX_OFFSET, MAX_OFFSET),
    zoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM),
  };
  if (raw.hidden === true) framing.hidden = true;
  return framing;
}

type FieldSanitizers = { [K in SrdField]: (raw: unknown) => SrdStoredFields[K] | undefined };

const FIELD_SANITIZERS: FieldSanitizers = {
  // An unknown template id may come from a newer build; it falls back to the
  // default template rather than failing the whole document.
  templateId: (raw) => (isSrdTemplateId(raw) ? raw : undefined),
  presetId: shortText,
  metadata: sanitizeMetadata,
  requirementsLayout: (raw) => (raw === 'table' || raw === 'list' ? raw : undefined),
  includeComponentTable: (raw) => (typeof raw === 'boolean' ? raw : undefined),
  includeConnectionsTable: (raw) => (typeof raw === 'boolean' ? raw : undefined),
  theme: sanitizeTheme,
  headersAndFooters: sanitizeHeadersAndFooters,
  sections: sanitizeSections,
};

/** One field's value from untrusted input, or its default. */
export function readSrdField<K extends SrdField>(field: K, raw: unknown): SrdStoredFields[K] {
  return (FIELD_SANITIZERS[field](raw) as SrdStoredFields[K] | undefined) ?? DEFAULT_FIELDS[field];
}

function readSettings(get: (field: SrdField) => unknown): SrdDocumentSettings {
  return {
    requirementsLayout: readSrdField('requirementsLayout', get('requirementsLayout')),
    includeComponentTable: readSrdField('includeComponentTable', get('includeComponentTable')),
    includeConnectionsTable: readSrdField(
      'includeConnectionsTable',
      get('includeConnectionsTable'),
    ),
    theme: readSrdField('theme', get('theme')),
    headersAndFooters: readSrdField('headersAndFooters', get('headersAndFooters')),
    sections: readSrdField('sections', get('sections')),
  };
}

function sanitizeSettings(source: SrdTemplateConfig): SrdDocumentSettings {
  const record = source as unknown as Record<string, unknown>;
  return readSettings((field) => record[field]);
}

/**
 * Structural equality for stored values. Independent of key order, because
 * values written by peers, files and older builds need not share one. The
 * values are small (a theme, a section list), so a recursive walk is cheap.
 */
export function srdValuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((v, i) => srdValuesEqual(v, b[i]));
  }
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  // Absent and undefined are the same thing once stored.
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!srdValuesEqual(a[key], b[key])) return false;
  }
  return true;
}

export function isDefaultSrdField<K extends SrdField>(
  field: K,
  value: SrdStoredFields[K],
): boolean {
  return srdValuesEqual(value, DEFAULT_FIELDS[field]);
}

export function isDefaultFraming(framing: SrdSnapshotFraming): boolean {
  return srdValuesEqual(framing, DEFAULT_SNAPSHOT_FRAMING);
}

export function fieldsOf(state: SrdDocumentState): SrdStoredFields {
  return {
    templateId: state.templateId,
    presetId: state.presetId,
    metadata: state.metadata,
    ...state.settings,
  };
}

/** Assembles document state from stored fields and framing records, both
 * read through `get` so the source can be a Y.Map or a plain object. */
export function readSrdState(
  getField: (field: SrdField) => unknown,
  framingEntries: Iterable<[string, unknown]>,
): SrdDocumentState {
  const framing: Record<string, SrdSnapshotFraming> = {};
  for (const [itemId, raw] of framingEntries) {
    const value = sanitizeFraming(raw);
    if (value) framing[itemId] = value;
  }
  const state: SrdDocumentState = {
    templateId: readSrdField('templateId', getField('templateId')),
    presetId: readSrdField('presetId', getField('presetId')),
    settings: readSettings(getField),
    metadata: readSrdField('metadata', getField('metadata')),
    framing,
  };
  const unsupported = unsupportedTemplateIdOf(getField('templateId'));
  if (unsupported) state.unsupportedTemplateId = unsupported;
  return state;
}

/** A stored template id naming no template this build has, if it is one. */
export function unsupportedTemplateIdOf(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.length > 0 && raw.length <= 100 && !isSrdTemplateId(raw)
    ? raw
    : undefined;
}

// --- File representation ------------------------------------------------------

/** The `srd` value of a diagram file: only what differs from the defaults. */
export type SrdFileValue = Partial<Omit<SrdStoredFields, 'templateId'>> & {
  /** Any name: one from a newer version is kept as found. */
  templateId?: string;
  framing?: Record<string, SrdSnapshotFraming>;
};

/** The file value for `state`, or undefined when it is entirely default -
 * so a document that never touched its SRD adds nothing to its file. */
export function compactSrdState(state: SrdDocumentState): SrdFileValue | undefined {
  const fields = fieldsOf(state);
  const result: Record<string, unknown> = {};
  for (const field of SRD_FIELDS) {
    if (!isDefaultSrdField(field, fields[field])) result[field] = fields[field];
  }
  const framing: Record<string, SrdSnapshotFraming> = {};
  for (const [itemId, value] of Object.entries(state.framing)) {
    if (!isDefaultFraming(value)) framing[itemId] = value;
  }
  if (Object.keys(framing).length > 0) result.framing = framing;
  // Written back as found, so a newer version's choice survives this one.
  if (state.unsupportedTemplateId) result.templateId = state.unsupportedTemplateId;
  return Object.keys(result).length > 0 ? (result as SrdFileValue) : undefined;
}

/** Document state from a file's `srd` value, whatever it holds. */
export function expandSrdFileValue(raw: unknown): SrdDocumentState {
  const source = isPlainObject(raw) ? raw : {};
  const framing = isPlainObject(source.framing) ? Object.entries(source.framing) : [];
  return readSrdState((field) => source[field], framing);
}

// --- Applying state to SRD data -------------------------------------------------

/** `data` with the document's metadata overrides applied. Returns `data`
 * itself when there are none, so memoized consumers see no change. */
export function applyMetadataOverrides(
  data: SrdDataContext,
  overrides: SrdMetadataOverrides,
): SrdDataContext {
  if (Object.keys(overrides).length === 0) return data;
  return { ...data, metadata: { ...data.metadata, ...overrides } };
}

/**
 * `data` as the document says it should print: metadata overrides applied and
 * snapshots the document removed left out. Returns `data` itself when the
 * document changes nothing, so memoized consumers see no change.
 */
export function applyDocumentState(
  data: SrdDataContext,
  state: Pick<SrdDocumentState, 'metadata' | 'framing'>,
): SrdDataContext {
  const withMetadata = applyMetadataOverrides(data, state.metadata);
  const hasHidden = Object.values(state.framing).some((f) => f.hidden);
  if (!hasHidden) return withMetadata;
  const diagramHidden =
    state.framing[SRD_DIAGRAM_FRAMING_KEY]?.hidden === true &&
    withMetadata.architecture.diagramImageBase64 !== undefined;
  const itemsByCategory: SrdDataContext['requirements']['itemsByCategory'] = {};
  for (const [categoryId, items] of Object.entries(withMetadata.requirements.itemsByCategory)) {
    itemsByCategory[categoryId] = items.map((item) =>
      state.framing[item.id]?.hidden && item.contextSnapshotBase64 !== undefined
        ? { ...item, contextSnapshotBase64: undefined, snapshotFraming: undefined }
        : item,
    );
  }
  return {
    ...withMetadata,
    architecture: diagramHidden
      ? { ...withMetadata.architecture, diagramImageBase64: undefined }
      : withMetadata.architecture,
    requirements: { ...withMetadata.requirements, itemsByCategory },
  };
}

/** The framing to render `item`'s snapshot with: the document's, or the
 * default when it has none. */
export function framingFor(
  state: Pick<SrdDocumentState, 'framing'>,
  itemId: string,
): SrdSnapshotFraming {
  return state.framing[itemId] ?? DEFAULT_SNAPSHOT_FRAMING;
}

/** Whether a captured snapshot was taken with `framing`. Visibility is not
 * part of the image, so it is ignored. */
export function isCapturedWith(
  item: Pick<RequirementItemViewModel, 'contextSnapshotBase64' | 'snapshotFraming'>,
  framing: SrdSnapshotFraming,
): boolean {
  const captured = item.snapshotFraming;
  return (
    item.contextSnapshotBase64 !== undefined &&
    captured !== undefined &&
    captured.offsetX === framing.offsetX &&
    captured.offsetY === framing.offsetY &&
    captured.zoom === framing.zoom
  );
}
