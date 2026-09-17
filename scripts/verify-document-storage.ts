/**
 * Per-document storage, in a real browser.
 *
 *  - WS2-R1: content survives a reload with no explicit save, and the
 *    localStorage draft slot is no longer written;
 *  - the retired draft is imported once into an empty document, then cleared;
 *  - WS2-R3: two tabs on two documents do not overwrite each other, and both
 *    appear in the document index;
 *  - starting a session does not store the document a second time under a
 *    room key; joining still keeps a local replica (WS2-R6).
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { readFileSync } from "fs";
import { join, resolve } from "path";
import { startDevServers, type DevServers } from "./lib/devServers";

const LEGACY_KEY = "system-design-editor:autosave";
const FIXTURE_TEXT = readFileSync(resolve(join("fixtures", "schema-0.7.json")), "utf8");
const FIXTURE = JSON.parse(FIXTURE_TEXT) as { title: string; nodes: unknown[] };

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
/** Longer than the 1s autosave debounce plus the write itself. */
const SAVE_WAIT = 1800;

const nodeCount = (p: Page) => p.$$eval(".react-flow__node", (els) => els.length);
const titleOf = (p: Page) => p.inputValue('[aria-label="Diagram title"]');
const legacyDraft = (p: Page) => p.evaluate((k) => localStorage.getItem(k), LEGACY_KEY);

async function ready(p: Page) {
  await p.waitForSelector(".collab-panel__trigger");
  await p.waitForFunction("typeof window.__PERF__?.loadFixture === 'function'", null, { timeout: 15000 });
  await sleep(300);
}

async function documentIndex(p: Page): Promise<{ docId: string; title: string; origin: string; sessionRoom?: string }[]> {
  return p.evaluate(
    () =>
      new Promise((res, rej) => {
        const open = indexedDB.open("system-design-editor");
        open.onerror = () => rej(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("documents")) {
            db.close();
            res([]);
            return;
          }
          const get = db.transaction("documents").objectStore("documents").get("index");
          get.onerror = () => rej(get.error);
          get.onsuccess = () => {
            db.close();
            res(get.result ? JSON.parse(get.result as string).entries : []);
          };
        };
      })
  );
}

const databaseNames = (p: Page) =>
  p.evaluate(async () => (await indexedDB.databases()).map((d) => d.name ?? ""));

