import { StyleSheet } from '@react-pdf/renderer';
import type { SrdTemplateConfig } from '../../../../../domain/srd/srdTypes';
import type { PdfMarkdownStyles, PdfStyle } from '../../srdPdfMarkdown';
import { PDF_PALETTE as P, mixColors } from '../../srdPdfPalette';
import { pdfMonoStyle, resolvePdfFontFamily } from '../../srdPdfFonts';
import type { PillVariant, SrdPdfSlots, SrdPdfSlotsByPlacement } from '../../template/types';

export const PAGE_MARGIN = 48;
const HEADER_BAND = 34;
const FOOTER_BAND = 40;

/**
 * A text size with its line height, always declared together. react-pdf
 * turns a unitless line height into points where it is declared, using that
 * style's own font size - or 18pt when it has none - and children inherit
 * the points. So a line height without a size (or a size without one, under
 * an inherited line height) gives small text a tall line: chips and badges
 * once stood twice their height with the text at the top.
 */
function type(fontSize: number, leading: number): PdfStyle {
  return { fontSize, lineHeight: leading };
}

/** A pill's colors, mixed as the HTML preview's CSS mixes them. */
function tone(base: string, bg: number, fg: number, border: number): PdfStyle {
  return {
    backgroundColor: mixColors(base, bg, P.white),
    color: mixColors(base, fg, P.black),
    borderColor: mixColors(base, border, P.white),
  };
}

/**
 * Classic: the look the SRD has always had - a single column, numbered
 * headings in the primary color with an accent rule, light-ruled tables.
 */
