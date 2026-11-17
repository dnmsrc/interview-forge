<script setup lang="ts">
/**
 * 路由进入动画包装器。
 *
 * 背景：`.rise` 是纯 CSS 入场动画（from{opacity:0}，fill-mode: both）。直接把 class
 * 静态写在被 <KeepAlive> 缓存的组件根节点上时，CSS 动画只在元素「首次插入 DOM」播放一次；
 * KeepAlive 再次激活复用同一 DOM，动画不会重播，而 fill-mode:both 让元素永久停在
 * from 帧（opacity:0）——表现为切页后正文变淡/白屏。
 *
 * 这里把动画 class 交给本包装器，在每次 onActivated 时强制重放：先摘掉 class 并强制
 * reflow，再于下一帧加回，浏览器即重新触发一次动画。被缓存的页面实例本身不销毁，
 * 练习队列、图谱 fitView、考试作答等状态全部保留；也不使用 <transition>，规避
 * dev HMR 替换路由组件时 leave 钩子悬挂导致的白屏。
 */
import { nextTick, onActivated, onMounted, ref } from 'vue'

const host = ref<HTMLElement | null>(null)

function replay() {
  const el = host.value
  if (!el) return
  el.classList.remove('rise')
  // 强制回流，让「移除动画」立即生效，否则浏览器会合并前后两次 class 变更
  void el.offsetHeight
  void nextTick(() => {
    // 下一帧再加回，确保这次插入被识别为一次新的动画开始
    requestAnimationFrame(() => host.value?.classList.add('rise'))
  })
}

onMounted(replay)
onActivated(replay)
</script>

<template>
  <div ref="host" class="rise view-rise">
    <slot />
  </div>
</template>

<style scoped>
.view-rise {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>
