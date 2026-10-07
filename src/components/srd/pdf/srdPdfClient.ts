import type {SrdDataContext, SrdTemplateConfig} from '../../../domain/srd/srdTypes';
import {createRenderQueue} from './srdPdfQueue';

export { SupersededError } from './srdPdfQueue';

/**
 * Renders SRD PDFs in a Web Worker, keeping the page responsive while
 * react-pdf works (seconds, for a large document). One worker per page load,
 * kept warm so fonts load once. Renders are ordered by srdPdfQueue: one at a
 * time, preview renders superseded by newer ones while they wait.
 *
 * Without worker support, or if the worker fails, renders fall back to the
 * main thread, as before.
 */
export interface SrdPdfRequest {
  id: number;
  data: SrdDataContext;
  config: SrdTemplateConfig;
}

export type SrdPdfResponse = { id: number; blob: Blob } | { id: number; error: string };

interface RenderInput {
  data: SrdDataContext;
  config: SrdTemplateConfig;
}

let worker: Worker | null = null;
let workerFailed = false;
let nextId = 1;
const pending = new Map<number, { resolve: (blob: Blob) => void; reject: (e: Error) => void }>();

function createWorker(): Worker | null {
  if (workerFailed || typeof Worker === 'undefined') return null;
  try {
    const created = new Worker(new URL('./srdPdf.worker.ts', import.meta.url), {
      type: 'module',
    });
    created.onmessage = (event: MessageEvent<SrdPdfResponse>) => {
      const waiter = pending.get(event.data.id);
      if (!waiter) return;
      pending.delete(event.data.id);
      if ('blob' in event.data) waiter.resolve(event.data.blob);
      else waiter.reject(new Error(event.data.error));
    };
    created.onerror = (event) => {
      // The worker could not load or crashed: render on the main thread from
      // now on, including whatever it was doing.
      event.preventDefault();
      console.warn('SRD PDF worker failed; rendering on the main thread.', event.message);
      workerFailed = true;
      created.terminate();
      worker = null;
      for (const [, waiter] of pending) waiter.reject(new WorkerFailedError());
      pending.clear();
    };
    return created;
  } catch {
    workerFailed = true;
    return null;
  }
}

class WorkerFailedError extends Error {}

async function renderOnMainThread({ data, config }: RenderInput): Promise<Blob> {
  const { renderSrdPdfBlob } = await import('./srdPdfBrowser');
  return renderSrdPdfBlob(data, config);
}

async function render(input: RenderInput): Promise<Blob> {
  worker ??= createWorker();
  if (!worker) return renderOnMainThread(input);
  const id = nextId++;
  const message: SrdPdfRequest = { id, ...input };
  try {
    return await new Promise<Blob>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker!.postMessage(message);
    });
  } catch (err) {
    if (err instanceof WorkerFailedError) return renderOnMainThread(input);
    throw err;
  }
}

const request = createRenderQueue(render);

export function renderSrdPdf(
  data: SrdDataContext,
  config: SrdTemplateConfig,
  options: { supersedable?: boolean } = {},
): Promise<Blob> {
  return request({ data, config }, options);
}
