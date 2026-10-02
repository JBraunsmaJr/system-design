import { useMemo } from 'react';
import { Document } from '@react-pdf/renderer';
import type { SrdDataContext, SrdTemplateConfig } from '../../../domain/srd/srdTypes';
import { SrdPdfTemplateContext } from './template/context';
import { pdfTemplateFor } from './templates';

export interface SrdPdfDocumentProps {
  data: SrdDataContext;
  config: SrdTemplateConfig;
  /** Whether the SRD's own fonts are registered; otherwise PDF built-ins. */
  fontsRegistered?: boolean;
}

/**
 * The SRD as a react-pdf document. The document's template supplies the look
 * (slots) and the page structure (layout); every section's content comes
 * from the shared renderers, so all templates carry the same document.
 */
export function SrdPdfDocument({ data, config, fontsRegistered = false }: SrdPdfDocumentProps) {
  const template = pdfTemplateFor(config.templateId);
  const context = useMemo(
    () => ({ slotsFor: template.createSlots(config, fontsRegistered), placement: 'body' as const }),
    [template, config, fontsRegistered],
  );
  const sections = useMemo(
    () => config.sections.filter((s) => s.enabled).sort((a, b) => a.order - b.order),
    [config.sections],
  );
  const { Layout } = template;

  return (
    <Document
      title={data.metadata.title}
      author={data.metadata.authors.map((a) => a.name).join(', ') || undefined}
      subject="Solution Requirement Document"
      creator="System Design"
      producer="System Design"
    >
      <SrdPdfTemplateContext.Provider value={context}>
        <Layout data={data} config={config} sections={sections} />
      </SrdPdfTemplateContext.Provider>
    </Document>
  );
}
