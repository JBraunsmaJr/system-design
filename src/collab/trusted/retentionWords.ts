/**
 * How long a deleted document is kept, in words (pure).
 *
 * A deleted document stays in the store until its retention ends, so it can
 * be restored. A hold keeps it past that, until an administrator releases
 * it. The store reports the dates; this turns them into a sentence, with
 * the hold taking precedence because it is the one that decides.
 */
import type { TrustedDocument } from './trustedStoreClient.ts';

const DAY_MS = 86_400_000;

type Retained = Pick<TrustedDocument, 'deletedAt' | 'purgeAfter' | 'legalHold'>;

export function describeRetention(
  document: Retained,
  now: Date,
  formatDate: (date: Date) => string = (date) => date.toLocaleDateString(),
): string {
  if (document.legalHold) {
    return `On hold, so it is kept until the hold is released. Reason: ${document.legalHold.reason}`;
  }
  const purgeAt = document.purgeAfter ? new Date(document.purgeAfter) : null;
  if (!purgeAt || Number.isNaN(purgeAt.getTime())) {
    return 'Kept until an administrator removes it.';
  }
  const days = Math.ceil((purgeAt.getTime() - now.getTime()) / DAY_MS);
  if (days <= 0) return 'Due to be removed the next time the store clears out old documents.';
  if (days === 1) return `Can be restored until ${formatDate(purgeAt)} (1 day left).`;
  return `Can be restored until ${formatDate(purgeAt)} (${days} days left).`;
}

/** Deleted documents, most recently deleted first. */
export function deletedFirstByRecency<T extends Pick<TrustedDocument, 'deletedAt'>>(
  documents: readonly T[],
): T[] {
  return documents
    .filter((document) => document.deletedAt !== null)
    .sort((a, b) => (a.deletedAt! < b.deletedAt! ? 1 : a.deletedAt! > b.deletedAt! ? -1 : 0));
}
