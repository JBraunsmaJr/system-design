/**
 * Asking the canvas to add something without dragging it there: pressing
 * Enter on a palette search result. The palette and the canvas sit in
 * different parts of the tree and share no parent that knows about either's
 * internals, so the request goes through this one small channel instead of
 * a chain of props through App. The canvas subscribes while it is mounted
 * and places the item at the centre of what is on screen.
 */
export interface PaletteAddRequest {
  /** One of the palette's drag types - see Palette.tsx. */
  mimeType: string;
  id: string;
}

type Listener = (request: PaletteAddRequest) => void;

const listeners = new Set<Listener>();

export function onPaletteAddRequest(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Returns false when no canvas is there to take it. */
export function requestPaletteAdd(request: PaletteAddRequest): boolean {
  if (listeners.size === 0) return false;
  for (const listener of listeners) listener(request);
  return true;
}
