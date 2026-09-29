import type { RequirementsDocument } from '../../domain/requirements/requirementsTypes';
import type { PresenceInfo } from '../../collab/sync/session';

interface PresenceAvatarStackProps {
  peers: PresenceInfo[];
  requirements: RequirementsDocument;
}

function getPresenceInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/[\s_-]+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

/**
 * Who else is on the Timeline view, as a stack of avatars.
 *
 * Moved unchanged from TimelineView.tsx. Not memoized, as before: it
 * re-renders with its parent exactly as it did when it lived there.
 */
export function PresenceAvatarStack({ peers, requirements }: PresenceAvatarStackProps) {
  if (peers.length === 0) return null;

  const MAX_DISPLAY = 4;
  const displayPeers = peers.slice(0, MAX_DISPLAY);
  const overflowCount = peers.length - MAX_DISPLAY;

  const summaryLines = peers.map((p) => {
    const focusedItem = p.focusedItemId
      ? requirements.items.find((it) => it.id === p.focusedItemId)
      : null;
    const action = focusedItem ? `viewing ${focusedItem.id}: ${focusedItem.title}` : 'browsing';
    return `• ${p.name} (${action})`;
  });

  const titleText = `Users on Timeline (${peers.length}):\n${summaryLines.join('\n')}`;

  return (
    <div
      className="timeline-view__presence-stack"
      title={titleText}
      aria-label={`Users on Timeline: ${peers.length}`}
    >
      <div className="timeline-view__presence-avatars">
        {displayPeers.map((p, idx) => {
          const focusedItem = p.focusedItemId
            ? requirements.items.find((it) => it.id === p.focusedItemId)
            : null;
          const statusText = focusedItem
            ? `viewing ${focusedItem.id}: ${focusedItem.title}`
            : 'browsing';
          return (
            <span
              key={p.clientId}
              className="timeline-view__presence-avatar"
              style={{
                backgroundColor: p.color,
                zIndex: displayPeers.length - idx,
              }}
              title={`${p.name} — ${statusText}`}
            >
              {getPresenceInitials(p.name)}
            </span>
          );
        })}
        {overflowCount > 0 && (
          <span
            className="timeline-view__presence-avatar timeline-view__presence-avatar--more"
            style={{ zIndex: 0 }}
            title={`${overflowCount} more user${overflowCount === 1 ? '' : 's'}`}
          >
            +{overflowCount}
          </span>
        )}
      </div>

      <div className="timeline-view__presence-popover" role="tooltip">
        <div className="timeline-view__presence-popover-header">
          Users on Timeline ({peers.length})
        </div>
        <div className="timeline-view__presence-popover-list">
          {peers.map((p) => {
            const focusedItem = p.focusedItemId
              ? requirements.items.find((it) => it.id === p.focusedItemId)
              : null;
            const statusText = focusedItem
              ? `viewing ${focusedItem.id}: ${focusedItem.title}`
              : 'browsing';
            return (
              <div key={p.clientId} className="timeline-view__presence-popover-item">
                <span
                  className="timeline-view__presence-popover-avatar"
                  style={{ backgroundColor: p.color }}
                >
                  {getPresenceInitials(p.name)}
                </span>
                <div className="timeline-view__presence-popover-info">
                  <span className="timeline-view__presence-popover-name">{p.name}</span>
                  <span className="timeline-view__presence-popover-status">{statusText}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
