import { readdirSync } from "fs";
import { join, relative, resolve } from "path";
import { spawnSync } from "child_process";

function findFiles(dir: string, pattern: RegExp): string[] {
  const results: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "dist" && entry.name !== ".git") {
        results.push(...findFiles(fullPath, pattern));
      }
    } else if (pattern.test(entry.name)) {
      results.push(fullPath);
    }
  }

  return results;
}

const rootDir = resolve(".");
const filterArg = process.argv.slice(2).find((arg) => !arg.startsWith("-"));

// Collect test and verification files
const testPattern = /\.(verify|test|spec)\.(ts|tsx|js|jsx|mjs)$/;
const srcFiles = findFiles(join(rootDir, "src"), testPattern);
const scriptFiles = findFiles(join(rootDir, "scripts"), /^verify-.*\.(ts|js)$/);
const rootTestFiles = findFiles(rootDir, /^test-.*\.(mjs|js|ts)$/);

let allTestFiles = [...srcFiles, ...scriptFiles, ...rootTestFiles].sort();

if (filterArg) {
  allTestFiles = allTestFiles.filter((f) => f.toLowerCase().includes(filterArg.toLowerCase()));
}

if (allTestFiles.length === 0) {
  console.log("No test files found matching criteria.");
  process.exit(0);
}

console.log(`\nRunning ${allTestFiles.length} test suite(s)...\n`);

/**
 * Failure lines the suites in this repo print. Anchored to the start of a
 * line and upper-case, so descriptive text such as "a failing provider ..."
 * does not match.
 */
const FAILURE_MARKERS = [/^\s*FAIL\b[:\s]/m, /^\s*\d+ FAILURE\(S\)/m, /^\s*\d+ assertion\(s\) failed/m, /^\s*\d+ check\(s\) failed/m];

let passedCount = 0;
let failedCount = 0;
const failedSuites: { file: string; output: string }[] = [];

for (const filePath of allTestFiles) {
  const relPath = relative(rootDir, filePath);
  const startTime = Date.now();

  const isTsxOrSrc = filePath.endsWith(".tsx") || relPath.startsWith("src");
  const args = isTsxOrSrc
    ? ["--tsconfig", "tsconfig.app.json", filePath]
    : [filePath];

  const result = spawnSync("npx", ["tsx", ...args], {
    cwd: rootDir,
    stdio: "pipe",
    encoding: "utf-8",
    shell: true,
  });

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  const combined = (result.stdout || "") + (result.stderr || "");
  // A suite that prints a failure but exits 0 still failed. Suites here use
  // hand-rolled assert helpers, and one that forgot to set an exit code hid
  // three failing assertions for weeks while this runner reported PASS.
  const reportedFailure = FAILURE_MARKERS.some((re) => re.test(combined));

  if (result.status === 0 && !reportedFailure) {
    passedCount++;
    console.log(` PASS  ${relPath} (${duration}s)`);
  } else {
    failedCount++;
    console.error(
      ` FAIL  ${relPath} (${duration}s)` +
        (result.status === 0 ? " - exited 0 but printed a failure; the suite must set a non-zero exit code" : "")
    );
    const output = (result.stdout || "") + (result.stderr || "");
    failedSuites.push({ file: relPath, output });
    if (output.trim()) {
      console.error(output.trim());
    }
  }
}

console.log("\n==================================================");
console.log(`Test Suites: ${passedCount} passed, ${failedCount} failed, ${allTestFiles.length} total`);
console.log("==================================================\n");

if (failedCount > 0) {
  console.error("Failed test summary:");
  for (const failed of failedSuites) {
    console.error(` - ${failed.file}`);
  }
  process.exit(1);
} else {
  console.log("All test suites passed successfully!\n");
  process.exit(0);
}
