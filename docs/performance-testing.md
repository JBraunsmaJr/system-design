# Performance Testing Harness

This document describes the design, execution workflows, and maintenance procedures for the diagram canvas render-loop performance testing harness.

---

## 1. Objectives & Overview

The performance testing harness exists to detect render-loop, store mutation, and state computation regressions in the diagram canvas before they reach production. 

To maximize aggregate developer productivity and eliminate setup friction across diverse host environments, the harness is architected around a **Docker-first execution model**. All browser-based scenario tests run hermetically inside a pinned container image with pre-installed browser binaries, ensuring byte-identical results and zero dependencies on host OS libraries or internet CDN access.

---

## 2. Three-Layer Architecture

```
Layer 1  Pure-Module Complexity Guards   — Fast unit tests in scripts/run-tests.ts (zero new dependencies)
Layer 2  Dockerized Browser Harness     — Headless Playwright scenarios in a pinned Docker container
Layer 3  Baseline Comparison & Gating   — Automated counter thresholds and PR reporting
```

### Layer 1: Pure-Module Complexity Guards
- **Location**: `src/perf/*.verify.ts`
- **Execution**: Runs automatically as part of `npm run tests`.
- **Purpose**: Verifies that core geometric algorithms and store operations scale as expected (e.g. $O(N)$ vs $O(N^2)$) without needing a browser.
- **Dependency-free**: Runs directly on Node.js using existing test infrastructure.

### Layer 2: Instrumented Browser Harness
- **Location**: `docker/perf/Dockerfile`, `scripts/run-perf.ts`, `src/perf/scenarios/*.ts`
- **Execution**: `npm run test:perf` (containerized) or `npm run test:perf:local` (local host bypass).
- **Purpose**: Drives 13 realistic user gestures and collaborative workloads against a production build (`vite preview`) and captures exact render and mutation counters.
- **Instrumentation**: Zero-cost integer counters compiled only when `VITE_PERF_INSTRUMENTATION=1`.

### Layer 3: Baseline Comparison & Gating Engine
- **Location**: `scripts/perf-gate.ts`, `baselines/perf-baseline.json`
- **Execution**: Evaluates measured metrics against committed baselines.
- **Gating Policy**: Fails CI if any counter metric increases by more than **10%** or **+2 absolute** (whichever is greater). Wall-clock timings are calibrated against an isolated CPU benchmark and reported for visibility without gating.

---

## 3. Containerized Execution Model

### Hermetic Docker Container (`docker/perf/Dockerfile`)
The container image encapsulates:
1. **Base Image**: Pinned Microsoft Playwright image (`mcr.microsoft.com/playwright:v1.51.0-noble` or pinned stable equivalent) with Chromium, Firefox, and WebKit binaries.
2. **Build Stage**: Compiles the application with `VITE_PERF_INSTRUMENTATION=1` and `npm run build`.
3. **Runner Stage**: Launches the `vite preview` server on port `4173` and executes the scenario test runner.
4. **Volume Mounting**: Mounts the host `dist/` directory or outputs `dist/perf-results.json` directly back to the host file system.

### Command Reference

| Command | Environment | Description |
| --- | --- | --- |
| `npm run test:perf` | Docker Container | **Default Standard**. Builds and executes the test harness inside Docker, outputting `dist/perf-results.json`. |
| `npm run test:perf:local` | Host Machine | Local developer bypass. Runs against a locally built preview server if Playwright is installed on the host. |
| `npm run test:perf:gate` | Host Machine / CI | Compares `dist/perf-results.json` against `baselines/perf-baseline.json` and evaluates gating thresholds. |
| `npm run tests` | Host Machine / CI | Runs all unit and Layer 1 complexity guard verification tests. |

---

## 4. Deterministic Workload Fixtures

Workload fixtures are generated deterministically using a seeded pseudo-random number generator (PRNG) in `src/perf/fixtures.ts`. For a given seed and parameter set, the generator produces byte-identical `SubDiagram` models across platforms:

