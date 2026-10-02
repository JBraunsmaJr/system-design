const SOFT_HYPHEN = /\u00ad/g;

/**
 * `value` with every soft hyphen (U+00AD) removed from its strings, at any
 * depth. Unchanged parts keep their identity, and when nothing changes the
 * value itself is returned, so memoized consumers see no difference.
 *
 * Soft hyphens are invisible break hints that pasted text often carries. A
 * text made only of one crashes react-pdf's text layout ("Cannot read
 * properties of null (reading 'unitsPerEm')"), and the PDF engine does not
 * hyphenate, so removing them loses nothing.
 */
export function stripSoftHyphens<T>(value: T): T {
  if (typeof value === 'string') {
    return (value.includes('\u00ad') ? value.replace(SOFT_HYPHEN, '') : value) as T;
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const stripped = stripSoftHyphens(item);
      if (stripped !== item) changed = true;
      return stripped;
    });
    return (changed ? next : value) as T;
  }
  if (value && typeof value === 'object') {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const stripped = stripSoftHyphens(item);
      if (stripped !== item) changed = true;
      next[key] = stripped;
    }
    return (changed ? next : value) as T;
  }
  return value;
}
