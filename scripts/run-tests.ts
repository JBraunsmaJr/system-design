import { readdirSync, readFileSync } from 'fs';
import { availableParallelism } from 'os';
import { join, relative, resolve } from 'path';
import { spawn } from 'child_process';

function findFiles(dir: string, pattern: RegExp): string[] {
  const results: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== '.git') {
        results.push(...findFiles(fullPath, pattern));
      }
    } else if (pattern.test(entry.name)) {
      results.push(fullPath);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Arguments
//   npm test                    run everything, in parallel
//   npm test -- store           only suites whose path contains "store"
//   npm test -- --jobs=4        cap concurrency (also: -j 4, TEST_JOBS=4)
//   npm test -- --serial        one suite at a time, like the old runner
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
let jobsArg: string | undefined;
const positional: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--serial') jobsArg = '1';
  else if (arg.startsWith('--jobs=')) jobsArg = arg.slice('--jobs='.length);
  else if (arg === '--jobs' || arg === '-j') jobsArg = argv[++i];
  else if (!arg.startsWith('-')) positional.push(arg);
}
const filterArg = positional[0];

const cpuCount = availableParallelism();
const JOBS = Math.max(1, Number(jobsArg ?? process.env.TEST_JOBS ?? cpuCount) || cpuCount);
// Browser suites each start Vite + a relay + Chromium. Running many at once
// just thrashes the CPU and pushes them into their own timeouts.
const BROWSER_JOBS = Math.max(
  1,
  Math.min(JOBS, Number(process.env.TEST_BROWSER_JOBS ?? Math.ceil(cpuCount / 2)) || 1),
);

const rootDir = resolve('.');
// Call tsx's CLI with this same node binary: skips npx's package resolution
// and the extra shell, which cost ~300ms per suite.
const TSX_CLI = join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');

// Collect test and verification files
const testPattern = /\.(verify|test|spec)\.(ts|tsx|js|jsx|mjs)$/;
const srcFiles = findFiles(join(rootDir, 'src'), testPattern);
const scriptFiles = findFiles(join(rootDir, 'scripts'), /^verify-.*\.(ts|js)$/);
const rootTestFiles = findFiles(rootDir, /^test-.*\.(mjs|js|ts)$/);

let allTestFiles = [...srcFiles, ...scriptFiles, ...rootTestFiles].sort();

if (filterArg) {
  allTestFiles = allTestFiles.filter((f) => f.toLowerCase().includes(filterArg.toLowerCase()));
}

if (allTestFiles.length === 0) {
  console.log('No test files found matching criteria.');
  process.exit(0);
}

/**
 * Lanes limit how many suites of a kind run at once.
 * - browser: Playwright / Vite suites are heavy, so they get a smaller cap.
 * - postgres: these suites DELETE FROM shared tables, so against a real
 *   DATABASE_URL they must never overlap. Without one they skip in
 *   milliseconds, so serialising them costs nothing.
 */
type Lane = 'browser' | 'postgres';
const laneLimits: Record<Lane, number> = { browser: BROWSER_JOBS, postgres: 1 };

interface Suite {
  file: string;
  relPath: string;
  lanes: Lane[];
}

