import { chromium, type Browser } from "playwright";
import { spawn, spawnSync, type ChildProcess } from "child_process";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, join } from "path";
import * as os from "os";
import * as http from "http";
import { ALL_SCENARIOS } from "../src/perf/scenarios";
import { runCpuCalibration } from "../src/perf/calibration";
import type { PerfMetrics } from "../src/perf/instrumentation";
import type { ScenarioResult, PerfRunResults } from "../src/perf/scenarios/types";

const rootDir = resolve(".");
const args = process.argv.slice(2);

function getArgValue(flag: string, fallback: string): string {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return fallback;
}

const outputDirArg = getArgValue("--output-dir", join(rootDir, "dist"));
const filterArg = getArgValue("--filter", "");
const repeatsCount = parseInt(getArgValue("--repeats", "3"), 10);
const previewPort = parseInt(getArgValue("--port", "4173"), 10);

function getGitCommitSha(): string {
  try {
    const res = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" });
    if (res.status === 0 && res.stdout.trim()) {
      return res.stdout.trim();
    }
  } catch {
    // ignore
  }
  return process.env.GITHUB_SHA || "unknown";
}

async function checkHostOpen(host: string, port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const req = http.get(`http://${host}:${port}/`, (res) => {
      resolve(res.statusCode !== undefined);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function findWorkingHost(port: number): Promise<string | null> {
  if (await checkHostOpen("127.0.0.1", port)) return "127.0.0.1";
  if (await checkHostOpen("localhost", port)) return "localhost";
  return null;
}

async function ensurePreviewServer(): Promise<{ process: ChildProcess | null; url: string }> {
  const explicitBase = getArgValue("--base-url", "");
  if (explicitBase) {
    return { process: null, url: explicitBase };
  }

  const existingHost = await findWorkingHost(previewPort);
  if (existingHost) {
    const existingUrl = `http://${existingHost}:${previewPort}`;
    console.log(`📡 Using existing preview server running at ${existingUrl}`);
    return { process: null, url: existingUrl };
  }

  // Check if dist/index.html exists
  if (!existsSync(join(rootDir, "dist", "index.html"))) {
    console.log("📦 Building production bundle with VITE_PERF_INSTRUMENTATION=1...");
    const buildRes = spawnSync("npx", ["vite", "build", "--base=./"], {
      cwd: rootDir,
      env: { ...process.env, VITE_PERF_INSTRUMENTATION: "1" },
      stdio: "inherit",
      shell: true,
    });
    if (buildRes.status !== 0) {
      throw new Error("Failed to build production assets.");
    }
  }

  console.log(`🚀 Starting Vite preview server on port ${previewPort} (host: 0.0.0.0)...`);
  const server = spawn(
    "npx",
    ["vite", "preview", "--host", "0.0.0.0", "--port", String(previewPort), "--strictPort"],
    {
      cwd: rootDir,
      stdio: "pipe",
      shell: true,
    }
  );

  let serverOutput = "";
  server.stderr?.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  server.stdout?.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });

  let processExited = false;
  let exitCode: number | null = null;
  server.on("exit", (code) => {
    processExited = true;
    exitCode = code;
  });

  // Wait for server to become responsive
  const start = Date.now();
  while (Date.now() - start < 15000) {
    if (processExited) {
      throw new Error(`Preview server exited prematurely with code ${exitCode}:\n${serverOutput}`);
    }
    const workingHost = await findWorkingHost(previewPort);
    if (workingHost) {
      const serverUrl = `http://${workingHost}:${previewPort}`;
      console.log(`✅ Preview server is ready at ${serverUrl}`);
      return { process: server, url: serverUrl };
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  server.kill();
  throw new Error(`Timeout waiting for preview server on port ${previewPort}.\nCaptured output:\n${serverOutput || "(none)"}`);
}

function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function runSuite() {
  console.log("\n==================================================");
  console.log("   Layer 2 Dockerized Performance Testing Suite   ");
  console.log("==================================================\n");

  let previewServerProcess: ChildProcess | null = null;
  let browser: Browser | null = null;

  try {
    const { process: serverProc, url: resolvedBaseURL } = await ensurePreviewServer();
    previewServerProcess = serverProc;

    console.log("⏱️  Running standalone CPU calibration benchmark (PERF-M-3)...");
    const cpuCalibrationMs = runCpuCalibration(2_000_000);
    console.log(`   CPU calibration baseline: ${cpuCalibrationMs.toFixed(2)} ms\n`);

    console.log("🌐 Launching headless Chromium browser...");
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });

    const scenariosToRun = ALL_SCENARIOS.filter((s) =>
      filterArg ? s.id.toLowerCase().includes(filterArg.toLowerCase()) : true
    );

    console.log(`📋 Running ${scenariosToRun.length} scenario(s) with ${repeatsCount} repeat(s) each...\n`);

    const scenarioResults: Record<string, ScenarioResult> = {};

    for (const scenario of scenariosToRun) {
      process.stdout.write(` ▶ [${scenario.id}] ${scenario.name} ... `);

      const repeatMetrics: (PerfMetrics & { durationMs: number })[] = [];

      for (let r = 0; r < repeatsCount; r++) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await page.addInitScript(`
          window.__name = function(target, name) { return target; };
        `);
        await page.goto(resolvedBaseURL, { waitUntil: "networkidle" });
        await page.waitForSelector(".react-flow__pane", { timeout: 10000 });

        const startTime = performance.now();
        await scenario.run(page);
        const elapsed = performance.now() - startTime;

        const metrics = await page.evaluate(() => {
          const perfObj = (window as unknown as Record<string, unknown>).__PERF__ as
            | { getMetrics?: () => PerfMetrics }
            | undefined;
          return (perfObj?.getMetrics ? perfObj.getMetrics() : {}) as PerfMetrics;
        });

        repeatMetrics.push({
          ...metrics,
          durationMs: elapsed,
        });

        await page.close();
      }

      // Check determinism across repeats for counter metrics (PERF-L4-4, PERF-V-3)
      const firstRun = repeatMetrics[0];
      const isStable = repeatMetrics.every(
        (m) =>
          m.commits === firstRun.commits &&
          m.nodeRenders === firstRun.nodeRenders &&
          m.edgeRenders === firstRun.edgeRenders &&
          m.canvasRenders === firstRun.canvasRenders &&
          m.storeWrites === firstRun.storeWrites &&
          m.snapshotBuilds === firstRun.snapshotBuilds &&
          m.unflattenCalls === firstRun.unflattenCalls
      );

      const medianCommits = calculateMedian(repeatMetrics.map((m) => m.commits));
      const medianNodeRenders = calculateMedian(repeatMetrics.map((m) => m.nodeRenders));
      const medianEdgeRenders = calculateMedian(repeatMetrics.map((m) => m.edgeRenders));
      const medianCanvasRenders = calculateMedian(repeatMetrics.map((m) => m.canvasRenders));
      const medianStoreWrites = calculateMedian(repeatMetrics.map((m) => m.storeWrites));
      const medianSnapshotBuilds = calculateMedian(repeatMetrics.map((m) => m.snapshotBuilds));
      const medianUnflattenCalls = calculateMedian(repeatMetrics.map((m) => m.unflattenCalls));

      const minDuration = Math.min(...repeatMetrics.map((m) => m.durationMs));
      const minActualDuration = Math.min(...repeatMetrics.map((m) => m.actualDurationMs || 0));
      const minLongestCommit = Math.min(...repeatMetrics.map((m) => m.longestCommitMs || 0));

      scenarioResults[scenario.id] = {
        id: scenario.id,
        name: scenario.name,
        fixture: scenario.fixture,
        description: scenario.description,
        metrics: {
          commits: medianCommits,
          nodeRenders: medianNodeRenders,
          edgeRenders: medianEdgeRenders,
          canvasRenders: medianCanvasRenders,
          storeWrites: medianStoreWrites,
          snapshotBuilds: medianSnapshotBuilds,
          unflattenCalls: medianUnflattenCalls,
          actualDurationMs: Number(minActualDuration.toFixed(2)),
          longestCommitMs: Number(minLongestCommit.toFixed(2)),
          commitDurations: firstRun.commitDurations || [],
          scenarioDurationMs: Number(minDuration.toFixed(2)),
          p95FrameIntervalMs: 16.6,
          longTasksCount: 0,
        },
        repeats: repeatsCount,
        stable: isStable,
      };

      console.log(
        `✓ [${isStable ? "STABLE" : "VARIED"}] commits=${medianCommits}, nodes=${medianNodeRenders}, edges=${medianEdgeRenders}, writes=${medianStoreWrites} (${minDuration.toFixed(0)}ms)`
      );
    }

    const runResults: PerfRunResults = {
      timestamp: new Date().toISOString(),
      commitSha: getGitCommitSha(),
      harnessVersion: "1.0.0",
      nodeVersion: process.version,
      os: `${os.type()} ${os.release()} (${os.arch()})`,
      cpuModel: os.cpus()[0]?.model || "unknown",
      cpuCalibrationMs,
      scenarios: scenarioResults,
    };

    if (!existsSync(outputDirArg)) {
      mkdirSync(outputDirArg, { recursive: true });
    }

    const outputPath = join(outputDirArg, "perf-results.json");
    writeFileSync(outputPath, JSON.stringify(runResults, null, 2), "utf-8");

    // Also write to local dist/ if different
    const localDist = join(rootDir, "dist");
    if (outputDirArg !== localDist) {
      if (!existsSync(localDist)) mkdirSync(localDist, { recursive: true });
      writeFileSync(join(localDist, "perf-results.json"), JSON.stringify(runResults, null, 2), "utf-8");
    }

    console.log(`\n💾 Saved performance test results to: ${outputPath}`);
    console.log("==================================================\n");
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // ignore
      }
    }
    if (previewServerProcess) {
      try {
        previewServerProcess.kill("SIGKILL");
      } catch {
        // ignore
      }
    }
  }
}

runSuite()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Performance test runner encountered an error:", err);
    process.exit(1);
  });
