/**
 * Same-origin guard for every model and runtime asset the sensor loads.
 *
 * Invariant 3 (zero runtime network dependency) and ARCHITECTURE.md §9 layer 2:
 * model files, WASM binaries and the classifier are served from this app's own
 * origin. Third-party libraries default to remote hosts (face-landmarks-detection
 * defaults to tfhub.dev), so every URL handed to them goes through here first and
 * a cross-origin URL is refused before any request is made.
 *
 * This is the only file in src/core the privacy lint rules allow to use network
 * APIs (eslint/privacy.js MODEL_LOADER). It currently needs none: the libraries
 * do the fetching, this module only decides what they may fetch.
 */

export class CrossOriginAssetError extends Error {
  override readonly name = 'CrossOriginAssetError';

  constructor(
    readonly url: string,
    readonly pageOrigin: string,
  ) {
    super(
      `Refusing to load ${url}: model and runtime assets must be served from ${pageOrigin} (CLAUDE.md invariant 3).`,
    );
  }
}

/**
 * Resolves `path` against `baseUrl` (itself resolved against the page) and
 * returns an absolute URL, or throws `CrossOriginAssetError` if the result is
 * not on the page's origin.
 *
 * `baseUrl` is treated as a directory: `'/models'` and `'/models/'` are the same.
 */
export function resolveSameOriginAsset(
  baseUrl: string,
  path: string,
  pageUrl: string = globalThis.location.href,
): string {
  const page = new URL(pageUrl);
  const base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`, page);
  const resolved = new URL(path, base);
  if (resolved.origin !== page.origin) {
    throw new CrossOriginAssetError(resolved.href, page.origin);
  }
  return resolved.href;
}
