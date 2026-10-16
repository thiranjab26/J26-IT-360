/**
 * Registers the Workbox service worker that makes the demo work offline after
 * the first load (CLAUDE.md invariant 3, ARCHITECTURE.md §10). The worker
 * itself is generated at build time by vite-plugin-pwa (vite.config.ts).
 *
 * Demo-side on purpose: `src/core` is a library that teammates embed in their
 * own apps, and a page may only have one service worker per scope, so caching
 * policy belongs to whichever app hosts the sensor.
 */

/**
 * - `dev`: `pnpm dev`, where a worker would serve stale modules past hot reload.
 * - `unsupported`: no service workers here (e.g. Firefox private windows).
 * - `installing`: registered, still downloading the precache.
 * - `ready`: everything is cached; a reload works with the network off.
 * - `error`: registration failed; the app still works online.
 */
export type OfflineState = 'dev' | 'unsupported' | 'installing' | 'ready' | 'error';

/** Human-readable labels for the debug read-out. */
export const OFFLINE_STATE_LABEL: Readonly<Record<OfflineState, string>> = {
  dev: 'Off in dev server',
  unsupported: 'Not supported here',
  installing: 'Caching…',
  ready: 'Ready',
  error: 'Failed (online only)',
};

/**
 * Registers `sw.js` in production builds and reports progress. Never throws:
 * without a service worker the app still works online ("degrade, don't crash").
 */
export function registerServiceWorker(onState: (state: OfflineState) => void): void {
  if (!import.meta.env.PROD) {
    onState('dev');
    return;
  }
  if (!('serviceWorker' in navigator)) {
    onState('unsupported');
    return;
  }
  onState('installing');
  const base = import.meta.env.BASE_URL;
  navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).then(
    async () => {
      // `ready` resolves once a worker is active, i.e. the precache finished.
      await navigator.serviceWorker.ready;
      onState('ready');
    },
    (error: unknown) => {
      console.warn('Service worker registration failed; offline use is unavailable.', error);
      onState('error');
    },
  );
}
