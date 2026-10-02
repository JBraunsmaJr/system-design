import type { SrdTemplateConfig } from '../../../../../domain/srd/srdTypes';
import type { PdfStyle } from '../../srdPdfMarkdown';
import { PDF_PALETTE as P } from '../../srdPdfPalette';
import type { PillVariant, SrdPdfSlots, SrdPdfSlotsByPlacement } from '../../template/types';
import { createClassicSlots } from '../classic/classicSlots';
import { PAGE_MARGIN, solidTone, type } from '../shared';

/**
 * Engineering: a specification's look. A dark title band across the first
 * page, sections marked by an accent bar, dark table headers, solid status
 * pills. Built on Classic's slots, overriding only what makes it different.
 */
export function createEngineeringSlots(
  config: SrdTemplateConfig,
  fontsRegistered: boolean,
): SrdPdfSlotsByPlacement {
  const classic = createClassicSlots(config, fontsRegistered)('body');
  const { theme } = config;
  const semibold = fontsRegistered ? 600 : 700;

  // The title band reaches the page's edges: negative margins undo the
  // page padding, and padding of the same width keeps the text aligned.
  const bleed: PdfStyle = { marginHorizontal: -PAGE_MARGIN, paddingHorizontal: PAGE_MARGIN };

  const pills: Record<PillVariant, PdfStyle> = {
    type: solidTone(P.ink700),
    'status-done': solidTone('#047857'),
    'status-in-progress': solidTone('#b45309'),
    'status-todo': solidTone(P.ink500),
    points: solidTone('#6d28d9'),
    sprint: solidTone('#be185d'),
    assignee: { backgroundColor: P.white, color: P.ink800, borderColor: P.ink400 },
  };
  const pill = (variant: PillVariant): PdfStyle => ({
    ...classic.pill(variant),
    ...pills[variant],
    borderRadius: 0,
  });

  const slots: SrdPdfSlots = {
    ...classic,
    title: {
      ...classic.title,
      ...bleed,
      ...type(24, 1.2),
      color: P.white,
      backgroundColor: P.ink900,
      paddingTop: 18,
      paddingBottom: 10,
      marginBottom: 0,
    },
    metaGrid: {
      ...classic.metaGrid,
      ...bleed,
      backgroundColor: P.ink800,
      borderTopWidth: 3,
      borderTopColor: theme.accentColor,
      borderBottomWidth: 0,
      paddingVertical: 10,
      marginBottom: 20,
    },
    metaItem: { ...classic.metaItem, color: P.ink200 },
    metaLabel: { ...classic.metaLabel, color: P.white },
    sectionHeading: {
      ...type(14, 1.25),
      fontWeight: 700,
      color: P.ink900,
      marginTop: 4,
      marginBottom: 6,
      paddingLeft: 8,
      borderLeftWidth: 4,
      borderLeftColor: theme.accentColor,
    },
    subHeading: {
      ...type(8.5, 1.3),
      fontWeight: 700,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      color: theme.primaryColor,
      marginTop: 12,
      marginBottom: 5,
    },
    tableHeaderRow: {
      ...classic.tableHeaderRow,
      backgroundColor: P.ink800,
      borderTopColor: P.ink800,
      borderColor: P.ink800,
    },
    tableHeaderCell: { ...classic.tableHeaderCell, color: P.white },
    tableRowAlt: {},
    tableRow: { ...classic.tableRow, borderColor: P.ink300 },
    cardHead: {
      ...classic.cardHead,
      borderColor: P.ink300,
      borderLeftWidth: 1,
      borderLeftColor: P.ink300,
    },
    cardRest: {
      ...classic.cardRest,
      borderColor: P.ink300,
      borderLeftWidth: 1,
      borderLeftColor: P.ink300,
    },
    cardId: { ...classic.cardId, color: P.white, backgroundColor: theme.primaryColor },
    cardTitle: { ...classic.cardTitle, fontWeight: semibold },
    snapshotFrame: { ...classic.snapshotFrame, backgroundColor: P.white, borderColor: P.ink300 },
    pill,
  };
  // One column, so the same slots wherever content is placed.
  return () => slots;
}
