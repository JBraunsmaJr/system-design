import { Eye, EyeOff } from "lucide-react";
import type { Scenario, ScenarioStep } from "../domain/types";

interface ScenarioPanelProps {
  scenarios: Scenario[];
  activeScenarioId: string | null;
  onSelectScenario: (id: string) => void;
  onCreateScenario: () => void;
  onRenameScenario: (id: string, title: string) => void;
  onDeleteScenario: (id: string) => void;
  onAddStep: (scenarioId: string) => void;
  onUpdateStep: (scenarioId: string, stepId: string, patch: Partial<ScenarioStep>) => void;
  onDeleteStep: (scenarioId: string, stepId: string) => void;
  onMoveStep: (scenarioId: string, stepId: string, direction: "up" | "down") => void;
  onPresent: (scenarioId: string) => void;
  canAddStep: boolean;
  previewStepId: string | null;
  onTogglePreviewStep: (stepId: string) => void;
  onClose: () => void;
}

export function ScenarioPanel({
  scenarios,
  activeScenarioId,
  onSelectScenario,
  onCreateScenario,
  onRenameScenario,
  onDeleteScenario,
  onAddStep,
  onUpdateStep,
  onDeleteStep,
  onMoveStep,
  onPresent,
  canAddStep,
  previewStepId,
  onTogglePreviewStep,
  onClose,
}: ScenarioPanelProps) {
  // activeScenarioId is already resolved by App.tsx (including its "default
  // to the first scenario" fallback) before it gets here - this file
  // shouldn't re-implement that decision, since having it in two places is
  // exactly what let them drift out of sync before.
  const active = scenarios.find((s) => s.id === activeScenarioId) ?? null;

  return (
    <div className="scenario-panel">
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

        <button type="button" className="scenario-panel__close" onClick={onClose} aria-label="Close scenarios panel">
          ×
        </button>
      </div>

      {!active && (
        <p className="scenario-panel__empty">
          No scenarios yet. Create one, then select nodes/edges on the canvas and add them as a step below.
        </p>
      )}

      {active && (
        <>
          <input
            className="scenario-panel__title"
            value={active.title}
            onChange={(e) => onRenameScenario(active.id, e.target.value)}
          />

          <div className="scenario-panel__steps">
            {active.steps.map((step, index) => {
              const count = step.focusNodeIds.length + step.focusEdgeIds.length;
              const isPreviewing = previewStepId === step.id;
              return (
                <div className={`step-card${isPreviewing ? " is-previewing" : ""}`} key={step.id}>
                  <div className="step-card__header">
                    <span className="step-card__number">{index + 1}</span>
                    <button
                      type="button"
                      className={`step-card__preview${isPreviewing ? " is-active" : ""}`}
                      onClick={() => onTogglePreviewStep(step.id)}
                      title={isPreviewing ? "Stop previewing this step" : "Preview this step's highlight on the canvas"}
                      aria-label={isPreviewing ? "Stop previewing this step" : "Preview this step on the canvas"}
                    >
                      {isPreviewing ? <Eye size={13} /> : <EyeOff size={13} />}
                    </button>
                    <div className="step-card__move">
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => onMoveStep(active.id, step.id, "up")}
                        aria-label="Move step earlier"
                      >
                        ←
                      </button>
                      <button
                        type="button"
                        disabled={index === active.steps.length - 1}
                        onClick={() => onMoveStep(active.id, step.id, "down")}
                        aria-label="Move step later"
                      >
                        →
                      </button>
                    </div>
                    <button
                      type="button"
                      className="step-card__delete"
                      onClick={() => onDeleteStep(active.id, step.id)}
                      aria-label="Delete step"
                    >
                      ×
                    </button>
                  </div>
                  <input
                    className="step-card__title"
                    value={step.title}
                    onChange={(e) => onUpdateStep(active.id, step.id, { title: e.target.value })}
                  />
                  <textarea
                    className="step-card__narration"
                    placeholder="Narration / speaker notes..."
                    rows={3}
                    value={step.narration ?? ""}
                    onChange={(e) => onUpdateStep(active.id, step.id, { narration: e.target.value })}
                  />
                  <div className="step-card__count">
                    {count} element{count === 1 ? "" : "s"} highlighted
                  </div>
                </div>
              );
            })}

            <button
              type="button"
              className="step-card step-card--add"
              disabled={!canAddStep}
              onClick={() => onAddStep(active.id)}
              title={
                canAddStep
                  ? "Add the current canvas selection as a new step"
                  : "Select one or more nodes/edges on the canvas first"
              }
            >
              + Add step
              <span>from current selection</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
