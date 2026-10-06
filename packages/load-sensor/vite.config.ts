import { defineConfig } from 'vite';

// Serves the demo / debug page (index.html → src/demo). Port 5174 so it can run
// next to the main frontend on 5173. The library build for consumers is added
// with the public API (TODO A5).
export default defineConfig({
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
