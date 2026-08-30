import { useCallback, type PointerEvent as ReactPointerEvent } from "react";
import { GripHorizontal, MapPin } from "lucide-react";
import { getBreadcrumbLabels } from "../domain/subDiagramTree";
import type { Scenario, ScenarioStep, SubDiagram } from "../domain/types";

interface ScenarioPanelProps {
  scenarios: Scenario[];
  activeScenarioId: string | null;
  onSelectScenario: (id: string) => void;
  onCreateScenario: () => void;
  onRenameScenario: (id: string, title: string) => void;
  onDeleteScenario: (id: string) => void;
  onAddStep: (scenarioId: string) => void;
  onAddSelectionToStep: (scenarioId: string, stepId: string) => void;
  onRemoveSelectionFromStep: (scenarioId: string, stepId: string) => void;
  onUpdateStep: (scenarioId: string, stepId: string, patch: Partial<ScenarioStep>) => void;
  onDeleteStep: (scenarioId: string, stepId: string) => void;
  onMoveStep: (scenarioId: string, stepId: string, direction: "up" | "down") => void;
  onPresent: (scenarioId: string) => void;
  canAddStep: boolean;
  /** The step currently selected in the list - shown in the editor pane on
   * the right AND previewed/highlighted on the canvas at the same time. */
  activeStepId: string | null;
  onSelectStep: (stepId: string) => void;
  /** Full diagram tree and current drill-down path - used to resolve each
   * step's own level into a readable label, and to tell whether a step's
   * level matches where you're currently looking (which gates preview/edit). */
  root: SubDiagram;
  currentPath: string[];
  onClose: () => void;
  height: number;
  onHeightChange: (height: number) => void;
}

function pathsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function levelLabel(root: SubDiagram, path: string[]): string {
  const labels = getBreadcrumbLabels(root, path);
  return labels.length === 0 ? "Root" : labels.join(" › ");
}

