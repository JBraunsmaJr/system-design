# `src/app` — the editor shell's logic

`App.tsx` wires these hooks together and lays out the views. The logic lives
here so that each concern can be read on its own; how it is split is
constrained by performance first, readability second.

| Module                         | What it owns                                                         |
| ------------------------------ | -------------------------------------------------------------------- |
| `documentSnapshot.ts`          | File ⇄ document normalisation (pure)                                 |
| `canvasProjection.ts`          | Nodes/edges the canvas renders, and the caches that keep them stable |
| `hooks/useOpenDocument`        | Which document is open, the Y.Doc, the document catalogue            |
| `hooks/useStoreSignIn`         | Workspace store identity and sign-in                                 |
| `hooks/useCollabSession`       | Sessions, presence, relay and ICE configuration                      |
| `hooks/useDocumentStores`      | Undoable stores and their snapshots                                  |
| `hooks/useWorkspaceSession`    | Workspace sync, save-to-workspace, auto-joining a workspace room     |
| `hooks/useDocumentPersistence` | Autosave, durability signals, unload guard, resumable session        |
| `hooks/useDiagramSelection`    | Current diagram level and selection, shared with peers               |
| `hooks/useScenarios`           | Scenario editing, step preview, presenting                           |
| `hooks/useViewNavigation`      | Which page is showing; jumping between requirements and nodes        |
| `hooks/useCanvasEditing`       | Gesture batching and every canvas edit                               |
| `hooks/useClipboard`           | Copy and paste                                                       |
| `hooks/useKeyboardShortcuts`   | Window-level shortcuts                                               |
| `hooks/useFileActions`         | New, save, load, attached file, timed copies, exports                |
| `hooks/usePerfHarnessBridge`   | `window.__PERF__` handles for the perf harness                       |

## Performance rules

These are not style preferences. Each one has a measured failure behind it.

### 1. Split logic into hooks, not child components

A custom hook runs inside App's render: it adds no component, no render and
no commit. Moving the same code into a child component changes when things
render, which is a performance change that has to be measured, not a
refactor.

### 2. Destructure hook results; never depend on the returned object

Every hook here returns a fresh object on every render. Its _members_ are
stable (state, refs, memoized values, `useCallback`s); the object is not.

```ts
// Right: depends on a stable member.
const { onDeleteSelection } = useCanvasEditing(...);
useEffect(..., [onDeleteSelection]);

// Wrong: `canvas` is new every render, so this effect runs every render,
// and a callback built this way changes identity every render.
const canvas = useCanvasEditing(...);
useEffect(..., [canvas]);
```

Calling a method on the object (`canvas.onCopy()`) makes the
`react-hooks/exhaustive-deps` rule _ask_ for the whole object, which is how
this slips in. Destructuring avoids the question.

This is what went wrong on `techdebt/deconstruction`. Measured with this
repo's harness on the same machine:

| Scenario       | `main` node / edge renders | `techdebt/deconstruction` |
| -------------- | -------------------------- | ------------------------- |
| drag-node      | 23 / 120                   | 8,421 / 12,720            |
| drag-hub-node  | 23 / 1,320                 | 8,421 / 13,920            |
| drag-group     | 370 / 1,260                | 3,888 / 5,260             |
| marquee-select | 30 / 83                    | 5,376 / 8,207             |

### 3. Callbacks that reach the canvas must not change during a drag

`Canvas` is not memoized, so every App render is a Canvas render. Callbacks
it receives go on to React Flow's memoized node and edge wrappers and to
`CanvasContext`; a new identity there re-renders every node and edge. If a
callback needs a value that changes during a drag (`nodes`, `path`,
in-flight geometry), read it through a ref at call time, as
`onAdoptIntoGroup` and `onUpdateNode` do, rather than listing it as a
dependency.

### 4. Setters and refs passed into a hook go in its dependency arrays

When a hook receives a React state setter or a ref as a parameter, the lint
rule cannot know it is stable, so it is listed. Listing it costs nothing:
its identity never changes. Only pass real setters and refs to parameters
typed as such; a wrapper function recreated each render would silently turn
every callback that lists it into a per-render callback.

A ref received as a parameter must be named `…Ref`, or the React Compiler
lint (`react-hooks/immutability`) rejects writes to `.current`.

### 5. Keep the projection caches module-level

`canvasProjection.ts` keeps derived node and edge objects in module-level
`WeakMap`s keyed by the store's own objects. That is what makes an unchanged
node the same object between renders, so React Flow skips it. Do not move
them into a `useMemo` or recreate them per call. `canvasProjection.verify.ts`
fails if the node, edge or `data` caching breaks.

### 6. Hook order is effect order

Effects run in the order their hooks are called. `App.tsx` calls the hooks in
an order that keeps every interacting effect (presence broadcasts, keyboard
listener registration, ref-syncing layout effects) in the same relative
order it had before the split. Reorder only with a reason.

## Checking a change

```bash
npm run tests                                  # includes canvasProjection.verify.ts
npm run test:perf && npm run test:perf:gate    # counters vs baselines/perf-baseline.json
```

Every counter in the gate (`commits`, `nodeRenders`, `edgeRenders`,
`canvasRenders`, `storeWrites`, `snapshotBuilds`, `unflattenCalls`) should
be unchanged by a pure refactor. The gate's 10% tolerance is for real
changes, not for refactors.
