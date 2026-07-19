import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // ── Global ignores (standalone entry = true global scope) ──────────────────
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      '.chrome-dashboard/**',
      '.venv/**',
      '.cloak-profiles/**',
      '.yoke/**',
      '.kombai/**',
      'extensions/**',
      'native/**',
      'models/**',
      'pow-solver/**',
      'hermes/hermes-daemon.cjs',
      'get-sizes.cjs',
      'src/services/dead-hand.js',
      '*.config.ts',
      '*.config.mjs',
      '*.config.js',
      '*.config.cjs',
      'ecosystem.config.cjs',
      'tests/live/**',
    ]
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  // ── Production source rules ────────────────────────────────────────────────
  {
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/require-await': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  // ── Test file overrides (relaxed typing for mocks/stubs) ───────────────────
  {
    files: ['tests/**/*.ts', 'tests/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-implied-eval': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);
