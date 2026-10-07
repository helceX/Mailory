/**
 * Content-Security-Policy for HTML pages. Scripts run only with the per-request nonce ('strict-dynamic' lets Next's own
 * bundles load their chunks); there is no 'unsafe-inline' for scripts. Styles keep 'unsafe-inline' because the UI
 * library and email previews rely on inline style attributes. `img-src https:` is for remote images inside the sandboxed
 * email-preview iframes (srcdoc frames inherit this policy); everything else is same-origin.
 */
export function buildCsp(
  nonce: string,
  options: { dev: boolean; appUrl: string },
): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(options.dev ? ["'unsafe-eval'"] : []),
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...(options.dev ? ["ws:", "wss:"] : [])],
    "frame-src": ["'self'"],
    "frame-ancestors": ["'self'"],
    "form-action": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
  };
  const parts = Object.entries(directives).map(([k, v]) => `${k} ${v.join(" ")}`);
  if (!options.dev && options.appUrl.startsWith("https://"))
    parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
