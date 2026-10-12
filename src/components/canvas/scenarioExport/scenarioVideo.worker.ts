/**
 * Encodes a scenario's frames as an animated GIF or an MP4, off the page's
 * thread so the editor stays responsive while it works.
 *
 * Air-gapped deployments: everything here is bundled with the app. gifenc
 * and Mediabunny are npm packages built into this worker's own chunk (each
 * loaded only for its format), and MP4 encoding uses the browser's built-in
 * WebCodecs encoder. Nothing is fetched at runtime.
 */
import {MP4_FPS, type TimelineFrame, videoFrameCounts,} from '../../../domain/scenarioExport/scenarioExportPlan';

export interface VideoRequest {
    kind: 'gif' | 'mp4';
    /** One composed 1920x1080 frame per step, in order. */
    frames: ImageBitmap[];
    timeline: TimelineFrame[];
    width: number;
    height: number;
}

export type VideoResponse =
    | { type: 'progress'; done: number; total: number }
    | { type: 'done'; bytes: ArrayBuffer; codec?: string }
    | { type: 'error'; message: string };

// The project's types are the page's (DOM), not a worker's: describe the
// little of the worker scope used here, as srdPdf.worker.ts does.
const scope = self as unknown as {
    onmessage: ((event: MessageEvent<VideoRequest>) => void) | null;
    postMessage(message: VideoResponse, transfer: Transferable[]): void;
};

function post(message: VideoResponse, transfer: Transferable[] = []) {
    scope.postMessage(message, transfer);
}

/** Draws one timeline frame, scaled to the output size. */
function draw(
    ctx: OffscreenCanvasRenderingContext2D,
    frame: TimelineFrame,
    bitmaps: ImageBitmap[],
    width: number,
    height: number,
) {
    ctx.globalAlpha = 1;
    if (frame.kind === 'hold') {
        ctx.drawImage(bitmaps[frame.step], 0, 0, width, height);
        return;
    }
    ctx.drawImage(bitmaps[frame.from], 0, 0, width, height);
    ctx.globalAlpha = frame.mix;
    ctx.drawImage(bitmaps[frame.to], 0, 0, width, height);
    ctx.globalAlpha = 1;
}

async function encodeGif(req: VideoRequest): Promise<ArrayBuffer> {
    const {GIFEncoder, quantize, applyPalette} = await import('gifenc');
    const canvas = new OffscreenCanvas(req.width, req.height);
    const ctx = canvas.getContext('2d', {willReadFrequently: true})!;
    ctx.imageSmoothingQuality = 'high';
    const gif = GIFEncoder();
    req.timeline.forEach((frame, i) => {
        draw(ctx, frame, req.frames, req.width, req.height);
        const {data} = ctx.getImageData(0, 0, req.width, req.height);
        // A palette per frame: one shared palette bands the glows and the
        // dimmed nodes badly, since each step dims different things.
        const palette = quantize(data, 256);
        const index = applyPalette(data, palette);
        gif.writeFrame(index, req.width, req.height, {
            palette,
            delay: Math.max(20, Math.round(frame.duration * 1000)),
            repeat: 0,
        });
        post({type: 'progress', done: i + 1, total: req.timeline.length});
    });
    gif.finish();
    const bytes = gif.bytes();
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function encodeMp4(req: VideoRequest): Promise<{ bytes: ArrayBuffer; codec: string }> {
    const {
        BufferTarget,
        CanvasSource,
        Mp4OutputFormat,
        Output,
        QUALITY_HIGH,
        getFirstEncodableVideoCodec,
    } = await import('mediabunny');
    // H.264 first: it plays everywhere, including PowerPoint and Keynote.
    const codec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], {
        width: req.width,
        height: req.height,
    });
    if (!codec) throw new Error("This browser can't encode video (no WebCodecs video encoder).");

    const canvas = new OffscreenCanvas(req.width, req.height);
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    const output = new Output({
        format: new Mp4OutputFormat({fastStart: 'in-memory'}),
        target: new BufferTarget(),
    });
    // Key frames every second keep scrubbing responsive anywhere in a step.
    const source = new CanvasSource(canvas, {codec, quality: QUALITY_HIGH, keyFrameInterval: 1});
    // A constant frame rate (see MP4_FPS): a held step is the same frame
    // repeated, which the encoder stores in almost nothing.
    output.addVideoTrack(source, {frameRate: MP4_FPS});
    await output.start();
    const counts = videoFrameCounts(req.timeline, MP4_FPS);
    const total = counts.reduce((a, b) => a + b, 0);
    let n = 0;
    for (let i = 0; i < req.timeline.length; i++) {
        const frame = req.timeline[i];
        draw(ctx, frame, req.frames, req.width, req.height);
        for (let k = 0; k < counts[i]; k++) {
            // Each step also starts on a key frame, so seeking to a step is
            // instant. Elsewhere the option is left out rather than false: false
            // would override keyFrameInterval and leave a step with only one.
            const startsStep = k === 0 && frame.kind === 'hold';
            await source.add(n / MP4_FPS, 1 / MP4_FPS, startsStep ? {keyFrame: true} : undefined);
            n++;
            if (n % 15 === 0 || n === total) post({type: 'progress', done: n, total});
        }
    }
    await output.finalize();
    const buffer = (output.target as InstanceType<typeof BufferTarget>).buffer;
    if (!buffer) throw new Error('The video encoder produced no output.');
    return {bytes: buffer, codec};
}

scope.onmessage = async (event: MessageEvent<VideoRequest>) => {
    const req = event.data;
    try {
        if (req.kind === 'gif') {
            const bytes = await encodeGif(req);
            post({type: 'done', bytes}, [bytes]);
        } else {
            const {bytes, codec} = await encodeMp4(req);
            post({type: 'done', bytes, codec}, [bytes]);
        }
    } catch (err) {
        post({type: 'error', message: err instanceof Error ? err.message : String(err)});
    } finally {
        for (const bitmap of req.frames) bitmap.close();
    }
};
