import type { Page } from "playwright";
import type { FixtureName } from "../fixtures";
import type { PerfMetrics } from "../instrumentation";

/**
 * Waits for pending animation frames and React state to settle.
 */
/**
 * Fails loudly when the viewport did not move as far as a pan scenario asked
 * it to.
 *
 * Without this the shortfall is invisible: fewer steps means fewer renders,
 * which reads as an IMPROVEMENT in the gate output rather than as a scenario
 * that failed to do its job. `pan` reported a 20% render reduction for exactly
 * that reason while no relevant code had changed.
 */
export async function assertViewportTranslated(
  page: Page,
  expectedDx: number,
  expectedDy: number,
  tolerancePx: number = 8
): Promise<void> {
  const moved = await page.evaluate(() => {
    const viewport = document.querySelector(".react-flow__viewport");
    const transform = viewport ? getComputedStyle(viewport).transform : "none";
    if (!transform || transform === "none") return null;
    const match = /matrix\(([^)]+)\)/.exec(transform);
    if (!match) return null;
    const parts = match[1].split(",").map((n) => Number.parseFloat(n.trim()));
    return parts.length >= 6 ? { x: parts[4], y: parts[5] } : null;
  });

  if (!moved) {
    throw new Error("Could not read the viewport transform to verify the pan.");
  }

  const actualDx = moved.x - viewportBeforeDrag.x;
  const actualDy = moved.y - viewportBeforeDrag.y;
  if (
    Math.abs(actualDx - expectedDx) > tolerancePx ||
    Math.abs(actualDy - expectedDy) > tolerancePx
  ) {
    const movedNotAtAll = actualDx === 0 && actualDy === 0;
    throw new Error(
      `Pan delivered ${actualDx.toFixed(0)},${actualDy.toFixed(0)}px but the ` +
        `scenario asked for ${expectedDx},${expectedDy}px. ` +
        (movedNotAtAll
          ? `The viewport did not move at all, so the drag never reached the ` +
            `canvas - it most likely landed on a node or on UI floating above ` +
            `the canvas. This is not an input-timing problem.`
          : `Input steps were dropped, so this run measured less work than the ` +
            `scenario describes and its numbers are not comparable to the baseline.`)
    );
  }
}

/**
 * A point where the canvas pane is genuinely the topmost element.
 *
 * Two separate ways a pan can fail to pan, both silent:
 *   - the drag starts on a node, so it drags the node instead;
 *   - the drag starts on a panel floating above the canvas (palette,
 *     toolbar, inspector), so the canvas never sees the event at all.
 *
 * Checking node rectangles only catches the first. `elementFromPoint` asks the
 * browser what would actually receive the click, which catches both and stays
 * correct as the chrome moves around.
 *
 * Scans outward from the centre, since the middle of the canvas is the least
 * likely place for overlays.
 */
export async function findEmptyCanvasPoint(
  page: Page
): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(() => {
    const pane = document.querySelector(".react-flow__pane");
    if (!pane) return null;
    const bounds = pane.getBoundingClientRect();
    const centreX = bounds.left + bounds.width / 2;
    const centreY = bounds.top + bounds.height / 2;

    const hitsPane = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y);
      return el !== null && (el === pane || el.classList.contains("react-flow__pane"));
    };

    if (hitsPane(centreX, centreY)) {
      return { x: Math.round(centreX), y: Math.round(centreY) };
    }

    // Square rings outward from the centre.
    for (let radius = 20; radius < Math.max(bounds.width, bounds.height) / 2; radius += 20) {
      for (const [dx, dy] of [
        [radius, 0], [-radius, 0], [0, radius], [0, -radius],
        [radius, radius], [-radius, radius], [radius, -radius], [-radius, -radius],
      ]) {
        const x = centreX + dx;
        const y = centreY + dy;
        if (
          x > bounds.left + 4 && x < bounds.right - 4 &&
          y > bounds.top + 4 && y < bounds.bottom - 4 &&
          hitsPane(x, y)
        ) {
          return { x: Math.round(x), y: Math.round(y) };
        }
      }
    }
    return null;
  });

  if (!point) {
    throw new Error(
      "No point found where the canvas pane is the topmost element. Every " +
        "sampled position is covered by a node or by floating UI, so a drag " +
        "cannot reach the canvas to pan it."
    );
  }
  return point;
}

/** Viewport translation recorded at the last mouse.down(), so a pan can be
 * verified relative to where it started rather than to the origin. */
let viewportBeforeDrag = { x: 0, y: 0 };

export async function recordViewportBeforeDrag(page: Page): Promise<void> {
  viewportBeforeDrag = (await page.evaluate(() => {
    const viewport = document.querySelector(".react-flow__viewport");
    const transform = viewport ? getComputedStyle(viewport).transform : "none";
    const match = /matrix\(([^)]+)\)/.exec(transform ?? "");
    if (!match) return { x: 0, y: 0 };
    const parts = match[1].split(",").map((n) => Number.parseFloat(n.trim()));
    return parts.length >= 6 ? { x: parts[4], y: parts[5] } : { x: 0, y: 0 };
  })) ?? { x: 0, y: 0 };
}

