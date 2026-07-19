/// <reference types="vite/client" />

/**
 * Build identity injected at compile time by electron.vite.config.ts (define).
 * Format: "v<version> · <YYYY-MM-DD HH:mm> · <git short hash>".
 * Shown as the gold badge in the sidebar — proof of which build is running.
 */
declare const __BUILD_TAG__: string
