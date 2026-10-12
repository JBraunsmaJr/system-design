import type {ComponentType} from 'react';
import type {RequirementStatus} from '../../../../domain/requirements/requirementsTypes';
import type {
  SrdDataContext,
  SrdSectionConfig,
  SrdTemplateConfig,
  SrdTemplateId,
} from '../../../../domain/srd/srdTypes';
import type {PdfMarkdownStyles, PdfStyle} from '../srdPdfMarkdown';

/**
 * Where on the page content sits. Classic puts everything in the body. A
 * template with a distinct opening page - Briefing's sidebar page - renders
 * that page's main column as `opening` and its side column as `sidebar`,
 * where its slots may style them differently; the pages after it are `body`.
 * Templates without such a page return the same slots for every placement.
 */
export type SrdPlacement = 'body' | 'opening' | 'sidebar';

/** The kinds of pill on a requirement card. */
export type PillVariant = 'type' | 'points' | 'sprint' | 'assignee' | `status-${RequirementStatus}`;

/**
 * Every style the shared section renderers use, by name. A template's look
 * is the values it gives these; the renderers own what is drawn and in what
 * order, so every template shows the same content. Adding a slot means
 * giving it a value in every template - the type enforces that.
 */
export interface SrdPdfSlots {
  // Page chrome
  page: PdfStyle;
  body: PdfStyle;
  banner: PdfStyle;
  runningHeader: PdfStyle;
  footerRule: PdfStyle;
  footerLeft: PdfStyle;
  footerRight: PdfStyle;
  // Title block
  title: PdfStyle;
  metaGrid: PdfStyle;
  metaItem: PdfStyle;
  metaLabel: PdfStyle;
  // Sections
  sectionHeading: PdfStyle;
  sectionIntro: PdfStyle;
  subHeading: PdfStyle;
  emptyNote: PdfStyle;
  // Tables
  table: PdfStyle;
  tableHeaderRow: PdfStyle;
  tableHeaderCell: PdfStyle;
  tableRow: PdfStyle;
  /** Every second row, on top of tableRow; {} for no striping. */
  tableRowAlt: PdfStyle;
  tableCell: PdfStyle;
  /** Emphasis and identifiers inside text. */
  strong: PdfStyle;
  code: PdfStyle;
  // Architecture
  /** The diagram, framed on the image itself, with a fixed height: see
   * IMAGES_IN_THE_BROWSER in SrdPdfSections. */
  diagramImage: PdfStyle;
  // Requirement cards: a head and the rest, two boxes whose borders join
  /** The part of a card kept together on one page: title, pills, snapshot. */
  cardHead: PdfStyle;
  /** The rest: linked components, body, dependencies; may span pages. */
  cardRest: PdfStyle;
  cardTitleRow: PdfStyle;
  cardId: PdfStyle;
  cardTitle: PdfStyle;
  pillRow: PdfStyle;
  pill: (variant: PillVariant) => PdfStyle;
  snapshotFrame: PdfStyle;
  snapshotCaption: PdfStyle;
  /** Give it a fixed height: see IMAGES_IN_THE_BROWSER in SrdPdfSections. */
  snapshotImage: PdfStyle;
  /** Linked components and dependency lines. */
  cardDetail: PdfStyle;
  nodeTag: PdfStyle;
  cardBody: PdfStyle;
  // Rich text
  markdown: PdfMarkdownStyles;
}

/** A template's slots for each placement. */
export type SrdPdfSlotsByPlacement = (placement: SrdPlacement) => SrdPdfSlots;

export interface SrdPdfLayoutProps {
  data: SrdDataContext;
  config: SrdTemplateConfig;
  /** The enabled sections, in order. */
  sections: SrdSectionConfig[];
}

/**
 * A template: its look (slots) and its structure (layout). The layout decides
 * the page - where the title block goes, whether there is a sidebar and which
 * sections it holds - and draws content only through the shared renderers.
 */
/**
 * Structural variations a template asks of the shared renderers, for content
 * its layout draws elsewhere. Each is off by default.
 */
export interface SrdPdfTemplateFeatures {
  /** The layout draws the scope metrics (SrdPdfMetrics) itself - in a
   * sidebar, say - so the executive summary leaves them out. */
  metricsInLayout?: boolean;
}

export interface SrdPdfTemplate {
  id: SrdTemplateId;
  features?: SrdPdfTemplateFeatures;
  createSlots: (config: SrdTemplateConfig, fontsRegistered: boolean) => SrdPdfSlotsByPlacement;
  Layout: ComponentType<SrdPdfLayoutProps>;
}
