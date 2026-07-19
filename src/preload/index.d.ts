import type { FinScriptApi } from './index'

declare global {
  interface Window {
    api: FinScriptApi
  }
}
