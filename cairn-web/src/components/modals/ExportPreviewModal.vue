<script setup lang="ts">
import { watch } from 'vue';
import ModalShell from './ModalShell.vue';
import MarkdownView from '@/components/MarkdownView.vue';
import { useUiStore, type ExportTab } from '@/stores/ui';
import { api, fetchText, ApiError } from '@/api/client';
import { highlightTimeline, highlightYaml } from '@/utils/highlight';

interface ProjectReport {
  id: number;
  project_id: string;
  content: string;
  generator: string;
  created_at: string;
}

const ui = useUiStore();

watch(
  () => [ui.exportPreview.show, ui.exportPreview.projectId, ui.exportPreview.tab],
  async ([show]) => {
    if (!show || !ui.exportPreview.projectId) return;
    await load(ui.exportPreview.tab);
  },
  { immediate: false },
);

async function loadReport(projectId: string): Promise<string> {
  // 优先取 dispatcher 在项目完成时生成的 LLM 报告；没有则回落到 server 自动生成的结构化报告。
  try {
    const report = await api<ProjectReport>('GET', `/projects/${projectId}/report`);
    if (report && report.content) {
      const header =
        `> 由 dispatcher worker 自动生成 · ${report.generator} · ${report.created_at}\n\n`;
      return `${header}${report.content}`;
    }
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 404) {
      // 真出错（非 404）才提示，404 走下面 fallback。
      throw e;
    }
  }
  return await fetchText(`/projects/${projectId}/export?format=report_zh`);
}

async function load(tab: ExportTab) {
  const projectId = ui.exportPreview.projectId;
  if (!projectId) return;
  ui.exportPreview.loading = true;
  try {
    if (tab === 'report') {
      const markdown = await loadReport(projectId);
      // report Tab：text 用于"复制"按钮；html 留空；markdown 交给 MarkdownView 渲染
      ui.setExportPreviewContent(markdown, '', markdown);
      return;
    }
    const queryFormat = tab === 'timeline' ? 'timeline' : 'yaml';
    const text = await fetchText(`/projects/${projectId}/export?format=${queryFormat}`);
    const html = tab === 'yaml' ? highlightYaml(text) : highlightTimeline(text);
    ui.setExportPreviewContent(text, html);
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : '加载导出内容失败', 'error');
    ui.exportPreview.loading = false;
  }
}

function switchTab(tab: ExportTab) {
  if (ui.exportPreview.tab === tab) return;
  ui.setExportPreviewTab(tab);
}

async function copy() {
  const text = ui.exportPreview.text;
  if (!text) return;
  if (!navigator.clipboard?.writeText) {
    ui.showToast('当前环境不支持复制', 'error');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    ui.showToast('已复制');
  } catch {
    ui.showToast('复制失败', 'error');
  }
}

function close() {
  ui.closeExportPreview();
}
</script>

<template>
  <ModalShell :show="ui.exportPreview.show" max-width="max-w-4xl" @close="close">
    <div class="px-5 py-4 border-b border-slate-200/80 flex items-center justify-between gap-4">
      <div class="min-w-0 flex items-center gap-3">
        <div class="flex rounded-lg border border-slate-200 overflow-hidden shrink-0">
          <button
            @click="switchTab('yaml')"
            class="px-2.5 py-1 text-xs font-medium transition"
            :class="ui.exportPreview.tab === 'yaml' ? 'bg-slate-100 text-slate-700' : 'text-slate-400 hover:text-slate-600'"
          >
            YAML
          </button>
          <button
            @click="switchTab('timeline')"
            class="px-2.5 py-1 text-xs font-medium transition"
            :class="ui.exportPreview.tab === 'timeline' ? 'bg-slate-100 text-slate-700' : 'text-slate-400 hover:text-slate-600'"
          >
            时间线
          </button>
          <button
            @click="switchTab('report')"
            class="px-2.5 py-1 text-xs font-medium transition"
            :class="ui.exportPreview.tab === 'report' ? 'bg-slate-100 text-slate-700' : 'text-slate-400 hover:text-slate-600'"
          >
            中文报告
          </button>
        </div>
        <p class="text-xs text-slate-400 truncate">{{ ui.exportPreview.title }}</p>
      </div>
      <div class="flex items-center gap-2">
        <button @click="copy" class="px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50 rounded-xl transition">复制</button>
        <button @click="close" class="px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50 rounded-xl transition">关闭</button>
      </div>
    </div>
    <div class="max-h-[75vh] overflow-auto bg-slate-50 p-4">
      <div class="rounded-xl border border-slate-200 bg-white overflow-auto shadow-sm relative min-h-[120px]">
        <div v-if="ui.exportPreview.loading" class="p-6 text-sm text-slate-400 text-center">加载中…</div>
        <template v-else>
          <MarkdownView
            v-if="ui.exportPreview.tab === 'report'"
            :source="ui.exportPreview.markdown"
          />
          <div
            v-else
            class="min-w-max p-0 text-[12px] leading-6 font-mono select-text"
            v-html="ui.exportPreview.html"
          ></div>
        </template>
      </div>
    </div>
  </ModalShell>
</template>
