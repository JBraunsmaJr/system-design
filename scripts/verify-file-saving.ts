/**
 * WS13 in a real browser (Chromium).
 *
 * A save picker cannot be driven headlessly, so an init script stands in for
 * `showSaveFilePicker` with handles from the origin-private file system. Those
 * are genuine FileSystemFileHandles: they write through createWritable, can be
 * stored in IndexedDB, and answer permission queries - which the script makes
 * controllable to exercise the permission states.
 *
 *  R1  attaching a file writes to it, and edits follow with no further action
 *  R2  a stored handle is re-acquired on reload and resumes with one click
 *  R3  an interrupted write leaves the previous complete file intact
 *  R4  an external change stops writing and offers reload or overwrite
 *  R7  closing with an unresolved conflict prompts
 *  R8  no file saving is claimed while paused, declined, stopped, or where the
 *      browser cannot write files at all
 *  R11 the only saved-copy holder is warned before leaving; others are not
 *
 * R13: set E2E_BROWSER=firefox to run under Firefox, which has no File System
 * Access API - the file-backed sections are then reported as skipped and the
 * rest (R3, R6, R8, R10, R11) run against the browser's real capabilities.
 * E2E_SIMULATE_NO_FILE_ACCESS=1 takes the same path on Chromium.
 */
import { chromium, firefox, type Browser, type BrowserContext, type Page } from "playwright";
import { startDevServers, type DevServers } from "./lib/devServers";

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
const SAVE_WAIT = 1800;
const FILE = "file-doc-v1.json";

// A string, not a function: tsx rewrites named functions with a helper that
// does not exist inside the page.
const FAKE_FILE_ACCESS = `(() => {
  // The session link, captured as it is copied: reading the clipboard back
  // needs a permission Firefox does not grant to automation.
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    const write = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = async (text) => {
      window.__lastCopied = text;
      try { await write(text); } catch (e) { /* the captured copy is what the suite reads */ }
    };
  }
  // Init scripts also run in documents without the file system API (the blank
  // page a new tab starts on is not a secure context). Nothing to replace there.
  if (typeof FileSystemHandle === "undefined" || !window.isSecureContext) return;
  // Only stand in for a capability the browser really has: Firefox has the
  // origin-private file system but no save picker, and must stay that way.
  if (typeof window.showSaveFilePicker !== "function") return;
  const mode = () => localStorage.getItem("fake-permission") || "granted";
  const proto = FileSystemHandle.prototype;
  proto.queryPermission = async () => (mode() === "granted" ? "granted" : mode() === "denied" ? "denied" : "prompt");
  proto.requestPermission = async () => {
    // A click on "Allow". A declined permission stays declined.
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
  if (localStorage.getItem("no-file-access") === "1") {
    window.showSaveFilePicker = undefined;
  } else {
    window.showSaveFilePicker = async ({ suggestedName }) =>
      (await navigator.storage.getDirectory()).getFileHandle(suggestedName, { create: true });
  }
})();`;

const readFile = (p: Page, name: string) =>
  p.evaluate(async (n) => {
    try {
      const h = await (await navigator.storage.getDirectory()).getFileHandle(n);
      return await (await h.getFile()).text();
    } catch {
      return null;
    }
  }, name);
const fileTitle = async (p: Page, name: string) => {
  const text = await readFile(p, name);
  try {
    return text ? (JSON.parse(text) as { title: string }).title : null;
  } catch {
    return `unparseable: ${text?.slice(0, 30)}`;
  }
};
const writeExternal = (p: Page, name: string, mutate: (title: string) => string) =>
  p.evaluate(
    async ([n, newTitle]) => {
      const h = await (await navigator.storage.getDirectory()).getFileHandle(n);
      const file = JSON.parse(await (await h.getFile()).text());
      file.title = newTitle;
      await new Promise((r) => setTimeout(r, 20)); // a distinct lastModified
      const w = await h.createWritable();
      await w.write(JSON.stringify(file, null, 2));
      await w.close();
    },
    [name, mutate("")] as const
  );

