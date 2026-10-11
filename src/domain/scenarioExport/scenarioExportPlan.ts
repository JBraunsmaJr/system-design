import type {Edge, Node} from '@xyflow/react';
import type {Scenario} from '../canvas/types';

/**
 * Pure planning for exporting a scenario as slides, images or a video:
 * what each step shows, how the frame is laid out, how long each step is on
 * screen, and what the files are called. No DOM here, so it is all unit
 * tested in Node (scenarioExportPlan.verify.ts).
 */

export type ScenarioExportFormat = 'pdf' | 'png' | 'gif' | 'mp4';

export interface ScenarioExportOptions {
    format: ScenarioExportFormat;
    /** Draw the header (scenario, level, step count) and the step's title
     * and narration on each image or video frame. PDF slides always have
     * them, as real text. */
    captions: boolean;
    /** PDF only: a first slide with the scenario's title and its steps. */
    titleSlide: boolean;
    /** GIF and MP4: how long each step is on screen. 'auto' reads it from
     * the step's title and narration. */
    secondsPerStep: 'auto' | number;
    /** GIF and MP4: fade from one step to the next instead of cutting. */
    crossfade: boolean;
}

export const DEFAULT_EXPORT_OPTIONS: ScenarioExportOptions = {
    format: 'pdf',
    captions: true,
    titleSlide: true,
    secondsPerStep: 'auto',
    crossfade: true,
};

/** One step, resolved against the current diagram. */
export interface ScenarioFramePlan {
    index: number;
    /** "Step 3", when the step has no title of its own. */
    title: string;
    narration: string;
    path: string[];
    levelLabel: string;
    /** False when the step's sub-diagram no longer exists. */
    levelExists: boolean;
    /** Focus ids that still exist at the step's level. */
    focusNodeIds: string[];
    focusEdgeIds: string[];
    /** The nodes the camera frames: the focused nodes, else the ends of the
     * focused edges, else the whole level (empty when the level is empty). */
    frameNodeIds: string[];
    /** Focus ids that no longer exist - deleted since the step was made. */
    missingCount: number;
}

type FlatData = { parentPath?: string[] } | undefined;

function parentPathOf(el: Node | Edge): string[] {
    return (el.data as FlatData)?.parentPath ?? [];
}

