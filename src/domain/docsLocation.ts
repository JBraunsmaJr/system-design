/**
 * Where this deployment's documentation is (WS8-R9).
 *
 * The editor image serves its own copy of the documentation, so a
 * deployment with no internet access still has it. By default it sits at
 * docs/ beside the editor - wherever the editor happens to be mounted,
 * including behind a reverse proxy's prefix - which is exactly how the
 * image's entrypoint places it. DOCS_URL overrides that, for a deployment
 * that serves the documentation somewhere else.
 */
export function getDocsUrl(options: { configured?: string | null; base?: string } = {}): string {
  const runtime =
    options.configured !== undefined
      ? options.configured
      : (globalThis as unknown as { window?: { __APP_CONFIG__?: { DOCS_URL?: string } } }).window
          ?.__APP_CONFIG__?.DOCS_URL;
  if (typeof runtime === 'string' && runtime.trim() && !runtime.includes('__DOCS_URL__'))
    return runtime.trim();
  // Resolved against the page's own address, as the editor's relative base
  // resolves its assets: https://example.gov/system-design/?doc=x gives
  // https://example.gov/system-design/docs/.
  const base = options.base ?? globalThis.document?.baseURI ?? globalThis.location?.href ?? '/';
  return new URL('docs/', base).toString();
}
