import type { SrdTemplateId } from '../../../../domain/srd/srdTypes';
import { DEFAULT_SRD_TEMPLATE_ID } from '../../../../domain/srd/srdSettings';
import type { SrdPdfTemplate } from '../template/types';
import { createClassicSlots } from './classic/classicSlots';
import { ClassicLayout } from './classic/ClassicLayout';

/**
 * Every PDF template, by id - the registry a document's templateId selects
 * from. Keyed by the SrdTemplateId union, so adding an id without a
 * template (or the reverse) does not compile.
 */
export const SRD_PDF_TEMPLATES: Record<SrdTemplateId, SrdPdfTemplate> = {
  classic: { id: 'classic', createSlots: createClassicSlots, Layout: ClassicLayout },
};

/** The template for an id; unknown ids - from a newer build, say - draw with
 * the default rather than failing. */
export function pdfTemplateFor(templateId: string | undefined): SrdPdfTemplate {
  return (
    SRD_PDF_TEMPLATES[templateId as SrdTemplateId] ?? SRD_PDF_TEMPLATES[DEFAULT_SRD_TEMPLATE_ID]
  );
}
