/// <reference types="vite/client" />
import 'vue'
import type { ForgeApi } from '@shared/api'

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const c: DefineComponent<any, any, any>
  export default c
}

declare global {
  interface Window {
    forge: ForgeApi
    forgeMeta: { platform: string; versions: Record<string, string> }
  }
}

export {}
