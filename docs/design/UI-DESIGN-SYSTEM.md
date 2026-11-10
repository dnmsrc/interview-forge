# 面试熔炉 · UI 设计系统落地规范

> 面向实现阶段的操作手册。基座已在 `src/renderer/src/styles.css` 落地，naive-ui 主题在 `src/renderer/src/lib/theme.ts`。
> 社区依据见同目录 `COMMUNITY-UI-BENCHMARK.md`。**改任何视图前先读本文第 1、2、3、8 节。**

---

## 1. Token 速查表（唯一合法取值来源）

**禁止**在任何 `.vue` 的 `style`/`:style`/`<style>` 里再出现十六进制色值或 `rgba(...)` 字面量（图表 SVG 也不例外，改用第 5 节的语义类）。

| 用途 | 变量 | 浅色值参考 |
| --- | --- | --- |
| 页面底 / 卡片 / 次级面 / 三级面 | `--bg` `--surface` `--surface-2` `--surface-3` | #f7f8fa / #fff / #f2f4f8 / #e9edf3 |
| 描边（常规 / 强调） | `--border` `--border-2` | #e3e8ef / #cbd3dd |
| 正文 / 次要 / 弱化文字 | `--text` `--text-dim` `--text-faint` | #16191f / #5b6472 / #8b95a3 |
| 主色 / 深主色 / 亮主色 | `--accent` `--accent-2` `--accent-hi` | indigo #5e6ad2 系 |
| 语义色 | `--ok` `--warn` `--bad` `--purple` `--cyan` `--hot` | 绿 / 琥珀 / 红 / 紫 / 青 / 橙 |
| 间距（4px 基准） | `--sp-1 … --sp-12` | 4/8/12/16/20/24/32/40/48 |
| 字号 | `--fs-xs 11.5` `--fs-sm 12.5` `--fs-base 13.5` `--fs-md 15` `--fs-lg 17` `--fs-xl 21` `--fs-2xl 27` `--fs-3xl 34` |
| 行高 | `--lh-tight 1.25` `--lh-snug 1.45` `--lh-loose 1.75` |
| 圆角 | `--r-sm 6` `--r-md 10` `--r-lg 14` `--r-xl 20` `--r-pill` | 卡片一律 `--r-lg`，控件 `--r-md` |
| 阴影 | `--sh-1` 静态卡 / `--sh-2` 悬浮 / `--sh-3` 浮层 / `--sh-4` 抽屉·弹窗 |
| 焦点环 | `--ring`（表单）`--ring-soft`（卡片内元素） |
| 动效时长 | `--dur-fast 120ms` `--dur 200ms` `--dur-slow 320ms` |
| 缓动 | `--ease-out` 进入 / `--ease-in-out` 状态切换 / `--spring` 按压回弹 |
| 半透明衍生色 | 一律 `color-mix(in oklab, var(--accent) 12%, transparent)` 这类写法，不要手写 rgba |
| 等宽数字 | 加类 `.num`（或对文本用 `font-variant-numeric: tabular-nums`） |

需要 alpha 时优先 `color-mix(in oklab, <token> N%, transparent)`；Electron 45 = Chromium 13x，`color-mix` / `oklab` / `backdrop-filter` 均可用。

## 2. 现成组件类（能用就用，别自己造）

