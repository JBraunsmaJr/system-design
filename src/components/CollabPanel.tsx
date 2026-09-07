import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Users, Copy, Check, LogOut, X } from "lucide-react";
import { computeFlippedPosition } from "../domain/popoverPosition";
import type { PresenceInfo } from "../collab/session";

const DROPDOWN_WIDTH = 300;

export interface ActiveSessionInfo {
  roomName: string;
  isSynced: () => boolean;
  /** Everyone else currently in the session - never includes this
   * person's own presence (see session.ts's own subscribeToPresence
   * doc comment on why). */
  peers: PresenceInfo[];
}

interface CollabPanelProps {
  /** Whether a signaling server URL is actually configured, from EITHER
   * source (this person's own runtime override, or VITE_SIGNALING_URL
   * as the deployer's build-time default) - starting or joining a
   * session is disabled, with an explanatory message instead, when this
   * is false, rather than silently failing to connect anywhere. */
  signalingConfigured: boolean;
  /** The current signaling URL(s), as a raw, comma-separated string -
   * this person's own saved override if they've ever set one, otherwise
   * whatever VITE_SIGNALING_URL was at build time. Controlled from
   * App.tsx, which also persists edits to localStorage, so this
   * component doesn't need to know anything about where it's stored. */
  signalingUrlsInput: string;
  onSignalingUrlsInputChange: (raw: string) => void;
  /** The deployer's own build-time default (VITE_SIGNALING_URL, or an
   * empty string if that was never set) - shown so a person editing
   * their own override can always see what "reset to default" would
   * actually reset to, and used to render a reset control at all only
   * when the deployer actually configured one. */
  buildTimeSignalingDefault: string;
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
  /** Whether to render OTHER peers' live cursors - a purely local,
   * display-side preference (see presenceIdentity.ts's own doc comment
   * on loadShowPeerCursors for why). Has no effect on this person's own
   * cursor, which keeps broadcasting to everyone else regardless. */
  showPeerCursors: boolean;
  onShowPeerCursorsChange: (show: boolean) => void;
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
  signalingUrlsInput,
  onSignalingUrlsInputChange,
  buildTimeSignalingDefault,
  activeSession,
  displayName,
  onDisplayNameChange,
  onStartSession,
  onJoinSession,
  onLeaveSession,
  showPeerCursors,
  onShowPeerCursorsChange,
}: CollabPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [joinRoomName, setJoinRoomName] = useState("");
  const [copied, setCopied] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const open = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setDropdownPos({ top: rect.bottom + 4, left: Math.max(8, rect.right - DROPDOWN_WIDTH) });
    setIsOpen(true);
  };
  const close = () => setIsOpen(false);

  // Refines the rough position set in open() once the dropdown has
  // actually been measured - its height varies a lot depending on
  // whether a session is active and how many peers are in it, so it
  // can't be known ahead of the first paint.
  useLayoutEffect(() => {
    if (!isOpen) return;
    const trigger = triggerRef.current;
    const dropdown = dropdownRef.current;
    if (!trigger || !dropdown) return;
    const triggerRect = trigger.getBoundingClientRect();
    const dropdownRect = dropdown.getBoundingClientRect();
    const next = computeFlippedPosition(
      triggerRect,
      { width: dropdownRect.width, height: dropdownRect.height },
      { width: window.innerWidth, height: window.innerHeight }
    );
    setDropdownPos((prev) => (prev && prev.top === next.top && prev.left === next.left ? prev : next));
  }, [isOpen]);

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
        { width: window.innerWidth, height: window.innerHeight }
      )
    );
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      close();
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  // Capture-phase scroll specifically so the toolbar row's OWN
  // horizontal scrolling moves the dropdown with its trigger, not just
  // window-level scrolling.
  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [isOpen, reposition]);

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
    close();
  };

  return (
    <div className="collab-panel">
      <button
        ref={triggerRef}
        type="button"
        className={`collab-panel__trigger${activeSession ? " is-active" : ""}`}
        onClick={() => (isOpen ? close() : open())}
        title={activeSession ? `In session: ${activeSession.roomName}` : "Collaborate"}
      >
        <Users size={14} />
        <span>{activeSession ? "Session Active" : "Collaborate"}</span>
      </button>

      {isOpen &&
        dropdownPos &&
        createPortal(
          <div
            ref={dropdownRef}
            className="collab-panel__dropdown"
            role="dialog"
            aria-modal="false"
            style={{ position: "fixed", top: dropdownPos.top, left: dropdownPos.left, width: DROPDOWN_WIDTH }}
          >
            <div className="collab-panel__header">
              <span>Collaborative Session</span>
              <button type="button" className="collab-panel__close" onClick={close}>
                <X size={14} />
              </button>
            </div>

            <label className="collab-panel__field-label" htmlFor="collab-panel-signaling-url">
              Relay Server URL
            </label>
            <input
              id="collab-panel-signaling-url"
              type="text"
              value={signalingUrlsInput}
              onChange={(e) => onSignalingUrlsInputChange(e.target.value)}
              placeholder={buildTimeSignalingDefault || "ws://localhost:4444"}
              className="collab-panel__name-input"
            />
            {buildTimeSignalingDefault && signalingUrlsInput !== buildTimeSignalingDefault && (
              <button
                type="button"
                className="collab-panel__reset-signaling"
                onClick={() => onSignalingUrlsInputChange(buildTimeSignalingDefault)}
              >
                Reset to deployment default
              </button>
            )}
            <p className="collab-panel__hint">
              One or more URLs (comma-separated) - only used to help peers find each other, never
              involved once a connection is established. Takes effect the next time you
              start or join a session.
            </p>

            {!signalingConfigured && (
              <p className="collab-panel__notice">Set a signaling server URL above to enable collaboration.</p>
            )}

            {signalingConfigured && !activeSession && (
              <>
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
                <button type="button" className="collab-panel__primary-action" onClick={() => { onStartSession(); close(); }}>
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
                <label className="collab-panel__cursor-toggle">
                  <input
                    type="checkbox"
                    checked={showPeerCursors}
                    onChange={(e) => onShowPeerCursorsChange(e.target.checked)}
                  />
                  Show other people's cursors
                </label>
                <button
                  type="button"
                  className="collab-panel__leave-button"
                  onClick={() => {
                    onLeaveSession();
                    close();
                  }}
                >
                  <LogOut size={13} />
                  Leave session
                </button>
              </>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
