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

async function open(p: Page, url: string) {
  await p.goto(url);
  await p.waitForSelector(".collab-panel__trigger");
  await p.waitForFunction("typeof window.__PERF__?.loadFixture === 'function'", null, { timeout: 15000 });
}

async function drag(p: Page, id: string, dx: number) {
  const box = await p.locator(`.react-flow__node[data-id="${id}"]`).boundingBox();
  if (!box) throw new Error(`node ${id} not on screen`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await p.mouse.move(x, y);
  await p.mouse.down();
  for (let i = 1; i <= 10; i++) await p.mouse.move(x + (dx * i) / 10, y);
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
    await sleep(200);
    check(
      (await nodeCount(a)) === NESTED.data.subDiagram!.nodes.length,
      `drilling into ${NESTED.id} shows its ${NESTED.data.subDiagram!.nodes.length} nested nodes`
    );
    await a.evaluate(`window.__PERF__.setPath([])`);
    await sleep(200);

    console.log("\n=== A drag takes exactly one undo (WS3-R3) ===");
    const home = await transformOf(a, DRAGGED);
    await drag(a, DRAGGED, 120);
    const moved = await transformOf(a, DRAGGED);
    check(moved !== home, `the drag moved the node (${home} -> ${moved})`);
    check(!(await undoDisabled(a)), "undo becomes available");
    await a.keyboard.press("Control+z");
    await sleep(150);
    check((await transformOf(a, DRAGGED)) === home, "one Ctrl+Z puts it back");
    check(await undoDisabled(a), "and nothing is left to undo");

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

    console.log("\n=== Starting a session leaves the canvas unchanged (WS1-R4) ===");
    const before = await nodeCount(a);
    await a.click(".collab-panel__trigger");
    const toggle = a.locator(".collab-panel__settings-toggle");
    await toggle.waitFor();
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    await a.fill("#collab-panel-signaling-url", servers.relayUrl);
    await a.click(".collab-panel__primary-action");
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
    await drag(a, DRAGGED, 120);
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
    await sleep(300);
    check((await nodeCount(a)) === before, "A keeps the document after leaving (WS2-R6)");
    a.once("dialog", (d) => void d.accept());
    await a.click('button[title="File"]');
    await a.click('.export-menu__dropdown button:has-text("New")');
    await sleep(300);
    check((await nodeCount(a)) === 0, "New clears the canvas");
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
