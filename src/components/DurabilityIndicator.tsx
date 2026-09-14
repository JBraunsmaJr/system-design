import { useId, useState } from "react";
import { HardDrive, Cloud, FileDown, Loader, TriangleAlert } from "lucide-react";
import {
  deriveDurability,
  type DurabilitySignals,
  type DurabilityLevel,
} from "../domain/durability.ts";

/**
 * Tells the user whether their work is actually safe (WS13-R8, WS13-R9).
 *
 * Sits in the toolbar as a quiet chip and says nothing beyond a word until
 * something is wrong, at which point it stops being quiet. That asymmetry is
 * the design: an indicator that is loud when everything is fine trains people
 * to ignore it, which is how the storage failure it exists to report gets
 * missed.
 *
 * All of the judgement lives in deriveDurability - this renders what it is
 * given and never softens it.
 */

const ICONS: Record<DurabilityLevel, typeof HardDrive> = {
  file: FileDown,
  synced: Cloud,
  local: HardDrive,
  "at-risk": TriangleAlert,
  loading: Loader,
};

export interface DurabilityIndicatorProps {
  signals: DurabilitySignals;
  onExport?: () => void;
  onChooseFile?: () => void;
  onRetry?: () => void;
}

export function DurabilityIndicator({
  signals,
  onExport,
  onChooseFile,
  onRetry,
}: DurabilityIndicatorProps) {
  const state = deriveDurability(signals);
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const Icon = ICONS[state.level];

  const handler =
    state.action === "export"
      ? onExport
      : state.action === "choose-file"
        ? onChooseFile
        : state.action === "retry"
          ? onRetry
          : undefined;

  const actionLabel =
    state.action === "export"
      ? "Export a copy"
      : state.action === "choose-file"
        ? "Save to a file"
        : state.action === "retry"
          ? "Try again"
          : null;

  // An alert is not something to go looking for: it opens itself and stays.
  const expanded = state.persistent || open;

  return (
    <div
      className={`durability durability--${state.tone}${expanded ? " durability--expanded" : ""}`}
    >
      <button
        type="button"
        className="durability__chip"
        aria-expanded={expanded}
        aria-describedby={expanded ? detailId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon
          size={14}
          aria-hidden="true"
          className={state.level === "loading" ? "durability__icon--spin" : undefined}
        />
        <span>{state.label}</span>
      </button>

      {expanded && (
        <div className="durability__detail" id={detailId} role="status">
          <p>{state.detail}</p>
          {actionLabel && handler && (
            <button type="button" className="durability__action" onClick={handler}>
              {actionLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