const suites: Suite[] = allTestFiles.map((file) => {
  const source = readFileSync(file, 'utf-8');
  const lanes: Lane[] = [];
  if (/from ['"]playwright['"]|startDevServers/.test(source)) lanes.push('browser');
  if (/DATABASE_URL/.test(source)) lanes.push('postgres');
  return { file, relPath: relative(rootDir, file), lanes };
});

// Start the slow browser suites first so they are not the long tail at the end.
suites.sort((a, b) => Number(b.lanes.includes('browser')) - Number(a.lanes.includes('browser')));

console.log(
  `\nRunning ${suites.length} test suite(s) with up to ${JOBS} in parallel` +
    ` (${BROWSER_JOBS} browser)...\n`,
);

/**
 * Failure lines the suites in this repo print. Anchored to the start of a
 * line and upper-case, so descriptive text such as "a failing provider ..."
 * does not match.
 */
const FAILURE_MARKERS = [
  /^\s*FAIL\b[:\s]/m,
  /^\s*\d+ FAILURE\(S\)/m,
  /^\s*\d+ assertion\(s\) failed/m,
  /^\s*\d+ check\(s\) failed/m,
];

interface Result {
  suite: Suite;
  passed: boolean;
  exitedZero: boolean;
  output: string;
  duration: number;
}

function runSuite(suite: Suite): Promise<Result> {
  const startTime = Date.now();
  const isTsxOrSrc = suite.file.endsWith('.tsx') || suite.relPath.startsWith('src');
  const args = isTsxOrSrc ? ['--tsconfig', 'tsconfig.app.json', suite.file] : [suite.file];

  return new Promise((resolveResult) => {
    const child = spawn(process.execPath, [TSX_CLI, ...args], {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf-8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf-8').on('data', (d: string) => (stderr += d));

    const finish = (code: number | null, errorText = '') => {
      const output = stdout + stderr + errorText;
      // A suite that prints a failure but exits 0 still failed. Suites here use
      // hand-rolled assert helpers, and one that forgot to set an exit code hid
      // three failing assertions for weeks while this runner reported PASS.
      const reportedFailure = FAILURE_MARKERS.some((re) => re.test(output));
      resolveResult({
        suite,
        passed: code === 0 && !reportedFailure,
        exitedZero: code === 0,
        output,
        duration: (Date.now() - startTime) / 1000,
      });
    };
    child.once('error', (err) => finish(1, String(err)));
    child.once('close', (code) => finish(code));
  });
}

// ---------------------------------------------------------------------------
// Scheduler: start any pending suite whose lanes have room, up to JOBS total.
// ---------------------------------------------------------------------------
const pending = [...suites];
const laneInUse: Record<Lane, number> = { browser: 0, postgres: 0 };
let running = 0;
const results: Result[] = [];
const wallStart = Date.now();

await new Promise<void>((done) => {
  const pump = () => {
    if (pending.length === 0 && running === 0) return done();
    for (let i = 0; i < pending.length && running < JOBS;) {
      const suite = pending[i];
      if (suite.lanes.some((lane) => laneInUse[lane] >= laneLimits[lane])) {
        i++;
        continue;
      }
      pending.splice(i, 1);
      running++;
      for (const lane of suite.lanes) laneInUse[lane]++;
      void runSuite(suite).then((result) => {
        running--;
        for (const lane of suite.lanes) laneInUse[lane]--;
        results.push(result);
        report(result);
        pump();
      });
    }
  };
  pump();
});

function report(result: Result) {
  const line = `${result.suite.relPath} (${result.duration.toFixed(2)}s)`;
  if (result.passed) {
    console.log(` PASS  ${line}`);
  } else {
    console.error(
      ` FAIL  ${line}` +
        (result.exitedZero
          ? ' - exited 0 but printed a failure; the suite must set a non-zero exit code'
          : ''),
    );
  }
}

const failed = results
  .filter((r) => !r.passed)
  .sort((a, b) => a.suite.relPath.localeCompare(b.suite.relPath));
const passedCount = results.length - failed.length;

// Failure output is printed here rather than as each suite finishes, so
// output from suites running side by side never interleaves.
for (const f of failed) {
  if (!f.output.trim()) continue;
  console.error(`\n--- ${f.suite.relPath} ---`);
  console.error(f.output.trim());
}

const slowest = [...results].sort((a, b) => b.duration - a.duration).slice(0, 5);
console.log('\nSlowest suites:');
for (const r of slowest) console.log(`  ${r.duration.toFixed(2)}s  ${r.suite.relPath}`);

console.log('\n==================================================');
console.log(
  `Test Suites: ${passedCount} passed, ${failed.length} failed, ${results.length} total` +
    ` in ${((Date.now() - wallStart) / 1000).toFixed(1)}s`,
);
console.log('==================================================\n');

if (failed.length > 0) {
  console.error('Failed test summary:');
  for (const f of failed) console.error(` - ${f.suite.relPath}`);
  process.exit(1);
} else {
  console.log('All test suites passed successfully!\n');
  process.exit(0);
}
