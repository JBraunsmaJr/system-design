import { chromium } from "playwright";
import { spawn } from "child_process";

async function run() {
  console.log("Starting local signaling server and vite server...");
  const signalingServer = spawn("node", ["node_modules/y-webrtc/bin/server.js"], {
    env: { ...process.env, PORT: "14447" },
  });

  const viteServer = spawn("npx", ["vite", "--port", "5180"], {
    shell: true,
  });

  await new Promise((res) => setTimeout(res, 2000));

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
    await page1.goto("http://localhost:5180");
    await page1.waitForSelector(".collab-panel__trigger");
    await page1.evaluate(`window.__PERF__?.loadFixture?.("small");`);
    await new Promise((res) => setTimeout(res, 200));

    // Open collab panel and start session on custom relay
    await page1.click(".collab-panel__trigger");
    await page1.click(".collab-panel__settings-toggle");
    await page1.fill("#collab-panel-signaling-url", "ws://localhost:14447");
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
    await page2.goto("http://localhost:5180");
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
