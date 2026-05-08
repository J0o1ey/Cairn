<script setup lang="ts">
import { reactive, watch } from 'vue';
import ModalShell from './ModalShell.vue';
import { useUiStore } from '@/stores/ui';
import { usePrefsStore } from '@/stores/prefs';
import { useProjectsStore } from '@/stores/projects';

const ui = useUiStore();
const prefs = usePrefsStore();
const projects = useProjectsStore();

const form = reactive({
  title: '',
  origin: '',
  goal: '',
  hints: [{ content: '' }] as { content: string }[],
});

watch(
  () => ui.showNewProject,
  show => {
    if (show) {
      form.title = '';
      form.origin = '';
      form.goal = '';
      form.hints = [{ content: '' }];
    }
  },
);

function close() {
  ui.showNewProject = false;
}

async function submit() {
  if (!form.title || !form.origin || !form.goal) return;
  try {
    const actor = prefs.actorName;
    const cleanedHints = form.hints
      .map(h => h.content.trim())
      .filter(c => c.length > 0)
      .map(content => ({ content, creator: actor }));
    await projects.createProject({
      title: form.title.trim(),
      origin: form.origin.trim(),
      goal: form.goal.trim(),
      hints: cleanedHints.length ? cleanedHints : undefined,
    });
    ui.showNewProject = false;
    ui.showToast('项目已创建');
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : '创建失败', 'error');
  }
}
</script>

<template>
  <ModalShell :show="ui.showNewProject" @close="close">
    <div class="p-6">
      <h3 class="text-base font-semibold text-slate-700 mb-4">新建项目</h3>
      <div class="space-y-3">
        <input
          v-model="form.title"
          placeholder="项目标题"
          class="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-400 transition placeholder:text-slate-300"
        />
        <textarea
          v-model="form.origin"
          placeholder="起点 — 项目从何处出发"
          rows="2"
          class="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-400 transition placeholder:text-slate-300"
        ></textarea>
        <textarea
          v-model="form.goal"
          placeholder="目标 — 期望达成什么"
          rows="2"
          class="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-400 transition placeholder:text-slate-300"
        ></textarea>

        <div>
          <div class="flex items-center justify-between mb-2">
            <span class="text-[11px] text-slate-400 font-medium uppercase tracking-wider">提示（可选）</span>
            <button
              type="button"
              @click="form.hints.push({ content: '' })"
              class="text-[11px] text-brand-500 hover:text-brand-600 font-medium"
            >
              + 添加
            </button>
          </div>
          <div v-for="(hint, idx) in form.hints" :key="idx" class="flex gap-2 mb-2">
            <input
              v-model="hint.content"
              placeholder="提示内容"
              class="flex-1 px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-400 transition placeholder:text-slate-300"
            />
            <button
              type="button"
              @click="form.hints.splice(idx, 1)"
              v-show="form.hints.length > 1"
              class="px-2 text-slate-300 hover:text-red-400 transition text-sm"
            >
              ×
            </button>
          </div>
          <p class="text-[11px] text-slate-400">
            提示创建者使用当前本地账号：<span class="font-medium text-slate-600">{{ prefs.actorName }}</span>
          </p>
        </div>
      </div>
      <div class="flex justify-end gap-2 mt-5">
        <button @click="close" class="px-4 py-2 text-sm text-slate-500 hover:bg-slate-50 rounded-xl transition">取消</button>
        <button
          @click="submit"
          :disabled="!form.title || !form.origin || !form.goal"
          class="px-5 py-2 text-sm bg-brand-500 text-white rounded-xl font-medium hover:bg-brand-600 transition disabled:opacity-30 shadow-sm shadow-brand-200"
        >
          创建
        </button>
      </div>
    </div>
  </ModalShell>
</template>
