<script setup lang="ts">
import { ref, watch } from 'vue';
import ModalShell from './ModalShell.vue';
import { useUiStore } from '@/stores/ui';
import { usePrefsStore } from '@/stores/prefs';
import { useProjectsStore } from '@/stores/projects';

const props = defineProps<{ show: boolean; intentId: string }>();
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
  if (!description.value.trim() || !projects.project || !props.intentId) return;
  try {
    await projects.concludeIntent(
      projects.project.project.id,
      props.intentId,
      prefs.actorName,
      description.value.trim(),
    );
    ui.showToast('意图已结案');
    close();
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : '结案失败', 'error');
  }
}
</script>

<template>
  <ModalShell :show="show" @close="close">
    <div class="p-6">
      <h3 class="text-base font-semibold text-slate-700 mb-1">结案意图</h3>
      <p class="text-xs text-slate-400 mb-4 font-mono">{{ intentId }}</p>
      <div class="space-y-3">
        <textarea
          v-model="description"
          placeholder="你发现了什么？（将作为新事实）"
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
          :disabled="!description.trim()"
          class="px-5 py-2 text-sm bg-teal-500 text-white rounded-xl font-medium hover:bg-teal-600 transition disabled:opacity-30 shadow-sm shadow-teal-200"
        >
          结案
        </button>
      </div>
    </div>
  </ModalShell>
</template>
