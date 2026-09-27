/**
 * Triggers a browser download of string or Blob content.
 * Gracefully handles server-side / test environments where DOM is not available.
 */
export function downloadFile(
  content: string | Blob,
  fileName: string,
  mimeType: string = 'text/plain',
): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
    return;
  }
  const blob = typeof content === 'string' ? new Blob([content], { type: mimeType }) : content;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
