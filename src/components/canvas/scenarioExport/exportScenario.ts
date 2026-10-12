import {
    buildTimeline,
    CROSSFADE_FRAMES,
    exportFileName,
    FRAME_HEIGHT,
    FRAME_WIDTH,
    type FrameLayout,
    GIF_HEIGHT,
    GIF_WIDTH,
    type ScenarioExportOptions,
    stepFileName,
} from '../../../domain/scenarioExport/scenarioExportPlan';
import {drawDiagram, drawFrame, type ExportTheme} from './composeFrame';
import {type CapturedStep, ExportCancelledError} from './useScenarioStepCapture';
import type {VideoRequest, VideoResponse} from './scenarioVideo.worker';

/**
 * Turns captured steps into the file the user asked for. Every format's
 * library is imported only when that format is chosen, and all of them are
 * bundled with the app - nothing here reaches outside it, so exporting works
 * the same on an air-gapped network.
 */

export interface ExportResult {
    blob: Blob;
    fileName: string;
    /** Anything the user should know about the file, e.g. a fallback codec. */
    note?: string;
}

export interface EncodeContext {
    steps: CapturedStep[];
    layout: FrameLayout;
    theme: ExportTheme;
    options: ScenarioExportOptions;
    scenarioTitle: string;
    documentTitle: string;
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
}

function checkCancelled(signal?: AbortSignal) {
    if (signal?.aborted) throw new ExportCancelledError();
}

function canvas(width: number, height: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    return c;
}

function toBlob(c: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
    return new Promise((resolve, reject) =>
        c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), type, quality),
    );
}

/** Every step drawn as a complete frame. */
async function composeFrames(ctx: EncodeContext): Promise<ImageBitmap[]> {
    const c = canvas(FRAME_WIDTH, FRAME_HEIGHT);
    const g = c.getContext('2d')!;
    const frames: ImageBitmap[] = [];
    for (const step of ctx.steps) {
        checkCancelled(ctx.signal);
        drawFrame(
            g,
            ctx.layout,
            step,
            {scenarioTitle: ctx.scenarioTitle, total: ctx.steps.length},
            ctx.theme,
        );
        frames.push(await createImageBitmap(c));
    }
    return frames;
}

async function exportPngZip(ctx: EncodeContext): Promise<ExportResult> {
    const {zipSync} = await import('fflate');
    const c = canvas(FRAME_WIDTH, FRAME_HEIGHT);
    const g = c.getContext('2d')!;
    const files: Record<string, Uint8Array> = {};
    for (const [i, step] of ctx.steps.entries()) {
        checkCancelled(ctx.signal);
        drawFrame(
            g,
            ctx.layout,
            step,
            {scenarioTitle: ctx.scenarioTitle, total: ctx.steps.length},
            ctx.theme,
        );
        const png = await toBlob(c, 'image/png');
        files[stepFileName(step.plan, ctx.steps.length)] = new Uint8Array(await png.arrayBuffer());
        ctx.onProgress?.(i + 1, ctx.steps.length);
    }
    // Stored, not deflated: PNGs are already compressed.
    const zip = zipSync(files, {level: 0});
    return {
        blob: new Blob([zip as Uint8Array<ArrayBuffer>], {type: 'application/zip'}),
        fileName: exportFileName(ctx.scenarioTitle, 'png'),
    };
}

async function exportPdf(ctx: EncodeContext): Promise<ExportResult> {
    const d = ctx.layout.diagram;
    const c = canvas(d.width, d.height);
    const g = c.getContext('2d')!;
    const slides = [];
    for (const step of ctx.steps) {
        checkCancelled(ctx.signal);
        drawDiagram(g, {x: 0, y: 0, width: d.width, height: d.height}, step, ctx.theme);
        // JPEG: several times cheaper to embed than PNG; the capture is opaque.
        slides.push({
            index: step.plan.index,
            title: step.plan.title,
            narration: step.plan.narration,
            levelLabel: step.plan.levelLabel,
            image: c.toDataURL('image/jpeg', 0.92),
        });
    }
    ctx.onProgress?.(0, 1);
    const {renderScenarioPdf} = await import('./renderScenarioPdf');
    const blob = await renderScenarioPdf({
        scenarioTitle: ctx.scenarioTitle,
        documentTitle: ctx.documentTitle,
        slides,
        layout: ctx.layout,
        titleSlide: ctx.options.titleSlide,
        theme: ctx.theme,
    });
    ctx.onProgress?.(1, 1);
    return {blob, fileName: exportFileName(ctx.scenarioTitle, 'pdf')};
}

const CODEC_NAMES: Record<string, string> = {avc: 'H.264', vp9: 'VP9', av1: 'AV1'};

async function exportVideo(ctx: EncodeContext, kind: 'gif' | 'mp4'): Promise<ExportResult> {
    const frames = await composeFrames(ctx);
    const timeline = buildTimeline(
        ctx.steps.map((s) => s.plan),
        ctx.options,
        CROSSFADE_FRAMES[kind],
    );
    const size =
        kind === 'gif'
            ? {width: GIF_WIDTH, height: GIF_HEIGHT}
            : {width: FRAME_WIDTH, height: FRAME_HEIGHT};
    // A module worker built into the app's own bundle (same origin).
    const worker = new Worker(new URL('./scenarioVideo.worker.ts', import.meta.url), {
        type: 'module',
    });
    try {
        const response = await new Promise<Extract<VideoResponse, { type: 'done' }>>(
            (resolve, reject) => {
                const onAbort = () => reject(new ExportCancelledError());
                ctx.signal?.addEventListener('abort', onAbort, {once: true});
                worker.onmessage = (event: MessageEvent<VideoResponse>) => {
                    const msg = event.data;
                    if (msg.type === 'progress') ctx.onProgress?.(msg.done, msg.total);
                    else if (msg.type === 'error') reject(new Error(msg.message));
                    else resolve(msg);
                };
                worker.onerror = (event) => {
                    event.preventDefault();
                    reject(new Error(event.message || 'The video encoder failed to start.'));
                };
                const request: VideoRequest = {kind, frames, timeline, ...size};
                worker.postMessage(request, frames);
            },
        );
        const type = kind === 'gif' ? 'image/gif' : 'video/mp4';
        const codec = response.codec;
        return {
            blob: new Blob([response.bytes], {type}),
            fileName: exportFileName(ctx.scenarioTitle, kind),
            note:
                kind === 'mp4' && codec && codec !== 'avc'
                    ? `This browser can't encode H.264, so the video is ${CODEC_NAMES[codec] ?? codec}. ` +
                    'It plays in browsers but may not in PowerPoint or Keynote.'
                    : undefined,
        };
    } finally {
        worker.terminate();
        for (const f of frames) f.close();
    }
}

export function encodeScenario(ctx: EncodeContext): Promise<ExportResult> {
    switch (ctx.options.format) {
        case 'png':
            return exportPngZip(ctx);
        case 'pdf':
            return exportPdf(ctx);
        case 'gif':
            return exportVideo(ctx, 'gif');
        case 'mp4':
            return exportVideo(ctx, 'mp4');
    }
}

export function downloadBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Give the download a moment to start before the URL goes away.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
