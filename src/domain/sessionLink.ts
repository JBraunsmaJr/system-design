/**
 * Utilities for creating and parsing shareable collaborative session links.
 *
 * Sessions are shared via a direct link containing:
 * - session: The room name / session ID
 * - key / password: The cryptographic session key for end-to-end encryption
 * - relay (optional): The signaling relay URL(s) if different from the deployment default
 *
 * Using URL hash parameters (`#session=...&key=...&relay=...`) ensures that
 * the link and cryptographic key are handled entirely on the client side
 * and never sent over the wire to web servers during HTTP requests.
 */

export interface CreateSessionLinkOptions {
  roomName: string;
  password?: string;
  key?: string;
  signalingUrlsInput?: string;
  defaultSignalingUrls?: string;
  baseUrl?: string;
}

export interface ParsedSessionInfo {
  roomName: string;
  password?: string;
  key?: string;
  relay?: string;
}

/**
 * Generates a cryptographically secure random session key for room encryption.
 */
export function generateSessionKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return (
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2)
  );
}

/**
 * Derives the base application URL for session link generation.
 *
 * Checks in order:
 * 1. Runtime config injected into `window.__APP_CONFIG__.APP_URL` or `BASE_URL`
 * 2. Build-time environment variable `import.meta.env.VITE_APP_URL` or `VITE_BASE_URL`
 * 3. `window.location.origin + window.location.pathname` (or stripped href)
 */
export function getBaseAppUrl(): string {
  if (typeof window !== "undefined") {
    const runtimeConfig = (
      window as unknown as {
        __APP_CONFIG__?: {
          APP_URL?: string;
          BASE_URL?: string;
          appUrl?: string;
          baseUrl?: string;
        };
      }
    ).__APP_CONFIG__;
    if (runtimeConfig) {
      const val =
        runtimeConfig.APP_URL ||
        runtimeConfig.BASE_URL ||
        runtimeConfig.appUrl ||
        runtimeConfig.baseUrl;
      if (val && typeof val === "string" && val.trim()) {
        return val.trim().replace(/\/+$/, "");
      }
    }
  }
  if (typeof import.meta !== "undefined" && typeof import.meta.env !== "undefined") {
    const envVal =
      (import.meta.env.VITE_APP_URL as string | undefined) ||
      (import.meta.env.VITE_BASE_URL as string | undefined);
    if (envVal && typeof envVal === "string" && envVal.trim()) {
      return envVal.trim().replace(/\/+$/, "");
    }
  }
  if (typeof window !== "undefined" && window.location) {
    return window.location.href.split("#")[0].split("?")[0];
  }
  return "";
}

/**
 * Creates a shareable session URL.
 *
 * Automatically includes the cryptographic encryption key so any recipient
 * can join and sync without needing manual password setup.
 *
 * Only includes the `relay` parameter if `signalingUrlsInput` is non-empty and
 * differs from `defaultSignalingUrls`, keeping links concise when using the
 * standard deployment relay.
 */
export function createSessionLink(options: CreateSessionLinkOptions): string {
  const base =
    options.baseUrl !== undefined
      ? options.baseUrl
      : getBaseAppUrl();

  const params = new URLSearchParams();
  if (options.roomName) {
    params.set("session", options.roomName);
  }

  const encryptionKey = options.key || options.password;
  if (encryptionKey) {
    params.set("key", encryptionKey);
  }

  const currentRelay = options.signalingUrlsInput?.trim();
  const defaultRelay = options.defaultSignalingUrls?.trim();

  if (currentRelay && currentRelay !== defaultRelay) {
    params.set("relay", currentRelay);
  }

  const queryString = params.toString();
  if (!queryString) return base;

  return `${base}#${queryString}`;
}

/**
 * Removes session-related parameters (session, key, password, relay) from a URL string,
 * returning a clean base URL suitable for displaying in the address bar without exposing
 * session identifiers or cryptographic keys to screen shares or livestreams.
 */
