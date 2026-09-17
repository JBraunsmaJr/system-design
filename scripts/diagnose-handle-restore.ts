/**
 * Diagnostic, not a test (not picked up by npm test).
 *
 *   npx tsx scripts/diagnose-handle-restore.ts
 *
 * verify-file-saving.ts lost its page on Windows right after the first reload
 * that restored a stored file handle. This walks that sequence one step at a
 * time and reports, after each step, whether the page and browser are still
 * there - so the step that ends them is named. Result on Windows Chromium 153:
 * reading an origin-private handle back from IndexedDB (step 1c) ends the
 * browser. Parts 2 and 3 now use the suite's name-based handle store and
 * should complete; part 1 runs last and is expected to stop at 1c there.
 */
import { chromium, type Browser, type Page } from "playwright";
import { startDevServers } from "./lib/devServers";

const t0 = Date.now();
const at = () => `+${String(Date.now() - t0).padStart(6)}ms`;
const log = (msg: string) => console.log(`${at()}  ${msg}`);

async function launch(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true, channel: "chromium" });
  } catch {
    return chromium.launch({ headless: true });
  }
}

async function step(name: string, page: Page, browser: Browser, work: () => Promise<unknown>) {
  log(`STEP ${name} ...`);
  try {
    const result = await Promise.race([
      work(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timed out after 15s")), 15000)),
    ]);
    log(`  ok: ${JSON.stringify(result)}`);
  } catch (error) {
    log(`  ERROR: ${String(error).split("\n")[0]}`);
  }
  log(`  page closed=${page.isClosed()} browser connected=${browser.isConnected()}`);
  if (page.isClosed() || !browser.isConnected()) {
    log("STOPPING: the step above ended the page or browser.");
    return false;
  }
  return true;
}

const PICKER = `(() => {
  if (typeof FileSystemHandle === "undefined" || !window.isSecureContext) return;
  const mode = () => localStorage.getItem("fake-permission") || "granted";
  FileSystemHandle.prototype.queryPermission = async () => (mode() === "granted" ? "granted" : mode() === "denied" ? "denied" : "prompt");
  FileSystemHandle.prototype.requestPermission = async () => {
    if (mode() === "prompt") localStorage.setItem("fake-permission", "granted");
    return mode() === "denied" ? "denied" : "granted";
  };
  // Remembers the file by name rather than storing the handle: reading an
  // origin-private handle back out of IndexedDB ends Chromium on Windows.
  window.__TEST_FILE_HANDLE_STORE__ = {
    get: async (docId) => {
      const name = localStorage.getItem("test-file-handle:" + docId);
      return name ? (await navigator.storage.getDirectory()).getFileHandle(name) : null;
    },
    set: async (docId, handle) => localStorage.setItem("test-file-handle:" + docId, handle.name),
    delete: async (docId) => localStorage.removeItem("test-file-handle:" + docId),
  };
  window.showSaveFilePicker = async ({ suggestedName }) =>
    (await navigator.storage.getDirectory()).getFileHandle(suggestedName, { create: true });
})();`;

async function main() {
  const servers = await startDevServers({ vitePort: 5189, signalingPort: 14456, quiet: true });
  const browser = await launch();
  log(`browser ${browser.version()} on ${process.platform}`);
  browser.on("disconnected", () => log("EVENT browser disconnected"));
  try {
    const app = `${servers.appUrl}/system-design/`;

    // Part 2: the app, exactly as verify-file-saving.ts drives it.
    {
      const ctx = await browser.newContext();
      await ctx.addInitScript({ content: PICKER });
      const page = await ctx.newPage();
      page.on("crash", () => log("EVENT page crashed"));
      page.on("close", () => log("EVENT page closed"));
      page.on("console", (m) => {
        if (m.type() === "error") log(`console error: ${m.text().slice(0, 200)}`);
      });
      page.on("pageerror", (e) => log(`page error: ${e.message.slice(0, 200)}`));
      const chip = () => page.textContent(".durability__chip span");
      const ok =
        (await step("2a open the app", page, browser, async () => {
          await page.goto(`${app}?doc=diag-app`);
          await page.waitForSelector(".durability__chip");
          await page.fill('[aria-label="Diagram title"]', "Diag doc");
          await page.waitForTimeout(1500);
          return chip();
        })) &&
        (await step("2b attach a file", page, browser, async () => {
          await page.click(".durability__chip");
          await page.click('.durability__detail button:has-text("Save to a file")');
          await page.waitForTimeout(2000);
          return chip();
        })) &&
        (await step("2c set permission to 'prompt'", page, browser, () =>
          page.evaluate(() => localStorage.setItem("fake-permission", "prompt")).then(() => "set")
        )) &&
        (await step("2d reload", page, browser, () => page.reload().then(() => "reloaded"))) &&
        (await step("2e wait for the toolbar", page, browser, () =>
          page.waitForSelector(".durability__chip").then(() => chip())
        )) &&
        (await step("2f wait 5s and read the chip", page, browser, async () => {
          await page.waitForTimeout(5000);
          return chip();
        }));
      if (ok) log("Part 2 completed: the app survives the restore here.");
      await ctx.close().catch(() => {});
    }

    // Part 3: exactly what verify-file-saving.ts does before its R2 reload -
    // clipboard permissions, the "small" fixture, two edits, and reading the
    // file back through the page.
    {
      const ctx = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
      await ctx.addInitScript({ content: PICKER });
      const page = await ctx.newPage();
      page.on("crash", () => log("EVENT page crashed"));
      page.on("close", () => log("EVENT page closed"));
      page.on("pageerror", (e) => log(`page error: ${e.message.slice(0, 200)}`));
      page.on("dialog", (d) => {
        log(`EVENT dialog: ${d.type()} "${d.message().slice(0, 80)}"`);
        void d.dismiss();
      });
      const chip = () => page.textContent(".durability__chip span");
      const readTitle = () =>
        page.evaluate(async () => {
          const h = await (await navigator.storage.getDirectory()).getFileHandle("file-doc-v1.json");
          return JSON.parse(await (await h.getFile()).text()).title;
        });
      const ok =
        (await step("3a open, load fixture, title v1", page, browser, async () => {
          await page.goto(`${app}?doc=filedoc`);
          await page.waitForSelector(".durability__chip");
          await page.waitForFunction("typeof window.__PERF__?.loadFixture === 'function'");
          await page.evaluate(`window.__PERF__.loadFixture("small")`);
          await page.fill('[aria-label="Diagram title"]', "File doc v1");
          await page.waitForTimeout(1800);
          return chip();
        })) &&
        (await step("3b attach", page, browser, async () => {
          await page.click(".durability__chip");
          await page.click('.durability__detail button:has-text("Save to a file")');
          await page.waitForTimeout(2000);
          return { chip: await chip(), title: await readTitle() };
        })) &&
        (await step("3c title v2 and read the file", page, browser, async () => {
          await page.fill('[aria-label="Diagram title"]', "File doc v2");
          await page.waitForTimeout(1800);
          return readTitle();
        })) &&
        (await step("3d does closing ask? (beforeunload)", page, browser, () =>
          page.evaluate(() => {
            const e = new Event("beforeunload", { cancelable: true });
            window.dispatchEvent(e);
            return e.defaultPrevented;
          })
        )) &&
        (await step("3e set permission to 'prompt'", page, browser, () =>
          page.evaluate(() => localStorage.setItem("fake-permission", "prompt")).then(() => "set")
        )) &&
        (await step("3f reload", page, browser, () => page.reload().then(() => "reloaded"))) &&
        (await step("3g wait for the toolbar and __PERF__", page, browser, async () => {
          await page.waitForSelector(".durability__chip");
          await page.waitForFunction("typeof window.__PERF__?.loadFixture === 'function'", null, { timeout: 15000 });
          return chip();
        })) &&
        (await step("3h wait 5s and read the chip", page, browser, async () => {
          await page.waitForTimeout(5000);
          return chip();
        }));
      if (ok) log("Part 3 completed: the suite's exact sequence survives here.");
      await ctx.close().catch(() => {});
    }
    // Part 1 (last, because on Windows Chromium 153 it ends the browser): the
    // primitive alone, no app code - store an origin-private file handle in
    // IndexedDB, reload, and read it back. Step 1c is where Windows fails; the
    // suite and parts 2-3 avoid it with a name-based test handle store.
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      page.on("crash", () => log("EVENT page crashed"));
      page.on("close", () => log("EVENT page closed"));
      await page.goto(`${servers.appUrl}/system-design/?doc=diag-blank`);
      const ok =
        (await step("1a store an OPFS handle in IndexedDB", page, browser, () =>
          page.evaluate(async () => {
            const handle = await (await navigator.storage.getDirectory()).getFileHandle("diag.json", { create: true });
            const w = await handle.createWritable();
            await w.write("{}");
            await w.close();
            const db: IDBDatabase = await new Promise((res, rej) => {
              const r = indexedDB.open("diag-handles", 1);
              r.onupgradeneeded = () => r.result.createObjectStore("h");
              r.onsuccess = () => res(r.result);
              r.onerror = () => rej(r.error);
            });
            await new Promise((res, rej) => {
              const tx = db.transaction("h", "readwrite");
              tx.objectStore("h").put(handle, "k");
              tx.oncomplete = res;
              tx.onerror = () => rej(tx.error);
            });
            db.close();
            return "stored";
          })
        )) &&
        (await step("1b reload", page, browser, () => page.reload().then(() => "reloaded"))) &&
        (await step("1c read the handle back", page, browser, () =>
          page.evaluate(async () => {
            const db: IDBDatabase = await new Promise((res, rej) => {
              const r = indexedDB.open("diag-handles", 1);
              r.onsuccess = () => res(r.result);
              r.onerror = () => rej(r.error);
            });
            const handle = await new Promise<FileSystemFileHandle>((res, rej) => {
              const g = db.transaction("h").objectStore("h").get("k");
              g.onsuccess = () => res(g.result);
              g.onerror = () => rej(g.error);
            });
            (window as unknown as { __h: FileSystemFileHandle }).__h = handle;
            return { name: handle?.name, kind: handle?.kind };
          })
        )) &&
        (await step("1d queryPermission (real)", page, browser, () =>
          page.evaluate(async () => {
            const h = (window as unknown as { __h: FileSystemFileHandle & { queryPermission?: (d: unknown) => Promise<string> } }).__h;
            return typeof h.queryPermission === "function" ? await h.queryPermission({ mode: "readwrite" }) : "no queryPermission";
          })
        )) &&
        (await step("1e getFile", page, browser, () =>
          page.evaluate(async () => (await (window as unknown as { __h: FileSystemFileHandle }).__h.getFile()).size)
        ));
      await ctx.close().catch(() => {});
      if (ok) log("Part 1 completed: this browser restores origin-private handles from IndexedDB.");
    }

  } finally {
    await browser.close().catch(() => {});
    servers.stop();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
