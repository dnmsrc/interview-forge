import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // node:sqlite 是 Node 内置模块，Electron 运行时提供，打包时必须留 external
    // node:vm / node:util 同理：项目闯关的判题沙箱（shared/project-core.mjs）要用它们，
    // 留在 external 才不会被 rollup 当成可解析的包去 node_modules 里找
    build: { rollupOptions: { external: ['node:sqlite', 'node:crypto', 'node:fs', 'node:path', 'node:child_process', 'node:vm', 'node:util'] } },
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
