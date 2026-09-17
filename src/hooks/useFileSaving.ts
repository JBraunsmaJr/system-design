/**
 * Continuous saving to a file on disk (WS13-R1 to R4, R8).
 *
 * Wraps createFileBackedAutosave with the state the interface needs, and owns
 * the order of operations the browser imposes: a stored handle is re-acquired
 * on load (R2) but write permission is not, so it waits for a click; writes are
 * atomic (R3, via createWritable); a file changed elsewhere stops writing and
 * asks (R4). Nothing here ever reports the file as written unless a write to it
 * has just succeeded (R8).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createFileBackedAutosave,
  createIndexedDbHandleStore,
  isFileAccessSupported,
  type FileBackedAutosave,
  type FileHandleLike,
  type FileHandleStore,
} from "../domain/fileBackedAutosave";
import type { DurabilitySignals } from "../domain/durability";

type Status =
  /** No file. */
  | "none"
  /** Permission granted; not written since attaching. */
  | "attached"
  /** The last write succeeded. The only state that means "file-backed". */
  | "written"
  | "needs-permission"
  | "denied"
  | "conflict"
  | "failed";

export interface FileSavingDeps {
  autosave?: FileBackedAutosave;
  handles?: FileHandleStore;
  supported?: boolean;
  pickFile?: (suggestedName: string) => Promise<FileHandleLike>;
}

export interface FileSaving {
  access: "available" | "unavailable";
  /** For the durability indicator. */
  signals: Pick<DurabilitySignals, "fileAccess" | "fileAttachment" | "fileBacked">;
  fileName: string | null;
  /** Bumped whenever the file is ready for a write it has not had yet, so
   * the caller's autosave can run again without waiting for an edit. */
  writeEpoch: number;
  /** Must be called from a user gesture: opens the save picker. */
  attach(suggestedName: string): Promise<void>;
  /** Must be called from a user gesture: re-requests write permission. */
  resume(): Promise<void>;
  detach(): Promise<void>;
  write(contents: string): Promise<void>;
  /** Overwrite the externally changed file with `contents`. */
  overwrite(contents: string): Promise<void>;
  /** The external file's contents, after which writing continues from them. */
  reloadExternal(): Promise<string | null>;
}

function defaultPicker(suggestedName: string): Promise<FileHandleLike> {
  const picker = (globalThis as unknown as {
    showSaveFilePicker: (options: unknown) => Promise<FileHandleLike>;
  }).showSaveFilePicker;
  return picker({
    suggestedName,
    types: [{ description: "Diagram", accept: { "application/json": [".json"] } }],
  });
}

export function useFileSaving(docId: string, deps: FileSavingDeps = {}): FileSaving {
  const [autosave] = useState(() => deps.autosave ?? createFileBackedAutosave());
  const [handles] = useState(() => deps.handles ?? createIndexedDbHandleStore());
  const [supported] = useState(() => deps.supported ?? isFileAccessSupported());
  const pickFile = deps.pickFile ?? defaultPicker;

  const [status, setStatusState] = useState<Status>("none");
  // Read by write(), so write() keeps one identity: callers list it as an
  // effect dependency, and a new identity after every write would schedule
  // another one.
  const statusRef = useRef<Status>("none");
  const setStatus = useCallback((next: Status) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);
  const [fileName, setFileName] = useState<string | null>(null);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [handle, setHandle] = useState<FileHandleLike | null>(null);
  const [writeEpoch, setWriteEpoch] = useState(0);

  const adopt = useCallback((state: ReturnType<FileBackedAutosave["state"]>) => {
    const next: Status = state === "attached" ? "attached" : state === "none" ? "none" : state;
    setStatus(next);
    setFileName(autosave.fileName());
    if (next === "attached") setWriteEpoch((n) => n + 1);
  }, [autosave, setStatus]);

  // WS13-R2: re-acquire this document's handle on load. Permission is only
  // queried here - asking needs a click.
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    void handles.get(docId).then(async (stored) => {
      if (cancelled || !stored) return;
      setHandle(stored);
      const state = await autosave.attach(stored);
      if (!cancelled) adopt(state);
    }).catch(() => {
      // An unreadable handle store is the same as no file.
    });
    return () => {
      cancelled = true;
    };
  }, [docId, supported, handles, autosave, adopt]);

  const attach = useCallback(async (suggestedName: string) => {
    if (!supported) return;
    let picked: FileHandleLike;
    try {
      picked = await pickFile(suggestedName);
    } catch {
      // Cancelled, or refused: nothing changes.
      return;
    }
    setHandle(picked);
    setMessage(undefined);
    let state = await autosave.attach(picked);
    // The picker grants access in most browsers; ask once more in case not.
    if (state === "needs-permission") state = await autosave.requestPermission();
    adopt(state);
    try {
      await handles.set(docId, picked);
    } catch {
      // The file still works this visit; it just will not be remembered.
    }
  }, [supported, pickFile, autosave, adopt, handles, docId]);

  const resume = useCallback(async () => {
    adopt(await autosave.requestPermission());
  }, [autosave, adopt]);

  const detach = useCallback(async () => {
    autosave.detach();
    setHandle(null);
    setStatus("none");
    setFileName(null);
    setMessage(undefined);
    try {
      await handles.delete(docId);
    } catch {
      // Nothing to forget.
    }
  }, [autosave, handles, docId, setStatus]);

  const applyWrite = useCallback((result: Awaited<ReturnType<FileBackedAutosave["write"]>>) => {
    if (result.ok) {
      setStatus("written");
      setMessage(undefined);
    } else if (result.reason === "conflict") {
      setStatus("conflict");
      setMessage(result.message);
    } else if (result.reason === "permission") {
      setStatus(autosave.state() === "denied" ? "denied" : "needs-permission");
      setMessage(result.message);
    } else {
      setStatus("failed");
      setMessage(result.message);
    }
  }, [autosave, setStatus]);

  const write = useCallback(async (contents: string) => {
    // A conflict waits for the user; a missing permission waits for a click.
    const current = statusRef.current;
    if (current !== "attached" && current !== "written" && current !== "failed") return;
    applyWrite(await autosave.write(contents));
  }, [autosave, applyWrite]);

  const overwrite = useCallback(async (contents: string) => {
    applyWrite(await autosave.overwrite(contents));
  }, [autosave, applyWrite]);

  const reloadExternal = useCallback(async () => {
    const text = await autosave.readExternal();
    // Re-adopting records the file's current timestamp, so the next write is
    // measured against the version just loaded rather than refused again.
    if (handle) adopt(await autosave.attach(handle));
    return text;
  }, [autosave, handle, adopt]);

  const signals = useMemo<FileSaving["signals"]>(() => {
    const fileAccess = supported ? "available" : "unavailable";
    const attachment =
      fileName && (status === "needs-permission" || status === "denied" || status === "conflict" || status === "failed")
        ? { fileName, status, message }
        : null;
    return { fileAccess, fileAttachment: attachment, fileBacked: status === "written" };
  }, [supported, fileName, status, message]);

  return {
    access: supported ? "available" : "unavailable",
    signals,
    fileName,
    writeEpoch,
    attach,
    resume,
    detach,
    write,
    overwrite,
    reloadExternal,
  };
}
