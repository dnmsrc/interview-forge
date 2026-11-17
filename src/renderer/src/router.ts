import { createRouter, createWebHashHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('./views/HomeView.vue'), meta: { title: '今日', icon: '🔥' } },
    { path: '/placement', name: 'placement', component: () => import('./views/PlacementView.vue'), meta: { title: '入门摸底', icon: '🧭' } },
    { path: '/practice', name: 'practice', component: () => import('./views/PracticeView.vue'), meta: { title: '练习', icon: '📝' } },
    { path: '/mistakes', name: 'mistakes', component: () => import('./views/WrongBookView.vue'), meta: { title: '错题本', icon: '📕' } },
    { path: '/exam', name: 'exam', component: () => import('./views/ExamView.vue'), meta: { title: '闭卷考试', icon: '⏱️' } },
    { path: '/graph', name: 'graph', component: () => import('./views/GraphView.vue'), meta: { title: '知识图谱', icon: '🕸️' } },
    { path: '/dashboard', name: 'dashboard', component: () => import('./views/DashboardView.vue'), meta: { title: '数据面板', icon: '📈' } },
    { path: '/bank', name: 'bank', component: () => import('./views/BankView.vue'), meta: { title: '题库与版本', icon: '🗂️' } },
    { path: '/settings', name: 'settings', component: () => import('./views/SettingsView.vue'), meta: { title: '设置', icon: '⚙️' } },
    { path: '/:pathMatch(.*)*', redirect: '/' }
  ]
})

router.afterEach((to) => {
  const t = (to.meta?.title as string) ?? ''
  document.title = t ? `${t} · 面试熔炉` : '面试熔炉'
})
