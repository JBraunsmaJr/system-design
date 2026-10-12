import {Buffer} from 'buffer';
import {pdf} from '@react-pdf/renderer';
import {registerSrdPdfFonts} from '../../srd/pdf/srdPdfFonts';
import {SRD_PDF_FONT_URLS} from '../../srd/pdf/srdPdfFontAssets';
import {ScenarioPdfDocument, type ScenarioPdfProps} from './ScenarioPdfDocument';

// react-pdf calls the Node global `Buffer` when it loads an image, which
// browsers lack (see srdPdfBrowser.tsx, which does the same).
const globals = globalThis as { Buffer?: unknown };
globals.Buffer ??= Buffer;

/**
 * The scenario deck's lazily loaded PDF entry. Fonts are the SRD's: Inter,
 * bundled with the app as fingerprinted assets, so the PDF engine loads them
 * from the app's own origin and never from a font CDN.
 */
export async function renderScenarioPdf(
    props: Omit<ScenarioPdfProps, 'fontsRegistered'>,
): Promise<Blob> {
    registerSrdPdfFonts((file) => {
        const url = SRD_PDF_FONT_URLS[file];
        if (!url) throw new Error(`No asset URL for PDF font ${file}`);
        return url;
    });
    return pdf(<ScenarioPdfDocument {...props} fontsRegistered/>).toBlob();
}
