import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // WS6-R1: all encryption goes through StorageCrypto, so the algorithms,
      // the envelope, and the authenticated context are decided in one place.
      // src/crypto/storageCrypto.ts is the only exception, below.
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name='subtle']",
          message:
            'Use StorageCrypto (src/crypto/storageCrypto.ts) instead of crypto.subtle directly (WS6-R1).',
        },
        {
          selector:
            "CallExpression[callee.object.name='crypto'][callee.property.name='getRandomValues']",
          message:
            'Generate key material and IVs through src/crypto (WS6-R1); crypto.getRandomValues is allowed there.',
        },
      ],
    },
  },
  {
    // The seam itself, and the key material built on it.
    files: ['src/crypto/**/*.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  prettierConfig,
]);
