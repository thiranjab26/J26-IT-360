// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { privacyConfig } from './eslint/privacy.js';

export default defineConfig(
  globalIgnores(['dist/', 'coverage/', 'playwright-report/', 'test-results/', 'public/']),

  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // Two programs: browser code (tsconfig.json) and node-side code (tsconfig.node.json).
        project: ['./tsconfig.json', './tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    files: ['src/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['tests/**/*.ts', 'scripts/**/*.ts', 'eslint/**/*.js', '*.config.ts', '*.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    // Plain JS files (lint config) are type-checked by tsc via checkJs, not linted with types.
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // FR7 / NFR2: privacy guards. See eslint/privacy.js and its tests.
  privacyConfig,

  // Last, so formatting rules never fight Prettier.
  prettier,
);
