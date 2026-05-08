<script setup lang="ts">
import { reactive, watch } from 'vue';
import ModalShell from './ModalShell.vue';
import { useUiStore } from '@/stores/ui';
import { useProjectsStore } from '@/stores/projects';

const ui = useUiStore();
const projects = useProjectsStore();

const draft = reactive({ intent_timeout: 5, reason_timeout: 5 });

watch(
  () => ui.showSettings,
  s => {
    if (s) {
      draft.intent_timeout = projects.settings.intent_timeout;
      draft.reason_timeout = projects.settings.reason_timeout;
    }
  },
);

function close() {
  ui.showSettings = false;
}

async function save() {
  try {
    await projects.saveSettings({
      intent_timeout: Number(draft.intent_timeout),
      reason_timeout: Number(draft.reason_timeout),
    });
    ui.showToast('服务端设置已保存');
    ui.showSettings = false;
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : '保存失败', 'error');
  }
}
</script>

<template>
  <ModalShell :show="ui.showSettings" max-width="max-w-sm" @close="close">
    <div class="p-6">
      <h3 class="text-base font-semibold text-slate-700 mb-4">服务端设置</h3>
      <div>
        <label class="text-[11px] text-slate-400 mb-1 block font-medium">意图超时（秒）</label>
        <input
          type="number"
          v-model.number="draft.intent_timeout"
          class="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-400 transition"
        />
      </div>
      <div class="mt-4">
        <label class="text-[11px] text-slate-400 mb-1 block font-medium">推理超时（秒）</label>
        <input
          type="number"
          v-model.number="draft.reason_timeout"
          class="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-400 transition"
        />
        <p class="text-[11px] text-slate-400 mt-2">服务端共享配置。</p>
      </div>
      <div class="flex justify-end gap-2 mt-5">
        <button @click="close" class="px-4 py-2 text-sm text-slate-500 hover:bg-slate-50 rounded-xl transition">关闭</button>
        <button
          @click="save"
          class="px-4 py-2 text-sm bg-brand-500 text-white rounded-xl font-medium hover:bg-brand-600 transition shadow-sm shadow-brand-200"
        >
          保存到服务端
        </button>
      </div>
    </div>
  </ModalShell>
</template>
