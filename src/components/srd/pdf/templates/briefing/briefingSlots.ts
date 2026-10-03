import type { SrdTemplateConfig } from '../../../../../domain/srd/srdTypes';
import { PDF_PALETTE as P, mixColors } from '../../srdPdfPalette';
import type { SrdPdfSlots, SrdPdfSlotsByPlacement } from '../../template/types';
import { createClassicSlots } from '../classic/classicSlots';
import { PAGE_MARGIN, type } from '../shared';

/** The colored strip down every page's left edge. */
export const SIDEBAR_WIDTH = 190;
/** Space between the strip and the main column. */
const GUTTER = 30;
/** Where the main column starts. */
export const MAIN_LEFT = SIDEBAR_WIDTH + GUTTER;

/**
 * Briefing: an opening page with a colored sidebar holding the title, the
 * details and the key metrics, the first section beside it; the sections
 * after it on full-width pages. Opening slots are Classic's moved clear of
 * the strip, sidebar slots draw light on the strip's color, and body slots -
 * the pages after - are Classic's own.
 */
export function createBriefingSlots(
  config: SrdTemplateConfig,
  fontsRegistered: boolean,
): SrdPdfSlotsByPlacement {
  const classic = createClassicSlots(config, fontsRegistered)('body');
  const { primaryColor } = config.theme;
  const onStrip = mixColors(primaryColor, 18, P.white);
  const stripRule = mixColors(primaryColor, 55, P.white);

  // The headings stay the same on every page; only the opening page's
  // geometry differs.
  const sectionHeading = { ...classic.sectionHeading, borderBottomWidth: 0, marginTop: 14 };
  const body: SrdPdfSlots = { ...classic, sectionHeading };

  const opening: SrdPdfSlots = {
    ...classic,
    page: { ...classic.page, paddingLeft: MAIN_LEFT, paddingRight: PAGE_MARGIN },
    banner: { ...classic.banner, left: SIDEBAR_WIDTH },
    runningHeader: { ...classic.runningHeader, left: MAIN_LEFT },
    footerRule: { ...classic.footerRule, left: MAIN_LEFT },
    footerLeft: { ...classic.footerLeft, left: MAIN_LEFT },
    sectionHeading,
  };

  const sidebar: SrdPdfSlots = {
    ...opening,
    title: { ...type(18, 1.2), fontWeight: 700, color: P.white, marginBottom: 12 },
    metaGrid: { flexDirection: 'column', marginBottom: 18 },
    metaItem: { ...type(8.5, 1.45), color: onStrip, paddingVertical: 2 },
    metaLabel: { fontWeight: 700, color: P.white },
    subHeading: {
      ...type(8, 1.3),
      fontWeight: 700,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      color: P.white,
      marginBottom: 6,
    },
    table: { ...type(8, 1.3), marginBottom: 0 },
    tableHeaderRow: {
      flexDirection: 'row',
      borderTopWidth: 1,
      borderTopColor: stripRule,
      borderBottomWidth: 1,
      borderColor: stripRule,
    },
    tableHeaderCell: { ...classic.tableHeaderCell, color: P.white, padding: 3 },
    tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderColor: stripRule },
    tableRowAlt: {},
    tableCell: { padding: 3, color: onStrip },
    strong: { fontWeight: 700, color: P.white },
  };

  return (placement) =>
    placement === 'sidebar' ? sidebar : placement === 'opening' ? opening : body;
}
