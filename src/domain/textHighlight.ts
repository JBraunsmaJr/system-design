export interface HighlightSegment {
  text: string;
  isMatch: boolean;
  start: number;
  end: number;
}

/**
 * Splits a text string into matching and non-matching segments based on a search query.
 * Case-insensitive match.
 */
export function splitByHighlight(text: string, query: string): HighlightSegment[] {
  if (!text) return [];
  const trimmed = query.trim();
  if (!trimmed) {
    return [{ text, isMatch: false, start: 0, end: text.length }];
  }

  const segments: HighlightSegment[] = [];
  const lowerText = text.toLowerCase();
  const lowerQuery = trimmed.toLowerCase();
  const queryLen = lowerQuery.length;

  let lastIndex = 0;
  let matchIndex = lowerText.indexOf(lowerQuery, lastIndex);

  while (matchIndex !== -1) {
    if (matchIndex > lastIndex) {
      segments.push({
        text: text.slice(lastIndex, matchIndex),
        isMatch: false,
        start: lastIndex,
        end: matchIndex,
      });
    }

    segments.push({
      text: text.slice(matchIndex, matchIndex + queryLen),
      isMatch: true,
      start: matchIndex,
      end: matchIndex + queryLen,
    });

    lastIndex = matchIndex + queryLen;
    matchIndex = lowerText.indexOf(lowerQuery, lastIndex);
  }

  if (lastIndex < text.length) {
    segments.push({
      text: text.slice(lastIndex),
      isMatch: false,
      start: lastIndex,
      end: text.length,
    });
  }

  return segments;
}

export interface TruncationHighlightResult {
  isTruncated: boolean;
  visibleText: string;
  hasMatchInVisible: boolean;
  hasMatchInTruncated: boolean;
  ellipsis: string;
}

/**
 * Computes how a text should be truncated given an available width and a width-measuring function.
 * Also determines whether search query matches appear in the visible text and/or in the truncated part (after the ellipsis).
 */
export function computeTruncationWithHighlight(
  text: string,
  query: string,
  availableWidth: number,
  measureText: (s: string) => number,
  ellipsis: string = "..."
): TruncationHighlightResult {
  if (!text) {
    return {
      isTruncated: false,
      visibleText: "",
      hasMatchInVisible: false,
      hasMatchInTruncated: false,
      ellipsis,
    };
  }

  const trimmedQuery = query.trim();
  const lowerQuery = trimmedQuery.toLowerCase();
  const lowerText = text.toLowerCase();
  const hasAnyMatch = lowerQuery.length > 0 && lowerText.includes(lowerQuery);

  if (availableWidth <= 0 || measureText(text) <= availableWidth) {
    return {
      isTruncated: false,
      visibleText: text,
      hasMatchInVisible: hasAnyMatch,
      hasMatchInTruncated: false,
      ellipsis,
    };
  }

  const ellipsisWidth = measureText(ellipsis);
  const targetWidth = Math.max(0, availableWidth - ellipsisWidth);

  // Binary search for the maximum prefix that fits within targetWidth
  let low = 0;
  let high = text.length;
  let cutIndex = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const prefix = text.slice(0, mid);
    const width = measureText(prefix);
    if (width <= targetWidth) {
      cutIndex = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const visibleText = text.slice(0, cutIndex);

  let hasMatchInVisible = false;
  let hasMatchInTruncated = false;

  if (hasAnyMatch) {
    let matchIdx = lowerText.indexOf(lowerQuery, 0);
    while (matchIdx !== -1) {
      const matchEnd = matchIdx + lowerQuery.length;
      if (matchIdx < cutIndex) {
        hasMatchInVisible = true;
      }
      if (matchEnd > cutIndex) {
        hasMatchInTruncated = true;
      }
      matchIdx = lowerText.indexOf(lowerQuery, matchIdx + 1);
    }
  }

  return {
    isTruncated: true,
    visibleText,
    hasMatchInVisible,
    hasMatchInTruncated,
    ellipsis,
  };
}
