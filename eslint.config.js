// @ts-check
const tseslint = require('typescript-eslint');
const js = require('@eslint/js');

module.exports = tseslint.config(
  {
    ignores: ['node_modules/**', '.expo/**', 'dist/**', 'android/**', 'ios/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        sourceType: 'module',
      },
    },
  },
  {
    // Plain Node-run config files (this file, jest.config.js) use CommonJS.
    files: ['*.config.js', '.eslintrc.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'writable',
        __dirname: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // Stubs intentionally declare the full contract signature (PRD §3/§4.5)
    // before implementation; unused params here are expected, not a bug.
    files: ['src/engine/tdee.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    // ═══════════════════════════════════════════════════════════════
    // THE ENGINE WALL — PRD §3 (non-negotiable architectural rule):
    //
    //   "The TDEE engine is a pure function ... It cannot accept
    //   `ExternalEstimate`. Enforce this at the type level so it's a
    //   compile error, not a discipline problem. At 2am 'I'll just
    //   blend them a little' will look reasonable. It is not."
    //
    // computeTDEE may read ONLY DayIntake, WeightLog, and UserProfile
    // (src/engine/types.ts). It must never see ExternalEstimate
    // (src/db/types.ts), never touch the database layer, never touch
    // screens/components, and never import React Native or any Expo
    // module. This rule makes every one of those an ESLint error, not
    // just a code-review convention — so it fails CI/lint even before
    // TypeScript would (or in cases TS alone wouldn't catch, like a
    // same-shaped duck-typed object).
    // ═══════════════════════════════════════════════════════════════
    files: ['src/engine/**/*.ts', 'src/engine/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../db', '../db/*', '**/db/**'],
              message:
                'src/engine must not import from src/db (PRD §3: the engine may read only intake and weight data, never ExternalEstimate).',
            },
            {
              group: ['../screens', '../screens/*', '**/screens/**'],
              message: 'src/engine must not import from src/screens (engine must stay pure TypeScript, no UI).',
            },
            {
              group: ['../components', '../components/*', '**/components/**'],
              message: 'src/engine must not import from src/components (engine must stay pure TypeScript, no UI).',
            },
            {
              group: ['../lib', '../lib/*', '**/lib/**'],
              message: 'src/engine must not import from src/lib (keep the engine free of app/native-facing helpers).',
            },
            {
              group: ['react-native', 'react-native/*'],
              message: 'src/engine must not import react-native (PRD §3: the engine is pure TypeScript with zero React Native imports).',
            },
            {
              group: ['expo', 'expo-*', 'expo-*/*', '@expo/*'],
              message: 'src/engine must not import any expo-* module (PRD §3: the engine is pure TypeScript with zero Expo imports).',
            },
            {
              group: ['../*', '../../*', '../../../*'],
              message:
                'src/engine must not import via a relative path that escapes src/engine (PRD §3: the engine is a self-contained pure function).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/__tests__/**'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    // The Gemini key proxy (PRD §8) is a Node serverless function deployed
    // separately to Vercel — it is NOT part of the React Native bundle and
    // legitimately uses Node globals. Linted rather than ignored, just with
    // the right environment, so a real mistake in it still surfaces.
    files: ['proxy/**/*.js'],
    languageOptions: {
      globals: {
        process: 'readonly',
        Buffer: 'readonly',
        fetch: 'readonly',
        console: 'readonly',
      },
    },
  }
);
