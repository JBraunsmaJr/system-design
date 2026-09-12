import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, join } from "path";
import type { PerfRunResults, ScenarioResult } from "../src/perf/scenarios/types";

const rootDir = resolve(".");
const args = process.argv.slice(2);

function getArgValue(flag: string, fallback: string): string {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return fallback;
}

const resultsPath = resolve(getArgValue("--results", join(rootDir, "dist", "perf-results.json")));
const baselinePath = resolve(getArgValue("--baseline", join(rootDir, "baselines", "perf-baseline.json")));
const recordPath = args.includes("--record")
  ? resolve(getArgValue("--record", join(rootDir, "baselines", "perf-baseline.json")))
  : null;
const markdownPath = args.includes("--markdown")
  ? resolve(getArgValue("--markdown", join(rootDir, "dist", "perf-summary.md")))
  : null;

const GATING_COUNTERS: (keyof ScenarioResult["metrics"])[] = [
  "commits",
  "nodeRenders",
  "edgeRenders",
  "canvasRenders",
  "storeWrites",
  "snapshotBuilds",
  "unflattenCalls",
];

const REQUIREMENT_MAPPING: Record<string, string> = {
  "idle": "PERF-S-1 (idle)",
  "drag-node": "PERF-S-1 (drag-node) / PERF-V-1",
  "drag-hub-node": "PERF-S-1 (drag-hub-node)",
  "drag-group": "PERF-S-1 (drag-group)",
  "marquee-select": "PERF-S-1 (marquee-select)",
  "pan": "PERF-S-1 (pan)",
  "zoom": "PERF-S-1 (zoom)",
  "drag-waypoint": "PERF-S-1 (drag-waypoint) / PERF-V-1",
  "create-waypoint": "PERF-S-1 (create-waypoint)",
  "reconnect-edge": "PERF-S-1 (reconnect-edge)",
  "drill-in-out": "PERF-S-1 (drill-in-out)",
  "remote-burst": "PERF-S-1 (remote-burst) / PERF-S-2",
  "remote-during-drag": "PERF-S-1 (remote-during-drag) / PERF-S-2",
};

interface MetricEvaluation {
  scenarioId: string;
  metric: string;
  baseline: number;
  measured: number;
  delta: number;
  pctDelta: number;
  gating: boolean;
  passed: boolean;
  improvement: boolean;
  requirementId: string;
}

function evaluateGate(
  results: PerfRunResults,
  baseline: PerfRunResults
): { evaluations: MetricEvaluation[]; failedCount: number; passedCount: number } {
  const evaluations: MetricEvaluation[] = [];
  let failedCount = 0;
  let passedCount = 0;

  for (const [id, scenario] of Object.entries(results.scenarios)) {
    const baseScenario = baseline.scenarios[id];
    const requirementId = REQUIREMENT_MAPPING[id] || "PERF-S-1";

    if (!baseScenario) {
      console.warn(`⚠️ No baseline found for scenario [${id}] - reporting as un-gated.`);
      continue;
    }

    for (const metric of GATING_COUNTERS) {
      const measured = (scenario.metrics[metric] as number) ?? 0;
      const baseVal = (baseScenario.metrics[metric] as number) ?? 0;
      const delta = measured - baseVal;
      const pctDelta = baseVal === 0 ? (measured === 0 ? 0 : 100) : (delta / baseVal) * 100;

      // Threshold: > 10% or > 2 absolute increase fails (PERF-L3-2)
      const maxAllowedIncrease = Math.max(2, baseVal * 0.1);
      const isFailed = delta > maxAllowedIncrease;
      const isImprovement = delta < -maxAllowedIncrease;

      if (isFailed) {
        failedCount++;
      } else {
        passedCount++;
      }

      evaluations.push({
        scenarioId: id,
        metric,
        baseline: baseVal,
        measured,
        delta,
        pctDelta,
        gating: true,
        passed: !isFailed,
        improvement: isImprovement,
        requirementId,
      });
    }
  }

  return { evaluations, failedCount, passedCount };
}

