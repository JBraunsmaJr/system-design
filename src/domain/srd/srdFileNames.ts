import type {SrdDataContext} from './srdTypes';

/** Lowercases, collapses non-alphanumerics to '-', and trims leading/trailing dashes. */
function slugifyFilenamePart(value: string | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The SRD's PDF file name, shared by every renderer so exports are named
 * the same whichever one produced them. */
export function srdPdfFileName(srdData: SrdDataContext): string {
  const safeTitle = slugifyFilenamePart(srdData.metadata.title) || 'document';
  const safeVersion = slugifyFilenamePart(srdData.metadata.version);
  return safeVersion ? `srd-${safeTitle}-v${safeVersion}.pdf` : `srd-${safeTitle}.pdf`;
}
