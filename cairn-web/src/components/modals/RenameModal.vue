<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import ModalShell from './ModalShell.vue';
import { useUiStore } from '@/stores/ui';
import { useProjectsStore } from '@/stores/projects';

const props = defineProps<{ show: boolean; projectId: string; originalTitle: string }>();
const emit = defineEmits<{ (e: 'update:show', value: boolean): void }>();

const ui = useUiStore();
const projects = useProjectsStore();

const title = ref('');
const inputRef = ref<HTMLInputElement | null>(null);

watch(
  () => props.show,
  async s => {
    if (s) {
      title.value = props.originalTitle;
      await nextTick();
      inputRef.value?.focus();
      inputRef.value?.select();
    }
  },
);

function close() {
  emit('update:show', false);
}

async function submit() {
  if (!props.projectId || !title.value.trim()) return;
  try {
    await projects.renameProject(props.projectId, title.value.trim());
    ui.showToast('项目已重命名');
    close();
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : '重命名失败', 'error');
  }
}
</script>

<template>
  <ModalShell :show="show" @close="close">
    <div class="p-6">
      <h3 class="text-base font-semibold text-slate-700 mb-1">重命名项目</h3>
      <p class="text-xs text-slate-400 mb-4">{{ projectId }} - {{ originalTitle }}</p>
      <div class="space-y-3">
        <input
          ref="inputRef"
          v-model="title"
          @keydown.enter.prevent="submit"
          placeholder="项目标题"
          class="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-400 transition placeholder:text-slate-300"
        />
        <p class="text-[11px] text-slate-400">仅修改项目标题，所有项目状态下均可执行。</p>
      </div>
      <div class="flex justify-end gap-2 mt-5">
        <button @click="close" class="px-4 py-2 text-sm text-slate-500 hover:bg-slate-50 rounded-xl transition">取消</button>
        <button
          @click="submit"
          :disabled="!title.trim() || !projectId"
          class="px-5 py-2 text-sm bg-slate-800 text-white rounded-xl font-medium hover:bg-slate-900 transition disabled:opacity-30 shadow-sm"
        >
          保存
        </button>
      </div>
    </div>
  </ModalShell>
</template>
