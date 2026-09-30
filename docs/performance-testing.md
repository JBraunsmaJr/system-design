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

| Command                   | Environment       | Description                                                                                                    |
| ------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------- |
| `npm run test:perf`       | Docker Container  | **Default Standard**. Builds and executes the test harness inside Docker, outputting `dist/perf-results.json`. |
| `npm run test:perf:local` | Host Machine      | Local developer bypass. Runs against a locally built preview server if Playwright is installed on the host.    |
| `npm run test:perf:gate`  | Host Machine / CI | Compares `dist/perf-results.json` against `baselines/perf-baseline.json` and evaluates gating thresholds.      |
| `npm run tests`           | Host Machine / CI | Runs all unit and Layer 1 complexity guard verification tests.                                                 |

---

## 4. Deterministic Workload Fixtures

Workload fixtures are generated deterministically using a seeded pseudo-random number generator (PRNG) in `src/perf/fixtures.ts`. For a given seed and parameter set, the generator produces byte-identical `SubDiagram` models across platforms:

| Fixture Name | Node Count | Edge Count | Structure     | Primary Verification Area                       |
| ------------ | ---------- | ---------- | ------------- | ----------------------------------------------- |
| `small`      | 25         | 30         | Flat          | Fast feedback & sanity checks                   |
| `medium`     | 150        | 220        | Flat          | Typical representative diagram                  |
| `large`      | 400        | 600        | Flat          | Stress testing and regression detection         |
| `nested`     | 300 total  | 400        | 4 levels      | Sub-diagram drill-in/out & `parentPath` filters |
| `grouped`    | 200        | 250        | 20 boundaries | Group boundary geometry and containment         |

---

## 5. Metric Catalog

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

## 6. Scenario Catalog

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

The harness starts its own signaling relay for the session scenarios
(`remote-burst`, `remote-during-drag`) and stops it at the end, so no relay
configuration is needed to run the suite anywhere - previously a developer's
`VITE_SIGNALING_URL` supplied it, and CI, having none, failed at the first
session scenario. Override the port with `PERF_RELAY_PORT` if 14459 is taken.
No traffic leaves the machine: the relay is local and the scenarios have no
second peer.

Every drag scenario frames its target with `__PERF__.frameNodes` before
measuring, checks with `elementFromPoint` that the target really is under the
pointer, and fails if the gesture wrote nothing to the document. Fixtures are
installed after React Flow's initial fit, so without framing most targets are
off-screen: until this was added, every drag scenario dragged empty space and
recorded zeros that read as a perfect score. `reconnect-edge` grabs whichever
endpoint updater is topmost in the framed region and releases just inside a
handle of `node-42`. Autosave is suppressed for the whole run so its debounce
timer cannot land inside a measurement window. 11. `drill-in-out`: Drill into a nested sub-diagram and back out. Protects level transitions and camera fit. 12. `remote-burst`: Apply 120 remote Yjs updates at ~60Hz while idle locally. Protects remote change ingestion. 13. `remote-during-drag`: Apply 120 remote Yjs updates while actively dragging a node locally. Protects the worst-case live collaborative interaction path.

---

## 7. Baseline Management

### Initial Baseline Creation

To capture and commit a fresh baseline:

```bash
npm run test:perf                        # check the log says it ran in Docker
npx tsx scripts/perf-gate.ts --record    # writes baselines/perf-baseline.json
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

1. **Unmemoized Context Menu**: Removing `useCallback` on `onNodeContextMenu` in `src/components/canvas/useCanvasContextMenu.ts` (spikes `nodeRenders`).
2. **Uncoalesced Node Drag**: Removing animation frame coalescing in node drags (spikes `storeWrites` and `snapshotBuilds`).
3. **Unmemoized Edge Selector**: Changing `TypedEdge` to select entire node objects rather than position strings (spikes `edgeRenders`).
4. **Uncoalesced Waypoint Drag**: Emitting store writes on raw pointer events during waypoint drags (spikes `storeWrites`).

Automated reference checks verify that the gating engine flags these anti-patterns deterministically.

## 9. Render Census for the Non-Canvas Views

The harness above drives the diagram canvas only. The Requirements and
Timeline views and the SRD and library modals are covered by a separate
tool,
`scripts/measure-view-renders.ts`, built for proving that a refactor of those
views changes nothing.

For each of 44 interactions (plus six setup steps, below) it records the
number of React commits and, per component name, how many times that
component's render function ran:

- Requirements and Timeline (14): opening each view, typing in search,
  stepping through matches, collapsing and expanding cards, board and
  Gantt, filtering by epic, searching the backlog, opening an item.
- SRD modal (13): every tab, typing in fields, theme color, preset, the
  component and connection tables.
- Library manager (11): creating a library, adding an icon and a shape.
- Canvas right-click menu (6): opening it on a node, both submenus,
  applying a color, dismissing it with Escape.

For the modal and menu interactions it also records the rendered HTML, and
`--compare` reports the first differing character. For the SRD the markup
is the product: the preview is what becomes the PDF.

```bash
# Measure two checkouts with the same measuring code, then compare.
git worktree add /tmp/base main
npx tsx scripts/measure-view-renders.ts --repo /tmp/base --out /tmp/before.json
npx tsx scripts/measure-view-renders.ts --repo .         --out /tmp/after.json
npx tsx scripts/measure-view-renders.ts --compare /tmp/before.json /tmp/after.json
```

A pure refactor must produce an identical census; `--compare` exits non-zero
on any difference.

A split that adds components (a section of markup becoming its own
component) cannot be identical: the new components appear in the census.
For those, the bar is that commits and every pre-existing component's count
are identical, the HTML is byte-identical, and each new component renders
exactly once per render of its parent, and only while it is shown.

Six steps are marked `setup` and never compared: they only prepare the
next measured step. Four put the app into a known state (pointer on empty
canvas, then hovering a node, before each right-click - hovering and
right-clicking in one step raced, committing together or apart). Two vary
even on `main` and are kept only for the state they leave: returning to the
diagram view (React Flow measures nodes through `ResizeObserver`), and
reopening the right-click menu (leftover documentation-popup timers). The
steps after every setup step are stable.

How it works, and why each choice matters:

- **No application changes.** It installs a minimal
  `__REACT_DEVTOOLS_GLOBAL_HOOK__`, which production React calls after every
  commit, and counts the component fibers React visited that carry the
  `PerformedWork` flag (set exactly when a render function ran).
- **Production build, unminified.** The development build double-renders
  under StrictMode; minification would erase component names. The PWA plugin
  is dropped so a service worker cannot cache the page being measured.
- **Normalised HTML.** Only what is not markup is normalised: captured
  diagram images (`data:` and `blob:` URLs) and library ids built from
  `Date.now()`.
- **Quiet windows.** Each window starts and ends only once the app has made
  no commit for 2.5 s, so commits from timers (the Requirements search
  highlight, autosave) are counted against the action that caused them. With
  fixed delays, identical builds reported different per-scenario counts.

Reference regression: making `onUpdateItem` (now in
`src/components/requirements/useRequirementStoreActions.ts`) a plain
function instead of a `useCallback` re-renders every `RequirementCard` on
each search step; the census reports it.

The census is not part of `npm test`: like the perf suite, it builds the app
and drives a browser.