const nodeCount = (p: Page) => p.$$eval(".react-flow__node", (els) => els.length);
const chipLabel = (p: Page) => p.textContent(".durability__chip span");
const chipDetail = async (p: Page) => {
  if ((await p.getAttribute(".durability__chip", "aria-expanded")) !== "true") await p.click(".durability__chip");
  return (await p.textContent(".durability__detail")) ?? "";
};
async function clickChipButton(p: Page, text: string) {
  await chipDetail(p);
  await p.click(`.durability__detail button:has-text("${text}")`);
}
const setTitle = (p: Page, t: string) => p.fill('[aria-label="Diagram title"]', t);
async function ready(p: Page) {
  await p.waitForSelector(".durability__chip");
  await p.waitForFunction("typeof window.__PERF__?.loadFixture === 'function'", null, { timeout: 15000 });
  await sleep(300);
}
async function waitForLabel(p: Page, label: string, timeout = 5000) {
  return p
    .waitForFunction((l) => document.querySelector(".durability__chip span")?.textContent === l, label, { timeout })
    .then(() => true, () => false);
}

/**
 * Full Chromium in headless mode where it is installed, rather than the
 * stripped-down headless shell Playwright uses by default. Restoring a stored
 * file handle closed the page under chrome-headless-shell on Windows; the
 * File System Access paths this suite exercises belong to the full browser.
 */
const BROWSER = (process.env.E2E_BROWSER ?? "chromium").toLowerCase();
const SIMULATE_NO_FILE_ACCESS = process.env.E2E_SIMULATE_NO_FILE_ACCESS === "1";
/**
 * Whether the two R10/R11 participants share one browser context (two tabs)
 * instead of two. Same-context tabs sync over BroadcastChannel, with no WebRTC.
 * On for Firefox: Playwright's Firefox never established a peer connection
 * between two of its instances (Windows and CI Linux alike, relay connected),
 * while the leave-guard logic this section covers does not depend on the
 * transport. WebRTC between peers is covered in Chromium, which keeps two
 * contexts, and by verify-session-link.ts.
 */
const PEERS_SAME_CONTEXT = BROWSER === "firefox" || process.env.E2E_PEERS_SAME_CONTEXT === "1";

async function launchBrowser(): Promise<Browser> {
  if (BROWSER === "firefox") {
    const ff = await firefox.launch({
      headless: true,
      // Two local peers (the R11 checks) must be able to reach each other:
      // Firefox hides host addresses behind mDNS names and skips loopback by
      // default, which a CI runner may not resolve.
      firefoxUserPrefs: {
        "media.peerconnection.ice.obfuscate_host_addresses": false,
        "media.peerconnection.ice.loopback": true,
        // Without a media permission Firefox offers only its default-route
        // address, and may offer none usable between two local profiles.
        "media.peerconnection.ice.default_address_only": false,
        "media.peerconnection.ice.no_host": false,
        "media.navigator.permission.disabled": true,
      },
    });
    console.log(`Using Firefox ${ff.version()} (headless)`);
    return ff;
  }
  try {
    const full = await chromium.launch({ headless: true, channel: "chromium" });
    console.log(`Using full Chromium ${full.version()} (headless)`);
    return full;
  } catch (error) {
    console.log(`Full Chromium unavailable (${String(error).split("\n")[0]}); using the default headless browser.`);
    return chromium.launch({ headless: true });
  }
}

/** Makes a renderer crash, or the page or browser going away, a named
 * failure with a time, instead of a later "page closed". */
function watchForCrash(page: Page, label: string) {
  const at = () => new Date().toISOString().slice(11, 23);
  page.on("crash", () => check(false, `the page crashed (${label}) at ${at()}`));
  page.on("close", () => console.log(`  [${at()}] ${label}: page closed`));
  page.context().on("close", () => console.log(`  [${at()}] ${label}: context closed`));
  page.context().browser()?.on("disconnected", () => console.log(`  [${at()}] browser disconnected`));
}

