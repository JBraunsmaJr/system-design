/**
 * The unified document model, in a real browser.
 *
 * Automates the checks the migration plan marks as "wants a running app",
 * because their failure is silent - nothing throws, the canvas just does the
 * wrong thing:
 *
 *  - opening a .json replaces the diagram, at every nesting level (patch 23,
 *    WS1 Step 5);
 *  - starting a session leaves the canvas unchanged (WS1-R4);
 *  - joining keeps local content as a separate document (WS1-R5);
 *  - title syncs between peers (WS1-R7);
 *  - a drag takes exactly one undo (WS3-R3), undo works in a session and
 *    reverts only the local user's edit (WS3-R2), and document boundaries
 *    clear history (WS3-R4);
 *  - New clears the canvas.
 */
import { chromium, type Browser, type Page } from "playwright";
import { readFileSync } from "fs";
import { join, resolve } from "path";
import { startDevServers, type DevServers } from "./lib/devServers";

const FIXTURE = resolve(join("fixtures", "schema-0.7.json"));
const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
  title: string;
  nodes: { id: string; data: { subDiagram?: { nodes: unknown[] } } }[];
};
const NESTED = fixture.nodes.find((n) => (n.data.subDiagram?.nodes.length ?? 0) > 0)!;
const DRAGGED = "n-gateway";

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

const nodeCount = (p: Page) => p.$$eval(".react-flow__node", (els) => els.length);
const transformOf = (p: Page, id: string) =>
  p.$eval(`.react-flow__node[data-id="${id}"]`, (el) => (el as HTMLElement).style.transform);
const undoDisabled = (p: Page) => p.$eval('button[aria-label="Undo"]', (el) => (el as HTMLButtonElement).disabled);
const titleOf = (p: Page) => p.inputValue('[aria-label="Diagram title"]');
const storeWrites = (p: Page) =>
  p.evaluate<number>(`window.__PERF__.getCounters().storeWrites`);

async function open(p: Page, url: string) {
  await p.goto(url);
  await p.waitForSelector(".collab-panel__trigger");
  await p.waitForFunction("typeof window.__PERF__?.loadFixture === 'function'", null, { timeout: 15000 });
}

