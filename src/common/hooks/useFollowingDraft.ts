import { useState } from 'react';

/**
 * Text being typed into a box that is written to the document only when
 * the box is left (so a shared document is not rewritten on every key).
 *
 * The draft follows the stored value: when someone else changes it, or it
 * is changed elsewhere on the page, the box shows the new text. The one
 * exception is a box this person has typed in and not yet left - their
 * text stays, and is what gets written when they leave.
 *
 * Without this a box keeps the text it was first drawn with, and a
 * collaborator's change never appears in an item that is already open.
 */
export function useFollowingDraft(stored: string): [string, (next: string) => void] {
  const [draft, setDraft] = useState(stored);
  const [seen, setSeen] = useState(stored);
  // Adjusted while rendering rather than in an effect, so the new text is
  // in the first paint after the change.
  if (stored !== seen) {
    setSeen(stored);
    if (draft === seen) setDraft(stored);
  }
  return [draft, setDraft];
}
