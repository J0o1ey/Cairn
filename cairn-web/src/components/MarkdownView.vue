<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import mermaid from 'mermaid';
import 'highlight.js/styles/github.css';

// markdown-it 的 Token / Renderer / Options 类型，从子路径导入避免和默认导出名冲突
type MdToken = import('markdown-it/lib/token.mjs').default;
type MdRenderer = import('markdown-it/lib/renderer.mjs').default;
type MdOptions = import('markdown-it').Options;
type MdRenderRule = (
  tokens: MdToken[],
  idx: number,
  options: MdOptions,
  env: unknown,
  self: MdRenderer,
) => string;

const props = withDefaults(
  defineProps<{
    /** 待渲染的 markdown 文本（来自 LLM 输出 / 后端报告等不可信源） */
    source: string;
    /** 内容容器的 padding；默认与导出预览模态框统一 */
    padding?: string;
  }>(),
  { padding: '20px 24px' },
);

const root = ref<HTMLDivElement | null>(null);
const html = ref('');
const renderToken = ref(0);

mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  // strict 模式禁止 mermaid 内部执行 user-supplied script，防止 LLM 输出夹带 XSS
  securityLevel: 'strict',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
});

const md: MarkdownIt = new MarkdownIt({
  // 关闭 raw HTML 解析；LLM 报告内容是不可信源，必须只走 markdown 语法
  html: false,
  linkify: true,
  breaks: false,
  typographer: false,
  highlight(str: string, lang: string): string {
    if ((lang || '').toLowerCase() === 'mermaid') {
      // mermaid block 占位：内容保留 markdown 原文，挂载后由 mermaid.run() 替换为 SVG
      return `<pre class="mermaid-source">${md.utils.escapeHtml(str)}</pre>`;
    }
    if (lang && hljs.getLanguage(lang)) {
      try {
        return (
          `<pre class="hljs"><code class="hljs language-${lang}">` +
          hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
          '</code></pre>'
        );
      } catch {
        /* fallthrough */
      }
    }
    return `<pre class="hljs"><code class="hljs">${md.utils.escapeHtml(str)}</code></pre>`;
  },
});

// 让 markdown-it 给链接加上 target=_blank + rel=noopener
const defaultLinkOpen: MdRenderRule =
  (md.renderer.rules.link_open as MdRenderRule | undefined) ||
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = ((tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const href = token.attrGet('href');
  if (href) {
    token.attrSet('target', '_blank');
    token.attrSet('rel', 'noopener noreferrer');
  }
  return defaultLinkOpen(tokens, idx, options, env, self);
}) as MdRenderRule;

function render(source: string) {
  const raw = md.render(source ?? '');
  // markdown-it 已经禁用 raw HTML，这里再叠加 DOMPurify 以拦截 highlight 输出层面
  // 任何意外注入。mermaid 占位用的 <pre class="mermaid-source"> 会被原样保留。
  html.value = DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
  });
}

async function runMermaid() {
  if (!root.value) return;
  const blocks = root.value.querySelectorAll<HTMLElement>('pre.mermaid-source');
  if (blocks.length === 0) return;
  const token = ++renderToken.value;
  for (const block of Array.from(blocks)) {
    if (token !== renderToken.value) return; // source 又变了，放弃旧渲染
    const code = block.textContent || '';
    const id = `mermaid-${token}-${Math.random().toString(36).slice(2)}`;
    try {
      const { svg, bindFunctions } = await mermaid.render(id, code);
      const wrapper = document.createElement('div');
      wrapper.className = 'mermaid-rendered';
      wrapper.innerHTML = svg;
      bindFunctions?.(wrapper);
      block.replaceWith(wrapper);
    } catch (err) {
      const errBox = document.createElement('pre');
      errBox.className = 'mermaid-error';
      errBox.textContent =
        '【mermaid 渲染失败】\n' + (err instanceof Error ? err.message : String(err)) + '\n\n' + code;
      block.replaceWith(errBox);
    }
  }
}

watch(
  () => props.source,
  async (s) => {
    render(s);
    await nextTick();
    await runMermaid();
  },
  { immediate: true },
);

onMounted(async () => {
  await nextTick();
  await runMermaid();
});

onBeforeUnmount(() => {
  // 让进行中的 mermaid 渲染检测到 token 变化后早退
  renderToken.value++;
});
</script>

<template>
  <div ref="root" class="markdown-view" :style="{ padding }" v-html="html"></div>
</template>

