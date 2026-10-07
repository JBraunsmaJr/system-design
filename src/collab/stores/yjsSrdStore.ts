/**
 * The SRD's template, settings, metadata and snapshot framing, stored in the
 * document so every collaborator sees and prints the same thing.
 *
 * These lived in the SRD modal's React state, so each person - and each time
 * the modal opened - started from the defaults, and nothing survived a reload
 * or reached a saved file.
 *
 * Layout:
 *
 *  - `srd`: one key per field of SrdStoredFields, each replaced as a whole.
 *    That split is the granularity of concurrent edits: changing the theme and
 *    reordering sections at the same moment both survive, while two changes to
 *    the theme resolve last-writer-wins, as a single form should.
 *  - `srdFraming`: one key per requirement item. A separate root map rather
 *    than a nested one, because two peers creating the same nested map at once
 *    would each create their own and one set of entries would be lost.
 *
 * Only values that differ from the defaults are stored (see srdSettings.ts):
 * writing a default deletes the key. A document whose SRD was never touched
 * holds nothing here, which keeps documents and their sync traffic small.
 *
 * Everything read is sanitized, because it may come from a peer or from a
 * file written by any version, and some of it ends up in CSS.
 */
import * as Y from 'yjs';
import type {
    SrdDocumentSettings,
    SrdDocumentState,
    SrdMetadataOverrides,
    SrdSnapshotFraming,
    SrdTemplateConfig,
    SrdTemplateId,
} from '../../domain/srd/srdTypes';
import {
    CUSTOM_PRESET_ID,
    fieldsOf,
    isDefaultFraming,
    isDefaultSrdField,
    readSrdField,
    sanitizeFraming,
    SRD_FIELDS,
    type SrdField,
    type SrdStoredFields,
    srdValuesEqual,
    stateWithPreset,
    unsupportedTemplateIdOf,
} from '../../domain/srd/srdSettings';

export const SRD_MAP = 'srd';
export const SRD_FRAMING_MAP = 'srdFraming';

export interface SrdStore {
  getSnapshot(): SrdDocumentState;
  subscribe(listener: () => void): () => void;
  /** Applies a preset or imported template: its template id and every
   * setting, in one transaction. Metadata and framing are kept. */
  applyPreset(preset: SrdTemplateConfig, presetId?: string): void;
  /** Chooses the template that draws the document. Its settings, and so its
   * preset, are unchanged: a template is how they are drawn. */
  setTemplate(templateId: SrdTemplateId): void;
  /** Replaces the given settings. Marks the document as no longer matching a
   * preset, since it was edited by hand. */
  updateSettings(patch: Partial<SrdDocumentSettings>): void;
  /** Replaces the metadata overrides as a whole. */
  setMetadata(overrides: SrdMetadataOverrides): void;
  /** Sets one item's framing; null restores the default. */
  setFraming(itemId: string, framing: SrdSnapshotFraming | null): void;
  destroy(): void;
}

const SETTINGS_FIELDS = [
  'requirementsLayout',
  'includeComponentTable',
  'includeConnectionsTable',
  'theme',
  'headersAndFooters',
  'sections',
] as const satisfies readonly (keyof SrdDocumentSettings)[];

/**
 * Writes `value` to `field` only if it changes what the field reads as.
 * A default is stored as an absent key. Returns whether anything changed.
 */
function writeField<K extends SrdField>(
  map: Y.Map<unknown>,
  field: K,
  value: SrdStoredFields[K],
): boolean {
  if (srdValuesEqual(readSrdField(field, map.get(field)), value)) {
    // Reads the same, but a default may still be stored explicitly (from an
    // older build or a peer); dropping it keeps the document minimal.
    if (map.has(field) && isDefaultSrdField(field, value)) map.delete(field);
    return false;
  }
  if (isDefaultSrdField(field, value)) map.delete(field);
  else map.set(field, value);
  return true;
}

function writeFraming(
  map: Y.Map<unknown>,
  itemId: string,
  framing: SrdSnapshotFraming | null,
): void {
  const value = framing === null ? null : sanitizeFraming(framing);
  if (value === undefined) return;
  if (value === null || isDefaultFraming(value)) {
    if (map.has(itemId)) map.delete(itemId);
    return;
  }
  if (srdValuesEqual(sanitizeFraming(map.get(itemId)), value)) return;
  map.set(itemId, value);
}

