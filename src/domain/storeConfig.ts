/**
 * Where the store is, if there is one (WS8-R9, deployment shapes A-D).
 *
 * Absent means shapes A and B: the editor works exactly as it does today,
 * with no sign-in and nothing leaving the browser. Everything the store adds
 * is additive, so a deployment that never configures one sees no change.
 */
export function getStoreUrl(): string | null {
  const runtime = (globalThis as unknown as { window?: { __APP_CONFIG__?: { STORE_URL?: string } } }).window?.__APP_CONFIG__?.STORE_URL;
  const configured =
    typeof runtime === "string" && runtime.trim() && !runtime.includes("__STORE_URL__")
      ? runtime
      : ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_STORE_URL ?? "");
  const trimmed = configured.trim().replace(/\/+$/, "");
  return trimmed.length > 0 ? trimmed : null;
}