export function createClassicSlots(
  config: SrdTemplateConfig,
  fontsRegistered: boolean,
): SrdPdfSlotsByPlacement {
  const { theme } = config;
  const fontFamily = resolvePdfFontFamily(theme.fontFamily, fontsRegistered);
  const mono = pdfMonoStyle(fontsRegistered);
  // PDF's built-in fonts have only regular and bold.
  const semibold = fontsRegistered ? 600 : 700;
  const hasBanner = Boolean(config.headersAndFooters.classificationBanner);
  const cellPadding = theme.tableDense ? 3 : 5;

  const s = StyleSheet.create({
    page: {
      paddingTop: PAGE_MARGIN + HEADER_BAND + (hasBanner ? 14 : 0),
      paddingBottom: PAGE_MARGIN + FOOTER_BAND,
      paddingHorizontal: PAGE_MARGIN,
      fontFamily,
      fontSize: 10,
      color: P.ink700,
      backgroundColor: P.paper,
    },
    // Line height lives on the body, never the page or any ancestor of the
    // page chrome: there it makes react-pdf drop the page numbers.
    body: type(10, 1.5),
    banner: {
      position: 'absolute',
      top: 14,
      left: 0,
      right: 0,
      textAlign: 'center',
      ...type(8, 1.2),
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
      borderColor: P.ink200,
      ...type(8, 1.2),
      color: P.ink500,
    },
    footerRule: {
      position: 'absolute',
      bottom: PAGE_MARGIN - 6,
      left: PAGE_MARGIN,
      right: PAGE_MARGIN,
      borderTopWidth: 1,
      borderColor: P.ink200,
    },
    footerLeft: {
      position: 'absolute',
      bottom: PAGE_MARGIN - 20,
      left: PAGE_MARGIN,
      // Size only: a line height on a footer text, as on the page, makes
      // react-pdf drop the page numbers it renders.
      fontSize: 8,
      color: P.ink500,
    },
    footerRight: {
      position: 'absolute',
      bottom: PAGE_MARGIN - 20,
      right: PAGE_MARGIN,
      textAlign: 'right',
      // Size only: a line height on a footer text, as on the page, makes
      // react-pdf drop the page numbers it renders.
      fontSize: 8,
      color: P.ink500,
    },
    title: {
      ...type(24, 1.2),
      fontWeight: 700,
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
      borderBottomColor: P.ink200,
    },
    metaItem: { width: '50%', paddingVertical: 2, ...type(9, 1.5) },
    metaLabel: { fontWeight: 700, color: P.ink900 },
    sectionHeading: {
      ...type(15, 1.25),
      fontWeight: 700,
      color: theme.primaryColor,
      marginTop: 18,
      marginBottom: 6,
      paddingBottom: 4,
      borderBottomWidth: 1,
      borderColor: theme.accentColor,
    },
    sectionIntro: { marginBottom: 8, color: P.ink500 },
    subHeading: {
      ...type(11.5, 1.3),
      fontWeight: 700,
      color: P.ink900,
      marginTop: 10,
      marginBottom: 5,
    },
    emptyNote: { fontStyle: 'italic', color: P.ink500, marginBottom: 8 },
    // Tighter than body text: rows are short and many.
    // No top border here: a table may carry its heading inside it (see
    // PdfTable), so the top rule belongs to the header row.
    table: { marginBottom: 10, ...type(9, 1.3) },
    tableHeaderRow: {
      flexDirection: 'row',
      backgroundColor: P.ink100,
      borderTopWidth: 1,
      borderTopColor: P.ink200,
      borderBottomWidth: 1,
      borderColor: P.ink300,
    },
    tableHeaderCell: { padding: cellPadding, fontWeight: 700, color: P.ink900 },
    tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderColor: P.ink200 },
    tableRowAlt: { backgroundColor: P.ink50 },
    tableCell: { padding: cellPadding },
    strong: { fontWeight: 700, color: P.ink900 },
    code: { ...mono, ...type(8.5, 1.3), color: P.ink800 },
    // Framed on the image itself, as one node (see IMAGES_IN_THE_BROWSER in
    // SrdPdfSections). A fixed box, the size the previous export drew it,
    // which fits one page's content height in either orientation (Letter
    // landscape leaves about 428pt) - an image never splits.
    diagramImage: {
      width: '100%',
      height: 240,
      objectFit: 'contain',
      marginVertical: 8,
      padding: 6,
      borderWidth: 1,
      borderColor: P.ink200,
      backgroundColor: P.ink100,
    },
    // One card drawn as two boxes: the head (top and sides) and the rest
    // (sides and bottom), whose borders join into one frame.
    cardHead: {
      paddingTop: 10,
      paddingHorizontal: 10,
      paddingBottom: 4,
      borderTopWidth: 1,
      borderRightWidth: 1,
      borderLeftWidth: 3,
      borderColor: P.ink200,
      borderLeftColor: theme.primaryColor,
    },
    cardRest: {
      paddingHorizontal: 10,
      paddingBottom: 10,
      marginBottom: 10,
      borderBottomWidth: 1,
      borderRightWidth: 1,
      borderLeftWidth: 3,
      borderColor: P.ink200,
      borderLeftColor: theme.primaryColor,
    },
    cardTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 5 },
    cardId: {
      ...mono,
      ...type(8.5, 1.2),
      fontWeight: 700,
      color: theme.primaryColor,
      backgroundColor: P.ink100,
      paddingVertical: 1.5,
      paddingHorizontal: 4,
      marginRight: 6,
    },
    cardTitle: { flex: 1, ...type(11, 1.3), fontWeight: semibold, color: P.ink900 },
    pillRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 },
    snapshotFrame: {
      marginTop: 4,
      padding: 4,
      borderWidth: 1,
      borderColor: P.ink200,
      backgroundColor: P.ink50,
    },
    snapshotCaption: {
      ...type(7.5, 1.2),
      fontWeight: 700,
      color: P.ink500,
      marginBottom: 3,
      letterSpacing: 0.5,
    },
    // A fixed height (see IMAGES_IN_THE_BROWSER in SrdPdfSections), which
    // also bounds the unsplittable card head to fit on one page.
    // 150pt, as the previous export drew snapshots.
    snapshotImage: { width: '100%', height: 150, objectFit: 'contain' },
    cardDetail: { ...type(8.5, 1.45), color: P.ink600, marginTop: 3 },
    nodeTag: { ...mono, ...type(8, 1.2), color: P.ink700 },
    cardBody: { marginTop: 4 },
  });

  const pillBase: PdfStyle = {
    ...type(7.5, 1.2),
    fontWeight: semibold,
    paddingVertical: 1.5,
    paddingHorizontal: 5,
    marginRight: 4,
    marginBottom: 2,
    borderWidth: 1,
    borderRadius: 3,
  };
  const pillTones: Record<PillVariant, PdfStyle> = {
    type: tone(P.info, 15, 60, 35),
    'status-done': tone(P.success, 15, 70, 25),
    'status-in-progress': tone(P.warning, 20, 65, 35),
    'status-todo': { backgroundColor: P.ink100, color: P.ink600, borderColor: P.ink200 },
    points: tone(P.violet, 15, 80, 25),
    sprint: tone(P.danger, 15, 75, 30),
    assignee: { backgroundColor: P.ink100, color: P.ink700, borderColor: P.ink200 },
  };
  const pills = Object.fromEntries(
    Object.entries(pillTones).map(([variant, colors]) => [variant, { ...pillBase, ...colors }]),
  ) as Record<PillVariant, PdfStyle>;

  const markdown: PdfMarkdownStyles = {
    paragraph: { marginBottom: 6 },
    heading: {
      ...type(11.5, 1.3),
      fontWeight: 700,
      color: P.ink900,
      marginTop: 8,
      marginBottom: 4,
    },
    strong: { fontWeight: 700, color: P.ink900 },
    emphasis: { fontStyle: 'italic' },
    strikethrough: { textDecoration: 'line-through' },
    inlineCode: { ...mono, ...type(9, 1.3), backgroundColor: P.ink100 },
    codeBlock: {
      ...mono,
      ...type(8.5, 1.4),
      padding: 8,
      marginBottom: 8,
      backgroundColor: P.ink100,
      borderLeftWidth: 2,
      borderColor: theme.accentColor,
    },
    link: { color: theme.accentColor, textDecoration: 'underline' },
    blockquote: {
      marginBottom: 8,
      paddingLeft: 10,
      borderLeftWidth: 2,
      borderColor: P.ink200,
      color: P.ink500,
    },
    list: { marginBottom: 6 },
    listItem: { flexDirection: 'row', marginBottom: 2 },
    listMarker: { width: 16, color: P.ink500 },
    listContent: { flex: 1 },
    rule: { borderBottomWidth: 1, borderColor: P.ink200, marginVertical: 8 },
    table: { marginBottom: 8, borderTopWidth: 1, borderColor: P.ink200 },
    tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderColor: P.ink200 },
    tableHeaderCell: {
      flex: 1,
      padding: cellPadding,
      fontWeight: 700,
      color: P.ink900,
      backgroundColor: P.ink100,
    },
    tableCell: { flex: 1, padding: cellPadding },
  };

  const slots: SrdPdfSlots = { ...s, pill: (variant) => pills[variant], markdown };
  // One column, so the same slots wherever content is placed.
  return () => slots;
}
