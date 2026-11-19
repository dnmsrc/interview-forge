# 练习册 · 社区 UI 规范对标与先进水准评估

> **这份文档回答两个问题**：①「桌面学习/训练类应用，社区里做得最好的产品是怎么定的」——给出可核对的取值区间与出处；②「本项目现在做到了哪一步、还差什么」——逐条对照 `src/renderer/src/styles.css`、`lib/theme.ts`、`lib/ui.ts`、`App.vue`、`CommandPalette.vue`、`main/index.ts` 的实际代码给判定。
>
> 取证时间：2026-11-10。取证方式：官方设计系统文档 / W3C 标准页 / 品牌设计系统逆向分析页 / naive-ui 2.45.3 本地源码 grep。**每条结论都附来源链接**；无法核实的推断已显式标注。
>
> 相关文档：落地操作手册见同目录 [`UI-DESIGN-SYSTEM.md`](./UI-DESIGN-SYSTEM.md)（本文是它的「为什么这样定 + 差距清单」）。基线代码：naive-ui `^2.45.3`、electron `^45.2.3`（Chromium ≥ 130，`color-mix()/oklab/backdrop-filter` 实测可用）、vue `^3.5.45`。

---

## 0. 结论速查

| # | 维度 | 判定 | 一句话结论 | 优先级 |
| --- | --- | --- | --- | --- |
| 1 | 色彩 token 体系（单一主色 + 三级 surface + 语义色） | ✅ 已达先进水准 | 主色 indigo `#5e6ad2/#7b83eb` 与 Linear 同源，中性阶/语义色取自 GitHub 明暗双阶，`color-mix(in oklab)` 派生 alpha 属现代做法 | — |
| 2 | 间距 / 圆角 / 阴影 / 字号刻度 | ✅ 达标 | 4px 基准刻度与 Stripe 官方刻度族一致；四层柔和叠加阴影优于多数社区实现 | 微调：`--side-w: 224px` 略窄于社区 240–280 主流带 |
| 3 | 动效时长与缓动 | ⚠️ 部分达标 | 三档 120/200/320ms 落在 Carbon productive 区间内，但**缺「进入慢出、退出更快」的方向差异**，且列表容器用带回弹的 `--spring` 与社区规则相反 | P1 |
| 4 | `prefers-reduced-motion` | ✅ 达标（全局兜底） | 全局 `!important` 关停动画/过渡，符合 W3C C39 充分技术 | 引入 View Transitions 时补媒体查询分支 |
| 5 | 无障碍下限（焦点环 / 命中区 / 对比度） | ⚠️ 部分达标 | 焦点环 3px 满足 AAA(2.4.13) 面积要求，但**未验证 3:1 状态色差**；徽章 21px、导航计数 19px 低于 AA(2.5.8) 的 24px，只能靠 spacing 例外勉强通过 | P1 |
| 6 | naive-ui 主题接线（token → `themeOverrides`） | ✅ 思路正确 | CSS token 与 naive `common` 共用同一份常量，避免两套刻度漂移——naive 项目里少见的正确姿势 | — |
| 7 | `createDiscreteApi` 脱离 ConfigProvider | ❌ 明确缺陷 | `lib/ui.ts:15-18` 静态传入 `primaryColor:'#0969da'`（GitHub 蓝）**且不传 `darkTheme`** → 深色模式下 message/dialog/notification 仍是浅白底 + 第三种品牌色 | **P0** |
| 8 | 反馈时长策略 | ❌ 缺失 | naive 默认 `duration: 3000`（源码实测），错误提示也会 3s 自动消失；业界下限 5s，错误应驻留或 ≥10s | **P0** |
| 9 | 空状态有 CTA、错误态图形语义 | ⚠️ 部分达标 | `.empty` 只有 icon+标题+描述，**无主行动**；命令面板「没有匹配项」用搜索图标而非告警图标，Primer 明确要求错误态不得卖萌 | P1 |
| 10 | 命令面板可达性与排序 | ⚠️ 部分达标 | 尺寸（620px / 12vh / 46vh）在规范带内；但无 recents/frecency、无模糊匹配高亮、无 `role=listbox`/`aria-selected`/结果数播报 | P1 |
| 11 | Electron 壳层（窗口 / 主题同步 / 标题栏） | ⚠️ 部分达标 | `minWidth 1100` 偏大；`backgroundColor:'#f7f8fa'` 硬编码浅色 → 深色模式启动白闪；保留原生标题栏（可靠但不沉浸） | P1（白闪）/ P3（沉浸） |
| 12 | 玻璃拟态与关闭 GPU 加速的冲突 | ⚠️ 需要策略 | `disableHardwareAcceleration()` 与 topbar/工具条/图谱浮层/抽屉的 5 处 `backdrop-filter: blur(10~20px)` 同时存在，软件光栅下这是最贵的属性 | P1 |
| 13 | 加载策略（骨架 vs spinner） | ✅ 基本达标 | 已有 `.skeleton` shimmer；缺「≥1s 才显示骨架」「异步骨架保持终态行高」的写死规则 | P2 |
| 14 | 危险动作确认与撤销 | ⚠️ 无统一策略 | 没有「可撤销优先于弹窗」的分档规则；破坏性动作用 `n-popconfirm` 还是 `dialog` 未固定 | P2 |
| 15 | 图表配色与可访问性 | ⚠️ 部分达标 | `chartPalette` 与 token 同源、手写 SVG 走语义类 ✅；缺色盲双编码与 tooltip 键盘可达约定 | P2 |
| 16 | 密度自适应 / 虚拟列表阈值 | ⚠️ 缺失 | 题库、错题、图谱节点列表无虚拟化阈值约定（社区经验：>200 行需虚拟化） | P2 |

**总评**：token 层与视觉层已经到了一线社区产品的水平（不是模板级观感）。真正的短板集中在**行为契约**——反馈时长、退出动画、可达性语义、离散 API 的主题接线，恰好是决定「用起来专不专业」的那一层。下面各节给出依据与改法。

---

## 1. 对标对象与证据分层

按可信度使用证据：**标准 > 厂商官方规范 > 一线产品的可复用规范 > 品牌逆向分析页 > 博客**。