| 场景 | 写法 |
| --- | --- |
| 页面容器 | `<div class="page">`（已带 padding 与栅格 gap），需要限宽居中加 `.page-narrow` |
| 页头 | `.page-head > h1 + p`，右侧动作放 `.acts`，撑开用 `.grow` |
| 卡片 | `.card`；可点击跳转的卡加 `.lift`；无阴影卡加 `.flat`；零内边距 `pad-0` |
| 卡内标题行 | `.panel-head > h3 + .desc + .grow + 动作`（替代旧 `<h3><span class="grow"/></h3>` 技巧） |
| KPI 条 | `.kpis > .kpi > (.k 标签)(.v 数值)(.d 说明)`，一卡一指标 |
| 统计块（可点） | `.stat.clickable > .lbl + .val + .foot` |
| 徽章 | `.pill.ok/.warn/.bad/.info/.lock/.purple/.cyan`，内放 `<Icon :size="12"/>` 更精致 |
| 进度条 | `.bar > i[style=width:x%]`；强调色变体 `.bar.accent` |
| 分段选择器 | `.seg > button.on`（自绘，替代一排 n-button 当 tab 用） |
| 自研按钮 | `.btn` / `.btn.primary` / `.btn.ghost` / `.btn.danger`（只在需要链接式或紧凑动作时用，其余仍用 `n-button`） |
| 键位提示 | `<kbd class="kbd">⌘K</kbd>` |
| 空状态 | `.empty > .ic + .t + .d`（文案必须说清「为什么空」+「下一步做什么」） |
| 骨架屏 | `.skeleton.sk-line`（行）/ `.skeleton.sk-block`（卡），加载中取代 spinner |
| 手风琴 | `details.acc > summary + .acc-body`（已内置箭头旋转与展开动画） |
| 信息反馈块 | `.fb` / `.fb.ok/.warn/.bad`（左侧色条 + 浅底） |
| 分节小标题 | `.section-title`（自动带上延伸线） |
| 列表行 | `.q-list > .q-item > .qt`（标题自动两行省略） |
| 选项卡行 | `.opt`（题干选项），状态类 `.sel/.right/.wrong` |
| 工具条（吸顶） | `.toolbar` |
| 左右分布 | `.row`（wrap）/ `.col`（纵向）/ `.split > .grow` |
| 网格 | `.grid.g2/.g3/.g4`（auto-fit，窄窗自动降列），侧栏布局 `.grid.g-side` |
| 进入动画 | 给卡片加 `class="rise"` + `style="--i:2"`（错峰 45ms/张）；弹出用 `.pop` |

## 3. 图标规范

- 统一用 `<Icon name="..." :size="16" />`（`src/renderer/src/components/Icon.vue`，stroke=currentColor，自动适配明暗）。
- 可用 name：`flame pen timer graph chart folder gear search sun moon auto refresh chevron chevronDown check close play arrowRight panelLeft sparkles book target layers trophy brain download filter clock zap route external`。
- **功能图标禁止再用 emoji**（跨平台渲染不一致、无法跟随主题色）。仅在表达情绪/拟物的装饰位置（如空状态大图标、板块名前的点缀）允许保留少量 emoji。
- 尺寸档位：行内 12–14，正文/按钮 15–17，导航 17，空态 22–26。

## 4. naive-ui 规则

- `App.vue` 已用 `n-config-provider` 注入 `darkTheme` + `themeOverrides`，**所有 naive 组件自动跟随主题**，不要再写 `:style="{ color: '#xxx' }"`。
- 语义色交给 naive：`type="primary|info|success|warning|error"`；密度交给 `size="small|medium|large"`。
- 需要自定义观感时用 CSS 类（全局 styles.css 末尾覆盖 `.n-*`），不要用内联样式。
- 破坏性操作（删除考试记录、回滚题库、forceUnlock）必须走 `dialog.warning(...)` 二次确认，主按钮 `type: 'error'`。
- 提示统一 `message.success/error/warning`（来自 `lib/ui.ts`，已主题化），禁止自造 toast。

## 5. 手写 SVG 图表取色

切主题不花哨的前提是图表也走 token。SVG **属性**里不能写 `var()`，改用类：

| 元素 | 类 |
| --- | --- |
| 网格线 / 坐标轴 | `.c-grid` `.c-axis` |
| 刻度文字 / 数据标签 | `.c-tick` `.c-label` |
| 折线（主色 / 绿 / 琥珀） | `.c-line .c-accent` / `.c-ok` / `.c-warn` |
| 面积填充 | `.f-accent` / `.f-ok` |
| 数据点 | 加 `.c-dot`（hover 放大） |
| 环形进度 | `.ring-track` + `.ring-fill` |
| 空图提示文字 | `.c-empty` |

ECharts 用 `chartBase(isDark)` / `chartPalette(isDark)`（`lib/theme.ts`），主题切换时 `watch(isDark)` 重建 option。

## 6. 交互与动效准则

1. **四态必现**：hover（边框提亮 + `--sh-2`，可点卡片再 `translateY(-2px)`）、active（`scale(.97~.995)`）、focus-visible（`--ring`）、disabled（透明度 .45 + 禁指针）。
2. 只动 `transform` / `opacity` / `box-shadow` / `border-color`；**不要**动 width/height/top/left（会抖布局）。
3. 列表/卡片入场用 `.rise` + `--i` 错峰，整页入场已由 `App.vue` 的 `.view-host` 负责，页面内不要再套 Vue `<transition mode="out-in">`（dev HMR 会挂死，历史踩过坑）。
4. 加载 > 300ms 的操作给骨架屏或 `.skeleton` 占位，不要空白闪跳；提交按钮期间 `:loading` + 禁用重复提交。
5. 数字变化（分数、计时）保持 `tabular-nums`，避免跳动导致布局抖动。
6. `@media (prefers-reduced-motion: reduce)` 已在基座统一降级，无需每处处理。

