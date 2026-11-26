// Dit à TypeScript que `window.api` existe dans l'interface (voir preload/index.ts).
import type { Api } from './index'

declare global {
  interface Window {
    api: Api
  }
}

export {}
