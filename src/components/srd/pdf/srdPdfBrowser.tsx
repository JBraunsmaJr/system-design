import { pdf } from '@react-pdf/renderer';
import type { SrdDataContext, SrdTemplateConfig } from '../../../domain/srd/srdTypes';
import { SrdPdfDocument } from './SrdPdfDocument';
import { registerSrdPdfFonts } from './srdPdfFonts';
import { SRD_PDF_FONT_URLS } from './srdPdfFontAssets';

/**
 * The browser's entry to the react-pdf renderer. Registers the SRD's fonts
 * from the build's asset URLs on first use, so react-pdf can fetch the few it
 * needs, and renders a document to a PDF blob - the same blob the preview
 * shows and the export downloads.
 */
let fontsReady = false;
function ensureFonts() {
  if (fontsReady) return;
  registerSrdPdfFonts((file) => {
    const url = SRD_PDF_FONT_URLS[file];
    if (!url) throw new Error(`No asset URL for PDF font ${file}`);
    return url;
  });
  fontsReady = true;
}

export async function renderSrdPdfBlob(
  data: SrdDataContext,
  config: SrdTemplateConfig,
): Promise<Blob> {
  ensureFonts();
  return pdf(<SrdPdfDocument data={data} config={config} fontsRegistered />).toBlob();
}
