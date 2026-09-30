/**
 * Someone is waiting to be let into the workspace (WS7-R8).
 *
 * Shown over the editor, where the person who can grant it is working,
 * with the grant action on the notice itself. "Later" hides it for this
 * visit only: dismissing a person permanently would leave them waiting
 * with nobody reminded they are.
 */
import { useState } from 'react';
import { KeyRound, UserCheck, UserPlus, X } from 'lucide-react';
import type { AccessRequest, AutoGrantNotice } from '../../collab/hooks/useAccessRequests';
import { describeRejection } from '../../collab/access/autoGrant';

export interface AccessRequestNoticeProps {
  requests: AccessRequest[];
  granting: string | null;
  onGrant: (userId: string) => void;
  /** WS14-R39: people this browser just let in automatically. */
  autoGranted?: AutoGrantNotice[];
  onDismissAutoGranted?: (userId: string) => void;
  /** WS14-R40: this browser is replacing the workspace key. */
  rotating?: boolean;
}

const cardStyle = {
  display: 'flex',
  gap: 10,
  alignItems: 'center',
  padding: '10px 12px',
  borderRadius: 8,
  background: 'var(--chrome-bg-raised)',
  border: '1px solid var(--chrome-border)',
  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)',
  fontSize: 13,
} as const;

const dismissStyle = {
  background: 'none',
  border: 'none',
  padding: 2,
  cursor: 'pointer',
  color: 'inherit',
} as const;

export function AccessRequestNotice({
  requests,
  granting,
  onGrant,
  autoGranted = [],
  onDismissAutoGranted,
  rotating = false,
}: AccessRequestNoticeProps) {
  const [later, setLater] = useState<Set<string>>(() => new Set());
  const showing = requests.filter((request) => !later.has(request.userId));
  if (showing.length === 0 && autoGranted.length === 0 && !rotating) return null;

  return (
    <div
      className="access-request-notice"
      role="status"
      aria-live="polite"
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        zIndex: 20,
        display: 'grid',
        gap: 8,
        maxWidth: 360,
      }}
    >
      {rotating && (
        <div className="access-request access-request--rotating" style={cardStyle}>
          <KeyRound size={16} aria-hidden="true" />
          <span className="access-request__text" style={{ flex: 1 }}>
            Replacing the workspace key, because someone was removed. Keep this tab open for a
            moment.
          </span>
        </div>
      )}
      {autoGranted.map((notice) => (
        <div
          key={`joined-${notice.userId}`}
          className="access-request access-request--joined"
          data-user-id={notice.userId}
          style={cardStyle}
        >
          <UserCheck size={16} aria-hidden="true" />
          <span className="access-request__text" style={{ flex: 1 }}>
            <strong>{notice.displayName}</strong> joined through {notice.matchedGroup}.
          </span>
          <button
            type="button"
            className="access-request__dismiss"
            aria-label={`Dismiss the notice about ${notice.displayName}`}
            onClick={() => onDismissAutoGranted?.(notice.userId)}
            style={dismissStyle}
          >
            <X size={14} />
          </button>
        </div>
      ))}
      {showing.map((request) => (
        <div
          key={request.userId}
          className="access-request"
          data-user-id={request.userId}
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            padding: '10px 12px',
            borderRadius: 8,
            background: 'var(--chrome-bg-raised)',
            border: '1px solid var(--chrome-border)',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)',
            fontSize: 13,
          }}
        >
          <UserPlus size={16} aria-hidden="true" />
          <span className="access-request__text" style={{ flex: 1 }}>
            <strong>{request.displayName}</strong> is waiting for access to this workspace.
            {request.rejection && (
              <span className="access-request__reason" style={{ display: 'block', opacity: 0.8 }}>
                Not let in automatically: {describeRejection(request.rejection)}.
              </span>
            )}
          </span>
          <button
            type="button"
            className="access-request__grant"
            onClick={() => onGrant(request.userId)}
            disabled={granting !== null}
            title="Give them the workspace key, wrapped so only they can open it"
          >
            {granting === request.userId ? 'Giving…' : 'Give access'}
          </button>
          <button
            type="button"
            className="access-request__later"
            aria-label={`Remind me later about ${request.displayName}`}
            title="Hide until the next visit"
            onClick={() => setLater((current) => new Set(current).add(request.userId))}
            style={{
              background: 'none',
              border: 'none',
              padding: 2,
              cursor: 'pointer',
              color: 'inherit',
            }}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
