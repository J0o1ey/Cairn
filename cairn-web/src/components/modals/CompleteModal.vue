<script setup lang="ts">
import { ref, watch } from 'vue';
import ModalShell from './ModalShell.vue';
import { useUiStore } from '@/stores/ui';
import { usePrefsStore } from '@/stores/prefs';
import { useProjectsStore } from '@/stores/projects';

const props = defineProps<{ show: boolean }>();
const emit = defineEmits<{ (e: 'update:show', value: boolean): void }>();

const ui = useUiStore();
const prefs = usePrefsStore();
const projects = useProjectsStore();

const description = ref('');

watch(
  () => props.show,
  s => {
    if (s) description.value = '';
  },
);

function close() {
  emit('update:show', false);
}

async function submit() {
  if (!description.value.trim() || !projects.project || projects.selectedFacts.length === 0) return;
  try {
    await projects.completeProject(projects.project.project.id, {
      from: [...projects.selectedFacts],
      description: description.value.trim(),
      worker: prefs.actorName,
    });
    ui.showToast('项目已完成');
    close();
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : '完成项目失败', 'error');
  }
}
</script>

<template>
  <ModalShell :show="show" @close="close">
    <div class="p-6">
      <h3 class="text-base font-semibold text-slate-700 mb-1">完成项目</h3>
      <p class="text-xs text-slate-400 mb-4">将项目标记为已完成</p>
      <div class="space-y-3">
        <div>
          <label class="text-[11px] text-slate-400 mb-1 block font-medium">起始事实</label>
          <div class="w-full px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 min-h-[42px] flex flex-wrap gap-1.5 items-center">
            <span
              v-for="fid in projects.selectedFacts"
              :key="fid"
              class="px-2 py-1 rounded-lg bg-white border border-slate-200 text-[11px] font-mono text-slate-600"
            >
              {{ fid }}
            </span>
          </div>
        </div>
        <textarea
          v-model="description"
          placeholder="为什么目标已达成？"
          rows="2"
          class="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-400 transition placeholder:text-slate-300"
        ></textarea>
        <div class="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-500">
          操作者：<span class="font-medium text-slate-700">{{ prefs.actorName }}</span>
        </div>
      </div>
      <div class="flex justify-end gap-2 mt-5">
        <button @click="close" class="px-4 py-2 text-sm text-slate-500 hover:bg-slate-50 rounded-xl transition">取消</button>
        <button
          @click="submit"
          :disabled="projects.selectedFacts.length === 0 || !description.trim()"
          class="px-5 py-2 text-sm bg-teal-500 text-white rounded-xl font-medium hover:bg-teal-600 transition disabled:opacity-30 shadow-sm shadow-teal-200"
        >
          完成
        </button>
      </div>
    </div>
  </ModalShell>
</template>
