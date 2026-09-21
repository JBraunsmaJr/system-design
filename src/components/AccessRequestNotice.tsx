/**
 * Someone is waiting to be let into the workspace (WS7-R8).
 *
 * Shown over the editor, where the person who can grant it is working,
 * with the grant action on the notice itself. "Later" hides it for this
 * visit only: dismissing a person permanently would leave them waiting
 * with nobody reminded they are.
 */
import { useState } from 'react';
import { UserPlus, X } from 'lucide-react';
import type { AccessRequest } from '../collab/useAccessRequests';

export interface AccessRequestNoticeProps {
  requests: AccessRequest[];
  granting: string | null;
  onGrant: (userId: string) => void;
}

export function AccessRequestNotice({ requests, granting, onGrant }: AccessRequestNoticeProps) {
  const [later, setLater] = useState<Set<string>>(() => new Set());
  const showing = requests.filter((request) => !later.has(request.userId));
  if (showing.length === 0) return null;

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
            background: 'var(--surface-raised, #1f2430)',
            border: '1px solid var(--border, #2d3342)',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)',
            fontSize: 13,
          }}
        >
          <UserPlus size={16} aria-hidden="true" />
          <span className="access-request__text" style={{ flex: 1 }}>
            <strong>{request.displayName}</strong> is waiting for access to this workspace.
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