async function run() {
  let servers: DevServers | undefined;
  let browser: Browser | undefined;
  const contexts: BrowserContext[] = [];
  const newContext = async () => {
    const c = await browser!.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
    contexts.push(c);
    return c;
  };
  try {
    servers = await startDevServers({ vitePort: 5186, signalingPort: 14453, quiet: true });
    browser = await chromium.launch({ headless: true });
    const app = `${servers.appUrl}/system-design/`;

    console.log("=== A document persists without a save, and localStorage is not used (WS2-R1) ===");
    {
      const ctx = await newContext();
      const p = await ctx.newPage();
      p.on("pageerror", (e) => check(false, `page threw: ${e.message}`));
      await p.goto(app);
      await ready(p);
      check(new URL(p.url()).searchParams.get("doc") === "local", "a bare URL opens the default document and names it in the URL");
      await p.evaluate(`window.__PERF__.loadFixture("small")`);
      await p.fill('[aria-label="Diagram title"]', "Persisted title");
      await sleep(SAVE_WAIT);
      check((await legacyDraft(p)) === null, "the retired localStorage draft slot is not written");
      const index = await documentIndex(p);
      check(index.some((e) => e.docId === "local" && e.title === "Persisted title"), "the document index lists it with its current title");
      await p.reload();
      await ready(p);
      const [n, t] = [await nodeCount(p), await titleOf(p)];
      check(n === 25 && t === "Persisted title", `a reload restores content and title with no explicit save (${n} nodes, "${t}")`);
      await p.goto(servers.appUrl + "/system-design/");
      await ready(p);
      check(new URL(p.url()).searchParams.get("doc") === "local", "a bare URL reopens the last document");
    }

    console.log("\n=== The retired draft is imported once, then cleared ===");
    {
      const ctx = await newContext();
      // Present before the app first loads, exactly as an older build left it.
      await ctx.addInitScript(
        ([key, value]) => {
          if (!sessionStorage.getItem("legacy-seeded")) {
            localStorage.setItem(key, value);
            sessionStorage.setItem("legacy-seeded", "1");
          }
        },
        [LEGACY_KEY, FIXTURE_TEXT]
      );
      const p = await ctx.newPage();
      await p.goto(app);
      await ready(p);
      check((await nodeCount(p)) === FIXTURE.nodes.length && (await titleOf(p)) === FIXTURE.title, "an empty document is seeded from the old draft");
      await sleep(SAVE_WAIT);
      check((await legacyDraft(p)) === null, "and the old draft is cleared once the content is stored");
      await p.reload();
      await ready(p);
      check((await nodeCount(p)) === FIXTURE.nodes.length && (await titleOf(p)) === FIXTURE.title, "the imported content survives a reload");
    }

    console.log("\n=== Two tabs, two documents (WS2-R3) ===");
    {
      const ctx = await newContext();
      const alpha = await ctx.newPage();
      const beta = await ctx.newPage();
      await alpha.goto(`${app}?doc=alpha`);
      await beta.goto(`${app}?doc=beta`);
      await ready(alpha);
      await ready(beta);
      await alpha.setInputFiles('input[type="file"][accept="application/json"]', resolve(join("fixtures", "schema-0.7.json")));
      await beta.evaluate(`window.__PERF__.loadFixture("small")`);
      await beta.fill('[aria-label="Diagram title"]', "Beta");
      await sleep(SAVE_WAIT);
      await alpha.reload();
      await beta.reload();
      await ready(alpha);
      await ready(beta);
      check((await nodeCount(alpha)) === FIXTURE.nodes.length && (await titleOf(alpha)) === FIXTURE.title, "alpha keeps its own content");
      check((await nodeCount(beta)) === 25 && (await titleOf(beta)) === "Beta", `beta keeps its own content (${await nodeCount(beta)} nodes, "${await titleOf(beta)}")`);
      const ids = (await documentIndex(alpha)).map((e) => e.docId);
      check(ids.includes("alpha") && ids.includes("beta"), `both are in the index (${ids.join(", ")})`);
    }

    console.log("\n=== The document manager (WS2-R3, WS2-R5, WS2-R6) ===");
    {
      const ctx = await newContext();
      const p = await ctx.newPage();
      p.on("pageerror", (e) => check(false, `page threw: ${e.message}`));
      await p.goto(`${app}?doc=manager-one`);
      await ready(p);
      await p.evaluate(`window.__PERF__.loadFixture("small")`);
      await p.fill('[aria-label="Diagram title"]', "Doc one");
      await sleep(SAVE_WAIT);

      await p.click('button[title="File"]');
      await Promise.all([p.waitForNavigation(), p.click('.export-menu__dropdown button:has-text("New")')]);
      await ready(p);
      const secondId = new URL(p.url()).searchParams.get("doc") ?? "";
      check(secondId !== "manager-one" && (await nodeCount(p)) === 0, "File > New opens a new, empty document");
      await p.fill('[aria-label="Diagram title"]', "Doc two");
      await sleep(SAVE_WAIT);

      const openManager = async () => {
        await p.click('button[title="File"]');
        await p.click('.export-menu__dropdown button:has-text("Documents")');
        await p.waitForSelector(".document-manager__row");
      };
      const row = (id: string) => p.locator(`.document-manager__row[data-doc-id="${id}"]`);
      await openManager();
      check((await row("manager-one").count()) === 1 && (await row(secondId).count()) === 1, "both documents are listed");
      check((await row(secondId).locator(".document-manager__current").count()) === 1, "the open one is marked");
      check(await row(secondId).locator(".document-manager__forget").isDisabled(), "the open document cannot be forgotten from its own tab");
      const storageText = (await p.textContent(".document-manager__storage")) ?? "";
      check(/Using .+ of .+ available/.test(storageText), `storage usage is shown (WS2-R5): "${storageText.slice(0, 60)}..."`);

      // Rename a document that is not open.
      await row("manager-one").locator(".document-manager__rename").click();
      await p.fill(".document-manager__rename-input", "Doc one renamed");
      await p.keyboard.press("Enter");
      await p.waitForFunction(() =>
        [...document.querySelectorAll(".document-manager__title")].some((e) => e.textContent === "Doc one renamed")
      );
      check(true, "renaming a closed document updates the list");

      // Rename the open document: goes through its live title.
      await row(secondId).locator(".document-manager__rename").click();
      await p.fill(".document-manager__rename-input", "Doc two renamed");
      await p.keyboard.press("Enter");
      await sleep(200);
      check((await titleOf(p)) === "Doc two renamed", "renaming the open document renames it in the editor too");

      // Duplicate, then forget the copy.
      await row("manager-one").locator(".document-manager__duplicate").click();
      await p.waitForSelector('.document-manager__title:text-is("Copy of Doc one renamed")');
      const copyId = await p
        .locator('.document-manager__row:has(.document-manager__title:text-is("Copy of Doc one renamed"))')
        .getAttribute("data-doc-id");
      check(!!copyId, "duplicating adds a copy");
      let confirmText = "";
      p.once("dialog", (d) => {
        confirmText = d.message();
        void d.accept();
      });
      await row(copyId ?? "").locator(".document-manager__forget").click();
      await p.waitForFunction((id) => !document.querySelector(`.document-manager__row[data-doc-id="${id}"]`), copyId);
      check(/permanently deletes/.test(confirmText) && /cannot be undone/.test(confirmText), "forgetting asks first, and says it is irreversible (WS2-R6)");
      await sleep(300);
      const dbs = await databaseNames(p);
      check(!dbs.includes(`system-design:doc:${copyId}`), "the forgotten document's database is deleted");
      check(dbs.includes("system-design:doc:manager-one"), "the original's database is untouched");

      // Open the renamed document from the list.
      await Promise.all([p.waitForNavigation(), row("manager-one").locator(".document-manager__open").click()]);
      await ready(p);
      check(
        new URL(p.url()).searchParams.get("doc") === "manager-one" && (await titleOf(p)) === "Doc one renamed" && (await nodeCount(p)) === 25,
        "opening it from the list shows its content under its new name"
      );
    }

    console.log("\n=== Sessions and local replicas ===");
    {
      const ctx = await newContext();
      const host = await ctx.newPage();
      await host.goto(`${app}?doc=hosted`);
      await ready(host);
      await host.evaluate(`window.__PERF__.loadFixture("small")`);
      await host.click(".collab-panel__trigger");
      const toggle = host.locator(".collab-panel__settings-toggle");
      await toggle.waitFor();
      if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
      await host.fill("#collab-panel-signaling-url", servers.relayUrl);
      await host.click(".collab-panel__primary-action");
      await sleep(300);
      await host.click(".collab-panel__trigger");
      await host.waitForSelector(".collab-panel__room-code");
      await host.click(".collab-panel__copy-button");
      await sleep(200);
      const link = await host.evaluate(() => navigator.clipboard.readText());
      await host.keyboard.press("Escape");
      await sleep(SAVE_WAIT);
      const hostDbs = await databaseNames(host);
      check(!hostDbs.some((n) => n.startsWith("system-design:room:")), "starting a session does not store the document again under a room key");
      check(hostDbs.includes("system-design:doc:hosted"), "it stays stored under its document key");
      const hostEntry = (await documentIndex(host)).find((e) => e.docId === "hosted");
      check(hostEntry?.origin === "session" && !!hostEntry.sessionRoom, "the index records the session room, for rehosting later (WS13-R12)");

      const guestCtx = await newContext();
      const guest = await guestCtx.newPage();
      await guest.goto(app);
      await ready(guest);
      await guest.fill('[aria-label="Diagram title"]', "Guest local work");
      await sleep(SAVE_WAIT);
      await guest.click(".collab-panel__trigger");
      await guest.fill(".collab-panel__join-input", link);
      await guest.click(".collab-panel__join-button");
      // Peer connection setup time varies; wait for the content, not a clock.
      const joined = await guest
        .waitForFunction(() => document.querySelectorAll(".react-flow__node").length === 25, null, { timeout: 15000 })
        .then(() => true, () => false);
      await guest.keyboard.press("Escape");
      check(joined, `the guest sees the session (${await nodeCount(guest)} nodes)`);
      await sleep(SAVE_WAIT);
      const guestDbs = await databaseNames(guest);
      check(guestDbs.some((n) => n.startsWith("system-design:room:")), "the guest keeps its own replica of the session (WS2-R6)");
      const guestIndex = await documentIndex(guest);
      check(
        guestIndex.some((e) => e.docId.startsWith("session:") && e.origin === "session"),
        "and it is indexed as a session document"
      );
      const local = guestIndex.find((e) => e.docId === "local");
      check(local?.title === "Guest local work", `joining did not overwrite the guest's own document entry (title: ${local?.title})`);
    }
  } catch (err) {
    failures++;
    console.error("Verification failed with error:", err);
  } finally {
    for (const c of contexts) await c.close().catch(() => {});
    await browser?.close().catch(() => {});
    servers?.stop();
  }
  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll document storage checks passed.");
  process.exit(0);
}

run();