export function ScenarioPanel({
  scenarios,
  activeScenarioId,
  onSelectScenario,
  onCreateScenario,
  onRenameScenario,
  onDeleteScenario,
  onAddStep,
  onAddSelectionToStep,
  onRemoveSelectionFromStep,
  onUpdateStep,
  onDeleteStep,
  onMoveStep,
  onPresent,
  canAddStep,
  activeStepId,
  onSelectStep,
  root,
  currentPath,
  onClose,
  height,
  onHeightChange,
}: ScenarioPanelProps) {
  // activeScenarioId is already resolved by App.tsx (including its "default
  // to the first scenario" fallback) before it gets here - this file
  // shouldn't re-implement that decision, since having it in two places is
  // exactly what let them drift out of sync before.
  const active = scenarios.find((s) => s.id === activeScenarioId) ?? null;
  const currentLevelLabel = levelLabel(root, currentPath);
  const activeStep = active?.steps.find((st) => st.id === activeStepId) ?? null;
  const activeStepIndex = active && activeStep ? active.steps.indexOf(activeStep) : -1;
  const activeStepEditable = activeStep ? pathsEqual(activeStep.path, currentPath) : false;

  // Same document-level-listener drag pattern used for edge label dragging
  // in TypedEdge.tsx (see that file's comment for why) - robust regardless
  // of how many re-renders the continuous height updates trigger.
  const MIN_HEIGHT = 200;
  const onResizeStart = useCallback(
    (event: ReactPointerEvent) => {
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = height;
      const maxHeight = Math.round(window.innerHeight * 0.75);

      const handleMove = (moveEvent: PointerEvent) => {
        const dy = startY - moveEvent.clientY; // dragging up increases height
        onHeightChange(Math.min(Math.max(startHeight + dy, MIN_HEIGHT), maxHeight));
      };
      const handleUp = () => {
        document.removeEventListener("pointermove", handleMove);
        document.removeEventListener("pointerup", handleUp);
      };
      document.addEventListener("pointermove", handleMove);
      document.addEventListener("pointerup", handleUp);
    },
    [height, onHeightChange]
  );

  return (
    <div className="scenario-panel" style={{ height }}>
      <div
        className="scenario-panel__resize-handle"
        onPointerDown={onResizeStart}
        title="Drag to resize"
      >
        <GripHorizontal size={13} />
      </div>
      <div className="scenario-panel__header">
        <span className="scenario-panel__heading">Scenarios</span>

        {scenarios.length > 0 && (
          <select
            className="scenario-panel__select"
            value={active?.id ?? ""}
            onChange={(e) => onSelectScenario(e.target.value)}
          >
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title} ({s.steps.length})
              </option>
            ))}
          </select>
        )}

        <button type="button" onClick={onCreateScenario}>
          + New scenario
        </button>

        {active && (
          <>
            <button
              type="button"
              className="primary"
              disabled={active.steps.length === 0}
              onClick={() => onPresent(active.id)}
              title={active.steps.length === 0 ? "Add at least one step first" : "Start presenting"}
            >
              ▶ Present
            </button>
            <button type="button" className="danger" onClick={() => onDeleteScenario(active.id)}>
              Delete scenario
            </button>
          </>
        )}

        <div className="scenario-panel__header-end">
          <span
            className="scenario-panel__level"
            title="New steps are anchored to whichever diagram you're currently viewing"
          >
            <MapPin size={11} />
            {currentLevelLabel}
          </span>

          <button
            type="button"
            className="scenario-panel__close"
            onClick={onClose}
            aria-label="Close scenarios panel"
          >
            ×
          </button>
        </div>
      </div>

      {!active && (
        <p className="scenario-panel__empty">
          No scenarios yet. Create one, then select nodes/edges on the canvas and add them as a step.
          You can drill into a sub-diagram and keep adding steps there too - a scenario can span
          multiple diagrams.
        </p>
      )}

      {active && (
        <>
          <input
            className="scenario-panel__title"
            value={active.title}
            onChange={(e) => onRenameScenario(active.id, e.target.value)}
          />

          <div className="scenario-panel__body">
            <div className="scenario-step-list">
              {active.steps.map((step, index) => {
                const count = step.focusNodeIds.length + step.focusEdgeIds.length;
                const isActive = step.id === activeStepId;
                const stepEditable = pathsEqual(step.path, currentPath);
                return (
                  <div
                    key={step.id}
                    className={`scenario-step-row${isActive ? " is-active" : ""}`}
                    onClick={() => onSelectStep(step.id)}
                    title={
                      stepEditable
                        ? "Click to preview and edit this step"
                        : `On a different diagram (${levelLabel(root, step.path)}) - click to preview, navigate there to edit`
                    }
                  >
                    <span className="scenario-step-row__number">{index + 1}</span>
                    <span className="scenario-step-row__title">{step.title || `Step ${index + 1}`}</span>
                    <span className="scenario-step-row__count">{count}</span>
                    <div className="scenario-step-row__move" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => onMoveStep(active.id, step.id, "up")}
                        aria-label="Move step earlier"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={index === active.steps.length - 1}
                        onClick={() => onMoveStep(active.id, step.id, "down")}
                        aria-label="Move step later"
                      >
                        ↓
                      </button>
                    </div>
                    <button
                      type="button"
                      className="scenario-step-row__delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteStep(active.id, step.id);
                      }}
                      aria-label="Delete step"
                    >
                      ×
                    </button>
                  </div>
                );
              })}

              <button
                type="button"
                className="scenario-step-list__add"
                disabled={!canAddStep}
                onClick={() => onAddStep(active.id)}
                title={
                  canAddStep
                    ? `Add the current canvas selection as a new step (at: ${currentLevelLabel})`
                    : "Select one or more nodes/edges on the canvas first"
                }
              >
                + New step from selection
              </button>
            </div>

            <div className="scenario-step-editor">
              {!activeStep && (
                <p className="scenario-step-editor__empty">
                  Select a step on the left to edit it, or create a new one from your current canvas
                  selection.
                </p>
              )}
              {activeStep && (
                <>
                  <div className="scenario-step-editor__heading">
                    Step {activeStepIndex + 1} of {active.steps.length}
                  </div>

                  <label className="scenario-step-editor__field">
                    <span>Title</span>
                    <input
                      value={activeStep.title}
                      onChange={(e) => onUpdateStep(active.id, activeStep.id, { title: e.target.value })}
                    />
                  </label>

                  <label className="scenario-step-editor__field scenario-step-editor__field--grow">
                    <span>Narration / speaker notes</span>
                    <textarea
                      placeholder="What you'll say while this step is showing..."
                      value={activeStep.narration ?? ""}
                      onChange={(e) => onUpdateStep(active.id, activeStep.id, { narration: e.target.value })}
                    />
                  </label>

                  <div className="scenario-step-editor__selection">
                    <span>
                      {activeStep.focusNodeIds.length + activeStep.focusEdgeIds.length} element
                      {activeStep.focusNodeIds.length + activeStep.focusEdgeIds.length === 1 ? "" : "s"}{" "}
                      highlighted
                      {!activeStepEditable && " - on a different diagram, select it to change contents"}
                    </span>
                    <div className="scenario-step-editor__selection-actions">
                      <button
                        type="button"
                        disabled={!canAddStep || !activeStepEditable}
                        onClick={() => onAddSelectionToStep(active.id, activeStep.id)}
                        title={
                          !activeStepEditable
                            ? "Navigate to this step's diagram first"
                            : canAddStep
                              ? "Add the current canvas selection to this step"
                              : "Select something on the canvas first"
                        }
                      >
                        + Add selection
                      </button>
                      <button
                        type="button"
                        disabled={!canAddStep || !activeStepEditable}
                        onClick={() => onRemoveSelectionFromStep(active.id, activeStep.id)}
                        title={
                          !activeStepEditable
                            ? "Navigate to this step's diagram first"
                            : canAddStep
                              ? "Remove the current canvas selection from this step"
                              : "Select something on the canvas first"
                        }
                      >
                        − Remove selection
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
