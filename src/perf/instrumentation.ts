/**
 * Zero-overhead performance instrumentation layer.
 *
 * Gated strictly by `VITE_PERF_INSTRUMENTATION=1`.
 * When disabled (standard development and released production builds),
 * all operations are zero-cost / no-op inline functions.
 */

export interface PerfCounters {
  commits: number;
  nodeRenders: number;
  edgeRenders: number;
  canvasRenders: number;
  storeWrites: number;
  snapshotBuilds: number;
  unflattenCalls: number;
}

export interface PerfMetrics extends PerfCounters {
  actualDurationMs: number;
  longestCommitMs: number;
  commitDurations: number[];
}

const isEnabled: boolean =
  typeof import.meta !== "undefined" &&
  typeof import.meta.env !== "undefined" &&
  import.meta.env.VITE_PERF_INSTRUMENTATION === "1";

const counters: PerfCounters = {
  commits: 0,
  nodeRenders: 0,
  edgeRenders: 0,
  canvasRenders: 0,
  storeWrites: 0,
  snapshotBuilds: 0,
  unflattenCalls: 0,
};

let totalActualDurationMs = 0;
let longestCommitMs = 0;
const commitDurations: number[] = [];

export function isPerfInstrumentationActive(): boolean {
  return isEnabled;
}

export function recordCommit(actualDuration: number = 0): void {
  if (!isEnabled) return;
  counters.commits++;
  totalActualDurationMs += actualDuration;
  if (actualDuration > longestCommitMs) {
    longestCommitMs = actualDuration;
  }
  commitDurations.push(actualDuration);
}

export function recordNodeRender(): void {
  if (!isEnabled) return;
  counters.nodeRenders++;
}

export function recordEdgeRender(): void {
  if (!isEnabled) return;
  counters.edgeRenders++;
}

export function recordCanvasRender(): void {
  if (!isEnabled) return;
  counters.canvasRenders++;
}

export function recordStoreWrite(): void {
  if (!isEnabled) return;
  counters.storeWrites++;
}

export function recordSnapshotBuild(): void {
  if (!isEnabled) return;
  counters.snapshotBuilds++;
}

export function recordUnflattenCall(): void {
  if (!isEnabled) return;
  counters.unflattenCalls++;
}

export function getPerfCounters(): PerfCounters {
  return { ...counters };
}

export function getPerfMetrics(): PerfMetrics {
  return {
    ...counters,
    actualDurationMs: totalActualDurationMs,
    longestCommitMs,
    commitDurations: [...commitDurations],
  };
}

export function resetPerfCounters(): void {
  counters.commits = 0;
  counters.nodeRenders = 0;
  counters.edgeRenders = 0;
  counters.canvasRenders = 0;
  counters.storeWrites = 0;
  counters.snapshotBuilds = 0;
  counters.unflattenCalls = 0;
  totalActualDurationMs = 0;
  longestCommitMs = 0;
  commitDurations.length = 0;
}

// Attach to window for browser Playwright harness access
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__PERF__ = {
    isEnabled: () => isEnabled,
    getCounters: getPerfCounters,
    getMetrics: getPerfMetrics,
    reset: resetPerfCounters,
    recordCommit,
    recordNodeRender,
    recordEdgeRender,
    recordCanvasRender,
    recordStoreWrite,
    recordSnapshotBuild,
    recordUnflattenCall,
  };
}
