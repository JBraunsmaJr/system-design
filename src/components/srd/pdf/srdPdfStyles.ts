import { StyleSheet } from '@react-pdf/renderer';
import type { SrdTemplateConfig } from '../../../domain/srd/srdTypes';
import type { PdfMarkdownStyles } from './srdPdfMarkdown';
import { pdfMonoFamily, resolvePdfFontFamily } from './srdPdfFonts';

/**
 * The react-pdf styles for one document's settings.
 *
 * Transitional: Phase 3 replaces this single look with template-provided
 * style slots. Colors match the HTML preview's print palette.
 */
const INK_900 = '#111827';
const INK_700 = '#374151';
const INK_500 = '#6b7280';
const INK_200 = '#e5e7eb';
const INK_100 = '#f3f4f6';
const PAPER = '#ffffff';

export const PAGE_MARGIN = 48;
const HEADER_BAND = 34;
const FOOTER_BAND = 40;

export function createSrdPdfStyles(config: SrdTemplateConfig, fontsRegistered?: boolean) {
  const { theme } = config;
  const fontFamily = resolvePdfFontFamily(theme.fontFamily, fontsRegistered);
  const mono = pdfMonoFamily(fontsRegistered);
  const hasBanner = Boolean(config.headersAndFooters.classificationBanner);
  const top = PAGE_MARGIN + HEADER_BAND + (hasBanner ? 14 : 0);

  const sheet = StyleSheet.create({
    page: {
      paddingTop: top,
      paddingBottom: PAGE_MARGIN + FOOTER_BAND,
      paddingHorizontal: PAGE_MARGIN,
      fontFamily,
      fontSize: 10,
      color: INK_700,
      backgroundColor: PAPER,
    },
    // Line height lives here rather than on the page: a page-level
    // lineHeight makes react-pdf drop fixed `render` texts - the page
    // numbers - entirely. Text styles inherit through Views, so the body
    // keeps it while the footers sit outside.
    body: { lineHeight: 1.5 },
    banner: {
      position: 'absolute',
      top: 14,
      left: 0,
      right: 0,
      textAlign: 'center',
      fontSize: 8,
      fontWeight: 700,
      letterSpacing: 1,
      color: theme.primaryColor,
    },
    runningHeader: {
      position: 'absolute',
      top: PAGE_MARGIN - 14 + (hasBanner ? 14 : 0),
      left: PAGE_MARGIN,
      right: PAGE_MARGIN,
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingBottom: 6,
      borderBottomWidth: 1,
      borderColor: INK_200,
      fontSize: 8,
      color: INK_500,
    },
    footerRule: {
      position: 'absolute',
      bottom: PAGE_MARGIN - 6,
      left: PAGE_MARGIN,
      right: PAGE_MARGIN,
      borderTopWidth: 1,
      borderColor: INK_200,
    },
    footerLeft: {
      position: 'absolute',
      bottom: PAGE_MARGIN - 20,
      left: PAGE_MARGIN,
      fontSize: 8,
      color: INK_500,
    },
    footerRight: {
      position: 'absolute',
      bottom: PAGE_MARGIN - 20,
      right: PAGE_MARGIN,
      textAlign: 'right',
      fontSize: 8,
      color: INK_500,
    },
    title: {
      fontSize: 24,
      fontWeight: 700,
      lineHeight: 1.2,
      color: theme.primaryColor,
      marginBottom: 10,
    },
    metaGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      paddingVertical: 8,
      marginBottom: 18,
      borderTopWidth: 2,
      borderBottomWidth: 1,
      borderTopColor: theme.primaryColor,
      borderBottomColor: INK_200,
    },
    metaItem: { width: '50%', paddingVertical: 2, fontSize: 9 },
    metaLabel: { fontWeight: 700, color: INK_900 },
    sectionHeading: {
      fontSize: 15,
      fontWeight: 700,
      color: theme.primaryColor,
      marginTop: 18,
      marginBottom: 6,
      paddingBottom: 4,
      borderBottomWidth: 1,
      borderColor: theme.accentColor,
    },
    sectionIntro: { marginBottom: 8, color: INK_500 },
    subHeading: { fontSize: 11.5, fontWeight: 700, color: INK_900, marginTop: 10, marginBottom: 4 },
    diagramFrame: {
      marginVertical: 8,
      padding: 6,
      borderWidth: 1,
      borderColor: INK_200,
      backgroundColor: INK_100,
    },
    // Kept within one page's content height, since the diagram never
    // splits: Letter landscape leaves about 428pt, portrait about 616pt.
    diagramImage: {
      width: '100%',
      objectFit: 'contain',
      maxHeight: theme.pageOrientation === 'landscape' ? 300 : 420,
    },
  });

  const markdown: PdfMarkdownStyles = {
    paragraph: { marginBottom: 6 },
    heading: { fontSize: 11.5, fontWeight: 700, color: INK_900, marginTop: 8, marginBottom: 4 },
    strong: { fontWeight: 700, color: INK_900 },
    emphasis: { fontStyle: 'italic' },
    strikethrough: { textDecoration: 'line-through' },
    inlineCode: { fontFamily: mono, fontSize: 9, backgroundColor: INK_100 },
    codeBlock: {
      fontFamily: mono,
      fontSize: 8.5,
      lineHeight: 1.4,
      padding: 8,
      marginBottom: 8,
      backgroundColor: INK_100,
      borderLeftWidth: 2,
      borderColor: theme.accentColor,
    },
    link: { color: theme.accentColor, textDecoration: 'underline' },
    blockquote: {
      marginBottom: 8,
      paddingLeft: 10,
      borderLeftWidth: 2,
      borderColor: INK_200,
      color: INK_500,
    },
    list: { marginBottom: 6 },
    listItem: { flexDirection: 'row', marginBottom: 2 },
    listMarker: { width: 16, color: INK_500 },
    listContent: { flex: 1 },
    rule: { borderBottomWidth: 1, borderColor: INK_200, marginVertical: 8 },
    table: { marginBottom: 8, borderTopWidth: 1, borderColor: INK_200 },
    tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderColor: INK_200 },
    tableHeaderCell: {
      flex: 1,
      padding: theme.tableDense ? 3 : 5,
      fontWeight: 700,
      color: INK_900,
      backgroundColor: INK_100,
    },
    tableCell: { flex: 1, padding: theme.tableDense ? 3 : 5 },
  };

  return { ...sheet, markdown };
}

export type SrdPdfStyles = ReturnType<typeof createSrdPdfStyles>;
