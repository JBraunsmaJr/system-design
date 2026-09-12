import type { Page } from "playwright";
import type { FixtureName } from "../fixtures";
import type { PerfMetrics } from "../instrumentation";

/**
 * Waits for pending animation frames and React state to settle.
 */
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
    // Yield to let mousemove/pointermove process
    await page.evaluate(`new Promise((r) => requestAnimationFrame(r))`);
  }

  await page.mouse.up();
  await settleCanvas(page, 2);
}
