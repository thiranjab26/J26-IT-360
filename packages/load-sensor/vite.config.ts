import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const mediapipeRuntimeStub = fileURLToPath(
  new URL('./src/core/landmarks/mediapipe-runtime-stub.ts', import.meta.url),
);

// Serves the demo / debug page (index.html → src/demo). Port 5174 so it can run
// next to the main frontend on 5173. The library build for consumers is added
// with the public API (TODO A5).
export default defineConfig({
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
  },
  preview: {
    port: 4174,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
