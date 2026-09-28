import { useCallback, useMemo, useState } from 'react';
import type { Scenario, ScenarioStep } from '../domain/canvas/types';
import type { DiagramPath } from '../domain/canvas/subDiagramTree';

export interface UseScenarioRunnerOptions {
  scenarios: Scenario[];
  setScenarios: (updater: (s: Scenario[]) => Scenario[]) => void;
  selectedNodeIds: string[];
  selectedEdgeIds: string[];
  setSelectedNodeIds: (ids: string[]) => void;
  setSelectedEdgeIds: (ids: string[]) => void;
  path: DiagramPath;
  setPath: (path: DiagramPath) => void;
}

export function useScenarioRunner({
  scenarios,
  setScenarios,
  selectedNodeIds,
  selectedEdgeIds,
  setSelectedNodeIds,
  setSelectedEdgeIds,
  path,
  setPath,
}: UseScenarioRunnerOptions) {
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [isPresenting, setIsPresenting] = useState(false);
  const [activeStepIndex, setActiveStepIndex] = useState(0);

  const activeScenario = useMemo(
    () => scenarios.find((s) => s.id === activeScenarioId) ?? null,
    [scenarios, activeScenarioId],
  );

  const onAddScenario = useCallback(() => {
    setScenarios((s) => {
      const list = s ?? [];
      const nextNum = list.length + 1;
      const newScenario: Scenario = {
        id: `sc-${Date.now()}`,
        title: `Scenario ${nextNum}`,
        steps: [],
      };
      setActiveScenarioId(newScenario.id);
      setActiveStepId(null);
      return [...list, newScenario];
    });
  }, [setScenarios]);

  const onUpdateScenario = useCallback(
    (id: string, patch: Partial<Scenario>) => {
      setScenarios((s) => (s ?? []).map((sc) => (sc.id === id ? { ...sc, ...patch } : sc)));
    },
    [setScenarios],
  );

  const onDeleteScenario = useCallback(
    (id: string) => {
      setScenarios((s) => (s ?? []).filter((sc) => sc.id !== id));
      setActiveScenarioId((cur) => (cur === id ? null : cur));
      setActiveStepId(null);
      setIsPresenting(false);
    },
    [setScenarios],
  );

  const onAddStep = useCallback(
    (scenarioId: string) => {
      const newStepId = `step-${Date.now()}`;
      setScenarios((s) =>
        (s ?? []).map((sc) => {
          if (sc.id !== scenarioId) return sc;
          const nextStepNum = sc.steps.length + 1;
          const step: ScenarioStep = {
            id: newStepId,
            title: `Step ${nextStepNum}`,
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

  const onAddSelectionToStep = useCallback(
    (scenarioId: string, stepId: string) => {
      if (selectedNodeIds.length === 0 && selectedEdgeIds.length === 0) return;
      setScenarios((s) =>
        (s ?? []).map((sc) =>
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
        (s ?? []).map((sc) =>
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
        (s ?? []).map((sc) =>
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
        (s ?? []).map((sc) =>
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
        (s ?? []).map((sc) => {
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
    activeScenarioId,
    setActiveScenarioId,
    activeStepId,
    setActiveStepId,
    isPresenting,
    activeStepIndex,
    activeScenario,
    presentation,
    previewFocus,
    onAddScenario,
    onUpdateScenario,
    onDeleteScenario,
    onAddStep,
    onAddSelectionToStep,
    onRemoveSelectionFromStep,
    onUpdateStep,
    onDeleteStep,
    onMoveStep,
    onStartPresenting,
    onExitPresenting,
    onPresentNext,
    onPresentPrev,
  };
}
