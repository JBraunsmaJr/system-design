import { Document, Image, Page, Text, View } from '@react-pdf/renderer';
import type { SrdDataContext, SrdTemplateConfig } from '../../../domain/srd/srdTypes';
import { interpolateTokens } from '../../../domain/srd/srdMarkdownExport';
import { PdfMarkdown } from './srdPdfMarkdown';
import { createSrdPdfStyles, type SrdPdfStyles } from './srdPdfStyles';

export interface SrdPdfDocumentProps {
  data: SrdDataContext;
  config: SrdTemplateConfig;
  /** Whether the SRD's own fonts are registered; otherwise PDF built-ins. */
  fontsRegistered?: boolean;
}

/** Room a section heading keeps for what follows it, so it is never left
 * alone at the bottom of a page. */
const HEADING_KEEP_WITH_NEXT = 60;

function TitleBlock({ data, s }: { data: SrdDataContext; s: SrdPdfStyles }) {
  const { metadata } = data;
  const entries: Array<[string, string]> = [
    ['Version', metadata.version],
    ['Date', metadata.generatedAt],
  ];
  if (metadata.organization) entries.push(['Organization', metadata.organization]);
  if (metadata.authors.length > 0) {
    entries.push([
      'Authors',
      metadata.authors.map((a) => (a.role ? `${a.name} (${a.role})` : a.name)).join(', '),
    ]);
  }
  return (
    <View wrap={false}>
      <Text style={s.title}>{metadata.title}</Text>
      <View style={s.metaGrid}>
        {entries.map(([label, value]) => (
          <Text key={label} style={s.metaItem}>
            <Text style={s.metaLabel}>{label}: </Text>
            {value}
          </Text>
        ))}
      </View>
    </View>
  );
}

/**
 * The SRD as a react-pdf document - Phase 2's foundation: the page shell
 * (banner, running header, numbered footer), the title block, and each
 * enabled section's heading and introduction. Section bodies come with the
 * shared section renderers in Phase 3; the executive summary's description
 * and the architecture diagram are drawn here already, to exercise Markdown
 * and snapshot images end to end.
 */
export function SrdPdfDocument({ data, config, fontsRegistered }: SrdPdfDocumentProps) {
  const s = createSrdPdfStyles(config, fontsRegistered);
  const { headersAndFooters: hf, theme } = config;
  const text = (template: string | undefined) =>
    template ? interpolateTokens(template, data) : '';
  const sections = [...config.sections]
    .filter((section) => section.enabled)
    .sort((a, b) => a.order - b.order);

  const footerRight = (pageNumber: number, totalPages: number) =>
    hf.footerRight
      ? interpolateTokens(hf.footerRight, data, { pageNumber, totalPages })
      : hf.showPageNumbers
        ? `Page ${pageNumber} of ${totalPages}`
        : '';

  return (
    <Document
      title={data.metadata.title}
      author={data.metadata.authors.map((a) => a.name).join(', ') || undefined}
      subject="Solution Requirement Document"
      creator="System Design"
      producer="System Design"
    >
      <Page size="LETTER" orientation={theme.pageOrientation} style={s.page}>
        {hf.classificationBanner && (
          <Text style={s.banner} fixed>
            {text(hf.classificationBanner).toUpperCase()}
          </Text>
        )}
        {(hf.headerLeft || hf.headerRight) && (
          <View style={s.runningHeader} fixed>
            <Text>{text(hf.headerLeft)}</Text>
            <Text>{text(hf.headerRight)}</Text>
          </View>
        )}

        <View style={s.body}>
          <TitleBlock data={data} s={s} />

          {sections.map((section) => (
            <View key={section.id}>
              <Text style={s.sectionHeading} minPresenceAhead={HEADING_KEEP_WITH_NEXT}>
                {text(section.title)}
              </Text>
              {section.customIntroText && (
                <Text style={s.sectionIntro}>{text(section.customIntroText)}</Text>
              )}

              {section.id === 'executive_summary' && data.metadata.description && (
                <View>
                  <Text style={s.subHeading} minPresenceAhead={HEADING_KEEP_WITH_NEXT}>
                    Scope & Objectives
                  </Text>
                  <PdfMarkdown markdown={data.metadata.description} styles={s.markdown} />
                </View>
              )}

              {section.id === 'architecture' && data.architecture.diagramImageBase64 && (
                <View style={s.diagramFrame} wrap={false}>
                  <Image src={data.architecture.diagramImageBase64} style={s.diagramImage} />
                </View>
              )}
            </View>
          ))}
        </View>

        {/* Each footer text is its own fixed element: react-pdf evaluates a
            `render` callback (needed for page numbers) only on a fixed node
            itself, not on one nested inside a fixed View. They sit outside
            the body, whose line height would hide them (see srdPdfStyles). */}
        <View style={s.footerRule} fixed />
        <Text
          style={s.footerLeft}
          fixed
          render={({ pageNumber, totalPages }) =>
            hf.footerLeft ? interpolateTokens(hf.footerLeft, data, { pageNumber, totalPages }) : ''
          }
        />
        <Text
          style={s.footerRight}
          fixed
          render={({ pageNumber, totalPages }) => footerRight(pageNumber, totalPages)}
        />
      </Page>
    </Document>
  );
}