## 7. 自适应（最容易翻车的地方）

- 三档断点：`1240`（侧栏收窄）、`1000`（侧栏自动收成 62px 图标栏，页面 padding 收紧）、`720`（网格全部单列、抽屉全宽、hero 收紧）。
- 网格一律 `repeat(auto-fit, minmax(Xpx, 1fr))`，**禁止**固定列数（`grid-template-columns: repeat(4, 1fr)`）。
- 可能超长的文本必须自带省略：单行 `overflow:hidden;text-overflow:ellipsis;white-space:nowrap`（工具类 `.ellip`）或多行 `-webkit-line-clamp`（`.q-item .qt` 已是两行）。flex 子项要加 `min-width: 0`。
- 长中文题干（无空格）用 `overflow-wrap: anywhere` 防溢出。
- 任何绝对定位浮层（图谱工具条、图例、抽屉）都要考虑窄窗口下与画布/彼此重叠的可能。
- **验收红线**：CDP `AUDIT_JS` 在 1440×900 / 1180×800 / 900×720 三档下，`hOverflow`、`clippedRight`、`textCut`、`zeroBox` 必须为空，`Runtime` 错误必须为 0。

## 8. 明暗双主题自检

改完一个页面必须两遍看：`localStorage.setItem('forge.ui.theme','light')` 与 `'dark'` 各截一次图（或按 ⌥T 切换）。重点看：
- 深色下有没有残留浅色块（老代码里的 `#fff`、`#f6f8fa`、`rgba(255,255,255,.92)`）；
- 浅色下有没有深色文字压深色底；
- `.glass` / `--glass-solid` 浮层是否在半透明下仍可读（必要时加深底色而非降低文字对比）。

## 9. 各页改造要点（分工依据）

| 页面 | 文件 | 关键任务 |
| --- | --- | --- |
| 今日 | `views/HomeView.vue` | hero 环形进度 + 今日三类任务改 `.q-item` 列表 + 红线警示用 `.fb.bad`；摸底板块改 `.stat.clickable` 网格（含百分比条与起点 chips）；考试历史改时间线风格 `.kv`；摸底弹窗内题目区加间距 |
| 练习 | `views/PracticeView.vue` | 顶部改吸顶 `.toolbar`（进度条 + 题型/板块筛选 + 计数）；题目卡 `.card`；提交后反馈 `.fb`；键盘快捷键提示用 `kbd`；答错后的解析区折叠进 `details.acc` |
| 闭卷 | `views/ExamView.vue` | 考前配置卡（模板选择用 `.seg` + 时长/题量步进）；答题页左题右答题卡（`.grid.g-side`），计时器 `.timer` + 剩余时间进度；交卷确认走 dialog；成绩复盘用 `.kpis` |
| 数据 | `views/DashboardView.vue` | 四个 stat 改 `.kpis/.stat`；雷达与折线图 SVG 全量换语义类（去硬编码色）；最弱题型条形改 `.bar`；错题本全量改 `details.acc`；导出按钮进 `.panel-head` |
| 图谱 | `views/GraphView.vue` | 仅做视觉对齐：浮层改 `.glass` 系（已完成）；抽屉头部加关闭按钮与 `.panel-head`；内部硬编码色替换；**不要动 fitView/节点测量等逻辑**（VueFlow 1.48 有 Ref 陷阱，见记忆库） |
| 题库·版本 | `views/BankView.vue` | 分组改 `.card` + `.section-title`；版本列表改 `.kv` + 时间戳弱化；回滚等危险操作用 `.btn.danger` + dialog |
| 设置 | `views/SettingsView.vue` | 表单分节（AI 端点 / 路由 / 本地数据 / 外观）；端点行 `EndpointRow.vue` 间距与状态点统一；新增「外观」节：浅色/深色/跟随系统三选（`.seg`，调 `useNaiveTheme().set`） |
| 共用 | `components/FeedbackPanel.vue`、`QuestionBody.vue`、`EndpointRow.vue` | 去掉内联色；markdown 容器 `.md` 已有样式；AI 用量/耗时改 `.tiny.faint`；反馈分块用 `.fb` + `.section-title` |

