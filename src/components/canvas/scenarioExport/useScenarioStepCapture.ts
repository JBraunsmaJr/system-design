import {useCallback, useMemo, useRef, useState} from 'react';
import type {Edge, Node} from '@xyflow/react';
import {getFontEmbedCSS} from 'html-to-image';
import {projectCanvasElements} from '../../../app/canvasProjection';
import {levelKey, populatedLevelCounts} from '../../../collab/stores/diagramStore';
import {captureNodeSubsetSnapshot} from '../../../domain/canvas/imageExport';
import {applyPresentationFocusToEdges, applyPresentationFocusToNodes,} from '../../../domain/canvas/presentationFocus';
import type {ArchEdgeData, ArchNodeData} from '../../../domain/canvas/types';
import type {FrameLayout, ScenarioFramePlan,} from '../../../domain/scenarioExport/scenarioExportPlan';
import type {CaptureLevel, RenderedLevel, SrdCaptureSurfaceProps,} from '../../srd/capture/SrdCaptureSurface';

/** Presentation's camera never zooms past this; neither do exports. */
const MAX_ZOOM = 2;
/** Room around the framed nodes, as a fraction of the frame. */
const FRAME_PADDING = 0.1;
/** A level that never reports rendered is captured anyway rather than
 * stalling the export (the SRD's surface uses the same limit). */
const RENDER_TIMEOUT_MS = 4000;

const NO_IDS: readonly string[] = [];
const EMPTY_MAP = new Map<never, never>();

export class ExportCancelledError extends Error {
    constructor() {
        super('Export cancelled');
        this.name = 'ExportCancelledError';
    }
}

export interface CapturedStep {
    plan: ScenarioFramePlan;
    /** The step's diagram, sized to the layout's diagram rectangle; null when
     * the step has nothing to show (its level was deleted, or is empty). */
    diagram: ImageBitmap | null;
}

interface DiagramSnapshot {
    nodes: Node<ArchNodeData>[];
    edges: Edge<ArchEdgeData>[];
}

let fontEmbedCSS: Promise<string | undefined> | null = null;

function embeddedFonts(root: HTMLElement): Promise<string | undefined> {
    fontEmbedCSS ??= getFontEmbedCSS(root).catch(() => undefined);
    return fontEmbedCSS;
}

/** Decodes a data URL without the network stack: an <img>, not fetch(),
 * so a strict connect-src policy cannot block it. */
async function bitmapFromDataUrl(dataUrl: string): Promise<ImageBitmap> {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    return createImageBitmap(img);
}

/** Lets the page paint and handle input between steps. */
const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Renders each step of a scenario on an offscreen canvas, styled exactly as
 * Presentation Mode shows it, and captures it. The user's own canvas never
 * moves. Mount an SrdCaptureSurface with `surfaceProps` while capturing.
 */
export function useScenarioStepCapture() {
    const [level, setLevel] = useState<CaptureLevel | null>(null);
    const renderedRef = useRef<RenderedLevel | null>(null);
    const waitersRef = useRef(new Map<string, (rendered: RenderedLevel) => void>());

    const onRendered = useCallback((rendered: RenderedLevel) => {
        renderedRef.current = rendered;
        const resolve = waitersRef.current.get(rendered.key);
        waitersRef.current.delete(rendered.key);
        resolve?.(rendered);
    }, []);

    const showLevel = useCallback((next: CaptureLevel): Promise<RenderedLevel | null> => {
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                waitersRef.current.delete(next.key);
                resolve(renderedRef.current?.key === next.key ? renderedRef.current : null);
            }, RENDER_TIMEOUT_MS);
            waitersRef.current.set(next.key, (rendered) => {
                clearTimeout(timer);
                resolve(rendered);
            });
            setLevel(next);
        });
    }, []);

    const captureSteps = useCallback(
        async (
            diagram: DiagramSnapshot,
            plans: readonly ScenarioFramePlan[],
            layout: FrameLayout,
            {
                signal,
                onProgress,
            }: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
        ): Promise<CapturedStep[]> => {
            const levelCounts = populatedLevelCounts(diagram.nodes);
            const results: CapturedStep[] = [];
            try {
                // Text is drawn in web fonts; capturing before they load would put
                // the fallback font in the image.
                await document.fonts?.ready;
                for (const plan of plans) {
                    if (signal?.aborted) throw new ExportCancelledError();
                    onProgress?.(results.length, plans.length);
                    let image: ImageBitmap | null = null;
                    if (plan.levelExists && plan.frameNodeIds.length > 0) {
                        const projected = projectCanvasElements({
                            diagramSnapshot: diagram,
                            subDiagramLevelCounts: levelCounts,
                            path: plan.path,
                            selectedNodeIds: NO_IDS,
                            selectedEdgeIds: NO_IDS,
                            measuredDimensions: EMPTY_MAP,
                            inFlight: EMPTY_MAP,
                            peerInFlight: EMPTY_MAP,
                            edgeInFlight: EMPTY_MAP,
                            peerEdgeInFlight: EMPTY_MAP,
                            peerEdgeLabels: EMPTY_MAP,
                        });
                        const focus = {nodeIds: plan.focusNodeIds, edgeIds: plan.focusEdgeIds};
                        const rendered = await showLevel({
                            // Unique per step: each step's dimming is its own render.
                            key: `${levelKey(plan.path)}#${plan.index}`,
                            nodes: applyPresentationFocusToNodes(projected.nodes, focus),
                            edges: applyPresentationFocusToEdges(projected.edges, focus, {
                                animateEdges: false,
                            }),
                        });
                        if (signal?.aborted) throw new ExportCancelledError();
                        if (rendered) {
                            const dataUrl = await captureNodeSubsetSnapshot(
                                rendered.getNodes(),
                                plan.frameNodeIds,
                                {
                                    root: rendered.root,
                                    width: layout.diagram.width,
                                    height: layout.diagram.height,
                                    padding: FRAME_PADDING,
                                    maxZoom: MAX_ZOOM,
                                    pixelRatio: 1,
                                    format: 'png',
                                    fontEmbedCSS: await embeddedFonts(rendered.root),
                                },
                            );
                            if (dataUrl) image = await bitmapFromDataUrl(dataUrl);
                        }
                    }
                    results.push({plan, diagram: image});
                    await nextTask();
                }
                onProgress?.(plans.length, plans.length);
                return results;
            } catch (err) {
                for (const r of results) r.diagram?.close();
                throw err;
            } finally {
                // Release the offscreen canvas once done.
                setLevel(null);
                renderedRef.current = null;
                waitersRef.current.clear();
            }
        },
        [showLevel],
    );

    const surfaceProps: SrdCaptureSurfaceProps = useMemo(
        () => ({level, onRendered, className: 'scenario-capture-surface'}),
        [level, onRendered],
    );

    return {surfaceProps, captureSteps};
}