<style>
.markdown-view {
  color: #0f172a;
  font-family:
    -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei',
    'Inter', sans-serif;
  font-size: 14px;
  line-height: 1.75;
  word-wrap: break-word;
  background: #ffffff;
}

.markdown-view > *:first-child {
  margin-top: 0;
}
.markdown-view > *:last-child {
  margin-bottom: 0;
}

.markdown-view h1,
.markdown-view h2,
.markdown-view h3,
.markdown-view h4,
.markdown-view h5,
.markdown-view h6 {
  font-weight: 600;
  line-height: 1.3;
  margin: 1.5em 0 0.6em;
  color: #0f172a;
}
.markdown-view h1 {
  font-size: 22px;
  border-bottom: 1px solid #e2e8f0;
  padding-bottom: 0.3em;
}
.markdown-view h2 {
  font-size: 18px;
  border-bottom: 1px solid #f1f5f9;
  padding-bottom: 0.25em;
}
.markdown-view h3 {
  font-size: 16px;
}
.markdown-view h4,
.markdown-view h5,
.markdown-view h6 {
  font-size: 14px;
}

.markdown-view p {
  margin: 0.6em 0;
}

.markdown-view a {
  color: #4f46e5;
  text-decoration: none;
}
.markdown-view a:hover {
  text-decoration: underline;
}

.markdown-view ul,
.markdown-view ol {
  margin: 0.5em 0;
  padding-left: 1.6em;
}
.markdown-view li {
  margin: 0.25em 0;
}
.markdown-view li > p {
  margin: 0.2em 0;
}

.markdown-view blockquote {
  margin: 0.8em 0;
  padding: 0.4em 1em;
  border-left: 3px solid #c7d2fe;
  background: #eef2ff;
  color: #475569;
  border-radius: 4px;
}
.markdown-view blockquote > *:first-child {
  margin-top: 0;
}
.markdown-view blockquote > *:last-child {
  margin-bottom: 0;
}

.markdown-view code {
  font-family:
    'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 0.88em;
  padding: 1px 5px;
  background: #f1f5f9;
  border-radius: 4px;
  color: #b91c1c;
}

.markdown-view pre {
  margin: 0.8em 0;
  background: #0f172a;
  color: #e2e8f0;
  padding: 12px 14px;
  border-radius: 8px;
  overflow-x: auto;
  font-size: 12.5px;
  line-height: 1.55;
}
.markdown-view pre code {
  background: transparent;
  color: inherit;
  padding: 0;
  font-size: inherit;
  border-radius: 0;
}

/* highlight.js github theme 适配深色 pre 背景 */
.markdown-view pre.hljs {
  background: #0f172a;
}
.markdown-view pre.hljs code.hljs {
  background: transparent;
  color: #e2e8f0;
  padding: 0;
}
.markdown-view .hljs-comment,
.markdown-view .hljs-quote {
  color: #94a3b8;
}
.markdown-view .hljs-keyword,
.markdown-view .hljs-selector-tag,
.markdown-view .hljs-section,
.markdown-view .hljs-link {
  color: #c4b5fd;
}
.markdown-view .hljs-string,
.markdown-view .hljs-attr {
  color: #86efac;
}
.markdown-view .hljs-number,
.markdown-view .hljs-literal {
  color: #fda4af;
}
.markdown-view .hljs-title,
.markdown-view .hljs-name {
  color: #93c5fd;
}
.markdown-view .hljs-built_in,
.markdown-view .hljs-type {
  color: #fcd34d;
}
.markdown-view .hljs-meta {
  color: #fb923c;
}

.markdown-view table {
  margin: 0.8em 0;
  border-collapse: collapse;
  width: 100%;
  font-size: 13px;
}
.markdown-view th,
.markdown-view td {
  border: 1px solid #e2e8f0;
  padding: 6px 10px;
  text-align: left;
}
.markdown-view th {
  background: #f8fafc;
  font-weight: 600;
}
.markdown-view tr:nth-child(2n) td {
  background: #fafbfc;
}

.markdown-view hr {
  border: none;
  border-top: 1px solid #e2e8f0;
  margin: 1.5em 0;
}

.markdown-view img {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
}

.markdown-view .mermaid-rendered {
  display: flex;
  justify-content: center;
  margin: 1em 0;
  padding: 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  overflow-x: auto;
}
.markdown-view .mermaid-rendered svg {
  max-width: 100%;
  height: auto;
}

.markdown-view .mermaid-error {
  background: #fef2f2;
  color: #b91c1c;
  border: 1px solid #fecaca;
}
</style>
