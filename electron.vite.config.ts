import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // node:sqlite 是 Node 内置模块，Electron 运行时提供，打包时必须留 external
    build: { rollupOptions: { external: ['node:sqlite', 'node:crypto', 'node:fs', 'node:path', 'node:child_process'] } },
    resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { external: ['node:crypto'] } },
    resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } }
  },
  renderer: {
    plugins: [vue()],
    resolve: { alias: { '@renderer': resolve(__dirname, 'src/renderer/src'), '@shared': resolve(__dirname, 'src/shared') } },
    build: { chunkSizeWarningLimit: 2000 }
  }
})
