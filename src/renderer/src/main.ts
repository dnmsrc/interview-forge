import { createApp } from 'vue'
import { createPinia } from 'pinia'
import naive from 'naive-ui'
import App from './App.vue'
import { router } from './router'
import { applyTheme } from './lib/theme'
import './styles.css'

// 挂载前定好主题，避免首帧从浅色跳一下
applyTheme()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(naive)
app.config.errorHandler = (err, _inst, info) => {
  console.error('[vue error]', err, info)
}
app.mount('#app')