export function cleanSessionFromUrl(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== "string") return "";
  try {
    const isRelative = !rawUrl.startsWith("http://") && !rawUrl.startsWith("https://");
    const dummyBase = "https://system-design.local";
    const parsedUrl = new URL(rawUrl, isRelative ? dummyBase : undefined);

    const sessionParamNames = [
      "session",
      "room",
      "id",
      "key",
      "k",
      "password",
      "pwd",
      "p",
      "secret",
      "relay",
      "signaling",
      "relayUrl",
      "signalingUrl",
    ];

    // 1. Clean query search params
    for (const param of sessionParamNames) {
      parsedUrl.searchParams.delete(param);
    }

    // 2. Clean hash params if hash formatted as params
    if (parsedUrl.hash) {
      let hashContent = parsedUrl.hash.slice(1);
      const prefix = hashContent.startsWith("/") ? "/" : "";
      if (prefix) hashContent = hashContent.slice(1);

      if (hashContent.includes("=") || hashContent.includes("&")) {
        const hashParams = new URLSearchParams(hashContent);
        let hashModified = false;
        for (const param of sessionParamNames) {
          if (hashParams.has(param)) {
            hashParams.delete(param);
            hashModified = true;
          }
        }
        if (hashModified) {
          const remaining = hashParams.toString();
          parsedUrl.hash = remaining ? `${prefix}${remaining}` : "";
        }
      } else if (sessionParamNames.some((p) => hashContent.startsWith(`${p}=`))) {
        parsedUrl.hash = "";
      }
    }

    if (isRelative) {
      return parsedUrl.pathname + parsedUrl.search + parsedUrl.hash;
    }
    return parsedUrl.toString();
  } catch {
    return rawUrl.split("#")[0].split("?")[0];
  }
}

/**
 * Strips collaborative session parameters (room ID, key, relay) from the current
 * browser URL and updates the browser history state so the room code and encryption key
 * are not visible in the address bar during screen sharing or livestreaming.
 */
export function sanitizeCurrentUrl(): void {
  if (typeof window === "undefined" || !window.history?.replaceState) return;
  try {
    const currentUrl = window.location.href;
    const cleanUrl = cleanSessionFromUrl(currentUrl);
    if (cleanUrl && cleanUrl !== currentUrl) {
      window.history.replaceState(window.history.state, document.title, cleanUrl);
    }
  } catch {
    // Graceful fallback if history API is restricted in sandbox
  }
}

/**
 * Parses a user input string which may be:
 * 1. A full URL with hash params (e.g. `https://example.com/#session=session-xyz&key=...&relay=ws%3A%2F%2F...`)
 * 2. A full URL with search query params (e.g. `https://example.com/?session=session-xyz...`)
 * 3. A formatted or markdown link (e.g. `[Join](https://example.com/#session=...)` or `<https://example.com/#session=...>`)
 * 4. A JSON object string (e.g. `{"session":"session-xyz","key":"...","relay":"..."}`)
 * 5. A multi-line or inline DM text (e.g. `Session: session-xyz\nKey: ...\nRelay: ...`)
 * 6. A hash or query fragment (e.g. `#session=session-xyz...` or `?session=session-xyz...`)
 * 7. A raw parameter string (e.g. `session=session-xyz&key=...`)
 * 8. Pipe-separated string (e.g. `session-xyz | key123 | wss://...`)
 * 9. A bare room name / session ID (e.g. `session-1a2b3c4d`)
 */
