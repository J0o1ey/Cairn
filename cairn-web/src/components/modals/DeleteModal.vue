<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ModalShell from './ModalShell.vue';
import { useUiStore } from '@/stores/ui';
import { useProjectsStore } from '@/stores/projects';

const ui = useUiStore();
const projects = useProjectsStore();
const route = useRoute();
const router = useRouter();

const label = computed(() => {
  const { id, title } = ui.deleteConfirm;
  return title ? `${id} - ${title}` : id;
});

function close() {
  ui.closeDelete();
}

async function confirmDelete() {
  const id = ui.deleteConfirm.id;
  if (!id || ui.isDeletingProject) return;
  try {
    ui.isDeletingProject = true;
    await projects.deleteProject(id);
    ui.closeDelete(true);
    ui.showToast(`已删除 ${id}`);
    if (route.name === 'graph' && route.params.id === id) {
      router.replace({ name: 'list' });
    }
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : '删除失败', 'error');
  } finally {
    ui.isDeletingProject = false;
  }
}
</script>

<template>
  <ModalShell :show="ui.showDelete" max-width="max-w-md" @close="close">
    <div class="p-6">
      <div class="flex items-start gap-3">
        <div class="w-10 h-10 rounded-2xl bg-rose-50 text-rose-500 flex items-center justify-center shrink-0">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
            <path d="M3 6h18" />
            <path d="M8 6V4.75A1.75 1.75 0 0 1 9.75 3h4.5A1.75 1.75 0 0 1 16 4.75V6" />
            <path d="M19 6l-.63 11.338A2 2 0 0 1 16.37 19.5H7.63a2 2 0 0 1-1.997-2.162L5 6" />
          </svg>
        </div>
        <div class="min-w-0 flex-1">
          <h3 class="text-base font-semibold text-slate-700">删除项目</h3>
          <p class="text-sm text-slate-500 mt-1 leading-relaxed">
            将永久删除 <span class="font-medium text-slate-700 break-all">{{ label }}</span>。
          </p>
          <p class="text-xs text-slate-400 mt-3">此操作不可撤销。</p>
        </div>
      </div>
      <div class="flex justify-end gap-2 mt-6">
        <button
          @click="close"
          :disabled="ui.isDeletingProject"
          class="px-4 py-2 text-sm text-slate-500 hover:bg-slate-50 rounded-xl transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          取消
        </button>
        <button
          @click="confirmDelete"
          :disabled="ui.isDeletingProject"
          class="px-4 py-2 text-sm bg-rose-500 text-white rounded-xl font-medium hover:bg-rose-600 transition shadow-sm shadow-rose-200 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {{ ui.isDeletingProject ? '删除中...' : '删除' }}
        </button>
      </div>
    </div>
  </ModalShell>
</template>
