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
  leadingEllipsis: boolean;
  trailingEllipsis: boolean;
  ellipsis: string;
}

/**
 * Computes how a text should be truncated given an available width and a width-measuring function.
 * If a search query matches within a cut-off portion of the text, it reformats the visible slice
 * to window around the search match with context and leading/trailing ellipses as appropriate.
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
      leadingEllipsis: false,
      trailingEllipsis: false,
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
      leadingEllipsis: false,
      trailingEllipsis: false,
      ellipsis,
    };
  }

  const ellipsisWidth = measureText(ellipsis);

  if (!hasAnyMatch) {
    const targetWidth = Math.max(0, availableWidth - ellipsisWidth);
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

    return {
      isTruncated: true,
      visibleText: text.slice(0, cutIndex),
      hasMatchInVisible: false,
      hasMatchInTruncated: false,
      leadingEllipsis: false,
      trailingEllipsis: true,
      ellipsis,
    };
  }

  // There is a match in the text.
  const matchStart = lowerText.indexOf(lowerQuery);
  const matchEnd = matchStart + lowerQuery.length;

  // Check if standard prefix truncation starting from 0 includes the entire first match
  const prefixTargetWidth = Math.max(0, availableWidth - ellipsisWidth);
  let low = 0;
  let high = text.length;
  let prefixCutIndex = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const prefix = text.slice(0, mid);
    const width = measureText(prefix);
    if (width <= prefixTargetWidth) {
      prefixCutIndex = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (prefixCutIndex >= matchEnd) {
    let hasMatchInTruncated = false;
    let nextMatch = lowerText.indexOf(lowerQuery, matchEnd);
    while (nextMatch !== -1) {
      if (nextMatch + lowerQuery.length > prefixCutIndex) {
        hasMatchInTruncated = true;
        break;
      }
      nextMatch = lowerText.indexOf(lowerQuery, nextMatch + 1);
    }

    return {
      isTruncated: true,
      visibleText: text.slice(0, prefixCutIndex),
      hasMatchInVisible: true,
      hasMatchInTruncated,
      leadingEllipsis: false,
      trailingEllipsis: true,
      ellipsis,
    };
  }

  // The match is in the cut-off portion. Compute a snippet window centered/framed around the match.
  const matchText = text.slice(matchStart, matchEnd);
  const matchWidth = measureText(matchText);

  // If the match itself plus two ellipses is wider than available width
  if (matchWidth + 2 * ellipsisWidth >= availableWidth) {
    const startIdx = matchStart;
    const leadingEllipsis = startIdx > 0;
    const requiredStartEllipsis = leadingEllipsis ? ellipsisWidth : 0;
    let endIdx = matchStart;

    while (endIdx < matchEnd) {
      const candidateWidth =
        requiredStartEllipsis +
        measureText(text.slice(startIdx, endIdx + 1)) +
        (endIdx + 1 < text.length ? ellipsisWidth : 0);
      if (candidateWidth <= availableWidth) {
        endIdx++;
      } else {
        break;
      }
    }

    // Ensure at least 1 character if possible
    if (endIdx === startIdx && endIdx < text.length) {
      endIdx = startIdx + 1;
    }

    return {
      isTruncated: true,
      visibleText: text.slice(startIdx, endIdx),
      hasMatchInVisible: true,
      hasMatchInTruncated: endIdx < matchEnd || text.length > endIdx,
      leadingEllipsis,
      trailingEllipsis: endIdx < text.length,
      ellipsis,
    };
  }

  // Match fits within availableWidth with room for context
  const remainingBudget = Math.max(0, availableWidth - matchWidth - 2 * ellipsisWidth);
  const halfBudget = remainingBudget / 2;

  let startIdx = matchStart;
  // Step 1: Expand backwards from matchStart
  while (startIdx > 0 && measureText(text.slice(startIdx - 1, matchStart)) <= halfBudget) {
    startIdx--;
  }

  let endIdx = matchEnd;
  // Step 2: Expand forwards from matchEnd
  while (endIdx < text.length) {
    const testLeading = startIdx > 0 ? ellipsisWidth : 0;
    const testTrailing = endIdx + 1 < text.length ? ellipsisWidth : 0;
    const totalWidth = testLeading + measureText(text.slice(startIdx, endIdx + 1)) + testTrailing;
    if (totalWidth <= availableWidth) {
      endIdx++;
    } else {
      break;
    }
  }

  // Step 3: Reclaim any unused right space by expanding further backwards if startIdx > 0
  while (startIdx > 0) {
    const testLeading = startIdx - 1 > 0 ? ellipsisWidth : 0;
    const testTrailing = endIdx < text.length ? ellipsisWidth : 0;
    const totalWidth = testLeading + measureText(text.slice(startIdx - 1, endIdx)) + testTrailing;
    if (totalWidth <= availableWidth) {
      startIdx--;
    } else {
      break;
    }
  }

  // Step 4: Reclaim any remaining space by expanding forwards
  while (endIdx < text.length) {
    const testLeading = startIdx > 0 ? ellipsisWidth : 0;
    const testTrailing = endIdx + 1 < text.length ? ellipsisWidth : 0;
    const totalWidth = testLeading + measureText(text.slice(startIdx, endIdx + 1)) + testTrailing;
    if (totalWidth <= availableWidth) {
      endIdx++;
    } else {
      break;
    }
  }

  return {
    isTruncated: true,
    visibleText: text.slice(startIdx, endIdx),
    hasMatchInVisible: true,
    hasMatchInTruncated: startIdx > 0 || endIdx < text.length,
    leadingEllipsis: startIdx > 0,
    trailingEllipsis: endIdx < text.length,
    ellipsis,
  };
}
