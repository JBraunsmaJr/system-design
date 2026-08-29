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

      {/* Narration gets its own full-width block, not squeezed into a row
          alongside the nav buttons - that's what made it easy to miss
          entirely before. */}
      <Panel position="bottom-center" className="presentation-bottombar">
        <div className="presentation-bottombar__content">
          <div className="presentation-bottombar__title">{step.title}</div>
          {step.narration ? (
            <div className="presentation-bottombar__narration">{step.narration}</div>
          ) : (
            <div className="presentation-bottombar__narration presentation-bottombar__narration--empty">
              No narration for this step
            </div>
          )}
        </div>
        <div className="presentation-bottombar__nav">
          <button type="button" onClick={onPrev} disabled={stepIndex === 0}>
            ← Prev
          </button>
          <span className="presentation-bottombar__counter">
            {stepIndex + 1} / {total}
          </span>
          <button type="button" onClick={onNext} disabled={stepIndex === total - 1}>
            Next →
          </button>
        </div>
      </Panel>
    </>
  );
}
