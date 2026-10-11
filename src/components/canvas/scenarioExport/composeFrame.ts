import {
    CAPTION_GAP,
    CAPTION_PADDING_X,
    CAPTION_PADDING_Y,
    CAPTION_TEXT_LINE,
    CAPTION_TEXT_SIZE,
    CAPTION_TITLE_LINE,
    CAPTION_TITLE_SIZE,
    FRAME_HEIGHT,
    FRAME_WIDTH,
    type FrameLayout,
    frameLayout,
    type ScenarioFramePlan,
    wrapText,
} from '../../../domain/scenarioExport/scenarioExportPlan';
import type {CapturedStep} from './useScenarioStepCapture';

/** The app's own colors, read from its CSS tokens so exports match the
 * editor; the literals are only fallbacks. */
export interface ExportTheme {
    background: string;
    chrome: string;
    border: string;
    text: string;
    textDim: string;
    accent: string;
    font: string;
}

export function readExportTheme(): ExportTheme {
    const css = getComputedStyle(document.documentElement);
    const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    return {
        background: v('--canvas-bg', '#0f1117'),
        chrome: v('--chrome-bg', '#14161c'),
        border: v('--chrome-border', '#2a2e3a'),
        text: v('--chrome-text', '#e7e9ee'),
        textDim: v('--chrome-text-dim', '#8b90a0'),
        accent: v('--accent', '#5b7cfa'),
        font: 'Inter, system-ui, sans-serif',
    };
}

/** Waits for the caption fonts, so the first frame is not drawn in a
 * fallback font. They are bundled with the app (@fontsource): nothing is
 * fetched from outside it. */
export async function loadCaptionFonts(theme: ExportTheme): Promise<void> {
    await Promise.all([
        document.fonts?.load(`600 ${CAPTION_TITLE_SIZE}px ${theme.font}`),
        document.fonts?.load(`400 ${CAPTION_TEXT_SIZE}px ${theme.font}`),
        document.fonts?.load(`500 24px ${theme.font}`),
    ]);
}

type Ctx = CanvasRenderingContext2D;

function measurer(ctx: Ctx, font: string) {
    return (s: string) => {
        ctx.font = font;
        return ctx.measureText(s).width;
    };
}

const narrationFont = (theme: ExportTheme) => `400 ${CAPTION_TEXT_SIZE}px ${theme.font}`;
const titleFont = (theme: ExportTheme) => `600 ${CAPTION_TITLE_SIZE}px ${theme.font}`;

/** The layout for a set of steps: the caption band is as tall as the
 * longest narration needs, up to the limit. */
export function layoutFor(
    ctx: Ctx,
    plans: readonly ScenarioFramePlan[],
    captions: boolean,
    theme: ExportTheme,
): FrameLayout {
    if (!captions) return frameLayout(false, 0);
    const width = FRAME_WIDTH - CAPTION_PADDING_X * 2;
    const measure = measurer(ctx, narrationFont(theme));
    const lines = Math.max(
        0,
        ...plans.map((p) => (p.narration ? wrapText(p.narration, width, measure).length : 0)),
    );
    return frameLayout(true, lines);
}

/** Truncates one line of text to fit, with an ellipsis. */
function fit(ctx: Ctx, text: string, maxWidth: number): string {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let s = text;
    while (s.length > 0 && ctx.measureText(`${s}…`).width > maxWidth) s = s.slice(0, -1);
    return `${s.trimEnd()}…`;
}

/**
 * Draws a step's diagram into a rectangle, or a note saying why there is
 * none. Used for whole frames and, on its own, for the PDF's slide images.
 */
export function drawDiagram(
    ctx: Ctx,
    rect: { x: number; y: number; width: number; height: number },
    {plan, diagram}: CapturedStep,
    theme: ExportTheme,
): void {
    ctx.save();
    ctx.fillStyle = theme.background;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    if (diagram) {
        ctx.drawImage(diagram, rect.x, rect.y, rect.width, rect.height);
    } else {
        ctx.fillStyle = theme.textDim;
        ctx.font = `500 28px ${theme.font}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
            plan.levelExists ? 'Nothing to show at this level' : "This step's diagram no longer exists",
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
        );
    }
    ctx.restore();
}

/**
 * Draws one complete frame - header, diagram, caption - onto a 1920x1080
 * canvas. The diagram fills its rectangle edge to edge: it was captured at
 * exactly that size.
 */
export function drawFrame(
    ctx: Ctx,
    layout: FrameLayout,
    step: CapturedStep,
    context: { scenarioTitle: string; total: number },
    theme: ExportTheme,
): void {
    const {plan} = step;
    ctx.save();
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);

    drawDiagram(ctx, layout.diagram, step, theme);

    if (layout.headerHeight > 0) {
        const h = layout.headerHeight;
        ctx.fillStyle = theme.chrome;
        ctx.fillRect(0, 0, FRAME_WIDTH, h);
        ctx.fillStyle = theme.border;
        ctx.fillRect(0, h - 1, FRAME_WIDTH, 1);
        ctx.textBaseline = 'middle';

        const progress = `Step ${plan.index + 1} of ${context.total}`;
        ctx.font = `500 24px ${theme.font}`;
        const progressWidth = ctx.measureText(progress).width;
        ctx.fillStyle = theme.textDim;
        ctx.textAlign = 'right';
        ctx.fillText(progress, FRAME_WIDTH - CAPTION_PADDING_X, h / 2);
        ctx.textAlign = 'left';

        // Scenario title, then the level in the dimmer color, sharing what is
        // left of the bar.
        const available = FRAME_WIDTH - CAPTION_PADDING_X * 2 - progressWidth - 48;
        ctx.font = `600 26px ${theme.font}`;
        ctx.fillStyle = theme.text;
        const title = fit(ctx, context.scenarioTitle || 'Scenario', available * 0.6);
        ctx.fillText(title, CAPTION_PADDING_X, h / 2);
        const titleWidth = ctx.measureText(title).width;
        ctx.font = `500 22px ${theme.font}`;
        ctx.fillStyle = theme.textDim;
        ctx.fillText(
            fit(ctx, plan.levelLabel, available - titleWidth - 32),
            CAPTION_PADDING_X + titleWidth + 32,
            h / 2,
        );
    }

    const c = layout.caption;
    if (c.height > 0) {
        ctx.fillStyle = theme.chrome;
        ctx.fillRect(c.x, c.y, c.width, c.height);
        ctx.fillStyle = theme.border;
        ctx.fillRect(c.x, c.y, c.width, 1);
        // An accent rule ties the caption to the highlighted step.
        ctx.fillStyle = theme.accent;
        ctx.fillRect(c.x, c.y, 8, c.height);

        const textWidth = c.width - CAPTION_PADDING_X * 2;
        let y = c.y + CAPTION_PADDING_Y;
        ctx.textBaseline = 'top';
        ctx.font = titleFont(theme);
        ctx.fillStyle = theme.text;
        ctx.fillText(fit(ctx, plan.title, textWidth), CAPTION_PADDING_X, y + 4);
        y += CAPTION_TITLE_LINE;

        if (plan.narration && layout.narrationLines > 0) {
            y += CAPTION_GAP;
            const lines = wrapText(
                plan.narration,
                textWidth,
                measurer(ctx, narrationFont(theme)),
                layout.narrationLines,
            );
            ctx.font = narrationFont(theme);
            ctx.fillStyle = theme.textDim;
            for (const line of lines) {
                ctx.fillText(line, CAPTION_PADDING_X, y + 4);
                y += CAPTION_TEXT_LINE;
            }
        }
    }
    ctx.restore();
}