function samePath(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * Resolves every step of a scenario against the diagram (flat,
 * parentPath-tagged nodes and edges, as the document stores hold them).
 */
export function planScenarioFrames(
    scenario: Scenario,
    nodes: readonly Node[],
    edges: readonly Edge[],
    levelLabel: (path: string[]) => string,
): ScenarioFramePlan[] {
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    return scenario.steps.map((step, index) => {
        const path = step.path ?? [];
        // A level exists when every node on the path is where the path says it is.
        const levelExists = path.every((id, i) => {
            const node = nodeById.get(id);
            return node !== undefined && samePath(parentPathOf(node), path.slice(0, i));
        });
        const levelNodes = levelExists ? nodes.filter((n) => samePath(parentPathOf(n), path)) : [];
        const levelEdges = levelExists ? edges.filter((e) => samePath(parentPathOf(e), path)) : [];
        const levelNodeIds = new Set(levelNodes.map((n) => n.id));
        const edgeById = new Map(levelEdges.map((e) => [e.id, e]));

        const focusNodeIds = step.focusNodeIds.filter((id) => levelNodeIds.has(id));
        const focusEdgeIds = step.focusEdgeIds.filter((id) => edgeById.has(id));
        const missingCount =
            step.focusNodeIds.length -
            focusNodeIds.length +
            (step.focusEdgeIds.length - focusEdgeIds.length);

        let frameNodeIds = focusNodeIds;
        if (frameNodeIds.length === 0 && focusEdgeIds.length > 0) {
            const ends = new Set<string>();
            for (const id of focusEdgeIds) {
                const edge = edgeById.get(id)!;
                if (levelNodeIds.has(edge.source)) ends.add(edge.source);
                if (levelNodeIds.has(edge.target)) ends.add(edge.target);
            }
            frameNodeIds = [...ends];
        }
        if (frameNodeIds.length === 0) {
            // Top-level nodes of the level only: a group's children come along
            // with it when the capture frames it.
            frameNodeIds = levelNodes.filter((n) => !n.parentId).map((n) => n.id);
        }

        return {
            index,
            title: step.title?.trim() || `Step ${index + 1}`,
            narration: step.narration?.trim() ?? '',
            path,
            // The breadcrumb of a deleted level would read "Untitled"; say what happened.
            levelLabel: levelExists ? levelLabel(path) : 'Deleted sub-diagram',
            levelExists,
            focusNodeIds,
            focusEdgeIds,
            frameNodeIds,
            missingCount,
        };
    });
}

// ---------------------------------------------------------------------------
// Frame layout
// ---------------------------------------------------------------------------

/** Every export renders at 1080p; GIFs are scaled down from it. */
export const FRAME_WIDTH = 1920;
export const FRAME_HEIGHT = 1080;
export const GIF_WIDTH = 960;
export const GIF_HEIGHT = 540;

export const HEADER_HEIGHT = 72;
export const CAPTION_PADDING_X = 64;
export const CAPTION_PADDING_Y = 32;
export const CAPTION_TITLE_SIZE = 40;
export const CAPTION_TITLE_LINE = 52;
export const CAPTION_GAP = 12;
export const CAPTION_TEXT_SIZE = 28;
export const CAPTION_TEXT_LINE = 40;
/** Narration beyond this is cut with an ellipsis on images and video. */
export const MAX_NARRATION_LINES = 4;

export interface FrameLayout {
    width: number;
    height: number;
    /** 0 when captions are off. */
    headerHeight: number;
    /** The diagram's rectangle. */
    diagram: { x: number; y: number; width: number; height: number };
    /** The caption band below the diagram; height 0 when captions are off. */
    caption: { x: number; y: number; width: number; height: number };
    /** How many narration lines the caption band has room for. */
    narrationLines: number;
}

/**
 * One layout for every frame of an export, sized for the step with the
 * longest narration, so the diagram does not jump between steps in a video.
 * `narrationLinesNeeded` is the most lines any step's narration wraps to.
 */
export function frameLayout(captions: boolean, narrationLinesNeeded: number): FrameLayout {
    if (!captions) {
        return {
            width: FRAME_WIDTH,
            height: FRAME_HEIGHT,
            headerHeight: 0,
            diagram: {x: 0, y: 0, width: FRAME_WIDTH, height: FRAME_HEIGHT},
            caption: {x: 0, y: FRAME_HEIGHT, width: FRAME_WIDTH, height: 0},
            narrationLines: 0,
        };
    }
    const narrationLines = Math.max(0, Math.min(MAX_NARRATION_LINES, narrationLinesNeeded));
    const captionHeight =
        CAPTION_PADDING_Y * 2 +
        CAPTION_TITLE_LINE +
        (narrationLines > 0 ? CAPTION_GAP + narrationLines * CAPTION_TEXT_LINE : 0);
    const diagramHeight = FRAME_HEIGHT - HEADER_HEIGHT - captionHeight;
    return {
        width: FRAME_WIDTH,
        height: FRAME_HEIGHT,
        headerHeight: HEADER_HEIGHT,
        diagram: {x: 0, y: HEADER_HEIGHT, width: FRAME_WIDTH, height: diagramHeight},
        caption: {
            x: 0,
            y: HEADER_HEIGHT + diagramHeight,
            width: FRAME_WIDTH,
            height: captionHeight,
        },
        narrationLines,
    };
}

/**
 * Greedy word wrap. `measure` returns a string's width in the same units as
 * `maxWidth` (a canvas's measureText in the browser, a stub in tests). Hard
 * line breaks in the text are kept. When `maxLines` cuts the text short the
 * last line ends in an ellipsis. A single word wider than the line is broken
 * by characters rather than overflowing.
 */
export function wrapText(
    text: string,
    maxWidth: number,
    measure: (s: string) => number,
    maxLines = Infinity,
): string[] {
    const lines: string[] = [];
    const paragraphs = text.split(/\r?\n/);
    outer: for (const paragraph of paragraphs) {
        const words = paragraph.split(/\s+/).filter(Boolean);
        if (words.length === 0) {
            if (paragraphs.length > 1) lines.push('');
            continue;
        }
        let line = '';
        for (let word of words) {
            // A word too long for any line is split across lines.
            while (measure(word) > maxWidth) {
                let cut = word.length - 1;
                while (cut > 1 && measure(word.slice(0, cut)) > maxWidth) cut--;
                if (line) {
                    lines.push(line);
                    line = '';
                }
                lines.push(word.slice(0, cut));
                word = word.slice(cut);
                if (lines.length > maxLines) break outer;
            }
            const candidate = line ? `${line} ${word}` : word;
            if (measure(candidate) <= maxWidth) {
                line = candidate;
            } else {
                lines.push(line);
                line = word;
            }
            if (lines.length > maxLines) break outer;
        }
        lines.push(line);
        if (lines.length > maxLines) break;
    }
    // Blank lines from consecutive newlines at the end carry nothing.
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    if (lines.length <= maxLines) return lines;

    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last.length > 0 && measure(`${last}…`) > maxWidth) {
        last = last.slice(0, -1).trimEnd();
    }
    kept[maxLines - 1] = `${last}…`;
    return kept;
}

