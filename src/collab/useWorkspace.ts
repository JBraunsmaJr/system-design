/**
 * The editor's connection to a store, when one is configured (WS9-R4).
 *
 * A deployment with no store never reaches any of this: `configured` is
 * false, nothing is fetched, and the editor behaves exactly as it does
 * offline. Where there is one, this hook owns the sign-in state, the list of
 * workspace documents, and saving the open document to it.
 *
 * Document keys never reach the store. Each document's key is generated in
 * the browser, wrapped under the workspace key, and kept in the sealed index
 * (WS7-R3); the storage key is derived from it (WS7-R1).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createStoreClient, StoreClientError, type IndexEntry, type SessionInfo, type StoreClient } from "./storeClient.ts";
import { getStoreUrl } from "../domain/storeConfig.ts";
import { documentKeyFor, indexKeyFor, newDocumentKey, removeEntry, upsertEntry } from "./workspaceDocuments.ts";
import type { DiagramFile } from "../domain/serialization.ts";

export type WorkspaceStatus = "unconfigured" | "checking" | "offline" | "signed-out" | "ready";

export interface WorkspaceState {
  status: WorkspaceStatus;
  /** True where a store is configured at all. */
  configured: boolean;
  session: SessionInfo | null;
  providers: string[];
  /** WS6-R3: true when the store can read document content. */
  serverReadsContent: boolean;
  entries: IndexEntry[];
  busy: boolean;
  error: string | null;
}

export interface WorkspaceApi extends WorkspaceState {
  /** Sends the browser to the provider; the store handles the rest. */
  signIn(provider: string): void;
  signOut(): Promise<void>;
  refresh(): Promise<void>;
  /** Uploads the open document, sealed, and lists it in the index. */
  save(docId: string, file: DiagramFile): Promise<void>;
  /** Fetches and opens a workspace document. */
  open(entry: IndexEntry): Promise<DiagramFile>;
  remove(entry: IndexEntry): Promise<void>;
}

const WORKSPACE_ID = "default";

export interface WorkspaceOptions {
  /** Injected in tests. */
  client?: StoreClient;
  storeUrl?: string | null;
  /** The workspace key, once a device has unwrapped it. Until then the list
   * cannot be read, which is the point: the store cannot read it either. */
  workspaceKey?: CryptoKey | null;
}

