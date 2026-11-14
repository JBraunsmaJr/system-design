/**
 * Sanitizes a string for use as a URL slug or safe filename component.
 * Converts to lowercase, replaces non-alphanumeric character sequences with dashes,
 * and strips leading/trailing dashes.
 */
export function sanitizeFileName(name: string, fallback: string = 'file'): string {
  const sanitized = (name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return sanitized || fallback;
}

/**
 * Up to two upper-case initials for an avatar: the first letter of each of
 * the first two words. An empty or blank name gives an empty string.
 */
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase()
    .slice(0, 2);
}