async function drag(p: Page, id: string, dx: number, steps = 10) {
  const box = await p.locator(`.react-flow__node[data-id="${id}"]`).boundingBox();
  if (!box) throw new Error(`node ${id} not on screen`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await p.mouse.move(x, y);
  await p.mouse.down();
  for (let i = 1; i <= steps; i++) await p.mouse.move(x + (dx * i) / steps, y);
  await p.mouse.up();
  await sleep(150);
}

async function run() {
  let servers: DevServers | undefined;
  let browser: Browser | undefined;
  try {
    servers = await startDevServers({ vitePort: 5181, signalingPort: 14448, quiet: true });
    browser = await chromium.launch({ headless: true });
    const perms = { permissions: ["clipboard-read", "clipboard-write"] };
    const a = await (await browser.newContext(perms)).newPage();
    const b = await (await browser.newContext(perms)).newPage();
    for (const [name, p] of [["A", a], ["B", b]] as const) {
      p.on("pageerror", (e) => {
        failures++;
        console.error(`  FAIL: page ${name} threw: ${e.message}\n${(e.stack ?? "").split("\n").slice(0, 8).join("\n")}`);
      });
    }

    console.log("=== Opening a file replaces the diagram at every level ===");
    await open(a, servers.appUrl);
    await a.setInputFiles('input[type="file"][accept="application/json"]', FIXTURE);
    await sleep(300);
    check((await nodeCount(a)) === fixture.nodes.length, `root level shows the file's ${fixture.nodes.length} nodes`);
    check((await titleOf(a)) === fixture.title, "title comes from the file");
    check(await undoDisabled(a), "undo is disabled right after opening a file (WS3-R4)");
    await a.evaluate(`window.__PERF__.setPath(${JSON.stringify([NESTED.id])})`);
    // Waits for the level to render rather than a fixed delay, which was too
    // short when the whole suite loads the machine.
    await a
      .waitForFunction((n) => document.querySelectorAll(".react-flow__node").length === n, NESTED.data.subDiagram!.nodes.length, { timeout: 5000 })
      .catch(() => {});
    check(
      (await nodeCount(a)) === NESTED.data.subDiagram!.nodes.length,
      `drilling into ${NESTED.id} shows its ${NESTED.data.subDiagram!.nodes.length} nested nodes`
    );
    await a.evaluate(`window.__PERF__.setPath([])`);
    await a
      .waitForFunction((n) => document.querySelectorAll(".react-flow__node").length === n, fixture.nodes.length, { timeout: 5000 })
      .catch(() => {});

    console.log("\n=== A drag takes exactly one undo (WS3-R3), and one write (WS4-R2) ===");
    const home = await transformOf(a, DRAGGED);
    await a.evaluate(`window.__PERF__.reset()`);
    await drag(a, DRAGGED, 120);
    check((await storeWrites(a)) === 1, `a ten-frame drag of one node writes the document once (wrote ${await storeWrites(a)})`);
    const moved = await transformOf(a, DRAGGED);
    check(moved !== home, `the drag moved the node (${home} -> ${moved})`);
    check(!(await undoDisabled(a)), "undo becomes available");
    await a.keyboard.press("Control+z");
    await sleep(150);
    check((await transformOf(a, DRAGGED)) === home, "one Ctrl+Z puts it back");
    check(await undoDisabled(a), "and nothing is left to undo");

    console.log("\n=== A long multi-node drag barely grows the document (WS4-R1) ===");
    const rootIds = fixture.nodes.map((n) => n.id);
    await a.evaluate(`window.__PERF__.setSelectedNodes(${JSON.stringify(rootIds)})`);
    await sleep(200);
    const bytesBefore = await a.evaluate<number>(`window.__PERF__.docBytes()`);
    await a.evaluate(`window.__PERF__.reset()`);
    await drag(a, DRAGGED, 160, 150);
    const grew = (await a.evaluate<number>(`window.__PERF__.docBytes()`)) - bytesBefore;
    const multiWrites = await storeWrites(a);
    check(multiWrites >= 2 && multiWrites <= rootIds.length, `a 150-frame drag of the selection writes once per moved node (${multiWrites} writes)`);
    check(grew <= 1024, `and adds ${grew} bytes to the document (limit 1024)`);
    await a.keyboard.press("Control+z");
    await sleep(200);
    check((await transformOf(a, DRAGGED)) === home, "one undo reverts the whole multi-node drag");
    await a.evaluate(`window.__PERF__.setSelectedNodes([])`);
    await sleep(100);

    console.log("\n=== Dragging a node out of its group: one write, no jump ===");
    {
      // group-1 sits 900 flow px from the origin, so a reparent computed
      // against the wrong parent is visibly off; around group-0 (at the
      // origin) the same bug would be invisible.
      // A fresh page: the reparent at drag stop is folded into the gesture's
      // commit, and getting that order wrong makes the node jump by its old
      // parent's offset the moment it is released.
      const c = await (await browser.newContext({ ...perms, viewport: { width: 1600, height: 1000 } })).newPage();
      await open(c, servers.appUrl);
      await c.evaluate(`window.__PERF__.loadFixture("grouped")`);
      await sleep(300);
      await c.evaluate(`window.__PERF__.frameNodes(["group-1"])`);
      await sleep(300);
      // Room around the group to drop into, away from the auto-pan margin.
      for (let i = 0; i < 3; i++) {
        await c.click(".react-flow__controls-zoomout");
        await sleep(150);
      }
      await sleep(300);
      const nodeBox = () => c.locator('.react-flow__node[data-id="node-21"]').boundingBox();
      const groupBoxOf = () => c.locator('.react-flow__node[data-id="group-1"]').boundingBox();
      const viewport = () => c.$eval(".react-flow__viewport", (e) => (e as HTMLElement).style.transform);
      const box = await nodeBox();
      const groupBox = await groupBoxOf();
      if (!box || !groupBox) throw new Error("grouped fixture not on screen");
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      // Straight down, clear of the group's bottom edge but well inside the
      // pane: near a pane edge React Flow auto-pans, which moves everything on
      // screen and makes any screen-space comparison meaningless.
      const pane = await c.$eval(".react-flow__pane", (e) => {
        const r = e.getBoundingClientRect();
        return { right: r.right, bottom: r.bottom };
      });
      const down = { dx: 0, dy: groupBox.y + groupBox.height - box.y + 30 };
      const right = { dx: groupBox.x + groupBox.width - box.x + 30, dy: 0 };
      const margin = (m: { dx: number; dy: number }) =>
        Math.min(pane.right - (box.x + box.width + m.dx), pane.bottom - (box.y + box.height + m.dy));
      const move = margin(down) >= margin(right) ? down : right;
      if (margin(move) < 80) {
        throw new Error(`no drop point clear of the pane edge (best margin ${Math.round(margin(move))}px) - it would auto-pan`);
      }
      const { dx, dy } = move;
      const viewportBefore = await viewport();
      await c.evaluate(`window.__PERF__.reset()`);
      await c.mouse.move(x, y);
      await c.mouse.down();
      for (let i = 1; i <= 15; i++) await c.mouse.move(x + (dx * i) / 15, y + (dy * i) / 15);
      // Where the node is drawn while still held. Compared with where it ends
      // up, not with the pointer: React Flow starts a drag on the first move
      // and does not apply that first step, so the node trails the pointer by
      // one step whatever this app does.
      await sleep(150);
      const held = await nodeBox();
      await c.mouse.up();
      await sleep(300);
      check((await viewport()) === viewportBefore, "the viewport did not auto-pan (so screen positions are comparable)");
      const after = await nodeBox();
      // Tolerance covers the alignment snap (ALIGNMENT_THRESHOLD flow px,
      // smaller on screen at this zoom); a reparent computed from the wrong
      // geometry is off by the old parent's offset, far more than this.
      const shift = held && after ? Math.hypot(after.x - held.x, after.y - held.y) : NaN;
      check(shift < 6, `node-21 stays where it was dropped (moved ${shift.toFixed(1)}px on release)`);
      check(
        !!after && (after.y > groupBox.y + groupBox.height || after.x > groupBox.x + groupBox.width),
        "and is outside the group"
      );
      check((await storeWrites(c)) === 1, `leaving the group is one write (wrote ${await storeWrites(c)})`);
      await c.keyboard.press("Control+z");
      await sleep(300);
      const back = await nodeBox();
      const groupNow = await groupBoxOf();
      check(
        !!back && !!groupNow && Math.abs(back.x - groupNow.x - (box.x - groupBox.x)) < 2 && Math.abs(back.y - groupNow.y - (box.y - groupBox.y)) < 2,
        "one undo puts it back at its original place inside the group"
      );
      await c.close();
    }

    console.log("\n=== Title edits are undoable ===");
    await a.fill('[aria-label="Diagram title"]', "Renamed locally");
    await sleep(100);
    await a.click('button[aria-label="Undo"]');
    await sleep(150);
    check((await titleOf(a)) === fixture.title, "Undo reverts the rename");

    console.log("\n=== Dragging an edge end reconnects it ===");
    // Regression: onReconnectStart's handleType is the ANCHORED end, and
    // reading it as the dragged end made every reconnection a silent no-op.
    const edgeLabel = (id: string) => a.getAttribute(`.react-flow__edge[data-id="${id}"]`, "aria-label");
    const originalLabel = await edgeLabel("e1");
    await a.evaluate(`window.__PERF__.setSelectedEdges(["e1"])`);
    await sleep(200);
    const grab = await a.evaluate(() => {
      const el = document.querySelector('.react-flow__edge[data-id="e1"] .react-flow__edgeupdater-target');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      for (const fx of [0.5, 0.3, 0.7]) for (const fy of [0.5, 0.3, 0.7]) {
        const x = r.left + r.width * fx, y = r.top + r.height * fy;
        if (document.elementFromPoint(x, y) === el) return { x, y };
      }
      return null;
    });
    // Just inside n-db from one of its handles: within React Flow's connection
    // radius, but over the node body rather than on top of the stacked handles.
    const drop = await a.evaluate(() => {
      const node = document.querySelector('.react-flow__node[data-id="n-db"]');
      const handle = node?.querySelector(".react-flow__handle");
      if (!node || !handle) return null;
      const n = node.getBoundingClientRect();
      const h = handle.getBoundingClientRect();
      const hx = h.left + h.width / 2, hy = h.top + h.height / 2;
      const cx = n.left + n.width / 2, cy = n.top + n.height / 2;
      const d = Math.hypot(cx - hx, cy - hy) || 1;
      return { x: hx + ((cx - hx) / d) * 8, y: hy + ((cy - hy) / d) * 8 };
    });
    if (!grab) {
      console.error("    e1 updater:", await a.evaluate(() => {
        const el = document.querySelector('.react-flow__edge[data-id="e1"] .react-flow__edgeupdater-target');
        if (!el) return "not rendered: " + Array.from(document.querySelectorAll('.react-flow__edge[data-id="e1"] *')).map((e) => (e as SVGElement).className?.baseVal ?? e.tagName).join(",");
        const r = el.getBoundingClientRect();
        const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) as HTMLElement | null;
        return `covered by ${h?.tagName}.${(h as unknown as SVGElement)?.className?.baseVal ?? h?.className} in node ${h?.closest(".react-flow__node")?.getAttribute("data-id") ?? "-"}`;
      }));
    }
    check(grab !== null && drop !== null, "e1's target end and n-db are both reachable");
    if (grab && drop) {
      await a.mouse.move(grab.x, grab.y);
      await a.mouse.down();
      for (let i = 1; i <= 10; i++) await a.mouse.move(grab.x + ((drop.x - grab.x) * i) / 10, grab.y + ((drop.y - grab.y) * i) / 10);
      await a.mouse.up();
      await sleep(200);
      check((await edgeLabel("e1")) === "Edge from n-gateway to n-db", `e1 now ends at n-db (was: ${originalLabel})`);
      await a.click(".react-flow__pane", { position: { x: 5, y: 5 } });
      await a.keyboard.press("Control+z");
      await sleep(200);
      check((await edgeLabel("e1")) === originalLabel, "one undo reverts the reconnection");
    }

    console.log("\n=== Bends: one write per gesture, one undo each (WS4-R1/R2 for edges) ===");
    {
      const bendCount = () => a.locator('.react-flow__edge[data-id="e2"] .typed-edge__waypoint, .typed-edge__waypoint').count();
      await a.evaluate(`window.__PERF__.setSelectedEdges(["e2"])`);
      await sleep(250);
      const before = await bendCount();
      const dot = await a.locator(".typed-edge__insert-dot").first().boundingBox();
      if (!dot) throw new Error("no insertion handle on the selected edge");
      await a.evaluate(`window.__PERF__.reset()`);
      const dx = dot.x + dot.width / 2;
      const dy = dot.y + dot.height / 2;
      await a.mouse.move(dx, dy);
      await a.mouse.down();
      for (let i = 1; i <= 12; i++) await a.mouse.move(dx + i * 3, dy + i * 6);
      check((await storeWrites(a)) === 0, "dragging a new bend out writes nothing while held");
      await a.mouse.up();
      await sleep(250);
      check((await bendCount()) === before + 1, "the bend exists after release");
      check((await storeWrites(a)) === 1, `creating it is one write (wrote ${await storeWrites(a)})`);
      await sleep(700); // a separate undo step from the next gesture

      const bend = await a.locator(".typed-edge__waypoint").first().boundingBox();
      if (!bend) throw new Error("bend handle not found");
      const bx = bend.x + bend.width / 2;
      const by = bend.y + bend.height / 2;
      const edgePath = () => a.getAttribute('.react-flow__edge[data-id="e2"] path.react-flow__edge-path', "d");
      const createdPath = await edgePath();
      await a.evaluate(`window.__PERF__.reset()`);
      await a.mouse.move(bx, by);
      await a.mouse.down();
      for (let i = 1; i <= 15; i++) await a.mouse.move(bx + i * 4, by - i * 2);
      await a.mouse.up();
      await sleep(250);
      check((await edgePath()) !== createdPath, "moving the bend reshapes the edge");
      check((await storeWrites(a)) === 1, `a 15-step bend drag is one write (wrote ${await storeWrites(a)})`);
      await a.click(".react-flow__pane", { position: { x: 5, y: 5 } });
      await a.keyboard.press("Control+z");
      await sleep(250);
      check((await edgePath()) === createdPath, "one undo reverts the whole bend drag");
      await a.keyboard.press("Control+z");
      await sleep(250);
      await a.evaluate(`window.__PERF__.setSelectedEdges(["e2"])`);
      await sleep(200);
      check((await bendCount()) === before, "and one more removes the bend it created");
      await a.evaluate(`window.__PERF__.setSelectedEdges([])`);
    }

    console.log("\n=== Starting a session leaves the canvas unchanged (WS1-R4) ===");
    const before = await nodeCount(a);
    await a.click(".collab-panel__trigger");
    const toggle = a.locator(".collab-panel__settings-toggle");
    await toggle.waitFor();
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    await a.fill("#collab-panel-signaling-url", servers.relayUrl);
    await a.click(".collab-panel__primary-action:not(.collab-panel__resume)");
    await sleep(50);
    check((await nodeCount(a)) === before, `${before} nodes immediately after starting`);
    await a.click(".collab-panel__trigger");
    await a.waitForSelector(".collab-panel__room-code");
    await a.click(".collab-panel__copy-button");
    await sleep(200);
    const link = await a.evaluate(() => navigator.clipboard.readText());
    await a.keyboard.press("Escape");
    check((await nodeCount(a)) === before, "still unchanged once the session is up");

    console.log("\n=== Joining keeps local content separate (WS1-R5, WS1-R7) ===");
    await open(b, servers.appUrl);
    await b.evaluate(`window.__PERF__.loadFixture("small")`);
    await sleep(300);
    const bLocal = await nodeCount(b);
    check(bLocal > 0 && bLocal !== before, `B has its own local diagram (${bLocal} nodes)`);
    await b.click(".collab-panel__trigger");
    await b.fill(".collab-panel__join-input", link);
    await b.click(".collab-panel__join-button");
    await sleep(3000);
    await b.keyboard.press("Escape");
    check((await nodeCount(b)) === before, `B shows the session's ${before} nodes, not a union`);
    check((await nodeCount(a)) === before, "A is unaffected by B's local content");
    check((await titleOf(b)) === fixture.title, "B sees the session's title");
    check(await undoDisabled(b), "B starts the session with nothing to undo");

    console.log("\n=== Undo in a session reverts only the local edit (WS3-R2) ===");
    // Held mid-gesture first: B must see the node moving before A lets go
    // (WS4-R3), which now travels over Awareness rather than the document.
    {
      const box = await a.locator(`.react-flow__node[data-id="${DRAGGED}"]`).boundingBox();
      if (!box) throw new Error("dragged node not on screen");
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await a.mouse.move(x, y);
      await a.mouse.down();
      for (let i = 1; i <= 6; i++) await a.mouse.move(x + i * 10, y);
      await sleep(1000);
      const midB = await transformOf(b, DRAGGED);
      check(midB !== home, `B sees A's node moving while A is still holding it (${midB})`);
      for (let i = 7; i <= 12; i++) await a.mouse.move(x + i * 10, y);
      await a.mouse.up();
      await sleep(150);
    }
    const aMoved = await transformOf(a, DRAGGED);
    await sleep(1000);
    check((await transformOf(b, DRAGGED)) === aMoved, "A's drag reaches B");
    await b.fill('[aria-label="Diagram title"]', "Renamed by B");
    await sleep(1000);
    check((await titleOf(a)) === "Renamed by B", "B's rename reaches A");
    await a.click(".react-flow__pane", { position: { x: 5, y: 5 } });
    await a.keyboard.press("Control+z");
    await sleep(1000);
    check((await transformOf(a, DRAGGED)) === home, "A's undo reverts A's drag");

    // A bend moving under A's pointer is visible to B before A lets go.
    {
      const pathOf = (p: Page) => p.getAttribute('.react-flow__edge[data-id="e2"] path.react-flow__edge-path', "d");
      await a.evaluate(`window.__PERF__.setSelectedEdges(["e2"])`);
      await sleep(250);
      const dot = await a.locator(".typed-edge__insert-dot").first().boundingBox();
      if (dot) {
        const bPathBefore = await pathOf(b);
        const dx = dot.x + dot.width / 2;
        const dy = dot.y + dot.height / 2;
        await a.mouse.move(dx, dy);
        await a.mouse.down();
        for (let i = 1; i <= 10; i++) await a.mouse.move(dx + i * 3, dy + i * 8);
        await sleep(1000);
        check((await pathOf(b)) !== bPathBefore, "B sees A's new bend while A is still dragging it");
        await a.mouse.up();
        await sleep(1000);
        check((await pathOf(b)) === (await pathOf(a)), "and the same bend once A releases");
      } else {
        check(false, "the insertion handle is on screen for the peer check");
      }
      await a.evaluate(`window.__PERF__.setSelectedEdges([])`);
    }
    check((await transformOf(b, DRAGGED)) === home, "...for B too");
    check((await titleOf(a)) === "Renamed by B" && (await titleOf(b)) === "Renamed by B", "B's rename survives A's undo");

    console.log("\n=== Leaving and New ===");
    await b.click(".collab-panel__trigger");
    await b.click(".collab-panel__leave-button");
    await sleep(300);
    check((await nodeCount(b)) === bLocal, `B's own ${bLocal}-node diagram is back after leaving`);
    check(await undoDisabled(b), "B's undo history does not survive the document switch (WS3-R4)");

    await a.click(".collab-panel__trigger");
    await a.click(".collab-panel__leave-button");
    // B has gone, so A holds the only saved copy: leaving asks first (WS13-R11).
    const guarded = await a.waitForSelector(".leave-guard", { timeout: 3000 }).then(() => true, () => false);
    check(guarded, "A, now the only holder of a saved copy, is asked before leaving");
    if (guarded) await a.click(".leave-guard__leave");
    await sleep(300);
    check((await a.locator(".leave-guard").count()) === 0, "and leaves once confirmed");
    check((await nodeCount(a)) === before, "A keeps the document after leaving (WS2-R6)");
    const docBefore = new URL(a.url()).searchParams.get("doc");
    await a.click('button[title="File"]');
    await Promise.all([a.waitForNavigation(), a.click('.export-menu__dropdown button:has-text("New")')]);
    await a.waitForSelector(".collab-panel__trigger");
    await sleep(300);
    const docAfter = new URL(a.url()).searchParams.get("doc");
    check(!!docAfter && docAfter !== docBefore, `New opens a different document (${docBefore} -> ${docAfter})`);
    check((await nodeCount(a)) === 0, "New shows an empty canvas");
    check(await undoDisabled(a), "New leaves nothing to undo");
  } catch (err) {
    failures++;
    console.error("Verification failed with error:", err);
  } finally {
    await browser?.close().catch(() => {});
    servers?.stop();
  }
  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll document browser checks passed.");
  process.exit(0);
}

run();