export function useWorkspace(options: WorkspaceOptions = {}): WorkspaceApi {
  const storeUrl = options.storeUrl !== undefined ? options.storeUrl : getStoreUrl();
  const [client] = useState<StoreClient | null>(() => options.client ?? (storeUrl ? createStoreClient({ baseUrl: storeUrl }) : null));
  const [status, setStatus] = useState<WorkspaceStatus>(client ? "checking" : "unconfigured");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [providers, setProviders] = useState<string[]>([]);
  const [serverReadsContent, setServerReadsContent] = useState(false);
  const [entries, setEntries] = useState<IndexEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workspaceKey = options.workspaceKey ?? null;
  const indexKeyRef = useRef<CryptoKey | null>(null);

  /** The index is sealed under a key derived from the workspace key, so a
   * device that cannot unwrap the workspace key cannot read the list. */
  const indexKey = useCallback(async (): Promise<CryptoKey | null> => {
    if (!workspaceKey) return null;
    if (!indexKeyRef.current) indexKeyRef.current = await indexKeyFor(workspaceKey);
    return indexKeyRef.current;
  }, [workspaceKey]);

  const describe = (failure: unknown): string => {
    if (failure instanceof StoreClientError) {
      if (failure.reason === "offline") return "The workspace is unreachable. Your work is saved in this browser.";
      if (failure.reason === "unauthenticated") return "Sign in to use the workspace.";
      if (failure.reason === "rolled-back") return "The workspace returned an older version than this browser has already seen. Nothing was applied.";
      return failure.message;
    }
    return String(failure);
  };

  const refresh = useCallback(async () => {
    if (!client) return;
    setBusy(true);
    try {
      const health = await client.health();
      setServerReadsContent(health.cryptoMode === "passthrough");
      const who = health.authentication === "none" ? ({ issuer: "none", subject: "anonymous" } as SessionInfo) : await client.session();
      setSession(who);
      if (!who) {
        setProviders(await client.providers());
        setStatus("signed-out");
        setEntries([]);
        return;
      }
      setStatus("ready");
      const key = await indexKey();
      setEntries(key ? (await client.readIndex(WORKSPACE_ID, key)).entries : []);
      setError(null);
    } catch (failure) {
      setStatus(failure instanceof StoreClientError && failure.reason === "offline" ? "offline" : "signed-out");
      setError(describe(failure));
    } finally {
      setBusy(false);
    }
  }, [client, indexKey]);

  useEffect(() => {
    // Deferred by a microtask: refresh() sets state, and doing that
    // synchronously inside an effect cascades renders.
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) return refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const save = useCallback(
    async (docId: string, file: DiagramFile) => {
      if (!client) return;
      const key = await indexKey();
      if (!workspaceKey || !key) throw new StoreClientError("This device cannot write to the workspace yet.", "unauthenticated");
      setBusy(true);
      try {
        const existing = entries.find((entry) => entry.docId === docId);
        // A document's key is made here and never sent: the store only ever
        // receives it wrapped under the workspace key (WS7-R3).
        const fresh = existing ? null : await newDocumentKey(workspaceKey);
        const documentKey = existing ? await documentKeyFor(existing, workspaceKey) : fresh!.documentKey;
        const wrappedDocKey = existing ? existing.wrappedDocKey : fresh!.wrappedDocKey;
        await client.putDocument(docId, documentKey, file, { wrappedForWorkspace: wrappedDocKey });
        const entry: IndexEntry = { docId, wrappedDocKey, title: file.title, updatedAt: new Date().toISOString() };
        const next = await client.updateIndex(WORKSPACE_ID, key, (current) => upsertEntry(current, entry));
        setEntries(next);
        setError(null);
      } catch (failure) {
        setError(describe(failure));
        throw failure;
      } finally {
        setBusy(false);
      }
    },
    [client, entries, indexKey, workspaceKey],
  );

  const open = useCallback(
    async (entry: IndexEntry): Promise<DiagramFile> => {
      if (!client || !workspaceKey) throw new StoreClientError("This device cannot read the workspace yet.", "unauthenticated");
      const documentKey = await documentKeyFor(entry, workspaceKey);
      const { file } = await client.getDocument(entry.docId, documentKey);
      return file;
    },
    [client, workspaceKey],
  );

  const remove = useCallback(
    async (entry: IndexEntry) => {
      if (!client) return;
      const key = await indexKey();
      await client.deleteDocument(entry.docId);
      if (key) {
        const next = await client.updateIndex(WORKSPACE_ID, key, (current) => removeEntry(current, entry.docId));
        setEntries(next);
      }
    },
    [client, indexKey],
  );

  const signIn = useCallback(
    (provider: string) => {
      if (!storeUrl) return;
      // A full navigation: the store is the OAuth client, and the session
      // comes back as a cookie (WS10-R1).
      globalThis.location.assign(`${storeUrl}/v1/auth/${encodeURIComponent(provider)}/start`);
    },
    [storeUrl],
  );

  const signOut = useCallback(async () => {
    if (!client) return;
    await client.logout();
    await refresh();
  }, [client, refresh]);

  return useMemo(
    () => ({
      status,
      configured: client !== null,
      session,
      providers,
      serverReadsContent,
      entries,
      busy,
      error,
      signIn,
      signOut,
      refresh,
      save,
      open,
      remove,
    }),
    [status, client, session, providers, serverReadsContent, entries, busy, error, signIn, signOut, refresh, save, open, remove],
  );
}
