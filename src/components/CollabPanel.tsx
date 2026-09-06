import { useState } from "react";
import { Users, Copy, Check, LogOut, X } from "lucide-react";
import type { PresenceInfo } from "../collab/session";

export interface ActiveSessionInfo {
  roomName: string;
  isSynced: () => boolean;
  /** Everyone else currently in the session - never includes this
   * person's own presence (see session.ts's own subscribeToPresence
   * doc comment on why). */
  peers: PresenceInfo[];
}

interface CollabPanelProps {
  /** Whether a signaling server URL is actually configured
   * (VITE_SIGNALING_URL) - starting or joining a session is disabled,
   * with an explanatory message instead, when this is false, rather than
   * silently failing to connect anywhere. */
  signalingConfigured: boolean;
  activeSession: ActiveSessionInfo | null;
  /** This person's own chosen display name - shown to everyone else in
   * the session. Controlled from App.tsx, which also persists it across
   * reloads, so this component doesn't need to know anything about
   * where it's stored. */
  displayName: string;
  onDisplayNameChange: (name: string) => void;
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
  displayName,
  onDisplayNameChange,
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
                <label className="collab-panel__field-label" htmlFor="collab-panel-display-name">
                  Your name
                </label>
                <input
                  id="collab-panel-display-name"
                  type="text"
                  value={displayName}
                  onChange={(e) => onDisplayNameChange(e.target.value)}
                  placeholder="How others will see you"
                  className="collab-panel__name-input"
                />
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
                {activeSession.peers.length > 0 && (
                  <div className="collab-panel__peers">
                    <div className="collab-panel__peers-label">In this session</div>
                    {activeSession.peers.map((peer, i) => (
                      <div className="collab-panel__peer" key={`${peer.name}-${i}`}>
                        <span className="collab-panel__peer-dot" style={{ background: peer.color }} />
                        <span className="collab-panel__peer-name">{peer.name}</span>
                      </div>
                    ))}
                  </div>
                )}
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
