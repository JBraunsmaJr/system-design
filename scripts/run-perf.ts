import { spawnSync, spawn } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { resolve, join } from "path";

const rootDir = resolve(".");
const distDir = join(rootDir, "dist");

const args = process.argv.slice(2);
const isLocal = args.includes("--local");
const forwardedArgs = args.filter((a) => a !== "--local");

if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

function runLocal(extraArgs: string[] = []) {
  console.log("\n🚀 Running performance test harness locally against production build...\n");
  const child = spawn("npx", ["tsx", "scripts/execute-perf-suite.ts", ...extraArgs], {
    cwd: rootDir,
    stdio: "inherit",
    shell: true,
  });

  child.on("exit", (code) => {
    process.exit(code ?? 1);
  });
}

function runDocker() {
  console.log("\n🐳 Running performance test harness inside Docker container (PERF-L2-7)...\n");

  const dockerCheck = spawnSync("docker", ["--version"], { encoding: "utf-8", shell: true });
  if (dockerCheck.status !== 0) {
    console.warn("⚠️  Docker not detected or daemon not running. Falling back to local execution.");
    runLocal(forwardedArgs);
    return;
  }

  console.log("🔨 Building hermetic performance test container image (system-design-perf)...");
  const buildResult = spawnSync(
    "docker",
    ["build", "-f", "docker/perf/Dockerfile", "-t", "system-design-perf", "."],
    { cwd: rootDir, stdio: "inherit", shell: true }
  );

  if (buildResult.status !== 0) {
    console.error("❌ Failed to build Docker performance image.");
    process.exit(buildResult.status ?? 1);
  }

  console.log("\n▶️  Executing Playwright scenarios inside container...");
  const volumeMount = `${distDir.replace(/\\/g, "/")}:/app/perf-output`;
  const runResult = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      volumeMount,
      "system-design-perf",
      "npx",
      "tsx",
      "scripts/execute-perf-suite.ts",
      "--output-dir",
      "/app/perf-output",
      ...forwardedArgs,
    ],
    { cwd: rootDir, stdio: "inherit", shell: true }
  );

  // If container wrote results to /app/perf-output/perf-results.json, it will be at dist/perf-results.json
  const mountedResult = join(distDir, "perf-results.json");
  if (existsSync(mountedResult)) {
    console.log(`\n✅ Container test execution finished. Results saved to ${mountedResult}`);
  }

  process.exit(runResult.status ?? 0);
}

if (isLocal) {
  runLocal(forwardedArgs);
} else {
  runDocker();
}
