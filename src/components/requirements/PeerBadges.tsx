import type { PresenceInfo } from '../../collab/sync/session';

/**
 * Who else in a collaborative session is editing an item right now: one
 * colored initial each, with their names in the tooltip. Renders nothing
 * outside a session or when nobody else is on the item. Shared by the card
 * and the open item in the table and split view.
 */
export function PeerBadges({ peers }: { peers: readonly PresenceInfo[] }) {
  if (peers.length === 0) return null;
  const names = peers.map((p) => p.name).join(', ');
  return (
    <span
      className="requirement-card__peers"
      title={`${names} ${peers.length === 1 ? 'is' : 'are'} editing this`}
      aria-label={`${names} ${peers.length === 1 ? 'is' : 'are'} editing this`}
    >
      {peers.map((p) => (
        <span
          key={p.clientId}
          className="requirement-card__peer-dot"
          style={{ backgroundColor: p.color }}
          aria-hidden
        >
          {p.name.charAt(0).toUpperCase()}
        </span>
      ))}
    </span>
  );
}