function formatMarkdownTable(
  results: PerfRunResults,
  evaluations: MetricEvaluation[],
  failedCount: number
): string {
  let md = `## 📊 Diagram Render Performance Report\n\n`;
  md += `**Commit**: \`${results.commitSha.slice(0, 8)}\` | **Runner OS**: ${results.os} | **CPU Calibration**: ${results.cpuCalibrationMs}ms\n\n`;

  if (failedCount > 0) {
    md += `> ❌ **PERFORMANCE REGRESSION DETECTED**: ${failedCount} counter metric(s) exceeded the gating tolerance (+10% or +2 absolute).\n\n`;
  } else {
    md += `> ✅ **ALL PERFORMANCE GATES PASSED**: Render and mutation counters are within baseline thresholds.\n\n`;
  }

  md += `| Scenario | Metric | Baseline | Measured | Delta | Status | Requirement |\n`;
  md += `| :--- | :--- | :---: | :---: | :---: | :---: | :--- |\n`;

  for (const ev of evaluations) {
    const statusPill = ev.passed
      ? ev.improvement
        ? "🟢 Improvement"
        : "✅ Pass"
      : "🔴 FAIL";
    const deltaStr = ev.delta > 0 ? `+${ev.delta} (+${ev.pctDelta.toFixed(1)}%)` : `${ev.delta} (${ev.pctDelta.toFixed(1)}%)`;

    md += `| \`${ev.scenarioId}\` | \`${ev.metric}\` | ${ev.baseline} | ${ev.measured} | ${deltaStr} | ${statusPill} | \`${ev.requirementId}\` |\n`;
  }

  return md;
}

function main() {
  if (!existsSync(resultsPath)) {
    console.error(`❌ Performance results file not found at: ${resultsPath}`);
    console.error("   Run `npm run test:perf` or `npm run test:perf:local` first.");
    process.exit(1);
  }

  const results: PerfRunResults = JSON.parse(readFileSync(resultsPath, "utf-8"));

  if (recordPath) {
    const baselineDir = resolve(recordPath, "..");
    if (!existsSync(baselineDir)) mkdirSync(baselineDir, { recursive: true });
    writeFileSync(recordPath, JSON.stringify(results, null, 2), "utf-8");
    console.log(`\n📝 Recorded fresh baseline to: ${recordPath}\n`);
    process.exit(0);
  }

  if (!existsSync(baselinePath)) {
    console.warn(`⚠️ Baseline file not found at: ${baselinePath}`);
    console.warn("   Recording current results as initial baseline...");
    const baselineDir = resolve(baselinePath, "..");
    if (!existsSync(baselineDir)) mkdirSync(baselineDir, { recursive: true });
    writeFileSync(baselinePath, JSON.stringify(results, null, 2), "utf-8");
    console.log(`📝 Created initial baseline at: ${baselinePath}\n`);
    process.exit(0);
  }

  const baseline: PerfRunResults = JSON.parse(readFileSync(baselinePath, "utf-8"));
  const { evaluations, failedCount, passedCount } = evaluateGate(results, baseline);

  console.log("\n==================================================");
  console.log("       Layer 3 Performance Baseline Gating        ");
  console.log("==================================================\n");

  for (const ev of evaluations) {
    if (!ev.passed) {
      console.error(
        ` ❌ FAIL: [${ev.scenarioId}] ${ev.metric}: ${ev.measured} (baseline ${ev.baseline}, delta +${ev.delta} / +${ev.pctDelta.toFixed(1)}%) -> ${ev.requirementId}`
      );
    } else if (ev.improvement) {
      console.log(
        ` 🟢 IMPROVEMENT: [${ev.scenarioId}] ${ev.metric}: ${ev.measured} (baseline ${ev.baseline}, delta ${ev.delta} / ${ev.pctDelta.toFixed(1)}%)`
      );
    }
  }

  console.log("\n==================================================");
  console.log(`Gating Evaluation: ${passedCount} metrics passed, ${failedCount} failed`);
  console.log("==================================================\n");

  if (markdownPath) {
    const mdTable = formatMarkdownTable(results, evaluations, failedCount);
    writeFileSync(markdownPath, mdTable, "utf-8");
    console.log(`📄 Markdown PR summary written to: ${markdownPath}`);
  }

  if (failedCount > 0) {
    console.error("🚫 Performance gate failed. One or more counter metrics exceeded allowable tolerance.");
    process.exit(1);
  } else {
    console.log("🎉 Performance gate passed successfully!");
    process.exit(0);
  }
}

main();
