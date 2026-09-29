/**
 * The Content-Security-Policy every page carries. proxy.ts mints a fresh nonce per request;
 * Next reads it back out of this header and stamps it on its own scripts and inline styles.
 *
 * - Scripts: only nonce'd ones, and whatever those load ('strict-dynamic'). No host
 *   allowlist, no 'unsafe-inline'.
 * - Styles: stylesheets from this origin or nonce'd <style> tags. `style` attributes need
 *   'unsafe-inline' of their own (style-src-attr): React renders element styles as
 *   attributes, and a nonce cannot cover an attribute. An attribute can restyle the page but
 *   cannot run code.
 * - Everything the page fetches or embeds is same-origin, except the one S3 origin the upload
 *   PUTs to (UPLOAD_ORIGIN, on AWS); the PNG export draws through data: and blob: URLs.
 */
export function buildCsp(
  nonce: string,
  { dev = false, uploadOrigin = "" }: { dev?: boolean; uploadOrigin?: string } = {},
): string {
  const directives: [string, ...string[]][] = [
    ["default-src", "'self'"],
    // React's development build uses eval to rebuild server error stacks; production never does.
    ["script-src", "'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    ["style-src", "'self'", `'nonce-${nonce}'`],
    ["style-src-attr", "'unsafe-inline'"],
    ["img-src", "'self'", "data:", "blob:"],
    ["font-src", "'self'"],
    ["connect-src", "'self'", ...(uploadOrigin ? [uploadOrigin] : []), ...(dev ? ["ws:"] : [])],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
  ];
  return directives.map((d) => d.join(" ")).join("; ");
}

/** 128 random bits, base64: unguessable, and valid in a CSP source expression. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
