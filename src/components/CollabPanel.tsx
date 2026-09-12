import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Users, Copy, Check, LogOut, X, Wifi, WifiOff, Settings, ChevronRight, ChevronDown, ExternalLink, Clipboard } from "lucide-react";
import { computeFlippedPosition } from "../domain/popoverPosition";
import { createSessionLink, parseSessionLink } from "../domain/sessionLink";
import type { PresenceInfo } from "../collab/session";

const DROPDOWN_WIDTH = 300;

export interface ActiveSessionInfo {
  roomName: string;
  password?: string;
  isSynced: () => boolean;
  /** Whether a signaling relay is currently reachable. Null before the
   * first status arrives. Distinct from isSynced() - see session.ts's
   * subscribeToRelayStatus for why conflating them makes every
   * connection fault look like "nobody has joined yet". */
  relayConnected: boolean | null;
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
  /** ICE servers as a raw, comma-separated string, in the same
   * build-default-with-runtime-override arrangement as the signaling
   * URLs above. Separate setting because it solves the other half of
   * the connection: the relay is how peers FIND each other, ICE is how
   * they REACH each other, and a network can get the first right and
   * the second wrong. */
  iceServersInput: string;
  onIceServersInputChange: (raw: string) => void;
  buildTimeIceServersDefault: string;
  activeSession: ActiveSessionInfo | null;
  /** This person's own chosen display name - shown to everyone else in
   * the session. Controlled from App.tsx, which also persists it across
   * reloads, so this component doesn't need to know anything about
   * where it's stored. */
  displayName: string;
  onDisplayNameChange: (name: string) => void;
  /** Starts a new collaborative session with an automatically generated encryption key. */
  onStartSession: (key?: string) => void;
  onJoinSession: (roomName: string, passwordOrKey?: string, relayOverride?: string) => void;
  onLeaveSession: () => void;
  /** Whether to render OTHER peers' live cursors - a purely local,
   * display-side preference (see presenceIdentity.ts's own doc comment
   * on loadShowPeerCursors for why). Has no effect on this person's own
   * cursor, which keeps broadcasting to everyone else regardless. */
  showPeerCursors: boolean;
  onShowPeerCursorsChange: (show: boolean) => void;
  /** Optional callback invoked when the session link is copied to clipboard. */
  onCopyLink?: (link: string) => void;
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
  iceServersInput,
  onIceServersInputChange,
  buildTimeIceServersDefault,
  activeSession,
  displayName,
  onDisplayNameChange,
  onStartSession,
  onJoinSession,
  onLeaveSession,
  showPeerCursors,
  onShowPeerCursorsChange,
  onCopyLink,
}: CollabPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [joinRoomName, setJoinRoomName] = useState("");
  // Starts open only when there's nothing configured yet, since the
  // panel can't do anything useful in that state and the fix is in
  // here. Otherwise collapsed: these are set once and rarely revisited.
  const [showSettings, setShowSettings] = useState(() => !signalingConfigured);
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
    const link = createSessionLink({
      roomName: activeSession.roomName,
      key: activeSession.password,
      signalingUrlsInput,
      defaultSignalingUrls: buildTimeSignalingDefault,
    });

    const fallbackCopy = (text: string) => {
      try {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const successful = document.execCommand("copy");
        document.body.removeChild(textArea);
        if (successful) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
          onCopyLink?.(text);
        }
      } catch {
        // Copy failed
      }
    };

    if (typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function") {
      navigator.clipboard
        .writeText(link)
        .then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
          onCopyLink?.(link);
        })
        .catch(() => {
          fallbackCopy(link);
        });
    } else {
      fallbackCopy(link);
    }
  };

  const handlePasteFromClipboard = async () => {
    try {
      if (typeof navigator !== "undefined" && typeof navigator.clipboard?.readText === "function") {
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          setJoinRoomName(text.trim());
        }
      }
    } catch {
      // Silently ignore clipboard read failures (e.g. permission denied)
    }
  };

  const handleStartSession = () => {
    onStartSession();
    close();
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = joinRoomName.trim();
    if (!trimmed) return;
    const parsed = parseSessionLink(trimmed);
    if (!parsed.roomName) return;
    const effectiveKey = parsed.key || parsed.password;
    if (!parsed.relay && !signalingConfigured) {
      setShowSettings(true);
      return;
    }
    onJoinSession(parsed.roomName, effectiveKey, parsed.relay);
    setJoinRoomName("");
    close();
  };

  const parsedJoin = parseSessionLink(joinRoomName);

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

            {!activeSession && (
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

                {signalingConfigured ? (
                  <button
                    type="button"
                    className="collab-panel__primary-action"
                    onClick={handleStartSession}
                  >
                    Start a new session
                  </button>
                ) : (
                  <button
                    type="button"
                    className="collab-panel__primary-action is-disabled"
                    onClick={() => setShowSettings(true)}
                  >
                    Configure relay in Settings to start
                  </button>
                )}

                <div className="collab-panel__divider">or join an existing one</div>
                <form className="collab-panel__join-form" onSubmit={handleJoin}>
                  <div className="collab-panel__join-input-wrap">
                    <input
                      type="text"
                      value={joinRoomName}
                      onChange={(e) => setJoinRoomName(e.target.value)}
                      placeholder="Paste a session link or code"
                      className="collab-panel__join-input"
                    />
                    {typeof navigator !== "undefined" && typeof navigator.clipboard?.readText === "function" && (
                      <button
                        type="button"
                        className="collab-panel__paste-button"
                        onClick={handlePasteFromClipboard}
                        title="Paste from clipboard"
                      >
                        <Clipboard size={13} />
                      </button>
                    )}
                  </div>
                  <button type="submit" className="collab-panel__join-button" disabled={!joinRoomName.trim()}>
                    Join
                  </button>
                </form>

                {joinRoomName.trim() && parsedJoin.roomName && (parsedJoin.key || parsedJoin.password || parsedJoin.relay || parsedJoin.roomName !== joinRoomName.trim()) && (
                  <div className="collab-panel__extracted-info">
                    <span className="collab-panel__extracted-pill">
                      Session: <strong>{parsedJoin.roomName}</strong>
                    </span>
                    {(parsedJoin.key || parsedJoin.password) && (
                      <span className="collab-panel__extracted-pill">
                        Encrypted: <strong>included</strong>
                      </span>
                    )}
                    {parsedJoin.relay && (
                      <span className="collab-panel__extracted-pill">
                        Relay: <strong>{parsedJoin.relay}</strong>
                      </span>
                    )}
                  </div>
                )}
              </>
            )}

            {activeSession && (
              <>
                <div className={`collab-panel__relay-status${activeSession.relayConnected === false ? " is-disconnected" : ""}`}>
                  {activeSession.relayConnected === false ? <WifiOff size={12} /> : <Wifi size={12} />}
                  <span>
                    {activeSession.relayConnected === null
                      ? "Contacting relay..."
                      : activeSession.relayConnected
                        ? "Relay connected"
                        : "Relay unreachable - check the URL in Settings, and that the server is running and reachable from this network"}
                  </span>
                </div>
                <p className="collab-panel__hint">Share this link with anyone you want to collaborate with:</p>
                <div className="collab-panel__room-code">
                  <code>{activeSession.roomName}</code>
                  <button
                    type="button"
                    className="collab-panel__copy-button"
                    onClick={handleCopy}
                    title={copied ? "Link copied!" : "Copy session link"}
                  >
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
                    close();
                  }}
                >
                  <LogOut size={13} />
                  Leave session
                </button>
              </>
            )}

            {/* Configuration lives behind a disclosure because it is set
                once (often baked in at build time and never touched) while
                the actions above are used every session. Kept in the same
                panel rather than moved elsewhere so a failing connection
                can still be diagnosed and fixed without hunting for it. */}
            <div className="collab-panel__settings">
              <button
                type="button"
                className="collab-panel__settings-toggle"
                onClick={() => setShowSettings((v) => !v)}
                aria-expanded={showSettings}
                aria-controls="collab-panel-settings-body"
              >
                {showSettings ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <Settings size={13} />
                <span>Settings</span>
              </button>

              {showSettings && (
                <div className="collab-panel__settings-body" id="collab-panel-settings-body">
                  <label className="collab-panel__field-label" htmlFor="collab-panel-signaling-url">
                    Relay server URL
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
                    Where peers find each other. Not involved once they're connected. Comma-separate
                    several. Takes effect on your next session.
                  </p>

                  <label className="collab-panel__field-label" htmlFor="collab-panel-ice-servers">
                    ICE servers <span className="collab-panel__label-optional">(advanced)</span>
                  </label>
                  <input
                    id="collab-panel-ice-servers"
                    type="text"
                    value={iceServersInput}
                    onChange={(e) => onIceServersInputChange(e.target.value)}
                    placeholder={buildTimeIceServersDefault || "Leave blank for defaults"}
                    className="collab-panel__name-input"
                  />
                  {buildTimeIceServersDefault && iceServersInput !== buildTimeIceServersDefault && (
                    <button
                      type="button"
                      className="collab-panel__reset-signaling"
                      onClick={() => onIceServersInputChange(buildTimeIceServersDefault)}
                    >
                      Reset to deployment default
                    </button>
                  )}
                  <p className="collab-panel__hint">
                    How peers reach each other after the relay introduces them. Blank uses public
                    STUN servers. On an isolated network where everyone shares a LAN, enter{" "}
                    <code>none</code>. Otherwise list your own:{" "}
                    <code>turn:turn.internal:3478|user|pass</code>.
                  </p>

                  <label className="collab-panel__cursor-toggle">
                    <input
                      type="checkbox"
                      checked={showPeerCursors}
                      onChange={(e) => onShowPeerCursorsChange(e.target.checked)}
                    />
                    Show other people's cursors
                  </label>

                  <a
                    className="collab-panel__docs-link"
                    href="https://github.com/jbraunsmajr/system-design/blob/main/docs/relay-server.md"
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Relay server documentation
                    <ExternalLink size={11} />
                  </a>
                </div>
              )}
            </div>

          </div>,
          document.body
        )}
    </div>
  );
}
