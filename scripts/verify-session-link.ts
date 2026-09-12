import { chromium } from "playwright";
import { spawn } from "child_process";
import { connect } from "net";

const SIGNALING_PORT = 14447;
const VITE_PORT = 5180;

function tryConnect(host: string, port: number): Promise<boolean> {
  return new Promise<boolean>((res) => {
    const socket = connect({ host, port });
    socket.setTimeout(1000);
    const done = (ok: boolean) => { socket.destroy(); res(ok); };
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

/**
 * Resolves once something is accepting connections on `port`, or throws after
 * `timeoutMs`.
 *
 * Probes IPv4 and IPv6 loopback separately and accepts either. Vite binds to
 * whatever "localhost" resolves to first, which is ::1 on GitHub Actions
 * runners and 127.0.0.1 on most dev machines - checking only one family makes
 * this hang for the full timeout against a server that is already up.
 */
async function waitForPort(port: number, timeoutMs = 60000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const results = await Promise.all([tryConnect("127.0.0.1", port), tryConnect("::1", port)]);
    if (results.some(Boolean)) return;
    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for port ${port} on either 127.0.0.1 or ::1`);
    }
    await new Promise((res) => setTimeout(res, 250));
  }
}

async function run() {
  console.log("Starting local signaling server and vite server...");
  const signalingServer = spawn("node", ["node_modules/y-webrtc/bin/server.js"], {
    env: { ...process.env, PORT: String(SIGNALING_PORT) },
  });
  signalingServer.stdout?.on("data", (d) => process.stdout.write(`[signaling] ${d}`));
  signalingServer.stderr?.on("data", (d) => process.stderr.write(`[signaling] ${d}`));

  // VITE_PERF_INSTRUMENTATION=1 is what defines window.__PERF__ (see
  // src/perf/instrumentation.ts). Without it loadFixture() silently no-ops and
  // the canvas stays empty, so the sync assertions below fail for the wrong
  // reason. Do not rely on a local .env for this - it is gitignored.
  const viteServer = spawn("npx", ["vite", "--port", String(VITE_PORT), "--strictPort"], {
    shell: true,
    env: { ...process.env, VITE_PERF_INSTRUMENTATION: "1" },
  });
  viteServer.stdout?.on("data", (d) => process.stdout.write(`[vite] ${d}`));
  viteServer.stderr?.on("data", (d) => process.stderr.write(`[vite] ${d}`));

  await Promise.all([waitForPort(SIGNALING_PORT), waitForPort(VITE_PORT)]);
  console.log(`Signaling server on :${SIGNALING_PORT}, vite on :${VITE_PORT}`);

  const browser = await chromium.launch({ headless: true });
  const context1 = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const context2 = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const context3 = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });

  try {
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    const page3 = await context3.newPage();

    // 1. Page 1 loads diagram and configures relay
    console.log("Loading page 1...");
    await page1.goto(`http://localhost:${VITE_PORT}`);
    await page1.waitForSelector(".collab-panel__trigger");
    // Fail loudly rather than letting optional chaining swallow a missing harness.
    await page1.waitForFunction("typeof window.__PERF__?.loadFixture === 'function'", null, { timeout: 15000 });
    await page1.evaluate(`window.__PERF__.loadFixture("small");`);
    await new Promise((res) => setTimeout(res, 200));

    // Open collab panel and start session on custom relay
    await page1.click(".collab-panel__trigger");
    // The Settings section starts EXPANDED when no relay is configured and
    // COLLAPSED when one is (CollabPanel.tsx: useState(() => !signalingConfigured)).
    // A dev machine with VITE_SIGNALING_URL in a local .env gets the collapsed
    // case, CI gets the expanded one - so a blind click opens it locally and
    // closes it on CI. Drive it to the state we need instead of toggling.
    const settingsToggle = page1.locator(".collab-panel__settings-toggle");
    await settingsToggle.waitFor();
    if ((await settingsToggle.getAttribute("aria-expanded")) !== "true") {
      await settingsToggle.click();
    }
    await page1.waitForSelector("#collab-panel-signaling-url", { timeout: 10000 });

    await page1.fill("#collab-panel-signaling-url", `ws://localhost:${SIGNALING_PORT}`);
    await page1.click(".collab-panel__primary-action");

    // Open collab panel on page 1 to check active session
    await page1.click(".collab-panel__trigger");
    await page1.waitForSelector(".collab-panel__room-code");

    // Click copy button on page 1
    await page1.click(".collab-panel__copy-button");
    await new Promise((res) => setTimeout(res, 200));

    // Verify toast notification appeared on page 1
    const toastVisible = await page1.waitForSelector(".app-toast", { timeout: 2000 }).then(() => true).catch(() => false);
    if (!toastVisible) {
      throw new Error("Toast notification did not appear after copying session link");
    }

    // Read clipboard text from page 1
    const copiedLink = await page1.evaluate(() => navigator.clipboard.readText());
    console.log("Copied link from page 1:", copiedLink);

    if (!copiedLink.includes("session=") || !copiedLink.includes("key=") || !copiedLink.includes("relay=")) {
      throw new Error(`Copied link did not contain expected parameters: ${copiedLink}`);
    }

    // 2. Page 2 joins by pasting the copied link directly into the join input
    console.log("Loading page 2 and joining via pasted link...");
    await page2.goto(`http://localhost:${VITE_PORT}`);
    await page2.waitForSelector(".collab-panel__trigger");

    await page2.click(".collab-panel__trigger");
    await page2.fill(".collab-panel__join-input", copiedLink);
    await page2.click(".collab-panel__join-button");

    // Wait for peer sync
    await new Promise((res) => setTimeout(res, 2500));

    const nodesCount1 = await page1.$$eval(".react-flow__node", (els) => els.length);
    const nodesCount2 = await page2.$$eval(".react-flow__node", (els) => els.length);

    console.log(`Node counts after Page 2 joins: Page1=${nodesCount1}, Page2=${nodesCount2}`);
    if (nodesCount1 !== nodesCount2 || nodesCount2 === 0) {
      throw new Error(`Sync failed between Page 1 and Page 2: Page1=${nodesCount1}, Page2=${nodesCount2}`);
    }

    // Verify Page 2 (joiner) can copy the exact SAME share link
    await page2.click(".collab-panel__trigger");
    await page2.waitForSelector(".collab-panel__room-code");
    await page2.click(".collab-panel__copy-button");
    await new Promise((res) => setTimeout(res, 200));
    const copiedLinkPage2 = await page2.evaluate(() => navigator.clipboard.readText());
    console.log("Copied link from page 2 (joiner):", copiedLinkPage2);

    if (copiedLinkPage2 !== copiedLink) {
      throw new Error(`Link copied by participant (Page 2) differs from host (Page 1): ${copiedLinkPage2} vs ${copiedLink}`);
    }

    // 3. Page 3 joins directly by navigating to the URL shared by Page 2
    console.log("Loading page 3 directly with link URL shared by Page 2...", copiedLinkPage2);
    page3.on("console", (msg) => console.log("Page 3 console:", msg.text()));
    await page3.goto(copiedLinkPage2);
    await page3.waitForSelector(".collab-panel__trigger");

    // Verify toast notification appeared on page 3 indicating auto-join
    const page3Toast = await page3.waitForSelector(".app-toast", { timeout: 2000 }).then(() => true).catch(() => false);
    if (!page3Toast) {
      throw new Error("Toast notification did not appear on page 3 after joining via direct link");
    }

    // Verify page 3 address bar URL was sanitized to avoid exposing credentials to live streams
    const page3Url = page3.url();
    console.log("Page 3 sanitized address bar URL:", page3Url);
    if (page3Url.includes("session=") || page3Url.includes("key=") || page3Url.includes("relay=") || page3Url.includes("#")) {
      throw new Error(`Page 3 address bar was not sanitized: ${page3Url}`);
    }

    // Wait for peer sync
    await new Promise((res) => setTimeout(res, 4000));
    const nodesCount3 = await page3.$$eval(".react-flow__node", (els) => els.length);

    console.log(`Node counts after Page 3 joins via URL: Page1=${nodesCount1}, Page3=${nodesCount3}`);
    if (nodesCount1 !== nodesCount3 || nodesCount3 === 0) {
      throw new Error(`Sync failed for Page 3: Page1=${nodesCount1}, Page3=${nodesCount3}`);
    }

    console.log("\nALL VERIFICATION STEPS PASSED SUCCESSFULLY!");
  } catch (err) {
    console.error("Verification failed with error:", err);
    process.exitCode = 1;
  } finally {
    await browser.close();
    viteServer.kill();
    signalingServer.kill();
    process.exit(process.exitCode || 0);
  }
}

run();
