import { Panel } from "@xyflow/react";
import type { Scenario, ScenarioStep } from "../domain/types";

interface PresentationOverlayProps {
  scenario: Scenario;
  step: ScenarioStep;
  stepIndex: number;
  onNext: () => void;
  onPrev: () => void;
  onExit: () => void;
}

export function PresentationOverlay({
  scenario,
  step,
  stepIndex,
  onNext,
  onPrev,
  onExit,
}: PresentationOverlayProps) {
  const total = scenario.steps.length;

  return (
    <>
      <Panel position="top-center" className="presentation-topbar">
        <span className="presentation-topbar__scenario">{scenario.title}</span>
        <span className="presentation-topbar__progress">
          Step {stepIndex + 1} of {total}
        </span>
        <button type="button" onClick={onExit}>
          Exit (Esc)
        </button>
      </Panel>

      <Panel position="bottom-center" className="presentation-bottombar">
        <button type="button" onClick={onPrev} disabled={stepIndex === 0}>
          ← Prev
        </button>
        <div className="presentation-bottombar__text">
          <div className="presentation-bottombar__title">{step.title}</div>
          {step.narration && <div className="presentation-bottombar__narration">{step.narration}</div>}
        </div>
        <button type="button" onClick={onNext} disabled={stepIndex === total - 1}>
          Next →
        </button>
      </Panel>
    </>
  );
}
