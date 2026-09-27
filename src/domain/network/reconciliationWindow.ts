/**
 * The reconciliation window (WS8-R11): how long a client may be disconnected
 * and still merge without loss. Rebase is blocked inside it (WS4-R8), because
 * a rebased document shares no history with the old one and anything a client
 * did offline on the old one would be orphaned.
 *
 * Configured per deployment with VITE_RECONCILIATION_WINDOW_DAYS. Default 30
 * days, and never shorter than the supported offline period of one week.
 */
export const DEFAULT_RECONCILIATION_WINDOW_DAYS = 30;
export const MINIMUM_RECONCILIATION_WINDOW_DAYS = 7;

export function resolveReconciliationWindowDays(configured: unknown): number {
  const days =
    typeof configured === 'string' && configured.trim() !== '' ? Number(configured) : Number.NaN;
  if (!Number.isFinite(days)) return DEFAULT_RECONCILIATION_WINDOW_DAYS;
  return Math.max(MINIMUM_RECONCILIATION_WINDOW_DAYS, Math.round(days));
}

export function reconciliationWindowMs(): number {
  const configured = (import.meta as unknown as { env?: Record<string, unknown> }).env
    ?.VITE_RECONCILIATION_WINDOW_DAYS;
  return resolveReconciliationWindowDays(configured) * 86_400_000;
}