export function parseSessionLink(rawInput: string): ParsedSessionInfo {
  let text = rawInput.trim();
  if (!text) {
    return { roomName: "" };
  }

  // 1. Strip markdown links, angle brackets, or quotes wrapping a URL or code
  const mdMatch = text.match(/\[.*?\]\((https?:\/\/[^\s)]+)\)/i);
  if (mdMatch) {
    text = mdMatch[1].trim();
  } else {
    text = text.replace(/^<([^>]+)>$/, "$1").trim();
    text = text.replace(/^["'`](.*)["'`]$/s, "$1").trim();
  }

  // 2. Check for JSON format (e.g. {"session": "session-123", "key": "...", "relay": "..."})
  if (text.startsWith("{") && text.endsWith("}")) {
    try {
      const obj = JSON.parse(text);
      if (typeof obj === "object" && obj !== null) {
        const roomName = obj.session || obj.roomName || obj.room || obj.id;
        const keyVal = obj.key || obj.k || obj.password || obj.pwd || obj.p || obj.secret;
        const relay = obj.relay || obj.signaling || obj.relayUrl || obj.signalingUrl || obj.server;
        if (roomName && typeof roomName === "string" && roomName.trim()) {
          const effectiveKey = keyVal !== undefined && keyVal !== null && keyVal !== "" ? String(keyVal) : undefined;
          return {
            roomName: roomName.trim(),
            key: effectiveKey,
            password: effectiveKey,
            relay: relay !== undefined && relay !== null && String(relay).trim() ? String(relay).trim() : undefined,
          };
        }
      }
    } catch {
      // Not valid JSON, continue
    }
  }

  // 3. Check for URL with hash/query params, or raw URL-encoded query params (e.g. #session=... or ?session=... or session=...&key=...)
  let paramString = "";
  if (text.includes("#")) {
    paramString = text.slice(text.indexOf("#") + 1);
  } else if (text.includes("?")) {
    paramString = text.slice(text.indexOf("?") + 1);
  } else if (
    (text.includes("session=") || text.includes("room=") || text.includes("id=")) &&
    (text.includes("&") || text.includes("key=") || text.includes("password=") || text.includes("pwd=") || text.includes("relay=") || text.includes("signaling="))
  ) {
    paramString = text;
  }

  if (paramString) {
    try {
      const params = new URLSearchParams(paramString);
      const roomName = params.get("session") || params.get("room") || params.get("id");
      const keyVal =
        params.get("key") ||
        params.get("k") ||
        params.get("password") ||
        params.get("pwd") ||
        params.get("p") ||
        params.get("secret");
      const relay =
        params.get("relay") ||
        params.get("signaling") ||
        params.get("relayUrl") ||
        params.get("signalingUrl");

      if (roomName && roomName.trim()) {
        const effectiveKey = keyVal !== null && keyVal !== "" ? keyVal : undefined;
        return {
          roomName: roomName.trim(),
          key: effectiveKey,
          password: effectiveKey,
          relay: relay && relay.trim() ? relay.trim() : undefined,
        };
      }
    } catch {
      // If parsing fails, fall through
    }
  }

  // 4. Check for formatted DM text (e.g. "Session: session-xyz\nKey: ...\nRelay: ...")
  if (/(?:^|[\r\n,;])\s*(?:session(?:\s*id)?|room(?:\s*name)?)\s*[:=]\s*([^\r\n,;|]+)/i.test(text)) {
    const sessionMatch = text.match(/(?:^|[\r\n,;])\s*(?:session(?:\s*id)?|room(?:\s*name)?)\s*[:=]\s*([^\r\n,;|]+)/i);
    const keyMatch = text.match(/(?:key|k|password|pwd|pass|secret)\s*[:=]\s*([^\r\n,;|]+)/i);
    const relayMatch = text.match(/(?:relay(?:\s*url|\s*server)?|signaling(?:\s*url)?|server)\s*[:=]\s*([^\r\n,;|]+)/i);

    if (sessionMatch && sessionMatch[1].trim()) {
      const rawRoom = sessionMatch[1].trim();
      if (rawRoom.includes("#") || rawRoom.includes("?") || rawRoom.includes("session=")) {
        const nested = parseSessionLink(rawRoom);
        if (nested.roomName) {
          const effectiveKey = nested.key ?? nested.password ?? (keyMatch ? keyMatch[1].trim() : undefined);
          return {
            roomName: nested.roomName,
            key: effectiveKey,
            password: effectiveKey,
            relay: nested.relay ?? (relayMatch ? relayMatch[1].trim() : undefined),
          };
        }
      }
      const effectiveKey = keyMatch && keyMatch[1].trim() ? keyMatch[1].trim() : undefined;
      return {
        roomName: rawRoom,
        key: effectiveKey,
        password: effectiveKey,
        relay: relayMatch && relayMatch[1].trim() ? relayMatch[1].trim() : undefined,
      };
    }
  }

  // 5. Check pipe-separated format: "session-xyz | key123 | wss://relay..."
  if (text.includes("|") && !/^[a-z]+:\/\//i.test(text) && !text.startsWith("#") && !text.startsWith("?")) {
    const parts = text.split("|").map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 1 && (parts[0].startsWith("session-") || parts[0].length >= 4)) {
      const effectiveKey = parts[1] ? parts[1] : undefined;
      return {
        roomName: parts[0],
        key: effectiveKey,
        password: effectiveKey,
        relay: parts[2] ? parts[2] : undefined,
      };
    }
  }

  // 6. Bare session code / room name (or simple key-value like "session=abc")
  if (text.startsWith("session=") || text.startsWith("room=") || text.startsWith("id=")) {
    try {
      const params = new URLSearchParams(text);
      const roomName = params.get("session") || params.get("room") || params.get("id");
      if (roomName && roomName.trim()) {
        return { roomName: roomName.trim() };
      }
    } catch {
      // Fall through
    }
  }

  return {
    roomName: text,
  };
}
