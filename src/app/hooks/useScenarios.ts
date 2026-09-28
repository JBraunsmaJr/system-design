import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { Scenario, ScenarioStep } from '../../domain/canvas/types';
import type { DiagramPath } from '../../domain/canvas/subDiagramTree';

let idSeed = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${idSeed++}`;

export interface UseScenariosOptions {
  scenarios: Scenario[];
  setScenarios: (updater: Scenario[] | ((prev: Scenario[]) => Scenario[])) => void;
  path: DiagramPath;
  setPath: Dispatch<SetStateAction<DiagramPath>>;
  selectedNodeIds: string[];
  selectedEdgeIds: string[];
  setSelectedNodeIds: Dispatch<SetStateAction<string[]>>;
  setSelectedEdgeIds: Dispatch<SetStateAction<string[]>>;
}

/**
 * Scenarios: editing their steps, previewing a step on the canvas, and
 * presenting them. Moved unchanged from App.tsx; the only edits are the
 * state setters received as parameters, now listed in the dependency arrays
 * that use them (they are React setters, so this changes no identity).
 *
 * Performance contract (see src/app/README.md): this hook runs inside App's
 * render, so it adds no component, no render and no commit. Every value it
 * returns is either React state, a ref, or memoised with the same
 * dependencies it had in App.tsx. Callers destructure the result and depend
 * on the individual members - never on the returned object, which is new on
 * every render.
 */
export function useScenarios({
  scenarios,
  setScenarios,
  path,
  setPath,
  selectedNodeIds,
  selectedEdgeIds,
  setSelectedNodeIds,
  setSelectedEdgeIds,
}: UseScenariosOptions) {
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [isPresenting, setIsPresenting] = useState(false);
  const [activeStepId, setActiveStepId] = useState<string | null>(null);

  // --- Scenarios (can now span multiple diagram levels - see path below) --

  const onCreateScenario = useCallback(() => {
    const id = nextId('scenario');
    setScenarios((s) => [...s, { id, title: `Scenario ${s.length + 1}`, steps: [] }]);
    setActiveScenarioId(id);
  }, [setScenarios]);

  const onRenameScenario = useCallback(
    (id: string, newTitle: string) => {
      setScenarios((s) => s.map((sc) => (sc.id === id ? { ...sc, title: newTitle } : sc)));
    },
    [setScenarios],
  );

  const onDeleteScenario = useCallback(
    (id: string) => {
      setScenarios((s) => s.filter((sc) => sc.id !== id));
      setActiveScenarioId((cur) => (cur === id ? null : cur));
    },
    [setScenarios],
  );

  const onSelectScenario = useCallback((id: string) => {
    setActiveScenarioId(id);
    setActiveStepId(null);
  }, []);

  // Falls back to the first scenario when nothing's been explicitly picked
  // yet (e.g. right after loading a file, or before ever touching the
  // dropdown) - this MUST match whatever ScenarioPanel displays, or the
  // preview toggle silently does nothing while the panel looks fine. See
  // the activeScenarioId prop passed to ScenarioPanel below - it receives
  // this already-resolved id rather than the raw state, so there's only one
  // place deciding the fallback.
  const activeScenario = useMemo(
    () => scenarios.find((s) => s.id === activeScenarioId) ?? scenarios[0] ?? null,
    [scenarios, activeScenarioId],
  );

  // Selecting a step in the list makes it both the editor's subject AND the
  // canvas preview target at once - clicking the same one again deselects,
  // which is how you get back to seeing the undimmed diagram without
  // closing the panel. When previewing a step that resides on a subdiagram,
  // automatically navigate there just like during presentation.
  const onSelectStep = useCallback(
    (stepId: string) => {
      const isDeselecting = activeStepId === stepId;
      const nextId = isDeselecting ? null : stepId;
      setActiveStepId(nextId);
      if (!isDeselecting) {
        const step = activeScenario?.steps.find((st) => st.id === stepId);
        if (step && step.path) {
          setPath(step.path);
        }
      }
    },
    [activeScenario, activeStepId, setPath],
  );

  // Captures whatever's currently selected on the canvas - AND which level
  // of the tree you're currently drilled into - as a new step. That's what
  // lets a single scenario walk through several nested diagrams: advancing
  // through steps with different `path`s auto-navigates between them (see
  // the presentation-path-sync effect below). The new step becomes active
  // immediately, so you can start writing its narration without a second click.
  const onAddStep = useCallback(
    (scenarioId: string) => {
      if (selectedNodeIds.length === 0 && selectedEdgeIds.length === 0) return;
      const newStepId = nextId('step');
      setScenarios((s) =>
        s.map((sc) => {
          if (sc.id !== scenarioId) return sc;
          const step: ScenarioStep = {
            id: newStepId,
            title: `Step ${sc.steps.length + 1}`,
            narration: '',
            path: [...path],
            focusNodeIds: [...selectedNodeIds],
            focusEdgeIds: [...selectedEdgeIds],
          };
          return { ...sc, steps: [...sc.steps, step] };
        }),
      );
      setActiveStepId(newStepId);
    },
    [selectedNodeIds, selectedEdgeIds, path, setScenarios],
  );

  // Adds/removes the current canvas selection to/from an EXISTING step's
  // focus set, rather than requiring you to delete and recreate the whole
  // step to change what it highlights. Both are unions/differences against
  // whatever's already there, not a wholesale replace.
  const onAddSelectionToStep = useCallback(
    (scenarioId: string, stepId: string) => {
      if (selectedNodeIds.length === 0 && selectedEdgeIds.length === 0) return;
      setScenarios((s) =>
        s.map((sc) =>
          sc.id !== scenarioId
            ? sc
            : {
                ...sc,
                steps: sc.steps.map((st) =>
                  st.id !== stepId
                    ? st
                    : {
                        ...st,
                        focusNodeIds: Array.from(new Set([...st.focusNodeIds, ...selectedNodeIds])),
                        focusEdgeIds: Array.from(new Set([...st.focusEdgeIds, ...selectedEdgeIds])),
                      },
                ),
              },
        ),
      );
    },
    [selectedNodeIds, selectedEdgeIds, setScenarios],
  );

  const onRemoveSelectionFromStep = useCallback(
    (scenarioId: string, stepId: string) => {
      if (selectedNodeIds.length === 0 && selectedEdgeIds.length === 0) return;
      const removeNodes = new Set(selectedNodeIds);
      const removeEdges = new Set(selectedEdgeIds);
      setScenarios((s) =>
        s.map((sc) =>
          sc.id !== scenarioId
            ? sc
            : {
                ...sc,
                steps: sc.steps.map((st) =>
                  st.id !== stepId
                    ? st
                    : {
                        ...st,
                        focusNodeIds: st.focusNodeIds.filter((nid) => !removeNodes.has(nid)),
                        focusEdgeIds: st.focusEdgeIds.filter((eid) => !removeEdges.has(eid)),
                      },
                ),
              },
        ),
      );
    },
    [selectedNodeIds, selectedEdgeIds, setScenarios],
  );

  const onUpdateStep = useCallback(
    (scenarioId: string, stepId: string, patch: Partial<ScenarioStep>) => {
      setScenarios((s) =>
        s.map((sc) =>
          sc.id === scenarioId
            ? { ...sc, steps: sc.steps.map((st) => (st.id === stepId ? { ...st, ...patch } : st)) }
            : sc,
        ),
      );
    },
    [setScenarios],
  );

  const onDeleteStep = useCallback(
    (scenarioId: string, stepId: string) => {
      setScenarios((s) =>
        s.map((sc) =>
          sc.id === scenarioId ? { ...sc, steps: sc.steps.filter((st) => st.id !== stepId) } : sc,
        ),
      );
      setActiveStepId((cur) => (cur === stepId ? null : cur));
    },
    [setScenarios],
  );

  const onMoveStep = useCallback(
    (scenarioId: string, stepId: string, direction: 'up' | 'down') => {
      setScenarios((s) =>
        s.map((sc) => {
          if (sc.id !== scenarioId) return sc;
          const index = sc.steps.findIndex((st) => st.id === stepId);
          const swapWith = direction === 'up' ? index - 1 : index + 1;
          if (index === -1 || swapWith < 0 || swapWith >= sc.steps.length) return sc;
          const steps = [...sc.steps];
          [steps[index], steps[swapWith]] = [steps[swapWith], steps[index]];
          return { ...sc, steps };
        }),
      );
    },
    [setScenarios],
  );

  const previewFocus = useMemo(() => {
    if (!activeStepId || !activeScenario) return null;
    const step = activeScenario.steps.find((st) => st.id === activeStepId);
    if (!step) return null;
    return { nodeIds: step.focusNodeIds, edgeIds: step.focusEdgeIds };
  }, [activeStepId, activeScenario]);

  const onStartPresenting = useCallback(
    (scenarioId: string) => {
      const scenario = scenarios.find((s) => s.id === scenarioId);
      if (!scenario || scenario.steps.length === 0) return;
      setActiveScenarioId(scenarioId);
      setActiveStepIndex(0);
      setPath(scenario.steps[0].path);
      setSelectedNodeIds([]);
      setSelectedEdgeIds([]);
      setActiveStepId(null);
      setIsPresenting(true);
    },
    [scenarios, setPath, setSelectedNodeIds, setSelectedEdgeIds],
  );

  const onExitPresenting = useCallback(() => setIsPresenting(false), []);

  // Cross-diagram scenarios: each step carries its own `path`, so advancing
  // sets both the step index AND (when it differs) navigates there directly -
  // right here in the handler that causes the change, rather than reacting
  // to the mismatch after the fact in an effect.
  const onPresentNext = useCallback(() => {
    const steps = activeScenario?.steps ?? [];
    const nextIndex = Math.min(activeStepIndex + 1, Math.max(steps.length - 1, 0));
    const nextStep = steps[nextIndex];
    if (nextStep) setPath(nextStep.path);
    setActiveStepIndex(nextIndex);
  }, [activeScenario, activeStepIndex, setPath]);

  const onPresentPrev = useCallback(() => {
    const prevIndex = Math.max(activeStepIndex - 1, 0);
    const steps = activeScenario?.steps ?? [];
    const prevStep = steps[prevIndex];
    if (prevStep) setPath(prevStep.path);
    setActiveStepIndex(prevIndex);
  }, [activeScenario, activeStepIndex, setPath]);

  const presentation = useMemo(() => {
    if (!isPresenting || !activeScenario) return null;
    const step = activeScenario.steps[activeStepIndex];
    if (!step) return null;
    return { scenario: activeScenario, step, stepIndex: activeStepIndex };
  }, [isPresenting, activeScenario, activeStepIndex]);

  return {
    setActiveScenarioId,
    setActiveStepIndex,
    isPresenting,
    setIsPresenting,
    activeStepId,
    setActiveStepId,
    activeScenario,
    onCreateScenario,
    onRenameScenario,
    onDeleteScenario,
    onSelectScenario,
    onSelectStep,
    onAddStep,
    onAddSelectionToStep,
    onRemoveSelectionFromStep,
    onUpdateStep,
    onDeleteStep,
    onMoveStep,
    previewFocus,
    onStartPresenting,
    onExitPresenting,
    onPresentNext,
    onPresentPrev,
    presentation,
  };
}
