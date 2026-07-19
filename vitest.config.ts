import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

// Vitest does NOT load electron.vite.config.ts, so anything the app gets from there
// (the __BUILD_TAG__ define, the @renderer alias) must be mirrored here for tests.
// Main-process tests run in node (default); renderer tests opt into jsdom per-file
// with a `// @vitest-environment jsdom` comment.
export default defineConfig({
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src')
    }
  },
  define: {
    __BUILD_TAG__: JSON.stringify('v0.0.0-test · 2026-01-01 00:00 · testtag')
  },
  test: {
    environment: 'node'
  }
})