| Fixture Name | Node Count | Edge Count | Structure | Primary Verification Area |
| --- | --- | --- | --- | --- |
| `small` | 25 | 30 | Flat | Fast feedback & sanity checks |
| `medium` | 150 | 220 | Flat | Typical representative diagram |
| `large` | 400 | 600 | Flat | Stress testing and regression detection |
| `nested` | 300 total | 400 | 4 levels | Sub-diagram drill-in/out & `parentPath` filters |
| `grouped` | 200 | 250 | 20 boundaries | Group boundary geometry and containment |

---

## 5. Metric Catalogue

### Counter Metrics (Gating)
Counter metrics count discrete operations and are 100% deterministic regardless of host CPU speed:
- `commits`: React commit count during the measured scenario window.
- `nodeRenders`: Total render invocations across all `TypedNode` components.
- `edgeRenders`: Total render invocations across all `TypedEdge` components.
- `canvasRenders`: Total render invocations of the top-level `Canvas` component.
- `storeWrites`: Mutating method calls into `DiagramStore` / `useDiagramStore`.
- `snapshotBuilds`: Rebuilds of the flat diagram snapshot.
- `unflattenCalls`: Invocations of `unflattenToSubDiagram`.

### Timing Metrics & Calibration (Reporting)
- `scenarioDurationMs`: Total elapsed scenario wall-clock time.
- `actualDurationMs`: Summed React commit durations reported by `React.Profiler`.
- `longestCommitMs`: Duration of the longest single React commit.
- `longTasksCount`: Number of main-thread tasks exceeding 50 ms.
- `p95FrameIntervalMs`: 95th-percentile frame interval during interaction.
- `cpuCalibrationMs`: Standardized standalone CPU benchmark run during the test session. Timings are normalized by this factor for consistent cross-runner comparison.

---

## 6. Scenario Catalogue

The harness tests 13 core interaction scenarios:

1. `idle`: Mount fixture, settle, and idle for 2 seconds. Protects against rogue timers and runaway effects.
2. `drag-node`: Drag a single unconnected node by 200px. Protects single-node render isolation.
3. `drag-hub-node`: Drag a high-degree node with ≥25 connected edges. Protects edge update fan-out.
4. `drag-group`: Drag a boundary containing ≥10 child nodes. Protects group child geometry caching.
5. `marquee-select`: Marquee-select ~100 nodes. Protects selection state fan-out.
6. `pan`: Pan the viewport 500px. Protects against viewport transform re-rendering nodes.
7. `zoom`: Zoom out two steps and back. Protects zoom-dependent rendering paths.
8. `drag-waypoint`: Drag an edge bend by 150px. Protects waypoint drag coalescing and routing.
9. `create-waypoint`: Drag an edge insertion handle to create a bend. Protects insertion drag path.
10. `reconnect-edge`: Drag an edge endpoint to reconnect to another node. Protects reconnection validation.
11. `drill-in-out`: Drill into a nested sub-diagram and back out. Protects level transitions and camera fit.
12. `remote-burst`: Apply 120 remote Yjs updates at ~60Hz while idle locally. Protects remote change ingestion.
13. `remote-during-drag`: Apply 120 remote Yjs updates while actively dragging a node locally. Protects the worst-case live collaborative interaction path.

---

## 7. Baseline Management

### Initial Baseline Creation
To capture and commit a fresh baseline:
```bash
npm run test:perf
node scripts/perf-gate.ts --record baselines/perf-baseline.json
```

### Reviewing Gating Violations
When a metric exceeds tolerance:
```bash
npm run test:perf:gate
```
Output clearly identifies the failing scenario, the affected counter, the baseline value, the observed value, and the percentage delta.

---

## 8. Reference Regressions

To ensure the harness remains sensitive and effective, four reference anti-patterns are validated:
1. **Unmemoized Context Menu**: Removing `useCallback` on `onNodeContextMenu` in `Canvas.tsx` (spikes `nodeRenders`).
2. **Uncoalesced Node Drag**: Removing animation frame coalescing in node drags (spikes `storeWrites` and `snapshotBuilds`).
3. **Unmemoized Edge Selector**: Changing `TypedEdge` to select entire node objects rather than position strings (spikes `edgeRenders`).
4. **Uncoalesced Waypoint Drag**: Emitting store writes on raw pointer events during waypoint drags (spikes `storeWrites`).

Automated reference checks verify that the gating engine flags these anti-patterns deterministically.
