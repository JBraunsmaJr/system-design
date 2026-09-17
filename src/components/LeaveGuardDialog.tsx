import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";

interface LeaveGuardDialogProps {
  isOpen: boolean;
  onStay: () => void;
  onExportAndLeave: () => void;
  onLeave: () => void;
}

/**
 * WS13-R11: shown when the person leaving is the only participant holding a
 * saved copy of the session. The others are working from what is in their
 * open tabs; once this person is gone, nothing else keeps that work if those
 * tabs close. The consequence is named, and an export is offered right here.
 */
export function LeaveGuardDialog({ isOpen, onStay, onExportAndLeave, onLeave }: LeaveGuardDialogProps) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onStay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onStay]);

  if (!isOpen) return null;
  return (
    <div
      className="modal-overlay"
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div
        className="modal-content leave-guard"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="leave-guard-title"
        aria-describedby="leave-guard-detail"
        style={{
          background: "var(--bg-panel, #1e222b)",
          color: "var(--text, #e7e9ee)",
          borderRadius: 8,
          width: 460,
          maxWidth: "92vw",
          padding: "18px 20px",
          border: "1px solid var(--border, #2d3342)",
          boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
        }}
      >
        <h2 id="leave-guard-title" style={{ fontSize: 16, margin: "0 0 10px", display: "flex", gap: 8, alignItems: "center" }}>
          <TriangleAlert size={18} style={{ color: "var(--warning, #e0a84a)" }} />
          You are the only one here with a saved copy
        </h2>
        <p id="leave-guard-detail" style={{ fontSize: 13, lineHeight: 1.5, margin: "0 0 16px" }}>
          Nobody else in this session is saving it. If you leave and the others close their tabs, their
          changes since joining are lost and the session cannot be reopened from their side. Your own copy
          stays in this browser.
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button type="button" className="leave-guard__stay" onClick={onStay} autoFocus>
            Stay in session
          </button>
          <button type="button" className="leave-guard__leave" onClick={onLeave}>
            Leave without exporting
          </button>
          <button type="button" className="primary leave-guard__export" onClick={onExportAndLeave}>
            Export a copy and leave
          </button>
        </div>
      </div>
    </div>
  );
}