/**
 * Waits until the viewport transform has stopped changing.
 *
 * `settleCanvas(n)` waits a FIXED number of frames, which is only equivalent to
 * "settled" if the machine renders at a predictable rate. It does not: the same
 * scenario produces one set of counts on a fast desktop and another in a
 * container, deterministically in each, because the camera-fit animation has
 * progressed a different distance by the time counting starts. That makes the
 * baseline environment-specific for no good reason.
 *
 * Waiting on the transform itself removes the machine from the measurement.
 */
export async function settleViewport(
  page: Page,
  options: { stableFrames?: number; timeoutMs?: number } = {}
): Promise<void> {
  const stableFrames = options.stableFrames ?? 3;
  const timeoutMs = options.timeoutMs ?? 2000;

  await page.evaluate(
    ({ stableFrames, timeoutMs }) =>
      new Promise<void>((resolve) => {
        const read = () => {
          const viewport = document.querySelector(".react-flow__viewport");
          return viewport ? getComputedStyle(viewport).transform : "none";
        };
        let previous = read();
        let unchanged = 0;
        const deadline = performance.now() + timeoutMs;

        const step = () => {
          const current = read();
          unchanged = current === previous ? unchanged + 1 : 0;
          previous = current;
          // Resolving on timeout rather than rejecting: a scenario whose
          // viewport genuinely never settles should still produce a
          // measurement, and the counters will show it.
          if (unchanged >= stableFrames || performance.now() > deadline) {
            resolve();
            return;
          }
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    { stableFrames, timeoutMs }
  );
}

export async function settleCanvas(page: Page, framesToWait: number = 3): Promise<void> {
  await page.evaluate(`
    new Promise((resolve) => {
      let current = 0;
      const step = () => {
        current++;
        if (current >= ${framesToWait}) {
          resolve();
        } else {
          requestAnimationFrame(step);
        }
      };
      requestAnimationFrame(step);
    })
  `);
}

/**
 * Injects a named fixture into application state and settles the canvas.
 */
export async function setupFixture(page: Page, fixtureName: FixtureName): Promise<void> {
  await page.evaluate(`
    (() => {
      const perfObj = window.__PERF__;
      if (perfObj && typeof perfObj.loadFixture === "function") {
        perfObj.loadFixture("${fixtureName}");
      }
    })()
  `);

  await settleCanvas(page, 4);
}

/**
 * Resets all render and mutation counters.
 */
export async function resetCounters(page: Page): Promise<void> {
  await page.evaluate(`
    (() => {
      const perfObj = window.__PERF__;
      if (perfObj && typeof perfObj.reset === "function") {
        perfObj.reset();
      }
    })()
  `);
}

/**
 * Reads telemetry counters and commit metrics from window.__PERF__.
 */
export async function readMetrics(page: Page): Promise<PerfMetrics> {
  return await page.evaluate(`
    (() => {
      const perfObj = window.__PERF__;
      if (perfObj && typeof perfObj.getMetrics === "function") {
        return perfObj.getMetrics();
      }
      return {
        commits: 0,
        nodeRenders: 0,
        edgeRenders: 0,
        canvasRenders: 0,
        storeWrites: 0,
        snapshotBuilds: 0,
        unflattenCalls: 0,
        actualDurationMs: 0,
        longestCommitMs: 0,
        commitDurations: [],
      };
    })()
  `);
}

/**
 * Performs a deterministic multi-step mouse drag gesture.
 */
export async function dragCoordinates(
  page: Page,
  startX: number,
  startY: number,
  dx: number,
  dy: number,
  steps: number = 20
): Promise<void> {
  await page.mouse.move(startX, startY);
  await page.mouse.down();

  for (let i = 1; i <= steps; i++) {
    const currentX = startX + (dx * i) / steps;
    const currentY = startY + (dy * i) / steps;
    await page.mouse.move(currentX, currentY);
    /**
     * Two frames, not one.
     *
     * A single requestAnimationFrame only guarantees the callback ran - the
     * move may not have been dispatched and committed yet. Under load the
     * browser then coalesces the next move with this one, so a 50-step drag
     * delivers nearer 40 and the scenario silently measures less work than it
     * claims to. That produced a gate that reported two different stable
     * answers for identical code depending on how busy the machine was, which
     * is worse than a slow gate: people learn to re-run it until it is green.
     *
     * The second frame is the cheapest way to guarantee the first has been
     * painted before the next input is queued.
     */
    await page.evaluate(
      `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`
    );
  }

  await page.mouse.up();
  await settleCanvas(page, 2);
}
