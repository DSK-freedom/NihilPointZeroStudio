// Flat ESLint config — pragmatic baseline: catch real mistakes (unused code, unsafe
// patterns, broken hook deps) without fighting the codebase's established idioms.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  { ignores: ['node_modules/**', 'out/**', 'dist/**', 'release/**', '*.mjs', '*.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // The new compiler-powered diagnostics flag patterns this codebase uses
      // DELIBERATELY (the latest-ref pattern in useAutosave/ProducerContext, and
      // setState-in-effect for autosave restore-on-mount). Keep them visible as
      // warnings; the classic rules-of-hooks/exhaustive-deps stay errors.
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn'
    }
  },
  {
    rules: {
      // The IPC boundary passes loosely-typed payloads by design; `any` there is a
      // deliberate trade-off, not an accident. Warn (visible) rather than error.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Underscore prefix = intentionally unused (common for ignored handler args).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }
      ]
    }
  }
)
