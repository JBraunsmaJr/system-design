import { useEffect, useRef, useState } from 'react';
// The legacy build: pdf.js's modern build relies on the newest JavaScript
// (e.g. Map.prototype.getOrInsertComputed) and fails outright in browsers
// even slightly behind; the legacy build polyfills it.
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { SrdDataContext, SrdTemplateConfig } from '../../../domain/srd/srdTypes';
import { renderSrdPdfBlob } from './srdPdfBrowser';

GlobalWorkerOptions.workerSrc = workerUrl;

/** Batches a burst of edits into one render. */
const RENDER_DEBOUNCE_MS = 400;
/** The widest a page is drawn on screen. */
const MAX_PAGE_WIDTH = 860;

export interface SrdPdfPreviewProps {
  data: SrdDataContext;
  config: SrdTemplateConfig;
  /** Receives each PDF once its pages are on screen: what the user sees is
   * exactly what an export downloads. */
  onRendered?: (blob: Blob) => void;
}

type Status =
  { state: 'rendering' } | { state: 'ready'; pages: number } | { state: 'error'; message: string };

/**
 * A preview of the PDF itself (Phase 2, behind the beta toggle): the document
 * is rendered with react-pdf, then its pages are drawn to canvases with
 * pdf.js. What is shown is the actual file, not an HTML imitation of it.
 *
 * Rendering is debounced, a newer render supersedes an older one, and new
 * pages are drawn offscreen and swapped in only once all are painted, so the
 * preview never flashes empty or shows a half-drawn document.
 *
 * Default export, loaded lazily: react-pdf and pdf.js are fetched only when
 * someone turns the new renderer on.
 */
export default function SrdPdfPreview({ data, config, onRendered }: SrdPdfPreviewProps) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef(0);
  const [status, setStatus] = useState<Status>({ state: 'rendering' });
  const onRenderedRef = useRef(onRendered);
  useEffect(() => {
    onRenderedRef.current = onRendered;
  }, [onRendered]);

  useEffect(() => {
    const request = ++requestRef.current;
    const isCurrent = () => request === requestRef.current;
    const timer = setTimeout(async () => {
      setStatus({ state: 'rendering' });
      try {
        const blob = await renderSrdPdfBlob(data, config);
        if (!isCurrent()) return;
        const loading = getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
        try {
          const pdfDoc = await loading.promise;
          const container = pagesRef.current;
          if (!isCurrent() || !container) return;
          const width = Math.min(container.clientWidth || MAX_PAGE_WIDTH, MAX_PAGE_WIDTH);
          const dpr = window.devicePixelRatio || 1;
          const staged: HTMLCanvasElement[] = [];
          for (let n = 1; n <= pdfDoc.numPages; n++) {
            const page = await pdfDoc.getPage(n);
            const viewport = page.getViewport({
              scale: width / page.getViewport({ scale: 1 }).width,
            });
            const canvas = document.createElement('canvas');
            canvas.width = Math.floor(viewport.width * dpr);
            canvas.height = Math.floor(viewport.height * dpr);
            canvas.style.width = `${Math.floor(viewport.width)}px`;
            canvas.setAttribute('aria-label', `Page ${n} of ${pdfDoc.numPages}`);
            await page.render({ canvas, viewport, transform: [dpr, 0, 0, dpr, 0, 0] }).promise;
            if (!isCurrent()) return;
            staged.push(canvas);
          }
          container.replaceChildren(...staged);
          setStatus({ state: 'ready', pages: pdfDoc.numPages });
          onRenderedRef.current?.(blob);
        } finally {
          // Frees the worker's copy of the document.
          void loading.destroy();
        }
      } catch (err) {
        if (!isCurrent()) return;
        console.error('SRD PDF preview failed:', err);
        setStatus({ state: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    }, RENDER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [data, config]);

  return (
    <div className="srd-pdf-preview" aria-busy={status.state === 'rendering'}>
      <div className="srd-pdf-preview__status" role="status">
        {status.state === 'rendering' && 'Rendering PDF…'}
        {status.state === 'ready' && `PDF · ${status.pages} page${status.pages === 1 ? '' : 's'}`}
        {status.state === 'error' && `Could not render the PDF: ${status.message}`}
      </div>
      <div ref={pagesRef} className="srd-pdf-preview__pages" />
    </div>
  );
}