// ---------------------------------------------------------------------------
// Timing (GIF and MP4)
// ---------------------------------------------------------------------------

export const AUTO_MIN_SECONDS = 3;
export const AUTO_MAX_SECONDS = 15;
/** Reading speed for 'auto': roughly 200 words a minute. */
const SECONDS_PER_CHARACTER = 0.06;
export const CROSSFADE_SECONDS = 0.5;
/** Frames drawn across one crossfade: smooth in a video, and fewer in a GIF,
 * where every frame is a full image and adds to the file's size. */
export const CROSSFADE_FRAMES = {mp4: 15, gif: 4} as const;

/**
 * MP4s are written at a constant frame rate, repeating a held step's frame,
 * rather than as one frame lasting several seconds. Both are valid MP4, but
 * many players - Windows' Media Player and Movies & TV, PowerPoint, chat
 * previews - freeze, stutter or seek wrongly on the latter. 15 fade frames
 * over half a second is exactly one fade frame per video frame.
 */
export const MP4_FPS = 30;

/** How long a step stays on screen, in seconds. */
export function stepHoldSeconds(
    step: Pick<ScenarioFramePlan, 'title' | 'narration'>,
    secondsPerStep: ScenarioExportOptions['secondsPerStep'],
): number {
    if (secondsPerStep !== 'auto') return Math.max(0.5, secondsPerStep);
    const characters = step.title.length + step.narration.length;
    const seconds = AUTO_MIN_SECONDS + characters * SECONDS_PER_CHARACTER;
    return Math.round(Math.min(AUTO_MAX_SECONDS, Math.max(AUTO_MIN_SECONDS, seconds)) * 10) / 10;
}

/** A frame of the video: either one step held still, or a fade between two. */
export type TimelineFrame =
    | { kind: 'hold'; step: number; start: number; duration: number }
    | { kind: 'fade'; from: number; to: number; mix: number; start: number; duration: number };

/**
 * The frames of a GIF or video, in seconds. A step is held for its time;
 * with crossfades, the fade into the next step takes the end of the hold,
 * so the total length is the same either way.
 */
export function buildTimeline(
    steps: readonly Pick<ScenarioFramePlan, 'title' | 'narration'>[],
    options: Pick<ScenarioExportOptions, 'secondsPerStep' | 'crossfade'>,
    fadeFrames: number = CROSSFADE_FRAMES.mp4,
): TimelineFrame[] {
    const frames: TimelineFrame[] = [];
    let t = 0;
    steps.forEach((step, i) => {
        const hold = stepHoldSeconds(step, options.secondsPerStep);
        const fades = options.crossfade && i < steps.length - 1;
        const fade = fades ? Math.min(CROSSFADE_SECONDS, hold / 2) : 0;
        frames.push({kind: 'hold', step: i, start: round(t), duration: round(hold - fade)});
        t += hold - fade;
        if (fades) {
            const each = fade / fadeFrames;
            for (let f = 1; f <= fadeFrames; f++) {
                frames.push({
                    kind: 'fade',
                    from: i,
                    to: i + 1,
                    mix: f / (fadeFrames + 1),
                    start: round(t),
                    duration: round(each),
                });
                t += each;
            }
        }
    });
    return frames;
}

/**
 * How many constant-rate video frames each timeline frame covers. Each
 * frame's start and end are rounded to the frame grid, and timeline frames
 * are contiguous, so the counts add up to the video's length with no drift.
 */
export function videoFrameCounts(timeline: readonly TimelineFrame[], fps: number): number[] {
    return timeline.map((f) => {
        const first = Math.round(f.start * fps);
        const end = Math.round((f.start + f.duration) * fps);
        // A frame too short for the grid still shows for one frame.
        return Math.max(1, end - first);
    });
}

function round(seconds: number): number {
    return Math.round(seconds * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// File names
// ---------------------------------------------------------------------------

export function safeFileName(title: string, fallback = 'scenario'): string {
    return (
        title
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '')
            .slice(0, 60)
            .replace(/-$/, '') || fallback
    );
}

/** "03-check-credentials.png", zero-padded so the files sort in order. */
export function stepFileName(step: Pick<ScenarioFramePlan, 'index' | 'title'>, total: number) {
    const digits = Math.max(2, String(total).length);
    const number = String(step.index + 1).padStart(digits, '0');
    return `${number}-${safeFileName(step.title, 'step')}.png`;
}

export function exportFileName(scenarioTitle: string, format: ScenarioExportFormat): string {
    const base = safeFileName(scenarioTitle);
    return format === 'png' ? `${base}-steps.zip` : `${base}.${format}`;
}
