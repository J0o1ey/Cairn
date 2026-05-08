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

const content = ref('');

watch(
  () => props.show,
  s => {
    if (s) content.value = '';
  },
);

function close() {
  emit('update:show', false);
}

async function submit() {
  if (!content.value.trim() || !projects.project) return;
  try {
    await projects.addHint(projects.project.project.id, {
      content: content.value.trim(),
      creator: prefs.actorName,
    });
    ui.showToast('提示已添加');
    close();
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : '添加提示失败', 'error');
  }
}
</script>

<template>
  <ModalShell :show="show" @close="close">
    <div class="p-6">
      <h3 class="text-base font-semibold text-slate-700 mb-4">添加提示</h3>
      <div class="space-y-3">
        <textarea
          v-model="content"
          placeholder="策略建议或备注…"
          rows="3"
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
          :disabled="!content.trim()"
          class="px-5 py-2 text-sm bg-amber-500 text-white rounded-xl font-medium hover:bg-amber-600 transition disabled:opacity-30 shadow-sm shadow-amber-200"
        >
          添加
        </button>
      </div>
    </div>
  </ModalShell>
</template>
