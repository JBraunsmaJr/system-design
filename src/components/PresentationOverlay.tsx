import { Panel } from "@xyflow/react";
import type { Scenario, ScenarioStep } from "../domain/types";

interface PresentationOverlayProps {
  scenario: Scenario;
  step: ScenarioStep;
  stepIndex: number;
  /** e.g. "Root" or "Orders Service › Request Handling" - the Breadcrumb itself
   * stays hidden while presenting (its click-to-navigate would undermine the
   * locked flow), but a scenario can now span multiple diagram levels, so
   * some passive orientation cue is worth keeping. */
  levelLabel: string;
  onNext: () => void;
  onPrev: () => void;
  onExit: () => void;
}

export function PresentationOverlay({
  scenario,
  step,
  stepIndex,
  levelLabel,
  onNext,
  onPrev,
  onExit,
}: PresentationOverlayProps) {
  const total = scenario.steps.length;

  return (
    <>
      <Panel position="top-center" className="presentation-topbar">
        <span className="presentation-topbar__scenario">{scenario.title}</span>
        <span className="presentation-topbar__level">{levelLabel}</span>
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
