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
      // Before the load, so the load itself never schedules an autosave that
      // could land inside the measurement window.
      if (perfObj && typeof perfObj.suppressAutosave === "function") {
        perfObj.suppressAutosave(true);
      }
      if (perfObj && typeof perfObj.loadFixture === "function") {
        perfObj.loadFixture("${fixtureName}");
      }
    })()
  `);

  await settleCanvas(page, 4);
}

/**
 * Frames `nodeIds` in the viewport, at no more than zoom 1.
 *
 * Call before resetCounters: the viewport change renders, and that render is
 * setup, not the work being measured. Throws if the app did not register the
 * hook, rather than letting a scenario drag at off-screen coordinates - which
 * is what every drag scenario was silently doing.
 */
export async function frameNodes(page: Page, nodeIds: string[]): Promise<void> {
  const framed = await page.evaluate(
    (ids) => (window as unknown as { __PERF__?: { frameNodes?: (ids: string[]) => boolean } }).__PERF__?.frameNodes?.(ids) ?? false,
    nodeIds
  );
  if (!framed) {
    throw new Error("window.__PERF__.frameNodes is unavailable - the canvas has not registered its viewport hook.");
  }
  await settleCanvas(page, 4);
}

/**
 * The centre of the element matching `selector`, verified to be what the
 * browser would actually deliver a pointer event to.
 *
 * `locator.boundingBox()` happily returns coordinates for an element that is
 * off-screen or covered, so a drag aimed at them moves the mouse over nothing
 * and the scenario reports zeros that read as a perfect score. This is the
 * same check `findEmptyCanvasPoint` makes for pans, applied to drag targets.
 */
export async function pointOnTarget(
  page: Page,
  selector: string,
  options: {
    /** Also accept a hit on any element matching this selector - for targets
     * that are interchangeable for what the scenario measures. */
    orAnyOf?: string;
  } = {}
): Promise<{ x: number; y: number }> {
  const result = await page.evaluate(({ sel, orAnyOf }) => {
    const target = document.querySelector(sel);
    if (!target) return { error: `no element matches ${sel}` };
    const r = target.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const hits = (px: number, py: number) => {
      const el = document.elementFromPoint(px, py);
      return el !== null && (el === target || target.contains(el) || (orAnyOf !== undefined && el.matches(orAnyOf)));
    };
    if (hits(x, y)) return { x, y };
    // Something may cover the centre (a hub node's edge labels do). Try a grid
    // of interior points, nearest the centre first, before giving up.
    const candidates: { x: number; y: number }[] = [];
    // Dense along x, since some targets are thin strips (a group's edge hit
    // area) crossed by edge paths at arbitrary points.
    const fxs = Array.from({ length: 19 }, (_, i) => 0.5 + (i % 2 === 0 ? 1 : -1) * Math.ceil(i / 2) * 0.05);
    for (const fx of fxs) {
      for (const fy of [0.5, 0.3, 0.7, 0.15, 0.85]) {
        candidates.push({ x: r.left + r.width * fx, y: r.top + r.height * fy });
      }
    }
    const found = candidates.find((c) => hits(c.x, c.y));
    if (found) return found;
    const hit = document.elementFromPoint(x, y);
    const describe = (el: Element | null) =>
      el ? `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : ""}` : "nothing (off-screen)";
    return {
      error:
        `${sel} is not under the pointer at its centre (${Math.round(x)},${Math.round(y)}); ` +
        `the browser would deliver the event to ${describe(hit)}. Frame it with frameNodes first.`,
    };
  }, { sel: selector, orAnyOf: options.orAnyOf });
  if ("error" in result) throw new Error(result.error);
  return result;
}

/**
 * Fails when a drag that should have committed wrote nothing.
 *
 * Since gestures became ephemeral (WS4-R1/R2), a completed drag writes to the
 * document exactly once, at the end. Zero writes therefore means the gesture
 * never happened, and the scenario's other counters describe an idle page.
 */
export async function assertGestureCommitted(page: Page, what: string): Promise<void> {
  const writes = await page.evaluate(
    () => (window as unknown as { __PERF__: { getCounters: () => { storeWrites: number } } }).__PERF__.getCounters().storeWrites
  );
  if (writes === 0) {
    throw new Error(`${what} wrote nothing to the document, so the gesture never took effect and this run measured nothing.`);
  }
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

/**
 * A point where some edge's endpoint updater is genuinely the topmost element,
 * searching updaters in DOM order (stable for a given fixture and viewport).
 *
 * React Flow renders an updater for every edge and does not raise the selected
 * edge, so in a dense diagram a particular edge's endpoint is usually covered
 * by another edge's updater, interaction path or label. Any updater exercises
 * the same reconnection path, which is what the scenario protects.
 */
export async function findGrabbableUpdater(page: Page): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(() => {
    const pane = document.querySelector(".react-flow__pane")?.getBoundingClientRect();
    if (!pane) return null;
    for (const el of Array.from(document.querySelectorAll(".react-flow__edgeupdater"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.left < pane.left + 20 || r.right > pane.right - 20 || r.top < pane.top + 20 || r.bottom > pane.bottom - 20) continue;
      for (const fx of [0.5, 0.25, 0.75]) {
        for (const fy of [0.5, 0.25, 0.75]) {
          const x = r.left + r.width * fx;
          const y = r.top + r.height * fy;
          const hit = document.elementFromPoint(x, y);
          if (hit && hit.classList.contains("react-flow__edgeupdater")) return { x, y };
        }
      }
    }
    return null;
  });
  if (!point) throw new Error("No edge endpoint updater is grabbable anywhere in the framed viewport.");
  return point;
}
