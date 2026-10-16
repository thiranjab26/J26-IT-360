// Content Security Policy and companion security headers (TODO A7,
// ARCHITECTURE.md §9 layer 3, FR7, NFR2, CLAUDE.md invariants 1 and 3).
//
// The CSP is the browser-enforced backstop behind the ESLint privacy rules: even
// if a bug, a compromised dependency or injected markup tried to send a frame or
// a landmark array somewhere, the browser refuses any request that is not to
// this origin. It is built from one directive table so the HTTP header (dev and
// preview servers) and the <meta> tag (baked into every built page, so it holds
// on whatever static host the build is deployed to) can never drift apart.
//
// Every source below was checked against the production bundle (2026-10-16):
// no eval / new Function, no inline <script> or <style> in the built HTML, no
// images, fonts or frames from anywhere, every model and WASM file same-origin.

export type CspMode = 'production' | 'development';

/**
 * How the policy reaches the browser. A <meta> policy cannot carry
 * `frame-ancestors`, `report-uri` or `sandbox` (CSP Level 3 §6.4: the browser
 * ignores them and logs a warning), so those are header-only.
 */
export type CspDelivery = 'header' | 'meta';

type Directives = Readonly<Record<string, readonly string[]>>;

/** Directives that browsers ignore when delivered in a <meta> tag. */
const HEADER_ONLY_DIRECTIVES: ReadonlySet<string> = new Set([
  'frame-ancestors',
  'report-uri',
  'report-to',
  'sandbox',
]);

// Allow-list style: deny everything, then open exactly what the app uses.
const PRODUCTION_DIRECTIVES: Directives = {
  'default-src': ["'none'"],
  // 'wasm-unsafe-eval' lets the TF.js WASM fallback backend compile its
  // self-hosted .wasm binary (WebAssembly.instantiate is gated by script-src).
  // It does NOT permit eval() or new Function() for JavaScript.
  'script-src': ["'self'", "'wasm-unsafe-eval'"],
  // Vite extracts all CSS into same-origin files in a build. Setting element.style
  // from script goes through the CSSOM and is not affected by style-src.
  'style-src': ["'self'"],
  // The one directive that stops data leaving: fetch, XHR, WebSocket, EventSource
  // and sendBeacon may only reach this origin (model.json, weights, .wasm).
  'connect-src': ["'self'"],
  // No raster images are loaded; 'self' only covers the browser's favicon request.
  'img-src': ["'self'"],
  'font-src': ["'self'"],
  // The <video> element is fed by srcObject (a MediaStream), which CSP does not
  // govern. 'self' keeps any URL-based media same-origin.
  'media-src': ["'self'"],
  // Service worker (A7 offline). No blob: workers: the threaded TF.js WASM build
  // spawns blob: workers, but only when the page is cross-origin isolated
  // (COOP/COEP), which this app is not, so it always takes the non-threaded path.
  // If cross-origin isolation is ever turned on, add blob: here deliberately.
  'worker-src': ["'self'"],
  'manifest-src': ["'self'"],
  'object-src': ["'none'"],
  'frame-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'self'"],
  // Clickjacking guard for a page that controls the camera: no other site may
  // frame it. Teammates embed the library as code (INTEGRATION.md), not the page.
  'frame-ancestors': ["'none'"],
};

// The Vite dev server needs two relaxations, and only these two:
// - style-src 'unsafe-inline': in dev, Vite injects each imported .css file as a
//   <style> element (and its error overlay uses inline styles) for hot reload.
// - connect-src: the hot-module-reload WebSocket. CSP3 lets 'self' match ws: on
//   the same host and port, which Chrome, Edge and Firefox implement; it stays
//   same-origin either way.
const DEVELOPMENT_DIRECTIVES: Directives = {
  ...PRODUCTION_DIRECTIVES,
  'style-src': ["'self'", "'unsafe-inline'"],
};

/** Serialises the policy for one mode and delivery mechanism. */
export function contentSecurityPolicy(mode: CspMode, delivery: CspDelivery): string {
  const directives = mode === 'production' ? PRODUCTION_DIRECTIVES : DEVELOPMENT_DIRECTIVES;
  return Object.entries(directives)
    .filter(([name]) => delivery === 'header' || !HEADER_ONLY_DIRECTIVES.has(name))
    .map(([name, sources]) => `${name} ${sources.join(' ')}`)
    .join('; ');
}

/**
 * Headers for the dev (`pnpm dev`) and preview (`pnpm preview`, e2e) servers.
 * A production host should send the same set; `contentSecurityPolicy('production',
 * 'header')` is the value to copy.
 */
export function securityHeaders(mode: CspMode): Record<string, string> {
  return {
    'Content-Security-Policy': contentSecurityPolicy(mode, 'header'),
    // Camera for this origin only; no embedded or third-party frame can ask for
    // it. Microphone and location are never used (audio cues are output only).
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };
}
