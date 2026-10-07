/**
 * The SRD's PDF engine, in a Web Worker: react-pdf's layout and PDF building
 * take seconds for a large document and would otherwise freeze the page.
 * Reuses the browser entry (srdPdfBrowser), so fonts and the Buffer
 * substitute are set up exactly as on the main thread.
 *
 * Messages: { id, data, config } in; { id, blob } or { id, error } out.
 */
import {renderSrdPdfBlob} from './srdPdfBrowser';
import type {SrdPdfRequest, SrdPdfResponse} from './srdPdfClient';

// This file runs as a worker; the app's type configuration is for pages.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SrdPdfRequest>) => void) | null;
  postMessage(message: SrdPdfResponse): void;
};

scope.onmessage = async (event) => {
  const { id, data, config } = event.data;
  try {
    scope.postMessage({ id, blob: await renderSrdPdfBlob(data, config) });
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