export function createYjsSrdStore(doc: Y.Doc): SrdStore {
  // Concrete types, never bare doc.get() - see undoManager.ts on placeholders.
  const fields = doc.getMap<unknown>(SRD_MAP);
  const framingMap = doc.getMap<unknown>(SRD_FRAMING_MAP);
  const listeners = new Set<() => void>();

  // Structural sharing: Yjs returns the same object for an unchanged key, so
  // a field is only re-sanitized - and only gets a new identity - when it was
  // actually replaced. Memoized consumers then re-run for what changed only.
  const fieldCache = new Map<SrdField, { raw: unknown; value: unknown }>();
  const readField = <K extends SrdField>(field: K): SrdStoredFields[K] => {
    const raw = fields.get(field);
    const cached = fieldCache.get(field);
    if (cached && cached.raw === raw) return cached.value as SrdStoredFields[K];
    const value = readSrdField(field, raw);
    fieldCache.set(field, { raw, value });
    return value;
  };

  let snapshot: SrdDocumentState | null = null;
  let framingDirty = true;

  const notify = () => {
    snapshot = null;
    for (const listener of listeners) listener();
  };
  const onFieldsChange = () => notify();
  const onFramingChange = () => {
    framingDirty = true;
    notify();
  };
  fields.observe(onFieldsChange);
  framingMap.observe(onFramingChange);

  const read = (previous: SrdDocumentState | null): SrdDocumentState => {
    const settings = Object.fromEntries(
      SETTINGS_FIELDS.map((field) => [field, readField(field)]),
    ) as unknown as SrdDocumentSettings;
    const settingsUnchanged =
      previous !== null && SETTINGS_FIELDS.every((f) => previous.settings[f] === settings[f]);

    let framing = previous?.framing;
    if (framing === undefined || framingDirty) {
      const next: Record<string, SrdSnapshotFraming> = {};
      framingMap.forEach((raw, itemId) => {
        const value = sanitizeFraming(raw);
        if (value) next[itemId] = value;
      });
      framing = next;
      framingDirty = false;
    }

    const state: SrdDocumentState = {
      templateId: readField('templateId'),
      presetId: readField('presetId'),
      settings: settingsUnchanged ? previous.settings : settings,
      metadata: readField('metadata'),
      framing,
    };
    const unsupported = unsupportedTemplateIdOf(fields.get('templateId'));
    if (unsupported) state.unsupportedTemplateId = unsupported;
    return state;
  };

  let lastSnapshot: SrdDocumentState | null = null;
  const getSnapshot = (): SrdDocumentState => {
    if (snapshot === null) {
      snapshot = read(lastSnapshot);
      lastSnapshot = snapshot;
    }
    return snapshot;
  };

  let destroyed = false;
  return {
    getSnapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    applyPreset(preset, presetId) {
      const next = fieldsOf(stateWithPreset(getSnapshot(), preset, presetId));
      doc.transact(() => {
        for (const field of SRD_FIELDS) {
          if (field === 'metadata') continue;
          writeField(fields, field, next[field]);
        }
      });
    },
    setTemplate(templateId) {
      doc.transact(() => writeField(fields, 'templateId', readSrdField('templateId', templateId)));
    },
    updateSettings(patch) {
      const keys = (Object.keys(patch) as (keyof SrdDocumentSettings)[]).filter(
        (key) => patch[key] !== undefined,
      );
      if (keys.length === 0) return;
      doc.transact(() => {
        let changed = false;
        for (const key of keys) {
          // Sanitized here too, so a bad value from a caller is caught at
          // the write rather than stored and dropped on every read.
          changed = writeField(fields, key, readSrdField(key, patch[key])) || changed;
        }
        // Only a real edit departs from the preset.
        if (changed) writeField(fields, 'presetId', CUSTOM_PRESET_ID);
      });
    },
    setMetadata(overrides) {
      doc.transact(() => writeField(fields, 'metadata', readSrdField('metadata', overrides)));
    },
    setFraming(itemId, framing) {
      if (!itemId) return;
      doc.transact(() => writeFraming(framingMap, itemId, framing));
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      fields.unobserve(onFieldsChange);
      framingMap.unobserve(onFramingChange);
      listeners.clear();
    },
  };
}

/**
 * Fills in whichever SRD fields and framing entries the document does not
 * have yet. Per key, and only for values that differ from the defaults, so it
 * is safe against a populated document and writes nothing for a default SRD.
 */
export function seedYjsSrd(doc: Y.Doc, state: SrdDocumentState | undefined): void {
  if (!state) return;
  const fields = doc.getMap<unknown>(SRD_MAP);
  const framingMap = doc.getMap<unknown>(SRD_FRAMING_MAP);
  const values = fieldsOf(state);
  const missingFields = SRD_FIELDS.filter(
    (field) => !fields.has(field) && !isDefaultSrdField(field, values[field]),
  );
  const missingFraming = Object.entries(state.framing).filter(
    ([itemId, framing]) => !framingMap.has(itemId) && !isDefaultFraming(framing),
  );
  // An unsupported template id is kept as found (see SrdDocumentState).
  const keepUnsupported = Boolean(state.unsupportedTemplateId) && !fields.has('templateId');
  if (missingFields.length === 0 && missingFraming.length === 0 && !keepUnsupported) return;
  doc.transact(() => {
    if (keepUnsupported) fields.set('templateId', state.unsupportedTemplateId);
    for (const field of missingFields) fields.set(field, values[field]);
    for (const [itemId, framing] of missingFraming) framingMap.set(itemId, framing);
  });
}
