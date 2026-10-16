import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { contentSecurityPolicy, securityHeaders } from './security-headers.config.js';

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
export default defineConfig({
  plugins: [cspMetaTag()],
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
      // Three pages: the sensor demo, its cog-admin settings panel, and the
      // mock consumer that shows the event stream as teammates receive it (A5).
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        'cog-admin': fileURLToPath(new URL('./cog-admin.html', import.meta.url)),
        consumer: fileURLToPath(new URL('./consumer.html', import.meta.url)),
      },
    },
  },
});
