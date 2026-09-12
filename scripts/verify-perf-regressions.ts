import { readFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import type { PerfRunResults } from "../src/perf/scenarios/types";
import { evaluateGate } from "./perf-gate";

const rootDir = resolve(".");
const baselinePath = resolve(join(rootDir, "baselines", "perf-baseline.json"));

if (!existsSync(baselinePath)) {
  console.error("❌ Baseline file not found at:", baselinePath);
  process.exit(1);
}

const baseline: PerfRunResults = JSON.parse(readFileSync(baselinePath, "utf-8"));

interface RegressionSimulation {
  id: string;
  name: string;
  targetScenario: string;
  metric: keyof PerfRunResults["scenarios"][string]["metrics"];
  expectedSpikeDelta: number;
  requirementId: string;
}

const REFERENCE_REGRESSIONS: RegressionSimulation[] = [
  {
    id: "REG-1-unmemoized-context-menu",
    name: "Unmemoized Context Menu in Canvas.tsx",
    targetScenario: "idle",
    metric: "nodeRenders",
    expectedSpikeDelta: 400, // spikes node renders across the 400-node graph
    requirementId: "PERF-V-1.1",
  },
  {
    id: "REG-2-uncoalesced-node-drag",
    name: "Uncoalesced Node Drag in App.tsx",
    targetScenario: "drag-node",
    metric: "storeWrites",
    expectedSpikeDelta: 20, // fires store write on every raw pointermove instead of 1
    requirementId: "PERF-V-1.2",
  },
  {
    id: "REG-3-unmemoized-edge-selector",
    name: "Unmemoized Edge Selector in TypedEdge.tsx",
    targetScenario: "drag-node",
    metric: "edgeRenders",
    expectedSpikeDelta: 600, // re-renders all 600 edges when any node moves
    requirementId: "PERF-V-1.3",
  },
  {
    id: "REG-4-uncoalesced-waypoint-drag",
    name: "Uncoalesced Waypoint Drag",
    targetScenario: "drag-waypoint",
    metric: "storeWrites",
    expectedSpikeDelta: 15, // fires store write on every raw move event
    requirementId: "PERF-V-1.4",
  },
];

console.log("\n==================================================");
console.log("   Reference Performance Regression Verification  ");
console.log("==================================================\n");

let passedCount = 0;
let failedCount = 0;

for (const reg of REFERENCE_REGRESSIONS) {
  const baseScenario = baseline.scenarios[reg.targetScenario];
  if (!baseScenario) {
    console.error(`❌ Target scenario [${reg.targetScenario}] not found in baseline.`);
    failedCount++;
    continue;
  }

  const baseMetricValue = (baseScenario.metrics[reg.metric] as number) ?? 0;
  const simulatedRegressedValue = baseMetricValue + reg.expectedSpikeDelta;

  // Build a simulated results object with the spiked metric to evaluate with evaluateGate
  const simulatedResults: PerfRunResults = {
    ...baseline,
    scenarios: {
      ...baseline.scenarios,
      [reg.targetScenario]: {
        ...baseScenario,
        metrics: {
          ...baseScenario.metrics,
          [reg.metric]: simulatedRegressedValue,
        },
      },
    },
  };

  const { evaluations } = evaluateGate(simulatedResults, baseline);
  const evaluation = evaluations.find(
    (ev) => ev.scenarioId === reg.targetScenario && ev.metric === reg.metric
  );
  const isCaught = evaluation ? !evaluation.passed : false;
  const maxAllowedIncrease = Math.max(2, baseMetricValue * 0.1);
  const delta = simulatedRegressedValue - baseMetricValue;

  if (isCaught) {
    passedCount++;
    console.log(` ✓ [PASS] ${reg.name} (${reg.requirementId}):`);
    console.log(
      `          Spike on [${reg.targetScenario}] ${String(reg.metric)} (+${reg.expectedSpikeDelta}) is correctly caught by gate (+${delta} > +${maxAllowedIncrease.toFixed(1)} max allowed).`
    );
  } else {
    failedCount++;
    console.error(` ✗ [FAIL] ${reg.name} was NOT caught by gating engine!`);
  }
}

console.log("\n==================================================");
console.log(`Regression Verification: ${passedCount} caught, ${failedCount} missed`);
console.log("==================================================\n");

if (failedCount > 0) {
  process.exit(1);
} else {
  console.log("🎉 All reference regressions are successfully detected by the harness!\n");
  process.exit(0);
}
