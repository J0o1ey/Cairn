# NeoNexus Web

基于 **Vue 3 + TypeScript + Vite + Tailwind CSS + Pinia + Cytoscape.js** 的 NeoNexus 前端工程，
是对原 `cairn/src/cairn/server/static/index.html`（Alpine.js 单文件 SPA）的工程化重写与品牌升级。

> NeoNexus = Neo（新）+ Nexus（联结、枢纽）。寓意「在事实之间不断生长出新的连接」，
> 是同一套事实图协同探索协议的全新前端形象。

## 目录结构

```
cairn-web/
├── index.html                 Vite 入口
├── package.json               依赖与脚本
├── vite.config.ts             Vite 配置（含到后端 8000 的代理）
├── tailwind.config.ts         Tailwind 主题（保留原 brand 色板）
├── tsconfig*.json             TypeScript 配置
├── public/favicon.svg         站点图标
└── src/
    ├── main.ts                启动入口（Pinia + Router）
    ├── App.vue                根组件
    ├── style.css              Tailwind 入口与全局动画
    ├── router/index.ts        / 与 /projects/:id 两条路由
    ├── types/api.ts           对齐后端 Pydantic 的请求/响应类型
    ├── api/client.ts          fetch 封装（json + text）
    ├── stores/
    │   ├── prefs.ts           本地偏好（actor、布局、面板宽）
    │   ├── ui.ts              Toast、模态框、导出预览
    │   └── projects.ts        项目列表/当前项目/选中状态/回放
    ├── composables/
    │   ├── useFormatters.ts   时间格式化、状态文案
    │   └── useTimeline.ts     基于 project 推导出时间线事件
    ├── stores/replay.ts        回放状态机（构帧、变速、重启、退出）
    ├── utils/
    │   ├── highlight.ts       YAML / Timeline / Markdown 着色
    │   ├── intent.ts          意图相关工具函数
    │   └── measure.ts         基于 canvas 的节点文本实测
    ├── views/
    │   ├── ProjectListView.vue
    │   └── GraphView.vue
    └── components/
        ├── Toast.vue
        ├── GraphCanvas.vue       (含 ResizeObserver 自动适配视口)
        ├── SidePanel.vue
        ├── ReplayControls.vue    回放控件：进度、播放/暂停、重启、变速、退出
        └── modals/*.vue
```

## 开发

```bash
cd cairn-web
npm install
npm run dev
```

默认监听 `http://localhost:5173`，所有以 `/projects`、`/settings`、`/hints`、`/intents`
开头的请求会代理到 `http://localhost:8000` 上的 Cairn FastAPI 后端。

确保后端已经在 `8000` 端口启动：

```bash
uv run --project cairn cairn serve
```

## 构建

```bash
npm run build
```

构建产物输出到 `cairn-web/dist/`。可由 FastAPI 通过 `StaticFiles` 直接挂载（替换原
`cairn/src/cairn/server/static/`），或部署到任意静态资源服务（Nginx、对象存储等），并由网关
将 `/projects`、`/settings`、`/hints`、`/intents` 反代到后端。

## 已实现的功能

完整覆盖原 Alpine.js 单文件 SPA 的核心交互：

- 项目列表：分组统计、状态徽章、进行中/未认领数量、推理状态徽章、批量暂停。
- 项目卡片：快照（YAML/Timeline/中文报告）、暂停/继续、重新打开、删除、重命名。
- 图谱视图：基于 Cytoscape.js 的事实/意图节点与边，支持 dagre / klay / elk 三套布局，
  正在进行中的意图节点 / bootstrap 节点保持区分样式。
- 侧边面板：详情（事实/意图）、提示列表、活动日志（时间线，可点击同步选中节点）。
- 模态框：新建项目、新建意图（声明/声明并认领）、结案、完成项目、添加提示、重命名、
  重新打开、删除项目、本地偏好（actor、布局）、服务端设置、导出预览。
- 后端中文报告（`format=report_zh`）已在导出预览第三个 Tab 中支持。
- 5 秒一次的轮询与所有响应字段保持类型同步。
- **时间线回放**：从原始项目快照构建逐帧序列（含 `reason_started → intent_declared →
  intent_running → intent_concluded` 的展开），支持播放/暂停、重新开始、快/正常/慢三档变速、
  退出后自动恢复实时数据；回放期间会暂停轮询并隐藏所有写操作按钮。
- **节点尺寸 canvas 实测**：通过 [`utils/measure.ts`](src/utils/measure.ts) 创建的离屏 canvas
  实测每个字符的宽度，按字体大小、CJK 宽度差异折行，结果与原 Alpine 版完全一致。
- **侧边面板拖拽改宽度**：拖拽手柄使用 `pointercapture + pointermove`，最小 260px、最大
  `containerWidth - 260`，松开后立即写入 `localStorage` 持久化；
  拖拽过程中触发的 `ResizeObserver` 会自动让 Cytoscape 重新适配视口。

## 已知与原版的差异

- Cytoscape 仅保留主要状态样式；原版的 `pulseActive`、`fadeInFreshElement` 等装饰性动画
  暂未一并移植（不影响数据正确性）。

## 与后端协作

- 接口契约对齐 `cairn/src/cairn/server/models.py` 中的 Pydantic 模型，详见
  [`src/types/api.ts`](src/types/api.ts)。
- 中文报告依赖后端 `cairn/src/cairn/server/routers/export.py` 中的 `_export_report_zh()`。
