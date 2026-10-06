import { defineConfig } from 'vitest/config';

// Unit tests run in Node. Core features are pure functions over numbers, so
// they need no DOM; tests that do need one opt in per file.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
    unstubGlobals: true,
  },
});
