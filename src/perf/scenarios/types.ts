import type { Page } from "playwright";
import type { FixtureName } from "../fixtures";
import type { PerfMetrics } from "../instrumentation";

export interface ScenarioDefinition {
  id: string;
  name: string;
  fixture: FixtureName;
  description: string;
  run: (page: Page) => Promise<void>;
}

export interface ScenarioResult {
  id: string;
  name: string;
  fixture: FixtureName;
  description: string;
  metrics: PerfMetrics & {
    scenarioDurationMs: number;
    p95FrameIntervalMs: number;
    longTasksCount: number;
  };
  repeats: number;
  stable: boolean;
}

export interface PerfRunResults {
  timestamp: string;
  commitSha: string;
  harnessVersion: string;
  nodeVersion: string;
  os: string;
  cpuModel: string;
  cpuCalibrationMs: number;
  scenarios: Record<string, ScenarioResult>;
}