async function run() {
  let servers: DevServers | undefined;
  let browser: Browser | undefined;
  const contexts: BrowserContext[] = [];
  const newContext = async (options: { noFileAccess?: boolean } = {}) => {
    const c = await browser!.newContext();
    if (options.noFileAccess || SIMULATE_NO_FILE_ACCESS) {
      await c.addInitScript({ content: `localStorage.setItem("no-file-access", "1");` });
    }
    await c.addInitScript({ content: FAKE_FILE_ACCESS });
    contexts.push(c);
    return c;
  };
  try {
    servers = await startDevServers({ vitePort: 5187, signalingPort: 14454, quiet: true });
    browser = await launchBrowser();
    const app = `${servers.appUrl}/system-design/`;

    const ctx = await newContext();
    const p = await ctx.newPage();
    p.on("pageerror", (e) => check(false, `page threw: ${e.message}`));
    watchForCrash(p, "main document page");
    await p.goto(`${app}?doc=filedoc`);
    await ready(p);

// Decided by the browser, not assumed: Firefox has no save picker, and the
    // stand-in only replaces one that exists.
    const fileAccess = await p.evaluate(() => typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === "function");
    if (fileAccess) {
      console.log("=== R1: attach, then edits follow ===");
      await p.evaluate(`window.__PERF__.loadFixture("small")`);
      await setTitle(p, "File doc v1");
      await sleep(SAVE_WAIT);
      check((await chipLabel(p)) === "Saved in browser", "before attaching: saved in the browser only");
      await clickChipButton(p, "Save to a file");
      check(await waitForLabel(p, "Saved to file"), "after attaching: saved to file");
      const first = JSON.parse((await readFile(p, FILE)) ?? "{}") as { title?: string; nodes?: unknown[] };
      check(first.title === "File doc v1" && first.nodes?.length === 25, "the file holds the whole document");
      await setTitle(p, "File doc v2");
      await sleep(SAVE_WAIT);
      check((await fileTitle(p, FILE)) === "File doc v2", "an edit reaches the file with no further action");
      // The suite's name-based handle store is in use, so no origin-private
      // handle is ever stored in IndexedDB - reading one back ends Chromium on
      // Windows before any of the checks below can run.
      const dbs = await p.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
      check(!dbs.includes("system-design-file-handles"), "no file handle is stored in IndexedDB during the suite");

      console.log("\n=== R2 / R8: a fresh visit needs one click, and claims nothing until then ===");
      await p.evaluate(() => localStorage.setItem("fake-permission", "prompt"));
      await p.reload();
      await ready(p);
      check(await waitForLabel(p, "File paused"), "reopening shows the file as paused, not saved");
      await setTitle(p, "File doc v3");
      await sleep(SAVE_WAIT);
      check((await fileTitle(p, FILE)) === "File doc v2", "nothing is written while paused");
      await clickChipButton(p, `Resume saving to ${FILE}`);
      check(await waitForLabel(p, "Saved to file"), "one click resumes");
      await sleep(SAVE_WAIT);
      check((await fileTitle(p, FILE)) === "File doc v3", "and the file catches up without another edit");

      console.log("\n=== R4 / R7: an external change is never clobbered ===");
      await writeExternal(p, FILE, () => "Changed by git");
      await setTitle(p, "Local edit");
      check(await waitForLabel(p, "File changed elsewhere"), "the change is detected on the next write");
      check((await fileTitle(p, FILE)) === "Changed by git", "and the external version is left as it is");
      const detail = await chipDetail(p);
      check(/reload it or overwrite it/.test(detail), "the choice is explained");
      await p.click('button:has-text("Reload from file")');
      await sleep(300);
      check((await p.inputValue('[aria-label="Diagram title"]')) === "Changed by git", "Reload loads the file's version");
      check(await waitForLabel(p, "Saved to file", 4000), "and saving to the file continues from it");

      await writeExternal(p, FILE, () => "Changed again");
      await setTitle(p, "Mine wins");
      check(await waitForLabel(p, "File changed elsewhere"), "a second external change is detected");
      await p.click('button:has-text("Overwrite file")');
      check(await waitForLabel(p, "Saved to file"), "Overwrite resolves the conflict");
      await sleep(300);
      const afterOverwrite = await fileTitle(p, FILE);
      check(afterOverwrite !== "Changed again" && afterOverwrite !== null, `and the file now holds this tab's version (${afterOverwrite})`);

      console.log("\n=== R7: closing with an unresolved conflict asks first ===");
      {
        const r7ctx = await newContext();
        const r7 = await r7ctx.newPage();
        await r7.goto(`${app}?doc=r7doc`);
        await ready(r7);
        await setTitle(r7, "R7 doc");
        await clickChipButton(r7, "Save to a file");
        check(await waitForLabel(r7, "Saved to file"), "attached");
        await writeExternal(r7, "r7-doc.json", () => "Changed outside");
        await setTitle(r7, "R7 doc edited");
        check(await waitForLabel(r7, "File changed elsewhere"), "conflict detected");
        // Whether closing would prompt, read from the page's own unload
        // handling: headless Chromium does not surface the prompt itself.
        const blocksClose = () =>
          r7.evaluate(() => {
            const e = new Event("beforeunload", { cancelable: true });
            window.dispatchEvent(e);
            return e.defaultPrevented;
          });
        check(await blocksClose(), "closing with an unresolved conflict is blocked");
        await r7.click('button:has-text("Overwrite file")');
        check(await waitForLabel(r7, "Saved to file"), "resolved");
        check(!(await blocksClose()), "a document fully written to its file does not block closing");
        await r7ctx.close();
      }

      console.log("\n=== Stopping, and a declined permission ===");
      await clickChipButton(p, `Stop saving to ${FILE}`);
      check(await waitForLabel(p, "Saved in browser"), "stopping returns to browser-only");
      const beforeStop = await fileTitle(p, FILE);
      await setTitle(p, "After stop");
      await sleep(SAVE_WAIT);
      check((await fileTitle(p, FILE)) === beforeStop, "a stopped file is not written");

      await p.evaluate(() => localStorage.setItem("fake-permission", "granted"));
      await p.goto(`${app}?doc=declined`);
      await ready(p);
      await setTitle(p, "Declined doc");
      await clickChipButton(p, "Save to a file");
      check(await waitForLabel(p, "Saved to file"), "a second document attaches its own file");
      await p.evaluate(() => localStorage.setItem("fake-permission", "denied"));
      await p.reload();
      await ready(p);
      check(await waitForLabel(p, "Not saving to file"), "a declined permission says the file is not being saved");
      const declinedName = "declined-doc.json";
      const declinedBefore = await fileTitle(p, declinedName);
      await setTitle(p, "Edited while declined");
      await sleep(SAVE_WAIT);
      check((await fileTitle(p, declinedName)) === declinedBefore, "and nothing is written to it");
      check(/declined/.test(await chipDetail(p)), "the detail names the reason");
    } else {
      console.log("=== R1, R2, R4, R7, stop and declined: SKIPPED - this browser has no File System Access API ===");
    }

    console.log("\n=== R8: a browser that cannot write files ===");
    {
      const noAccess = await newContext({ noFileAccess: true });
      const q = await noAccess.newPage();
      await q.goto(`${app}?doc=nofiles`);
      await ready(q);
      await setTitle(q, "No files here");
      await sleep(SAVE_WAIT);
      const text = await chipDetail(q);
      check((await chipLabel(q)) === "Saved in browser", "reports browser storage");
      check(/cannot save to a file/.test(text), "says continuous file saving is not available");
      check((await q.locator('.durability__detail button:has-text("Save to a file")').count()) === 0, "never offers to save to a file");
      check((await q.locator('.durability__detail button:has-text("Export a copy")').count()) === 1, "offers an export instead");
      check(/timed copies/.test(text), "and points to timed copies");

      console.log("\n=== R6: timed copies ===");
      const openManager = async () => {
        await q.click('button[title="File"]');
        await q.click('.export-menu__dropdown button:has-text("Documents")');
        await q.waitForSelector(".document-manager__timed-copies");
      };
      await openManager();
      const explain = (await q.textContent(".document-manager__timed-copies-explain")) ?? "";
      check(
        (await q.textContent(".document-manager__timed-copies-state")) === "Off" && /download folder/.test(explain) && /only if it changed/.test(explain),
        "off by default, with what it will do explained before it is turned on"
      );
      await q.evaluate(() => localStorage.setItem("system-design-editor:timed-copies-test-seconds", "2"));
      await q.click(".document-manager__timed-copies-toggle");
      check((await q.textContent(".document-manager__timed-copies-state")) === "On", "turning it on is one click");
      await q.keyboard.press("Escape");
      const nextDownload = (timeout: number) => q.waitForEvent("download", { timeout }).then((d) => d, () => null);
      const first = await nextDownload(8000);
      const firstName = first?.suggestedFilename() ?? "";
      check(/^no-files-here-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/.test(firstName), `a timestamped copy is downloaded (${firstName})`);
      if (first) {
        const { readFileSync } = await import("fs");
        const saved = JSON.parse(readFileSync((await first.path()) ?? "", "utf8")) as { title: string };
        check(saved.title === "No files here", "holding the document");
      }
      check((await nextDownload(4500)) === null, "an unchanged document is not copied again");
      await setTitle(q, "No files here, edited");
      const second = await nextDownload(6000);
      check(!!second && second.suggestedFilename().startsWith("no-files-here-edited-"), "a change is copied at the next interval");
      await openManager();
      await q.click(".document-manager__timed-copies-toggle");
      await q.keyboard.press("Escape");
      await setTitle(q, "Edited after turning off");
      check((await nextDownload(4500)) === null, "turned off, nothing more is downloaded");
    }

    console.log("\n=== R3: an interrupted write leaves the previous file intact ===");
    const canWriteOpfs = await p.evaluate(
      () => typeof (globalThis as unknown as { FileSystemFileHandle?: { prototype: { createWritable?: unknown } } }).FileSystemFileHandle?.prototype.createWritable === "function"
    );
    if (!canWriteOpfs) console.log("  SKIPPED - this browser cannot write origin-private files from a page");
    else {
      const r3 = await ctx.newPage();
      await r3.goto(`${app}?doc=atomic`);
      await ready(r3);
      await r3.evaluate(async () => {
        const h = await (await navigator.storage.getDirectory()).getFileHandle("atomic.json", { create: true });
        const w = await h.createWritable();
        await w.write("complete version");
        await w.close();
        const partial = await h.createWritable();
        await partial.write("half-written n");
        // No close(): the tab dies here.
      });
      await r3.close();
      const after = await ctx.newPage();
      await after.goto(`${app}?doc=atomic`);
      await ready(after);
      check((await readFile(after, "atomic.json")) === "complete version", "the file still holds the last complete write");
      await after.close();
    }

    console.log("\n=== R11: the leave guard ===");
    if (BROWSER === "firefox") {
      // Informational: whether this browser can open a WebRTC data channel at
      // all, between two connections in one page.
      const rtc = await p
        .evaluate(async () => {
          if (typeof RTCPeerConnection !== "function") return "RTCPeerConnection is not available";
          const a = new RTCPeerConnection();
          const b = new RTCPeerConnection();
          a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate).catch(() => {});
          b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate).catch(() => {});
          const opened = new Promise<string>((resolve) => {
            b.ondatachannel = (e) => (e.channel.onopen = () => resolve("data channel opened"));
            setTimeout(() => resolve(`no data channel after 8s (ice: ${a.iceConnectionState}/${b.iceConnectionState})`), 8000);
          });
          a.createDataChannel("probe");
          await a.setLocalDescription(await a.createOffer());
          await b.setRemoteDescription(a.localDescription!);
          await b.setLocalDescription(await b.createAnswer());
          await a.setRemoteDescription(b.localDescription!);
          const result = await opened;
          a.close();
          b.close();
          return result;
        })
        .catch((e) => `probe failed: ${String(e).slice(0, 120)}`);
      console.log(`  INFO WebRTC in this Firefox: ${rtc}`);
    }
    {
      const hostCtx = await newContext();
      const host = await hostCtx.newPage();
      await host.goto(`${app}?doc=leaving`);
      await ready(host);
      await host.evaluate(`window.__PERF__.loadFixture("small")`);
      await host.click(".collab-panel__trigger");
      const toggle = host.locator(".collab-panel__settings-toggle");
      await toggle.waitFor();
      if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
      await host.fill("#collab-panel-signaling-url", servers.relayUrl);
      await host.click(".collab-panel__primary-action:not(.collab-panel__resume)");
      await sleep(500);
      await host.click(".collab-panel__trigger");
      await host.waitForSelector(".collab-panel__room-code");
      await host.click(".collab-panel__copy-button");
      await sleep(200);
      const link = await host.evaluate(() => (window as unknown as { __lastCopied?: string }).__lastCopied ?? "");
      await host.waitForSelector(".collab-panel__leave-button");
      await host.click(".collab-panel__leave-button");
      const warned = await host.waitForSelector(".leave-guard", { timeout: 3000 }).then(() => true, () => false);
      check(warned, "the only holder of a saved copy is warned");
      const guardText = (await host.textContent(".leave-guard")) ?? "";
      check(/only one here with a saved copy/.test(guardText) && /lost/.test(guardText), "the warning names the consequence");
      check((await host.locator(".leave-guard__export").count()) === 1, "and offers an export inline");
      await host.click(".leave-guard__stay");
      await sleep(200);
      check((await host.locator(".leave-guard").count()) === 0, "Stay keeps the session");
      await host.keyboard.press("Escape");

      const guestCtx = PEERS_SAME_CONTEXT ? hostCtx : await newContext();
      if (PEERS_SAME_CONTEXT) console.log("  (guest is a second tab in the host's browser context: BroadcastChannel, no WebRTC)");
      const guest = await guestCtx.newPage();
      await guest.goto(`${app}?doc=guest-local`);
      await ready(guest);
      await guest.click(".collab-panel__trigger");
      await guest.fill(".collab-panel__join-input", link);
      await guest.click(".collab-panel__join-button");
      // Connection first, then the count: if the peers never meet, the count
      // cannot arrive, and the failure should say which of the two it was.
      const connected = await guest
        .waitForFunction(() => document.querySelectorAll(".react-flow__node").length === 25, null, { timeout: 20000 })
        .then(() => true, () => false);
      check(connected, `the guest connects and sees the host's document (${await nodeCount(guest)} nodes)`);
      const counted = await host
        .waitForFunction(
          // Synchronous on purpose: a predicate returning a Promise counts as
          // truthy at once, which made this pass before the count changed.
          () => {
            const chip = document.querySelector(".durability__chip") as HTMLButtonElement | null;
            if (chip && chip.getAttribute("aria-expanded") !== "true") chip.click();
            return /2 people here have a saved copy/.test(document.querySelector(".durability__detail")?.textContent ?? "");
          },
          null,
          { timeout: 15000, polling: 500 }
        )
        .then(() => true, () => false);
      check(counted, "the host sees two saved copies once the guest joins (R10)");
      if (!counted) {
        const detailOf = async (page: Page) => {
          const chip = page.locator(".durability__chip");
          if ((await chip.getAttribute("aria-expanded")) !== "true") await chip.click().catch(() => {});
          // The saved-copy sentence comes last.
          return ((await page.textContent(".durability__detail").catch(() => "")) ?? "").slice(-110);
        };
        console.log(`  DIAGNOSTIC host detail: ${await detailOf(host)}`);
        console.log(`  DIAGNOSTIC guest detail: ${await detailOf(guest)}`);
        await host.click(".collab-panel__trigger").catch(() => {});
        const peers = await host.locator(".collab-panel__peer-name").allTextContents().catch(() => []);
        const relay = ((await host.textContent(".collab-panel__relay-status").catch(() => "")) ?? "").trim();
        console.log(`  DIAGNOSTIC host sees peers: [${peers.join(", ")}]; relay: ${relay || "unknown"}`);
        await host.keyboard.press("Escape").catch(() => {});
      }
      await host.click(".collab-panel__trigger");
      await host.click(".collab-panel__leave-button");
      await sleep(500);
      check((await host.locator(".leave-guard").count()) === 0, "with another saved copy present, leaving is not blocked");
      check((await host.locator(".collab-panel__room-code").count()) === 0, "and the host has left");
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
  console.log("\nAll file saving and leave guard checks passed.");
  process.exit(0);
}

run();
