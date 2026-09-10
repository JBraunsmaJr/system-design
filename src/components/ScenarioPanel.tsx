import { Film, MapPin, X, Plus, Play, Trash2, ChevronUp, ChevronDown } from "lucide-react";
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
  /** The step currently selected in the list - shown in the editor pane
   * AND previewed/highlighted on the canvas at the same time. */
  activeStepId: string | null;
  onSelectStep: (stepId: string) => void;
  /** Full diagram tree and current drill-down path - used to resolve each
   * step's own level into a readable label, and to tell whether a step's
   * level matches where you're currently looking (which gates preview/edit). */
  root: SubDiagram;
  currentPath: string[];
  onClose: () => void;
  height?: number;
  onHeightChange?: (height: number) => void;
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
}: ScenarioPanelProps) {
  const active = scenarios.find((s) => s.id === activeScenarioId) ?? null;
  const currentLevelLabel = levelLabel(root, currentPath);
  const activeStep = active?.steps.find((st) => st.id === activeStepId) ?? null;
  const activeStepIndex = active && activeStep ? active.steps.indexOf(activeStep) : -1;
  const activeStepEditable = activeStep ? pathsEqual(activeStep.path, currentPath) : false;

  return (
    <div className="scenario-panel">
      {/* Header */}
      <div className="scenario-panel__header">
        <div className="scenario-panel__header-title">
          <Film size={15} />
          <span>Scenarios</span>
        </div>

        <div className="scenario-panel__header-end">
          <span
            className="scenario-panel__level"
            title={`Current diagram location: ${currentLevelLabel}`}
          >
            <MapPin size={11} />
            {currentLevelLabel}
          </span>

          <button
            type="button"
            className="scenario-panel__close"
            onClick={onClose}
            aria-label="Close scenarios panel"
            title="Close scenarios panel"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Scenario selector & actions */}
      <div className="scenario-panel__scenario-bar">
        {scenarios.length > 0 ? (
          <div className="scenario-panel__scenario-select-row">
            <select
              className="scenario-panel__select"
              value={active?.id ?? ""}
              onChange={(e) => onSelectScenario(e.target.value)}
              aria-label="Select scenario"
            >
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} ({s.steps.length} {s.steps.length === 1 ? "step" : "steps"})
                </option>
              ))}
            </select>
            <button
              type="button"
              className="scenario-panel__btn-new"
              onClick={onCreateScenario}
              title="Create new scenario"
            >
              <Plus size={13} /> New
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="scenario-panel__btn-primary-full"
            onClick={onCreateScenario}
          >
            <Plus size={14} /> Create First Scenario
          </button>
        )}

        {active && (
          <div className="scenario-panel__scenario-actions">
            <input
              className="scenario-panel__title-input"
              value={active.title}
              placeholder="Scenario title"
              onChange={(e) => onRenameScenario(active.id, e.target.value)}
              aria-label="Scenario title"
            />
            <div className="scenario-panel__action-buttons">
              <button
                type="button"
                className="scenario-panel__btn-present"
                disabled={active.steps.length === 0}
                onClick={() => onPresent(active.id)}
                title={active.steps.length === 0 ? "Add at least one step first" : "Start presenting"}
              >
                <Play size={11} /> Present
              </button>
              <button
                type="button"
                className="scenario-panel__btn-delete-scenario"
                onClick={() => onDeleteScenario(active.id)}
                title="Delete scenario"
                aria-label="Delete scenario"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        )}
      </div>

      {!active ? (
        <div className="scenario-panel__empty">
          <p>No scenarios yet.</p>
          <p className="scenario-panel__hint">
            Create a scenario, select nodes or edges on the diagram, and add them as steps. Steps can also span
            subdiagrams for multi-level walkthroughs.
          </p>
        </div>
      ) : (
        <div className="scenario-panel__content">
          {/* Steps List */}
          <div className="scenario-panel__section">
            <div className="scenario-panel__section-header">
              <span className="scenario-panel__section-title">
                Steps ({active.steps.length})
              </span>
              <button
                type="button"
                className="scenario-panel__btn-add-step"
                disabled={!canAddStep}
                onClick={() => onAddStep(active.id)}
                title={
                  canAddStep
                    ? `Add current canvas selection as a new step (${currentLevelLabel})`
                    : "Select one or more nodes/edges on the canvas first"
                }
              >
                <Plus size={12} /> Add Selection
              </button>
            </div>

            {active.steps.length === 0 ? (
              <div className="scenario-panel__empty-steps">
                <p>No steps in this scenario yet.</p>
                <p className="scenario-panel__hint">
                  Select elements on the diagram, then click <strong>Add Selection</strong> above to create your first step.
                </p>
              </div>
            ) : (
              <div className="scenario-step-list">
                {active.steps.map((step, index) => {
                  const count = step.focusNodeIds.length + step.focusEdgeIds.length;
                  const isActive = step.id === activeStepId;
                  const stepLocLabel = levelLabel(root, step.path);
                  const isSubDiagram = step.path.length > 0;
                  return (
                    <div
                      key={step.id}
                      role="button"
                      tabIndex={0}
                      className={`scenario-step-row${isActive ? " is-active" : ""}`}
                      onClick={() => onSelectStep(step.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelectStep(step.id);
                        }
                      }}
                      title="Click to preview this step on the diagram and edit details"
                    >
                      <span className="scenario-step-row__number">{index + 1}</span>
                      <div className="scenario-step-row__info">
                        <span className="scenario-step-row__title">
                          {step.title || `Step ${index + 1}`}
                        </span>
                        <div className="scenario-step-row__meta">
                          <span className="scenario-step-row__count">
                            {count} {count === 1 ? "item" : "items"}
                          </span>
                          {isSubDiagram && (
                            <span
                              className="scenario-step-row__path-badge"
                              title={`In subdiagram: ${stepLocLabel}`}
                            >
                              <MapPin size={9} /> {stepLocLabel}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="scenario-step-row__move" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() => onMoveStep(active.id, step.id, "up")}
                          aria-label="Move step earlier"
                          title="Move step earlier"
                        >
                          <ChevronUp size={12} />
                        </button>
                        <button
                          type="button"
                          disabled={index === active.steps.length - 1}
                          onClick={() => onMoveStep(active.id, step.id, "down")}
                          aria-label="Move step later"
                          title="Move step later"
                        >
                          <ChevronDown size={12} />
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
                        title="Delete step"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Active Step Editor */}
          {activeStep ? (
            <div className="scenario-step-editor">
              <div className="scenario-step-editor__heading">
                <span>
                  Step {activeStepIndex + 1} of {active.steps.length}
                </span>
                {activeStep.path.length > 0 && (
                  <span className="scenario-step-editor__location-badge">
                    <MapPin size={10} /> {levelLabel(root, activeStep.path)}
                  </span>
                )}
              </div>

              <label className="scenario-step-editor__field">
                <span className="scenario-step-editor__field-label">Step Title</span>
                <input
                  className="scenario-step-editor__input"
                  value={activeStep.title}
                  placeholder={`Step ${activeStepIndex + 1}`}
                  onChange={(e) => onUpdateStep(active.id, activeStep.id, { title: e.target.value })}
                />
              </label>

              <label className="scenario-step-editor__field scenario-step-editor__field--grow">
                <span className="scenario-step-editor__field-label">Narration / Speaker Notes</span>
                <textarea
                  className="scenario-step-editor__textarea"
                  placeholder="What you'll say while this step is showing..."
                  rows={4}
                  value={activeStep.narration ?? ""}
                  onChange={(e) => onUpdateStep(active.id, activeStep.id, { narration: e.target.value })}
                />
              </label>

              <div className="scenario-step-editor__selection">
                <div className="scenario-step-editor__selection-summary">
                  <strong>{activeStep.focusNodeIds.length + activeStep.focusEdgeIds.length}</strong> element
                  {activeStep.focusNodeIds.length + activeStep.focusEdgeIds.length === 1 ? "" : "s"} highlighted
                </div>
                <div className="scenario-step-editor__selection-actions">
                  <button
                    type="button"
                    disabled={!canAddStep || !activeStepEditable}
                    onClick={() => onAddSelectionToStep(active.id, activeStep.id)}
                    title={
                      !activeStepEditable
                        ? "Navigate to this step's diagram first"
                        : canAddStep
                          ? "Add selected nodes/edges to this step"
                          : "Select something on the canvas first"
                    }
                  >
                    <Plus size={11} /> Add selection
                  </button>
                  <button
                    type="button"
                    disabled={!canAddStep || !activeStepEditable}
                    onClick={() => onRemoveSelectionFromStep(active.id, activeStep.id)}
                    title={
                      !activeStepEditable
                        ? "Navigate to this step's diagram first"
                        : canAddStep
                          ? "Remove selected nodes/edges from this step"
                          : "Select something on the canvas first"
                    }
                  >
                    <X size={11} /> Remove selection
                  </button>
                </div>
              </div>
            </div>
          ) : (
            active.steps.length > 0 && (
              <div className="scenario-step-editor scenario-step-editor--empty">
                <p className="scenario-step-editor__empty-text">
                  Click any step above to preview on the diagram and edit its notes and highlighted elements.
                </p>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