## 10. 验收契约（改 UI 必须同时维护）

UI 重构后**文案和类名都会变**，所以自动化验收不认文案，只认 `data-testid`。改这些控件时必须保留或补上同名 testid：

| testid | 位置 | 被谁使用 |
| --- | --- | --- |
| `home-start` | HomeView「开始今日队列」 | `qa3-interact.mjs` D1 |
| `practice-submit` / `practice-next` / `practice-reveal` | PracticeView 提交 / 下一题 / 看答案（三者互斥渲染） | A2、A5 |
| `exam-tpl` / `exam-start` / `exam-prev` / `exam-next` / `exam-submit` / `exam-quit` | ExamView 模板卡与答题导航、弃考 | B2–B4 |
| `graph-drawer` / `graph-drawer-close` | GraphView 抽屉与其关闭按钮 | C2、C3 |
| `settings-save` / `bank-validate` | 保存学习参数 / 跑结构校验 | F1、G1 |

图谱节点类是自定义的 `.gn`（四级共用），**不是** VueFlow 的 `.vf-node`。

跑法：`node scripts/qa/qa3-interact.mjs`（交互流，目标 20/20）+ `node scripts/qa/r6-ui.mjs light,dark 1440x900,900x720`（截图 + 机检，目标 0 项有问题）。

`r6-ui.mjs` 除横向溢出/文字截断/深色残留外，还查两类"内容看不见"：
- **内容被裁**：容器 `scrollHeight > clientHeight` 且 `overflowY` 是 hidden/clip；
- **控件被遮挡**：`elementFromPoint(控件中心)` 命中的不是自己也不是自己的后代。

这两条各抓出过真实缺陷（首页 hero 塌缩、任务卡 footer 盖住列表、图谱图例盖死缩放控件、窄窗顶栏 pill 被搜索图标盖住）。

## 11. 本轮踩过的坑（改样式前先读）

1. **`.hero` 必须是 `overflow: clip`，不能是 `hidden`**。它是 `.page`（grid）的直接子项，Chrome 在「grid item + `overflow:hidden`」下把 auto 行按 0 解析：整块只剩 padding 高度（实测 42px），子项照常画但溢出部分被裁掉，于是主按钮看起来盖在下一块上面。改成 `clip` 后恢复 146px。同类写法（`.card` 等）目前没复现，但新增浮层容器时优先用 `clip`。
2. **等高卡片里的 footer 要用 flex 固定**：`.tasks > .card { display:flex; flex-direction:column }` + 列表区 `flex:1; min-height:0` + footer `margin-top:auto`。否则 footer 会压住列表最后几行（`min-height:0` 是关键，缺了 flex item 不肯收缩）。
3. **VueFlow 面板只接受六条边的位置**（`PanelPositionType`：`top-left … bottom-right`，没有 `center-left`）。四角被进度/工具条/图例/MiniMap 占满时，把图例挪到 `left:50%; translateX(-50%)`，左下角留给 `<Controls>`。
4. **MiniMap 默认 `background-color:#fff`**，深色主题下是一块刺眼白板；已在 `styles.css` 里主题化（`.graph-wrap .vue-flow__minimap` + mask + controls）。MiniMap 的 `:node-color` 写进 SVG 的 **fill 属性**，那里 `var()` 不生效，只能给真实色值——这是全站唯一允许 hex 的地方，按 `isDark` 取双档。
5. **主进程取列表必须用 `all()`，不能用 `get()`**：`db.get()` 走 `prepare().get()`，只返回**一行**。误用时渲染层 `v-for` 会去迭代这个对象的各个字段值，界面出现 "次 · tokens · NaNs" 这类碎片（`gateway.usageByTask` / `recentAiErrors` 踩过）。
6. **Electron 会缓存懒加载 chunk**：改完模板若 DOM 里没有新加的 `data-testid`，先怀疑 vite watch 丢了事件（磁盘和 dev server 输出都有、浏览器跑的是旧副本）。确认办法：`node scripts/qa/diag-module-check.mjs`（比对 performance entries 里的 URL 与当前编译产物）。修不好就重启 dev（`Page.reload({ignoreCache:true})` 已封装成 `cdp.reloadHard()`）。
7. **折叠侧栏（≤1000px）下 `.side-foot` 整块隐藏**：62px 宽会把「考点点亮 0%」竖排折成三四行。
