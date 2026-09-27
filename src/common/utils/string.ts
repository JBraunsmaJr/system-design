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