| 层级 | 来源 | 我们从中取什么 |
| --- | --- | --- |
| 标准 | [W3C Understanding SC 2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)、[SC 2.4.13 Focus Appearance](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html)、[Technique C39: reduced motion](https://www.w3.org/WAI/WCAG22/Techniques/css/C39) | 命中区 ≥24×24 CSS px（AA）/ 44×44（AAA 增强版 2.5.5）；不足 24px 时可用 spacing 例外（24px 直径圆互不相交）；焦点指示 ≥2px 周长且状态间色差 ≥3:1；reduced-motion 兜底写法 |
| 标准 | [Can I use — View Transitions (single-document)](https://caniuse.com/view-transitions) | Chrome/Edge 111+、Safari 18+、Firefox 144+（143 默认关闭）→ Electron 45 可直接使用 |
| 厂商官方 | [IBM Carbon — Motion（含 duration token 表）](https://v10.carbondesignsystem.com/guidelines/motion/overview/) | 六档时长 70/110/150/240/400/700ms；productive/expressive × standard/entrance/exit 共 6 条 cubic-bezier；自检清单「微交互 90–120ms、用户输入用 ease-out、不要用 bounce/stretch 曲线」 |
| 厂商官方 | [Stripe Apps — Style your app](https://docs.stripe.com/stripe-apps/style) | 间距刻度 `0/2/4/8/16/24/32/48`；语义背景只有 `surface`/`container` 两级；边框 `neutral`/`critical`；文本四级 `heading/subheading/body/caption`；排版与布局只允许 token 值 |
| 厂商官方 | [GitHub Primer — Empty states](https://primer.style/product/ui-patterns/empty-states/) | 空状态解剖：图形 / 主文案 / 次文案 / **一个主行动** / 可选次行动；错误态图形必须传达「出错了」而非讨喜；文案既不含糊也不过度技术化；错误态几乎不该有次行动 |
| 一线产品规范 | [Setproduct — Command Palette UI Design, 8 States and 10 Teardowns](https://www.setproduct.com/blog/command-palette-ui-design-guide)（拆 Linear/Raycast/Vercel/Notion/Figma/GitHub/Slack/Superhuman/Arc/Cal.com） | 宽度 560–680px、距顶 15–20%、可见列表 6–8 行、总高 ≤60vh、行高 40–48px（带描述 52–60）、footer ≈36px/12–13px、scrim 30–50%、进入 150–200ms `cubic-bezier(.16,1,.3,1)` 上浮 4–8px、退出纯淡出 100–140ms、列表重排动画 ≤120ms、异步 debounce 150–250ms 并取消上一请求、>200 项虚拟化、空查询展示 4–6 条 recents、fuzzy 必须高亮命中字符、`aria-activedescendant` + live region 播报数量 |
| 一线产品规范 | [02ui — Sidebar](https://02ui.com/components/sidebar/)、[codefronts — 可访问侧栏](https://codefronts.com/layouts/css-sidebar-layouts/accessible-admin-panel-sidebar-with-css-tooltips-and-icon-collapse/) | 展开 240–280px、折叠图标栏 48–64px 为社区惯例；折叠态每个图标必须在 hover **和键盘聚焦**时给出名称 |
| 品牌逆向分析 | [Linear（open-design）](https://open-design.ai/plugins/design-system-linear-app/)、[Linear tokens（designmd）](https://designmd.cc/benchmarks/linear)、[Linear（opendesigner）](https://opendesigner.io/design-systems/linear-app)、[Raycast（Refero）](https://styles.refero.design/style/3b6a17f0-3bdf-418c-a95e-0b89e5a8b2f8)、[Notion（open-design）](https://open-design.ai/plugins/design-system-notion/) | Linear 主色 `#5e6ad2`（bg）/`#7170ff`（accent）、正文 Inter 13px/510、深色发丝线 `rgba(255,255,255,.05)`、近乎全消色；Raycast 近黑 `#040506`/`#07080a` + Inter/GeistMono；Notion 走**暖**中性（纸感） |
| 研究/实践 | [Nielsen — Response Time Limits](https://www.nngroup.com/articles/response-times-3-important-limits/)、[NNG Skeleton Screens 101](https://www.nngroup.com/articles/skeleton-screens/)、[NNG Designing Empty States](https://www.nngroup.com/articles/empty-state-interface-design/)、[Sheri Byrne-Haber — Toast 无障碍](https://sheribyrnehaber.medium.com/designing-toast-messages-for-accessibility-fb610ac364be)、[Deque cauldron #2099](https://github.com/dequelabs/cauldron/issues/2099)、[Sara Soueidan — Focus Indicators](https://www.sarasoueidan.com/blog/focus-indicators/)、[VS Code #20417 字体抗锯齿](https://github.com/microsoft/vscode/issues/20417) | 0.1s / 1s / 10s 三条反馈红线；骨架屏适合结构性加载、shimmer 表示「即将到位」；toast 时长下限 5s（+每 120 词 1s）错误不自动消失；焦点环 2px 周长 + 3:1；Windows ClearType 与灰度抗锯齿之争 |
| 框架源码 | 本机 `node_modules/naive-ui@2.45.3/es/**`（grep 实测，见 §6） | `createDiscreteApi` 自行挂一棵 ConfigProvider；`MessageProvider` 默认 `duration: 3e3`；`fade-in-scale-up` 默认 `.2s` + `scale(.9)`；`ExtractThemeOverrides` 支持 `common/self/peers` 递归 |

> ⚠️ 使用逆向分析页的规则：**只用它确认「某品牌确实用了这个值」，不用它论证规范**。规范论证一律引用上表的官方页与标准页。

---

## 2. 原则层：十条硬规则

这是本项目的裁决依据，PR 与之冲突即视为回归。

1. **单一主色，且主色不做装饰**。Linear 的做法是界面近乎全消色，只在交互态与状态点使用 `#5e6ad2`/`#8b5cf6`。本项目 `--accent` 只出现在：焦点环、选中态、主按钮、进度强调、链接。禁止给卡片标题、分区底纹铺主色。
2. **中性面最多三级**：`--bg`（页面底）/ `--surface`（卡与弹层）/ `--surface-2`·`--surface-3`（凹陷与分组）。Stripe 官方更极端——只有 `surface` 与 `container` 两个语义背景。再多一级就必须改名合并。
3. **一切颜色来自 token**。半透明一律 `color-mix(in oklab, var(--x) N%, transparent)`，不手写 `rgba()`。理由：切主题只改一处，且 alpha 叠色在感知均匀空间更稳。
4. **四态必须可辨**：rest / hover / focus-visible / active（外加 disabled 与 selected）。任何可点元素缺 hover 或缺 focus 即视为未完成。
5. **动效只碰 `transform` 与 `opacity`**（本项目已遵守）。布局属性动画只在侧栏折叠一处例外，因为它需要真实列宽变化。
6. **时长三档封顶**：120ms（悬停/按压）、200ms（进入/切换）、320ms（大面积展开）。超过 320ms 需注释说明。Carbon 把 productive 微交互定在 70–150ms、toast 展开 240ms、背景变暗 700ms——我们的档位是它的简化版，落在合理区间。
7. **退出比进入快**：方向性缓动 = 进来时减速、离开时加速。见 §6.5。
8. **`prefers-reduced-motion` 是一等公民**。W3C 的充分技术就是在媒体查询里把时长压到 0.01ms（[C39](https://www.w3.org/WAI/WCAG22/Techniques/css/C39)），本项目已全局实现。
9. **键盘路径覆盖鼠标的每个动作**，并把快捷键印在可见触发器上（Linear/Figma/Superhuman 的共同做法：命令面板本身就是教学面）。
10. **可访问性是下限**：命中区 ≥24×24 CSS px（WCAG 2.2 AA，2.5.8），重要控件冲 44×44（AAA，2.5.5）；焦点指示满足 2.4.13 的面积与色差；正文对比 ≥4.5:1。

---

## 3. Token 层逐项对标

判定符号：✅ 达标 / ⚠️ 部分 / ❌ 缺失 / ➖ 无需改。

### 3.1 颜色

| 项 | 社区取值与出处 | 本项目现值 | 判定 | 行动 |
| --- | --- | --- | --- | --- |
| 品牌主色 | Linear `#5e6ad2`(bg)/`#7170ff`(accent)；Vercel/Geist 系走消色 + 少量强调 | 浅 `#5e6ad2`、深 `#7b83eb`（深色端提亮是 Linear 同源做法） | ✅ | 保持 |
| 页面底 | Linear 深色近黑 `#08090a`；Raycast `#040506`/`#07080a`；浅色端常见 `#f7f8fa` | 浅 `#f7f8fa` / 深 `#0b0d12` | ✅ | 保持 |
| 卡片面 | 深色需比页面底**抬升 2–3 个 elevation 台阶**（Setproduct 暗色规则：不要简单反色） | 浅 `#fff`；深 `#14171d`→`#1a1e26`→`#232833` 正好三级台阶 | ✅ | 保持 |
| 发丝线 | Linear 深色边框 `rgba(255,255,255,.05)`；Stripe 用单一 `keyline: neutral` | 深色实色 `#262c38`（另有 `--border-2 #3a424f`） | ➖ | 保持实色更可预测；新描边一律用 `--border`，别混进 `rgba(255,255,255,.05)` |
| 语义色 | GitHub 明暗双色阶（浅 `#cf222e/#1a7f37`，深 `#f85149/#3fb950`） | `--bad/--ok/--warn` 明暗两套直接采用 GitHub 值 | ✅ | 保持；残留硬编码见 §3.1-bug |
| 中性温度 | Notion 走**暖**中性（纸感），Linear/Raycast/GitHub 走**冷**中性（金属感） | 冷（`#f7f8fa`、`#0b0d12` 带蓝相） | ✅ | 数据/训练型工具选冷中性正确，别中途换暖 |
| 信息色 | — | naive `infoColor` 浅 `#2563eb`，CSS 侧没有对应 token，info 由 `--accent` 兼任 | ⚠️ | 加 `--info` token 并与 naive `infoColor` 同源，避免「蓝」与「靛」并存 |

**§3.1-bug（真实不一致，建议顺手修）**：`lib/ui.ts:30` 的 `SCALE_COLOR = ['#cf222e','#9a6700','#1a7f37','#8250df']` 与 `pctColor()` 里的 `'#1a7f37'` 是硬编码浅色 hex。深色模式下压在 `#14171d` 上时 `#9a6700` 约 3.4:1，低于正文 4.5:1 要求；同时违反自家「`.vue`/工具函数里禁止 hex 字面量」的规则（见 [`UI-DESIGN-SYSTEM.md` §1](./UI-DESIGN-SYSTEM.md)）。改法：改用 `var(--bad)/var(--warn)/var(--ok)/var(--purple)`（若必须在 JS 里取色值，就从 token 源导出一张明暗双值表，别让第三份真值出现）。同类残留：`lib/ui.ts:17` 的 `#0969da/#388bfd`（见 §6.1）。

### 3.2 间距 / 圆角 / 阴影 / 控件高度

| 项 | 社区取值 | 本项目 | 判定 |
| --- | --- | --- | --- |
| 间距刻度 | Stripe 官方 `0/2/4/8/16/24/32/48`；通用 4/8pt 网格 | `--sp-1..12` = 4/8/12/16/20/24/32/40/48 | ✅ 4px 基准的稠密超集，桌面端够用；20/40 是为 8pt 网格之外的补偿，**别再插新档** |
| 圆角 | 卡片 12–16px、控件 6–10px、徽章全圆角（Linear CTA 6px；Stripe `small/medium` 语义档） | 6/10/14/20/999 | ✅ 卡片 14、控件 10 正落区间中位 |
| 阴影 | 现代做法：多层叠加 + 负扩散，避免单层生硬投影 | `--sh-1..4` 每层两段、含负 spread，深色端换纯黑加强 | ✅ 优于社区平均水准 |
| 控件高度 | naive 默认 small 28 / medium 34 / large 40；密集桌面工具常见 30–36 | 覆盖为 `30/36/42` | ✅ 与自研 `.btn`(≈32)、`.icon-btn`(32) 同节奏 |
| 焦点环 | 2–3px 环 + 约 2px offset；多数 Web 应用用 `box-shadow` 环 | `--ring` 3px@32% accent、`--ring-soft` 3px@18%，`:focus-visible` 配 `outline: 2px solid transparent` | ⚠️ 面积满足 2.4.13 的「≥2px 周长」，但**状态间 3:1 色差未验证**：32% 混色压在 `--surface` 上大概率不足 3:1。改成实色 `--accent` 环或「accent 内环 + `--border-2` 外环」双层，并用取色器核对 |

### 3.3 排版

| 项 | 社区取值 | 本项目 | 判定 / 行动 |
| --- | --- | --- | --- |
| 正文字号 | Linear 正文 13px/510；Stripe 语义四级 `heading/subheading/body/caption` | `--fs-base 13.5px`，八级阶梯 11.5→34 | ✅ 13.5px 对中文可读性比 13px 稳，保持 |
| 中英文字体栈 | 桌面 Electron 通行：`-apple-system → Segoe UI Variable Text → system-ui → PingFang SC → Microsoft YaHei UI → Noto Sans CJK SC` | 完全一致，但在 `theme.ts:53` 与 `styles.css:43` **写了两遍** | ⚠️ 两处必须同步，否则 naive 与自研组件分家。建议 CSS 保留唯一声明，naive 侧从同一模块导出注入（或反过来由 theme.ts 写 `:root{--font:...}`） |
| 数字对齐 | 指标与表格必须 `tabular-nums` | `.num/.tabular` + 各处显式声明 | ✅ 这是专业感的关键，保持 |
| 字重 | Linear 用 510/550 这类可变字体中间档 | 大量 `550/620/650` | ⚠️ 系统字体（PingFang/YaHei）**没有可变字重轴**，620 会就近落到 600、550 落到 500。数值无害，但别指望 620 与 600 有视觉差；层级靠字号 + 颜色区分 |
| Windows 渲染 | VS Code 长期议题：ClearType 彩色子像素 vs 灰度抗锯齿（[#20417](https://github.com/microsoft/vscode/issues/20417)）；Chromium 在 Windows 走 DirectWrite | `-webkit-font-smoothing: antialiased` 写在 body | ➖ 该属性只对 macOS 生效，Windows 下无副作用。若收到「Windows 深色发虚」反馈，再考虑设置页提供灰度抗锯齿开关（Chromium `--disable-lcd-text`），现在不必 |

### 3.4 结构尺寸

| 项 | 社区取值与出处 | 本项目 | 判定 / 行动 |
| --- | --- | --- | --- |
| 侧栏展开宽 | 240–280px 是惯例带（[02ui](https://02ui.com/components/sidebar/)） | `--side-w: 224px`（≤1240px 降到 200px） | ⚠️ 224 略窄，最长标签「题库·版本」刚好顶格。**建议 240px**；坚持 224 则导航文案不得再加长 |
| 折叠图标栏 | 48–64px，且折叠态必须给名称提示（hover **与 focus**） | rail 62px；提示只用原生 `title`（仅鼠标、约 1s 延迟） | ⚠️ 键盘用户拿不到折叠态标签。补 `aria-label`（已有部分）并在键盘聚焦时用 `n-tooltip` 或伪元素浮层 |
| 顶栏高 | macOS 48–56px；Windows 原生标题栏 32–40px | `--topbar-h: 56px`（玻璃 + blur12） | ✅ |
| KPI 卡最小宽 | auto-fit 网格常见 160–240px | `.kpis minmax(168px,1fr)`、`.g4 180px`、`.g3 236px` | ✅ 一卡一指标 + 趋势位，符合 dashboard 常识 |
| 内容最大宽 | 1080–1200px 居中 | `.page-narrow max-width: 1120px` | ✅ |
| 断点 | — | 1240 / 1180 / 1080 / 1000 / 860 / 720 | ✅ 够用；但注意 §9 的窗口下限错配 |

---

## 4. 明暗双主题

社区共识：**深色不是把颜色反转，而是重新定义 elevation**（Setproduct：容器比页面底抬 2–3 阶、scrim 比页面更暗、active 行必须有背景位移，因为深色压缩了对比范围）。

本项目做对的：三级 surface 抬升、深色端阴影换纯黑并加强、`color-scheme` 随主题写入、语义色整组替换为 GitHub 深色值、图表调色板另配一套、`--glass/--glass-solid/--scrim` 各有一套深色值。

待补三件事：

1. **启动白闪（P1）**。`main/index.ts:60` 固定 `backgroundColor: '#f7f8fa'`，深色模式先看到浅灰底再跳深底。改法：建窗前从持久化偏好（或 `nativeTheme.shouldUseDarkColors`）判断并传对应底色，主题切换时调用 `win.setBackgroundColor()`。`show:false` + `ready-to-show` 已经做了，补齐这步就闭环。
2. **`auto` 模式的权威源（P3）**。CSS 的 `prefers-color-scheme` 与应用内 `data-theme` 目前各自成立。建议 `nativeTheme.themeSource = 'system|light|dark'` 由主进程统一广播，渲染层只接收事件——否则「跟随系统」在系统切换夜间主题时会出现 naive 组件与自研组件不同步。
3. **主题切换过渡（P2，可选亮点）**。当前是 `background-color/color` 200ms 过渡。先进做法是用 View Transitions 做整树交叉淡入（Chrome/Edge 111+，本项目 Chromium ≥130 直接可用，[caniuse](https://caniuse.com/view-transitions)）：

```ts
// lib/theme.ts：包一层，reduced-motion 下退化为同步赋值
export function applyThemeAnimated(): void {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  const doc = document as Document & { startViewTransition?: (cb: () => void) => void }
  if (reduce || !doc.startViewTransition) { applyTheme(); return }
  doc.startViewTransition(() => applyTheme())
}
```

```css
/* 切换期间冻结逐元素进入动画，否则每个 .rise 都会重播 */
::view-transition-old(root), ::view-transition-new(root) { animation-duration: 220ms }
html.theme-switching .rise { animation: none !important }
```

---

## 5. 组件与状态完备性

### 5.1 与 naive-ui 的分工（现状是对的）

- 结构化控件（表单、弹窗、表格、下拉、日期、消息）交给 naive-ui，语义走 `type=` / `size=`；
- 展示型容器（卡片、KPI、徽章、进度、手风琴、空态、骨架）自研，走 styles.css 的类；
- 覆盖 naive 观感只有两条路：`themeOverrides`（首选）或全局类覆盖 `.n-*`（已用于 `.n-data-table-th`、`.n-input__placeholder`）。**不要用内联 style 打补丁**——那会造成「同一个输入框在不同页面高度不同」的经典崩坏。

### 5.2 状态完备清单（把命令面板的 8 态推广到每个数据视图）

| 状态 | 必须呈现 | 本项目现状 |
| --- | --- | --- |
| 空查询 / 首次进入 | recents + 引导，而不是空白 | `.empty` 有文案但**无主行动**（§7.3） |
| 加载中 | 终态行高的骨架，避免跳动 | `.sk-line/.sk-block` 已有；需逐个视图确认列表用的是骨架而非 spinner |
| 无结果 | 至少两条出路（清条件 / 扩大范围） | 命令面板给了「换个关键词，或直接用左侧导航」，但仍是纯文本、零按钮 |
| 失败 / 离线 | 局部功能仍可用 + 安静提示 | `nodesErr` 会把原因显示出来 ✅；题库加载失败是否给重试？需检查 |
| 禁用 | 留在原地 + 说明原因，不要隐藏 | 图谱 `.locked` 用 45% 透明 + 去饱和 ✅；但缺 `cursor: not-allowed` 与原因提示 |
| 选中 / 多选 | 计数 + 批量动作 | 答题格子 `.answer-cell` 是等价物 ✅ |
| 危险 | 与常规动作视觉分离 | `.btn.danger` 有；naive 侧 `type="error"` 有 |

---

## 6. naive-ui 2.45 深水区（源码实测）

以下全部来自本机 `node_modules/naive-ui@2.45.3/es/` 的 grep 结果，可直接照抄进 PR 描述。

### 6.1 `createDiscreteApi` 不继承 ConfigProvider 主题 —— **P0**

```text
es/discrete/src/discrete.mjs:
  createDiscreteApi(includes, { configProviderProps, messageProviderProps, ... })
    → createDiscreteApp({ providersAndProps, configProviderProps })   // 自己挂一棵 NConfigProvider
```

也就是说 `message / dialog / notification` 渲染在**另一棵树**里，不会继承 `App.vue` 上那层 `n-config-provider` 的主题。本项目 `lib/ui.ts:15-18` 传的是模块加载时求值的普通对象：

```ts
{ configProviderProps: { themeOverrides: { common: { primaryColor: '#0969da', primaryColorHover: '#388bfd' } } } }
```

三个后果：① 没传 `theme: darkTheme`，深色模式下弹出来的提示与确认框是**浅白底**（压在 `#0b0d12` 上像手电筒）；② 主色被改成 GitHub 蓝 `#0969da`，与界面其余部分的 indigo 形成第三种品牌色；③ 普通对象不参与响应式，运行期切主题不会更新。

**改法 A（最稳）**：把 provider 放进主树，用 hook 取 API。

```text
n-config-provider → n-message-provider(:duration="3500" :keep-alive-on-hover="true")
                  → n-dialog-provider → n-notification-provider → RouterView
```

代价：只能在组件 setup 内 `useMessage() / useDialog()`。store/ipc 层需要提示时把实例注入（或保留 discrete 走改法 B）。

**改法 B（保留 discrete，但选项响应式 + 复用同一份 token）**：

```ts
import { computed } from 'vue'
import { darkTheme, createDiscreteApi } from 'naive-ui'
import { isDark, naiveOverrides } from './theme'

export const { message, dialog, notification } = createDiscreteApi(
  ['message', 'dialog', 'notification'],
  {
    // 交给 NConfigProvider 渲染时解包；切换主题后 .n-message 底色应随 isDark 变化（用一个断言测试守住）
    configProviderProps: computed(() => ({
      theme: isDark.value ? darkTheme : null,
      themeOverrides: naiveOverrides(isDark.value),
      hljsTheme: null,
    })) as any,
    messageProviderProps: { placement: 'top', duration: 3500, keepAliveOnHover: true, max: 3 },
  },
)
```

要点：**删掉那个 GitHub 蓝**。`lib/theme.ts` 已经是唯一真值源，任何第二处 hex 都是回归（见 §3.1-bug）。

### 6.2 反馈时长契约 —— **P0**

```text
es/message/src/MessageProvider.mjs:13   duration: { type: Number, default: 3e3 }   // 3 秒
                             keepAliveOnHover: Boolean                              // 默认 false
es/message/src/MessageEnvironment.mjs:35  if (duration) timerId = window.setTimeout(hide, duration)
```

业界下限：toast 自动消失 **5s 起**，并按内容长度追加（[Byrne-Haber：5 秒 + 每 120 词加 1 秒](https://sheribyrnehaber.medium.com/designing-toast-messages-for-accessibility-fb610ac364be)；[Deque cauldron #2099 把 auto-hide 直接定为 5s](https://github.com/dequelabs/cauldron/issues/2099)）。需要后续动作或表达失败的消息**不应自动消失**。

本项目应固化的契约（写进 `lib/ui.ts` 常量表，禁止散落的裸数字）：

| 类型 | 时长 | naive 参数 | 理由 |
| --- | --- | --- | --- |
| 成功轻确认（已保存 / 已刷新 / 已导出） | 2200ms | `{ duration: 2200 }` | 高频动作，超过 3s 会累积成噪音 |
| 信息 / 进行中 | 3500ms | `{ duration: 3500 }` | 至少要读完一句话 |
| 警告 | 6000ms + `keepAliveOnHover: true` | — | 低于 5s 读不完 |
| 错误 / 可撤销 | **不自动关**且 `closable: true`（或 10000ms） | `{ closable: true }` | 用户必须知道它失败了 |
| 后台任务完成（通知） | 8000ms + `keepAliveOnHover: true` | notification | 允许稍后再看 |

坑：naive 用 `if (duration)` 判断，**传 `0` 不等于常驻**（0 是 falsy，反而不启动定时器、表现依赖实现）；provider 默认 3000 会在调用处未指定时被套用。要做常驻，就在调用处显式 `duration: undefined` 并把 provider 的 `duration` 设大、同时给 `closable: true`。这类细节正是「为什么我们的错误提示自己消失了」的根因。

### 6.3 主题覆盖的能力边界

```text
es/_mixins/use-theme.d.ts:23
ExtractThemeOverrides<T> = Partial<组件自身 vars> & { peers?: 递归 peer 覆盖 } & { common?: Partial<ThemeCommonVars> }
```

即每个组件都支持三件事：①自己的 vars ②`common` ③**嵌套 peers**（例：`Card: { peers: { DataTable: { tdFontSize: '12.5px' } } }`）。本项目目前只用了 ①②（覆盖 16 个组件），这没问题；但要记住 peers 存在——遇到「只有卡片里的表格要特殊密度」时别去写全局 CSS。

尚未使用的能力：`builtinThemeOverrides`（组件内置覆盖，优先级低于用户传入的 `themeOverrides`，适合把「我们希望的默认」塞进自研封装而不与外部设置打架）、`GlobalTheme` + `createTheme({ name, common, self, peers })`（做整套皮肤时才需要）。

### 6.4 弹层动效与 naive 默认值的关系

```text
es/_styles/transitions/fade-in-scale-up.cssr.mjs:  duration = '.2s', enterScale = '.9'
```

naive 的 Modal/Select/Popover 走 `fade-in-scale-up`（200ms，scale .9↔1）。这与 Setproduct 对弹层的建议（进入 150–200ms、上浮 4–8px、减速曲线 `cubic-bezier(.16,1,.3,1)`、退出纯淡出 100–140ms）**同量级，不必为了对标去改**。真正的不一致来自我们自己：

- `.cmdk` 用 `--spring cubic-bezier(.34,1.36,.64,1)`（控制点 >1，会回弹）做进入。命令面板是**列表**，容器回弹会让行位置在读数瞬间漂移；Carbon 自检明确「不要用带 bounce/stretch 的曲线」。→ 换成减速曲线 + 位移 6px。
- naive Modal 的 `scale(.9)` 与自研 `.pop` 的 `scale(.96)` 并存，两套缩放幅度。→ 统一为 `scale(.97)`。
- 弹层退出目前是「无动画直接卸载」（`.cmdk-mask` 只有 enter 动画）。Setproduct 建议退出 100–140ms 纯淡出，且 Esc 关闭不要加长动画。→ 补一个 120ms 的 leave 淡出即可，位移留给进入。

### 6.5 方向性缓动规则（本次对标最大的一处行为缺口）

| 场景 | 社区依据 | 现状 | 应改为 |
| --- | --- | --- | --- |
| hover / active 等微交互 | Carbon 自检：用户输入侧用 ease-out，微交互落在 90–120ms | ✅ `--dur-fast 120ms` + `--ease-out` | 保持 |
| 元素**进入**视图 | Carbon entrance easing：productive `cubic-bezier(0,0,.38,.9)`、expressive `cubic-bezier(0,.3,1)`；Setproduct 弹层 `cubic-bezier(.16,1,.3,1)` | 统一用 `--ease-out` | 新增 `--ease-enter: cubic-bezier(.16,1,.3,1)` 专供进入类动画（`.rise/.pop/.drawer/cmdk`） |
| 元素**退出**视图 | Carbon exit easing：productive `cubic-bezier(.2,0,1,.9)`；Setproduct 退出 100–140ms | 缺（多为瞬时卸载或用同一条进入曲线） | 新增 `--ease-exit: cubic-bezier(.4,0,1,.9)` + `--dur-exit: 120ms` |
| 列表按键盘重排 | Setproduct：≤120ms，且只在 active 行位置变化时动 | 无（键盘移动瞬时，正确） | 保持瞬时；若加动画则 ≤120ms |
| 大面积展开 | Carbon `duration--moderate-02` 240ms（toast / 展开）、`slow-01` 400ms（大展开） | `--dur-slow 320ms` | 保持（落在 240–400 区间） |

---

## 7. 五个关键组件对标

### 7.1 ⌘K 命令面板

规范带宽取自 [Setproduct 拆解](https://www.setproduct.com/blog/command-palette-ui-design-guide)（该文对 Linear/Raycast/Vercel/Notion/Figma/GitHub/Slack/Superhuman/Arc/Cal.com 逐个实测给值）。

| 维度 | 社区带宽 | 本项目现值（来源：`styles.css:489-499` + `CommandPalette.vue`） | 判定 |
| --- | --- | --- | --- |
| 容器宽 | 560–680px | `min(620px, 92vw)` | ✅ |
| 距顶偏移 | 视口高 15–20% | `padding-top: 12vh` | ⚠️ 偏上；调到 15–18vh，让前 6 行落在视线中心 |
| 列表可见行数 / 总高 | 6–8 行封顶；总高 ≤60vh | `max-height: 46vh` | ➖ 保守但安全；考点结果多时可放到 52vh |
| 行高 | 单行标签 40–48px；带描述 52–60px | `padding: 9px var(--sp-3)` + 13.5px 字 ≈ **37px** | ⚠️ 低于下限；把垂直内边距提到 11–12px（≈42–44px） |
| footer 高度 / 字号 | ≈36px、12–13px | `--fs-xs 11.5px` + 上下 8px padding ≈ 34px | ⚠️ 字号偏小到临界可读；提到 `--fs-sm 12.5px` |
| scrim | 深色中性、30–50% 不透明度 | 浅 `rgba(16,24,40,.38)` / 深 `rgba(0,0,0,.58)` | ✅（深色 58% 略超上限，但深色端 Setproduct 要求「比页面更暗」，可接受） |
| 边框 + 阴影 | 发丝线 + 大而软的投影（两者都要） | `1px solid --border` + `--sh-4` | ✅ |
| 图标 | 单一图标族、16/20px、单色不带品牌色 | `<Icon :size="16">` 全 stroke=currentColor | ✅ |
| 快捷键提示样式 | keycap 圆角 8px、1px 低对比描边、右对齐、非活动行降透明度 | `.kbd`（mono 10.5px、下边框 2px） | ✅ 风格更精致，保持 |
| 进入动效 | 150–200ms 淡入 + 上浮 4–8px，减速曲线 | 200ms `pop` scale .96 + **spring 回弹**；mask 200ms 淡入 | ⚠️ 见 §6.5 |
| 退出动效 | 100–140ms 纯淡出，Esc 不得拖沓 | 瞬时卸载 | ⚠️ 补 120ms 淡出 |
| 空查询首屏 | 4–6 条 recents + 能力建议 | 固定 7 条导航 + 5 条动作，**无 recents/frecency** | ❌ 这是「用起来不像 Linear」的最大体感差 |
| 匹配方式 | fuzzy + **必须高亮命中字符** | 子串 `includes`，无高亮 | ❌ 中文场景 fuzzy 收益有限，但缩写（如 `fsrs`、`gdgl`）必须能吃下；至少要高亮 |
| 排序信号 | frecency（频率+新近度，需衰减），上下文优先于全局热度（Vercel 做法） | 固定顺序：前往 → 动作 → 考点 | ⚠️ 至少把「最近用过」置顶并持久化 |
| 二级动作 | `Cmd+Enter` 打开该行动作面板（Raycast 范式） | 无 | P3 |
| 嵌套页与返回 | Enter 进下层，空输入框 Backspace 回上层，Back ≠ Close | 无嵌套（单层，够用） | ➖ |
| 禁用命令 | 灰置 + 说明原因，不要隐藏 | 无禁用态 | P3 |
| 可达性 | combobox + listbox，焦点留在 input，`aria-activedescendant` 指向活动行，live region 播报数量 | `role="dialog" aria-modal` ✅，但行是裸 `div`，无 `option`/`aria-selected`，无数量播报 | ❌ P1 |
| 焦点管理 | 打开即聚焦输入框；关闭后焦点回到触发器 | 打开聚焦 ✅；关闭后**未回焦**，焦点落到 body → 键盘用户丢位置 | ❌ P1（一行代码） |
| 性能 | >200 项虚拟化；异步 debounce 150–250ms 并取消上一次 | 本地过滤 + 考点结果 `slice(0,9)` ✅ | ✅ 无需虚拟化 |
| AI 兜底 | 生成的结果单独分组打标签，**永远不得排在真实命令之前** | 暂无 AI 结果 | ➖ 未来接 AI 时照此约束 |

可达性最小改造（不动视觉）：

```html
<input role="combobox" aria-expanded="true" aria-controls="cmdk-list"
       aria-activedescendant="cmdk-it-<idx>" autocomplete="off" />
<div id="cmdk-list" role="listbox" :aria-label="`命令结果 ${items.length} 条`">
  <div role="group" :aria-label="g.group">
    <div v-for="(it,i) in g.list" :id="`cmdk-it-${globalIndex(it)}`" role="option"
         :aria-selected="items[idx]?.id === it.id">…</div>
  </div>
</div>
<div class="sr-only" role="status" aria-live="polite">{{ items.length }} 条结果</div>
```

关闭时 `triggerEl?.focus()`（Linear/Vercel 都把焦点还给触发按钮）。

### 7.2 侧栏与折叠图标栏

- 宽度：展开 240px（社区 240–280，[02ui](https://02ui.com/components/sidebar/)），折叠 62px（社区 48–64）✅。
- 折叠态标签：现在只有 `title` 属性（鼠标 + 延迟）。**要求**：`aria-label` 常带；键盘聚焦时用 `n-tooltip` 或 `::after` 浮层显示标题（[codefronts 的做法](https://codefronts.com/layouts/css-sidebar-layouts/accessible-admin-panel-sidebar-with-css-tooltips-and-icon-collapse/)：hover 与 focus 双触发）。
- 徽标计数（`.dot` 19px、rail 态 15px）低于 24px 命中区下限，但它是**装饰性附属物**（整行才是 target，行高约 33px ≥24）→ 依 WCAG 2.5.8 判定为可接受，前提是不单独可点。已在 §10 记为「通过（附条件）」。
- 折叠按钮 32×32 ✅；`⌘B`/`Ctrl+B` 已绑定 ✅（VS Code/Raycast 同款）。
- 侧栏底部状态区（AI 端点、点亮率）在 rail 态被完全隐藏：社区做法是保留一个 7px 状态点。建议 rail 态至少留端点健康色的圆点（已有 `.dotmark`，只是被 `display:none` 吞掉）。

### 7.3 空状态（差距最典型的组件）

Primer 的解剖要求（[官方页](https://primer.style/product/ui-patterns/empty-states/)）：图形 → 主文案（说明用途/安抚/开始流程/概括错误）→ 次文案（可选，说下一步）→ **一个主行动**（创建流程或指向答案）→ 可选次行动（文本链接，错误态基本不该有）；**错误态的图形不得卖萌，默认用告警图标**；文案既不能含糊（“出错了”）也不能过度技术（“US-East-2 集群挂了”）。NNG 同样强调空态是传达系统状态与可学习性的机会（[文章](https://www.nngroup.com/articles/empty-state-interface-design/)）。

本项目 `.empty`（`styles.css:323-326`）目前只有 icon + `.t` + `.d`，**缺主行动**；命令面板无结果时用的是搜索图标（中性），而 Primer 要求错误/失败场景改用告警图形。补齐写法：

```html
<div class="empty">
  <span class="ic"><Icon name="target" :size="26" /></span>
  <div class="t">还没有必考缺口</div>
  <div class="d">做完今日队列里的 12 题，系统才会判断哪些必考考点还没点亮。</div>
  <button class="btn primary" @click="goPractice"><Icon name="zap" :size="14" /> 开始今日队列</button>
  <!-- 错误态：图形换 alert，主行动指向“重试/查看原因”，不放次行动 -->
</div>
```

配套规则（写进 UI-DESIGN-SYSTEM.md §2 的空状态行）：**「为什么空」+「下一步做什么」+「一个能点的动作」**，三者缺一即视为未完成；四种空态分别对待——首次使用（欢迎 + 创建）、暂时为空（说明性质）、筛选后为空（清除条件）、加载失败（告警图形 + 重试）。

### 7.4 KPI / 数据面板

社区经验（一卡一指标、趋势用 sparkline、数值用等宽数字、单位与时间范围要标出来；参见 [Power BI KPI 卡实践](https://tabulareditor.com/blog/kpi-card-best-practices-dashboard-design)、[Appian SAIL KPI](https://docs.appian.com/suite/help/26.9/sail/ux-kpi.html)）：

| 要求 | 本项目 | 判定 |
| --- | --- | --- |
| 一卡一指标 | `.kpis > .kpi > (.k)(.v)(.d)` | ✅ |
| 等宽数字防抖动 | `.v` 已 `font-variant-numeric: tabular-nums` | ✅ |
| 趋势位 | `.d` 是纯文本；无 sparkline 槽位 | ⚠️ 建议给 `.kpi` 增加 `.spark` 半高槽（复用 `.spark-track` 语义类），别在卡里塞大图 |
| 阈值上色纪律 | `pctColor()` 四段阈值 | ⚠️ 见 §3.1-bug（硬编码浅色 hex）；且四段里两段都是绿系（`#1a7f37`/`--ok`）语义重叠，简化为 好/警戒/差 三档更清楚 |
| 颜色不作为唯一编码 | 徽章都有文字 | ✅ |
| 窄窗降级 | `@media (max-width:1080px)` 起逐步隐藏 topbar pill，`860px` 全隐 | ✅ 但被隐藏的信息没有替代出口（可在抽屉/“更多”里出现），P3 |

### 7.5 反馈三件套与危险动作分档

| 情形 | 选择 | 本项目策略（待固化） |
| --- | --- | --- |
| 可逆的小改动（加入错题本、切换开关） | **不弹窗**；toast 里带「撤销」 | 目前多为 toast，无撤销 → P2（`message` 加 `render` + action 按钮，或 `notification` 带两个动作） |
| 可恢复的破坏（删除单题记录） | `n-popconfirm`（就地、轻量） | 建议统一为 popconfirm |
| 不可逆且代价大（清空练习记录、回滚题库版本） | `dialog` + 明确动词按钮 + 影响范围说明；主按钮用 `type="error"`，**按钮文案用动词而非“确定”** | 需检查现有 dialog 文案是否写「确定/取消」（社区通病） |
| 批量破坏 | 先预览数量再确认 | 待加 |

依据：一线产品普遍把「可撤销」当作弹窗的替代品（弹窗只留给真正不可逆的场景）；`destructive action` 的确认文案应说明后果而不是问「你确定吗」。参考：[A UX guide to destructive actions](https://medium.com/design-bootcamp/a-ux-guide-to-destructive-actions-their-use-cases-and-best-practices-f1d8a9478d03)。

---

## 8. 动效规范（可直接抄进代码）

Carbon 时长与我们档位的映射（[来源](https://v10.carbondesignsystem.com/guidelines/motion/overview/)）：

| Carbon token | 值 | 典型场景 | 我们的对应 |
| --- | --- | --- | --- |
| `fast-01` | 70ms | 按钮、开关 | `--dur-fast 120ms`（偏慢一档，鼠标设备无感，可接受） |
| `fast-02` | 110ms | 淡入淡出 | 同上 |
| `moderate-01` | 150ms | 小范围展开、短距移动 | `--dur 200ms` |
| `moderate-02` | 240ms | toast、系统通信 | `--dur 200ms` / `--dur-slow 320ms` |
| `slow-01` | 400ms | 大展开、重要通知 | `--dur-slow 320ms` |
| `slow-02` | 700ms | 背景变暗 | 无（scrim 瞬时，可接受） |

曲线（Carbon productive 三条 + Setproduct 弹层一条）：

```css
:root {
  /* 状态切换：两端都在场 */
  --ease-standard: cubic-bezier(.2, 0, .38, .9);   /* Carbon productive standard */
  /* 进入：快速起步、平滑停止 */
  --ease-enter: cubic-bezier(.16, 1, .3, 1);       /* Setproduct 弹层进入 */
  /* 退出：加速离场，暗示“真的走了” */
  --ease-exit: cubic-bezier(.2, 0, 1, .9);         /* Carbon productive exit */
  --dur-exit: 120ms;
}
/* 例外：侧栏 ready-to-reappear，退出用 standard 而非 exit（Carbon 明确的侧栏规则） */
.side { transition: width var(--dur) var(--ease-standard), flex-basis var(--dur) var(--ease-standard) }
```

其余既有约定（都别改，它们是对的）：错峰 `--i * 45ms`（社区经验 30–50ms/项）；shimmer 1.5s 循环只在**等待中**的元素上；`.timer.danger` 1s 闪烁属于「提醒型」动画，必须纳入 reduced-motion（已被全局规则覆盖 ✅）；`pulse` 端点指示灯同理。

---

## 9. Electron 桌面特性清单

| 项 | 社区/官方做法 | 本项目（`main/index.ts`） | 判定 / 行动 |
| --- | --- | --- | --- |
| 默认窗口 | 1440×900 级 | 1460×920 | ✅ |
| 最小尺寸 | 常见 800×600～1024×768；下限越大越容易在分屏/小屏笔记本翻车 | `minWidth: 1100, minHeight: 700` | ⚠️ 1100 高于自家 1000px 断点，意味着**无法缩到自动收栏的宽度**，分屏一半（约 960px）直接撑破。建议 `minWidth: 940`（正好落在 1000 断点之下，能演示图标栏态） |
| 启动底色 | 跟主题，避免白闪 | 固定 `'#f7f8fa'` | ❌ P1，见 §4.1 |
| 主题源 | `nativeTheme.themeSource` 统一 | 未设置 | ⚠️ P3，见 §4.2 |
| 标题栏 | 沉浸：`titleBarStyle:'hidden'`（macOS 保留红绿灯，可用 `trafficLightPosition` 挪位）或 Windows `titleBarOverlay: { color, symbolColor, height }`；自绘区用 `-webkit-app-region: drag`，**其内部所有可点元素必须 `no-drag`**（否则点击被拖拽层吞掉，这是 Electron 最常见的“按钮点不动”成因） | 原生标题栏 + `autoHideMenuBar` | ➖ 可靠且不折腾；若要沉浸（P3）务必写 no-drag 白名单，并在 Windows 深色端同步 `titleBarOverlay.color`（已知坑：[electron#45958](https://github.com/electron/electron/issues/45958)） |
| 菜单 | 桌面应用需要 Ctrl+K 之类快捷键时，原生菜单 accelerator 会抢键；要么清空菜单，要么与渲染层快捷键二选一 | `autoHideMenuBar: true`（Alt 仍可唤出） | ⚠️ 需在 QA 清单里加一条：Windows 上 Alt 唤出菜单栏时 ⌘K/⌥T 是否仍生效 |
| GPU 与玻璃 | `backdrop-filter` 依赖 GPU 合成；软件光栅下每帧都要 CPU 模糊 | `app.disableHardwareAcceleration()`（默认关）+ 5 处 blur（topbar 12px、toolbar 10px、graph 浮层 10px、drawer 14px、cmdk mask 3px + 面板 20px） | ❌ P1：要么允许 GPU（仅在检测到白屏机器上关），要么在非活动浮层上退化为不透明底色（`--glass-solid`）。建议在 `main` 里广播 `gpuDisabled`，渲染层加 `html.no-gpu .topbar{ backdrop-filter:none; background:var(--surface) }` |
| 缩放 | Chromium 默认 Ctrl±/Ctrl0 改的是网页缩放，桌面应用通常自己接管或关掉以免布局错乱 | 未见处理 | ⚠️ P2：显式拦截 `Ctrl+=/-/0` 或提供「界面缩放」设置（对训练类长时阅读应用很实用） |
| 外链与弹窗 | `setWindowOpenHandler` 交系统浏览器 | 已实现且区分 disposition ✅ | ✅ |
| 崩溃可见性 | `render-process-gone` / `did-fail-load` 落日志 | 已实现 ✅ | ✅ 并建议把 `render-process-gone` 升级成 UI 内的 `.fb.bad` + 重新加载按钮 |

---

## 10. 无障碍合规清单

标准依据：[WCAG 2.2 Understanding](https://www.w3.org/WAI/WCAG22/Understanding/)。以下对比度按 WCAG 相对亮度公式由 hex 计算，标注为「≈」，落地前用取色器复核。

| 检查项 | 标准要求 | 本项目 | 结论 |
| --- | --- | --- | --- |
| 正文对比 | ≥4.5:1（AA 1.4.3） | `--text #16191f` on `#fff` ≈ 16.9:1；深色 `#e6eaf0` on `#14171d` ≈ 14.6:1 | ✅ |
| 次要文字 | ≥4.5:1 | `--text-dim #5b6472` on `#fff` ≈ 6.3:1；深色 `#9aa4b2` on `#14171d` ≈ 7.4:1 | ✅ |
| 弱化文字（11.5–12.5px） | ≥4.5:1（字号 <18.66px 属普通文本） | `--text-faint #8b95a3` on `#fff` ≈ **3.2:1**；深色 `#6b7684` on `#14171d` ≈ **4.4:1** | ❌ P1：`.micro/.section-title/.stat .foot` 全用它。浅色端提到 ≈`#6b7480`（≥4.5），深色端提到 `#7d8896`；或把这些标签字号升到 13px 并按大字号豁免 |
| 非文本 UI 对比 | ≥3:1（AA 1.4.11） | `--border #e3e8ef` on `#f7f8fa` ≈ 1.3:1（仅装饰性分隔线，可接受）；输入框描边由 naive 提供需实测 | ⚠️ 待测：把「有意义的边框/图标」与装饰线分开定义 |
| 焦点指示面积与色差 | 2.4.13（AAA）：≥2px 周长、状态间 ≥3:1、与相邻色 ≥3:1 | 3px 环 @32% accent | ⚠️ 面积满足，色差未验证 → §3.2 |
| 焦点不被遮挡 | 2.4.11（AA）：聚焦组件不得被作者内容完全遮住 | sticky `.toolbar` 与 topbar z-index 高于内容，滚动时可能盖住聚焦元素 | ⚠️ P2：给 `:focus-visible` 元素补 `scroll-margin-top: calc(var(--topbar-h) + 12px)` |
| 命中区 | 2.5.8（AA）：≥24×24 CSS px，否则需 spacing 例外 | `.icon-btn` 32 ✅；`.nav-item` 高约 33 ✅；`.pill` 21px（非交互）➖；`.dot` 19px（附属，整行才是 target）➖；`.answer-cell` ≥38 ✅；`.seg button` 高约 27 ✅ | ✅（附条件） |
| 键盘可达全部功能 | 2.1.1/2.1.2 | 命令面板可开/可导航/可执行 ✅；但**关闭后不回焦**、模态内无焦点陷阱（Esc 之外 Tab 会跑到背后的页面） | ❌ P1：`cmdk` 打开时锁 Tab 循环（`focus-trap` 手写 20 行即可） |
| 状态播报 | 4.1.3（AA） | message/notification 由 naive 自带 role；命令面板结果数无播报 | ⚠️ P1，见 §7.1 |
| 动画可关闭 | 2.3.3（AAA）+ C39 | 全局 reduced-motion 兜底 | ✅ |
| 重复内容跳过 | 2.4.1 | 无 skip link（桌面 SPA 低价值） | ➖ |
| 图标含义 | 1.1.1 | `Icon` 为 `aria-hidden` + 外层 `aria-label`（部分按钮有 label ✅）；纯图标导航在 rail 态靠 title（键盘不可见） | ⚠️ 见 §7.2 |

---

## 11. 差距清单与优先级（照此开工）

| 级别 | 改动 | 位置 | 验收标准 |
| --- | --- | --- | --- |
| **P0** | discrete API 跟随主题 + 去掉 GitHub 蓝 | `lib/ui.ts:15-18` | 深色模式下截图 message/dialog/notification，底色为 `--surface`/`--popover`；全局只剩一套品牌主色 |
| **P0** | 反馈时长契约 | `lib/ui.ts` 新增常量 + 各调用点 | 错误提示不会 3s 自己消失；grep 全仓无非契约时长字面量 |
| **P1** | 深色启动底色 | `main/index.ts:60` + 主题切换回调 | 冷启动到首帧无浅灰闪现（录屏逐帧检查） |
| **P1** | `--text-faint` 对比度提升到 ≥4.5:1 | `styles.css:21,87` | 取色器复核明暗两端均 ≥4.5:1 |
| **P1** | 命令面板可达性 + 回焦 + 焦点陷阱 | `CommandPalette.vue` | 读屏能报数量与选中项；关闭后焦点回到 ⌘K 按钮；Tab 跑不出面板 |
| **P1** | 退出动画与方向性缓动 | `styles.css:58-63` 新增 `--ease-enter/--ease-exit/--dur-exit` | 面板 Esc 关闭 120ms 淡出；列表容器不再有回弹 |
| **P1** | 命令面板 recents/frecency + 命中高亮 | `CommandPalette.vue` + localStorage | 空查询首屏显示最近 4–6 条；输入缩写能命中且命中字符加粗 |
| **P1** | 空状态补主行动 + 错误态告警图形 | `styles.css:323-326` + 各视图 | 每个 `.empty` 至少一个可点动作；失败态不再用中性图标 |
| **P1** | GPU 关闭时的玻璃降级 | `main` 广播 + `html.no-gpu` 类 | 软件渲染下拖动窗口无明显掉帧；blur 层 ≤2 个同时在场 |
| **P2** | 窗口下限 940px、Ctrl± 缩放策略 | `main/index.ts:57` | 1000px 断点可达；Ctrl+0 复位 |
| **P2** | 危险动作分档表落地（popconfirm vs dialog） | 各视图 + UI-DESIGN-SYSTEM.md §4 | 所有确认框按钮文案为动词且标明后果 |
| **P2** | 列表虚拟化阈值约定（>200 行） | 题库/错题列表 | 5k 题列表滚动不掉帧 |
| **P2** | 图表色盲双编码（形状/标注冗余） | `chartBase()` | 灰度截图仍能区分系列 |
| **P3** | View Transitions 主题切换 | `lib/theme.ts` | reduced-motion 下不触发动画 |
| **P3** | 沉浸式标题栏（hidden + overlay/no-drag 白名单） | `main/index.ts` | Windows 深色端 caption 按钮配色同步 |
| **P3** | 命令面板二级动作（⌘Enter 动作面板） | `CommandPalette.vue` | — |

---

## 12. 「先进水平」候选项（做完这些才叫领先）

按投入产出排序，前四项在两周内可完成：

1. **行为契约测试化**：把 §6.2 的时长、§8 的时长档位、§10 的对比度做成脚本断言（本项目已有 `scripts/qa/regress.mjs` 的先例）。多数团队只做到「文档里有规范」，做到「回归会红」就是少数派。
2. **View Transitions 做主题与路由过渡**：Electron 45 内核 ≥130 全量可用（[caniuse](https://caniuse.com/view-transitions)）。注意本项目 `App.vue:146-147` 已记录「dev HMR 下 `<transition mode=out-in>` 会悬挂」的老坑，View Transitions 走的是文档级快照，不受该坑影响，但要在生产构建下复验。
3. **frecency 排序 + 命令面板成为动作层**（不只是跳转）：Linear/Raycast/Superhuman 的分水岭。Setproduct 的原话值得贴在墙上：*一个只会列页面的面板，就是一个粘了快捷键的搜索框*。
4. **玻璃层收敛 + GPU 策略**：桌面 Electron 应用里「好看」和「流畅」的冲突点就在这。把它显式化（设置项 + 自动降级）比再加任何装饰都有价值。
5. **密度切换（紧凑/舒适）**：训练类应用单次会话时长长，WCAG 的 spacing 例外也更好满足；naive-ui 的 `size` 体系 + 我们已有的 `--sp-*` 让这件事成本很低。
6. **APCA / okLCH 前景**（观察项）：我们已经在用 `color-mix(in oklab)`，下一步可评估 [APCA 的 Lc 阈值](https://github.com/Myndex/apca-w3)——深色端的对比要求与 WCAG 2.x 不同，现阶段仍以 WCAG 为准，不要混用两套判据。

---

## 附录 A · 全部来源

- W3C：[Target Size (Minimum) SC 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) · [Focus Appearance SC 2.4.13](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html) · [Technique C39](https://www.w3.org/WAI/WCAG22/Techniques/css/C39) · [Can I use: View Transitions](https://caniuse.com/view-transitions)
- 厂商官方：[IBM Carbon Motion](https://v10.carbondesignsystem.com/guidelines/motion/overview/) · [Stripe Apps Style](https://docs.stripe.com/stripe-apps/style) · [GitHub Primer Empty states](https://primer.style/product/ui-patterns/empty-states/)
- 一线产品规范/拆解：[Setproduct Command Palette](https://www.setproduct.com/blog/command-palette-ui-design-guide) · [02ui Sidebar](https://02ui.com/components/sidebar/) · [codefronts 可访问侧栏](https://codefronts.com/layouts/css-sidebar-layouts/accessible-admin-panel-sidebar-with-css-tooltips-and-icon-collapse/) · [Power BI KPI 卡](https://tabulareditor.com/blog/kpi-card-best-practices-dashboard-design) · [Appian SAIL KPI](https://docs.appian.com/suite/help/26.9/sail/ux-kpi.html)
- 品牌逆向分析：[Linear（open-design）](https://open-design.ai/plugins/design-system-linear-app/) · [Linear tokens（designmd）](https://designmd.cc/benchmarks/linear) · [Linear（opendesigner）](https://opendesigner.io/design-systems/linear-app) · [Raycast（Refero Styles）](https://styles.refero.design/style/3b6a17f0-3bdf-418c-a95e-0b89e5a8b2f8) · [Notion（open-design）](https://open-design.ai/plugins/design-system-notion/)
- 研究/实践：[Nielsen 响应时间三红线](https://www.nngroup.com/articles/response-times-3-important-limits/) · [NNG Skeleton Screens](https://www.nngroup.com/articles/skeleton-screens/) · [NNG Empty States](https://www.nngroup.com/articles/empty-state-interface-design/) · [Toast 无障碍时长](https://sheribyrnehaber.medium.com/designing-toast-messages-for-accessibility-fb610ac364be) · [Deque cauldron #2099](https://github.com/dequelabs/cauldron/issues/2099) · [Sara Soueidan 焦点指示](https://www.sarasoueidan.com/blog/focus-indicators/) · [破坏性动作 UX 指南](https://medium.com/design-bootcamp/a-ux-guide-to-destructive-actions-their-use-cases-and-best-practices-f1d8a9478d03) · [VS Code #20417](https://github.com/microsoft/vscode/issues/20417) · [electron#45958](https://github.com/electron/electron/issues/45958)
- 框架源码（本机 grep）：`naive-ui@2.45.3/es/discrete/src/discrete.mjs`、`es/message/src/MessageProvider.mjs`、`es/message/src/MessageEnvironment.mjs`、`es/_styles/transitions/fade-in-scale-up.cssr.mjs`、`es/_mixins/use-theme.d.ts`

## 附录 B · 存疑与未核实条目（诚实记录）

| 条目 | 状态 | 说明 |
| --- | --- | --- |
| Electron 45 对应的 Chromium 具体版本号 | **未核实** | 官方 [Release Timelines](https://electronjs.org/docs/latest/tutorial/electron-timelines) 只给出「Electron 瞄准偶数版 Chromium、每 8 周一次」的节奏（示例：Electron 26 → Chromium 116），据此推算 Electron 45 约在 13x–14x。本文一律写「Chromium ≥ 130」，不影响任何结论（View Transitions 门槛是 111，`color-mix` 门槛是 111）。要精确值就跑一次 `npx electron -p "process.versions.chrome"` |
| Electron 官方 frameless-window / custom-title-bar 文档原文 | **未取得**（抓取多次返回 422） | `titleBarStyle: 'hidden'`、`titleBarOverlay.{color,symbolColor,height}`、`-webkit-app-region: drag/no-drag` 的取值来自搜索结果摘要与社区共识（含 [Custom Title Bar](https://electronjs.org/docs/latest/tutorial/custom-title-bar) 摘要：macOS 下 `titleBarStyle:'hidden'` 保留红绿灯）。动手前请自行核对当前版本文档 |
| Material Design 3 现行 GM3 Expressive 动效 token 的具体毫秒值 | **未取得** | [M3 官方页](https://m3.material.io/styles/motion/easing-and-duration/tokens-specs) 是客户端渲染，抓取只拿到一句「旧的运动系统仍在用但已不再维护」。因此本文的时长/曲线论证改用 IBM Carbon（同一用途、可完整抓取的厂商官方规范），结论等价 |
| Vercel Geist 的 motion token 具体值（如 150/200ms） | **二手** | 早期检索到的分析页摘录，未能再次直接核对官方仓库文件。本文未把它当判据，只在 §3.1 作为「消色风格」参考 |
| naive-ui 是否存在 `inlineThemeDisabled` prop | **未证实** | 在 `es/config-provider/src/Interface.d.ts` grep 未命中，故本文未据此提建议；`builtinThemeOverrides` 已在 `use-theme.d.ts` 实测存在，以此为准 |
| `createDiscreteApi` 传 computed 是否可靠跟随 | **推断（高置信）** | 源码把 `configProviderProps` 原样交给 `NConfigProvider` 渲染，Vue 会对 ref 解包；仍需按 §6.1 的断言测试实测一次 |

