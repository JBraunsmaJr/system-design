import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HardDrive, Cloud, FileDown, Loader, TriangleAlert } from "lucide-react";
import {
  deriveDurability,
  type DurabilitySignals,
  type DurabilityLevel,
} from "../domain/durability.ts";
import { computeFlippedPosition } from "../domain/popoverPosition";

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

const DETAIL_WIDTH = 264;

export interface DurabilityIndicatorProps {
  signals: DurabilitySignals;
  onExport?: () => void;
  onChooseFile?: () => void;
  onRetry?: () => void;
  /** Re-grants write permission to the attached file (WS13-R2). */
  onResumeFile?: () => void;
  /** The two answers to an external change (WS13-R4). */
  onReloadFromFile?: () => void;
  onOverwriteFile?: () => void;
  /** Stops saving to the attached file. */
  onStopFile?: () => void;
  fileName?: string | null;
}

export function DurabilityIndicator({
  signals,
  onExport,
  onChooseFile,
  onRetry,
  onResumeFile,
  onReloadFromFile,
  onOverwriteFile,
  onStopFile,
  fileName,
}: DurabilityIndicatorProps) {
  const state = deriveDurability(signals);
  const [open, setOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const detailId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const Icon = ICONS[state.level];

  const handler =
    state.action === "export"
      ? onExport
      : state.action === "choose-file"
        ? onChooseFile
        : state.action === "retry"
          ? onRetry
          : state.action === "resume-file"
            ? onResumeFile
            : undefined;

  const actionLabel =
    state.action === "export"
      ? "Export a copy"
      : state.action === "choose-file"
        ? "Save to a file"
        : state.action === "retry"
          ? "Try again"
          : state.action === "resume-file"
            ? fileName
              ? `Resume saving to ${fileName}`
              : "Resume saving to file"
            : null;

  // An alert is not something to go looking for: it opens itself and stays.
  const expanded = state.persistent || open;

  const openDropdown = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setDropdownPos({ top: rect.bottom + 6, left: Math.max(8, rect.right - DETAIL_WIDTH) });
    setOpen(true);
  };
  const closeDropdown = () => setOpen(false);

  useLayoutEffect(() => {
    if (!expanded) return;
    const trigger = triggerRef.current;
    if (!trigger) return;
    const triggerRect = trigger.getBoundingClientRect();
    const dropdown = dropdownRef.current;
    const width = dropdown ? dropdown.getBoundingClientRect().width : DETAIL_WIDTH;
    const height = dropdown ? dropdown.getBoundingClientRect().height : 100;
    const next = computeFlippedPosition(
      triggerRect,
      { width, height },
      { width: window.innerWidth, height: window.innerHeight },
      6
    );
    setDropdownPos((prev) => (prev && prev.top === next.top && prev.left === next.left ? prev : next));
  }, [expanded, state.detail, actionLabel]);

  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    const dropdown = dropdownRef.current;
    if (!trigger || !dropdown) return;
    const triggerRect = trigger.getBoundingClientRect();
    const dropdownRect = dropdown.getBoundingClientRect();
    setDropdownPos(
      computeFlippedPosition(
        triggerRect,
        { width: dropdownRect.width, height: dropdownRect.height },
        { width: window.innerWidth, height: window.innerHeight },
        6
      )
    );
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      if (!state.persistent) {
        closeDropdown();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !state.persistent) closeDropdown();
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [expanded, state.persistent]);

  useEffect(() => {
    if (!expanded) return;
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [expanded, reposition]);

  return (
    <div
      className={`durability durability--${state.tone}${expanded ? " durability--expanded" : ""}`}
    >
      <button
        ref={triggerRef}
        type="button"
        className="durability__chip"
        aria-expanded={expanded}
        aria-describedby={expanded ? detailId : undefined}
        title={state.label}
        onClick={() => {
          if (open) {
            closeDropdown();
          } else {
            openDropdown();
          }
        }}
      >
        <Icon
          size={14}
          aria-hidden="true"
          className={state.level === "loading" ? "durability__icon--spin" : undefined}
        />
        <span className="toolbar__label">{state.label}</span>
      </button>

      {expanded &&
        dropdownPos &&
        createPortal(
          <div
            ref={dropdownRef}
            className={`durability__detail durability--${state.tone}`}
            id={detailId}
            role="status"
            style={{
              position: "fixed",
              top: dropdownPos.top,
              left: dropdownPos.left,
              width: DETAIL_WIDTH,
            }}
          >
            <p>{state.detail}</p>
            {actionLabel && handler && (
              <button
                type="button"
                className="durability__action"
                onClick={() => {
                  handler();
                  if (!state.persistent) closeDropdown();
                }}
              >
                {actionLabel}
              </button>
            )}
            {state.action === "resolve-conflict" && (
              <div className="durability__choices">
                {onReloadFromFile && (
                  <button type="button" className="durability__action durability__reload" onClick={onReloadFromFile}>
                    Reload from file
                  </button>
                )}
                {onOverwriteFile && (
                  <button type="button" className="durability__action durability__overwrite" onClick={onOverwriteFile}>
                    Overwrite file
                  </button>
                )}
              </div>
            )}
            {onStopFile && state.level === "file" && (
              <button
                type="button"
                className="durability__secondary durability__stop-file"
                onClick={() => {
                  onStopFile();
                  closeDropdown();
                }}
              >
                {fileName ? `Stop saving to ${fileName}` : "Stop saving to file"}
              </button>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
