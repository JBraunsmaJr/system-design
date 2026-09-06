import { useState } from "react";
import { Users, Copy, Check, LogOut, X } from "lucide-react";

export interface ActiveSessionInfo {
  roomName: string;
  isSynced: () => boolean;
}

interface CollabPanelProps {
  /** Whether a signaling server URL is actually configured
   * (VITE_SIGNALING_URL) - starting or joining a session is disabled,
   * with an explanatory message instead, when this is false, rather than
   * silently failing to connect anywhere. */
  signalingConfigured: boolean;
  activeSession: ActiveSessionInfo | null;
  onStartSession: () => void;
  onJoinSession: (roomName: string) => void;
  onLeaveSession: () => void;
}

/**
 * Self-contained toolbar control for collaborative sessions - its own
 * trigger button and dropdown, deliberately not threaded through
 * Toolbar.tsx's own props (which already has a long list) so this stays
 * fully isolated from that component's existing behavior.
 *
 * A session covers all four domains - team, requirements, program
 * increments, and the diagram itself - once each got a proven Yjs
 * schema and real UI wiring onto it. Starting or joining a session
 * switches every one of them over together.
 */
export function CollabPanel({
  signalingConfigured,
  activeSession,
  onStartSession,
  onJoinSession,
  onLeaveSession,
}: CollabPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [joinRoomName, setJoinRoomName] = useState("");
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!activeSession) return;
    navigator.clipboard.writeText(activeSession.roomName).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = joinRoomName.trim();
    if (!trimmed) return;
    onJoinSession(trimmed);
    setJoinRoomName("");
    setIsOpen(false);
  };

  return (
    <div className="collab-panel">
      <button
        type="button"
        className={`collab-panel__trigger${activeSession ? " is-active" : ""}`}
        onClick={() => setIsOpen((v) => !v)}
        title={activeSession ? `In session: ${activeSession.roomName}` : "Collaborate"}
      >
        <Users size={14} />
        <span>{activeSession ? "Session Active" : "Collaborate"}</span>
      </button>

      {isOpen && (
        <>
          <div className="collab-panel__scrim" onClick={() => setIsOpen(false)} />
          <div className="collab-panel__dropdown" role="dialog" aria-modal="false">
            <div className="collab-panel__header">
              <span>Collaborative Session</span>
              <button type="button" className="collab-panel__close" onClick={() => setIsOpen(false)}>
                <X size={14} />
              </button>
            </div>

            {!signalingConfigured && (
              <p className="collab-panel__notice">
                Collaboration isn't configured for this deployment - no signaling server URL has been set
                (VITE_SIGNALING_URL).
              </p>
            )}

            {signalingConfigured && !activeSession && (
              <>
                <p className="collab-panel__hint">
                  Team, requirements, timeline/capacity, and the diagram are all shared live during a session.
                </p>
                <button type="button" className="collab-panel__primary-action" onClick={() => { onStartSession(); setIsOpen(false); }}>
                  Start a new session
                </button>
                <div className="collab-panel__divider">or join an existing one</div>
                <form className="collab-panel__join-form" onSubmit={handleJoin}>
                  <input
                    type="text"
                    value={joinRoomName}
                    onChange={(e) => setJoinRoomName(e.target.value)}
                    placeholder="Paste a session code"
                    className="collab-panel__join-input"
                  />
                  <button type="submit" className="collab-panel__join-button" disabled={!joinRoomName.trim()}>
                    Join
                  </button>
                </form>
              </>
            )}

            {activeSession && (
              <>
                <p className="collab-panel__hint">Share this code with anyone you want to collaborate with:</p>
                <div className="collab-panel__room-code">
                  <code>{activeSession.roomName}</code>
                  <button type="button" className="collab-panel__copy-button" onClick={handleCopy} title="Copy session code">
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                </div>
                <button
                  type="button"
                  className="collab-panel__leave-button"
                  onClick={() => {
                    onLeaveSession();
                    setIsOpen(false);
                  }}
                >
                  <LogOut size={13} />
                  Leave session
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
