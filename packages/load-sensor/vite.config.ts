import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { contentSecurityPolicy, securityHeaders } from './security-headers.config.js';

/**
 * Offline after first load (CLAUDE.md invariant 3, ARCHITECTURE.md §10).
 *
 * Workbox precaches the whole app at install: the three pages, every JS/CSS
 * chunk, the face mesh models and the WASM binaries. Each entry carries a
 * content hash as its revision, so the cache is effectively "cache-first with
 * revisioned filenames": model files keep their fixed names (TF.js requests
 * them by name) but a changed file gets a new revision and is re-downloaded,
 * and the next deploy cleans out the old ones.
 */
function offlineServiceWorker(): Plugin[] {
  return VitePWA({
    // Registered by our own code (src/demo/service-worker.ts). The plugin's
    // 'inline' option would need an inline <script>, which the CSP forbids.
    injectRegister: false,
    // A new deploy activates at once instead of waiting for every tab to close,
    // so a replaced model is never served next to new code that expects it.
    registerType: 'autoUpdate',
    // Offline is the goal here, not "installable app"; no web app manifest.
    manifest: false,
    // Never in `pnpm dev`: a service worker there would serve stale modules
    // past hot reload.
    devOptions: { enabled: false },
    workbox: {
      globPatterns: ['**/*.{html,js,css,json,bin,wasm}'],
      globIgnores: [
        // Debugging aids, never requested by the page.
        '**/*.map',
        // Asset lock file for `pnpm fetch-models`; not loaded at runtime.
        'models/MANIFEST.json',
        // TF.js only picks the threaded build under cross-origin isolation
        // (COOP/COEP), which this app does not enable (security-headers.config.ts).
        'wasm/tfjs-backend-wasm-threaded-simd.wasm',
      ],
      // Workbox skips files over 2 MiB by default; the landmark model weights
      // are about 2.3 MiB and must be cached for offline sensing to work.
      maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      // Multi-page app: a URL that is not precached must fail offline, not
      // silently turn into the sensor page.
      navigateFallback: null,
      cleanupOutdatedCaches: true,
      clientsClaim: true,
      skipWaiting: true,
    },
  });
}

/**
 * Bakes the production CSP into every built page as a <meta> tag, so the policy
 * travels with the static files to any host, even one that sends no headers.
 * Prepended so it is in force before the first <script> or <link> is parsed.
 */
function cspMetaTag(): Plugin {
  return {
    name: 'adaptlearn-csp-meta',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: {
          'http-equiv': 'Content-Security-Policy',
          content: contentSecurityPolicy('production', 'meta'),
        },
        injectTo: 'head-prepend',
      },
    ],
  };
}

const mediapipeRuntimeStub = fileURLToPath(
  new URL('./src/core/landmarks/mediapipe-runtime-stub.ts', import.meta.url),
);

// Serves the demo / debug page (index.html → src/demo). Port 5174 so it can run
// next to the main frontend on 5173. Teammates consume the library as source
// through the workspace package's `exports` (package.json), so there is no
// separate library build.
export default defineConfig(({ mode }) => ({
  plugins: [cspMetaTag(), offlineServiceWorker()],
  resolve: {
    // Adapter A uses runtime 'tfjs' only. The MediaPipe-runtime packages that
    // face-landmarks-detection imports are replaced by a stub that throws: they
    // do not bundle as ES modules and default to a CDN (invariant 3). See the stub.
    alias: {
      '@mediapipe/face_mesh': mediapipeRuntimeStub,
      '@mediapipe/face_detection': mediapipeRuntimeStub,
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    // Dev policy = production policy plus inline <style> for hot reload.
    headers: securityHeaders('development'),
  },
  preview: {
    port: 4174,
    strictPort: true,
    // Exactly what a production host should send (e2e tests run against this).
    headers: securityHeaders('production'),
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      // Four pages: the sensor demo, its cog-admin settings panel, the mock
      // consumer that shows the event stream as teammates receive it (A5), and
      // the latency benchmark that runs the bare library (A7).
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        'cog-admin': fileURLToPath(new URL('./cog-admin.html', import.meta.url)),
        consumer: fileURLToPath(new URL('./consumer.html', import.meta.url)),
        bench: fileURLToPath(new URL('./bench.html', import.meta.url)),
        // Pilot-study runner (TODO B1): only in `--mode study` builds, so the
        // normal build ships no study page (ARCHITECTURE.md §9).
        ...(mode === 'study'
          ? { study: fileURLToPath(new URL('./study.html', import.meta.url)) }
          : {}),
      },
    },
  },
}));
