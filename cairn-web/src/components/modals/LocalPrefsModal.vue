<script setup lang="ts">
import { reactive, watch } from 'vue';
import ModalShell from './ModalShell.vue';
import { useUiStore } from '@/stores/ui';
import { usePrefsStore, type LayoutMode } from '@/stores/prefs';

const ui = useUiStore();
const prefs = usePrefsStore();

const draft = reactive<{ actor_name: string; layout_mode: LayoutMode }>({
  actor_name: prefs.localPrefs.actor_name,
  layout_mode: prefs.localPrefs.layout_mode,
});

watch(
  () => ui.showLocalPrefs,
  s => {
    if (s) {
      draft.actor_name = prefs.localPrefs.actor_name;
      draft.layout_mode = prefs.localPrefs.layout_mode;
    }
  },
);

function close() {
  ui.showLocalPrefs = false;
}

function save() {
  prefs.setActor(draft.actor_name);
  prefs.setLayoutMode(draft.layout_mode);
  prefs.save();
  ui.showToast('本地偏好已保存');
  ui.showLocalPrefs = false;
}
</script>

<template>
  <ModalShell :show="ui.showLocalPrefs" max-width="max-w-md" @close="close">
    <div class="p-6">
      <h3 class="text-base font-semibold text-slate-700 mb-4">本地偏好</h3>
      <div class="space-y-4">
        <div>
          <label class="text-[11px] text-slate-400 mb-1 block font-medium">操作者</label>
          <input
            v-model="draft.actor_name"
            placeholder="你的名称"
            class="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-400 transition placeholder:text-slate-300"
          />
        </div>
        <div>
          <label class="text-[11px] text-slate-400 mb-1 block font-medium">默认布局</label>
          <select
            v-model="draft.layout_mode"
            class="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-400 transition"
          >
            <option value="dagre_tb">Dagre ↓ 自上而下</option>
            <option value="dagre_lr">Dagre → 自左向右</option>
            <option value="klay_tb">Klay ↓ 自上而下</option>
            <option value="klay_lr">Klay → 自左向右</option>
            <option value="elk_tb">ELK ↓ 自上而下</option>
            <option value="elk_lr">ELK → 自左向右</option>
          </select>
        </div>
        <p class="text-[11px] text-slate-400">仅在当前浏览器内保存。</p>
      </div>
      <div class="flex justify-end gap-2 mt-5">
        <button @click="close" class="px-4 py-2 text-sm text-slate-500 hover:bg-slate-50 rounded-xl transition">关闭</button>
        <button
          @click="save"
          class="px-4 py-2 text-sm bg-slate-800 text-white rounded-xl font-medium hover:bg-slate-900 transition shadow-sm"
        >
          保存到本地
        </button>
      </div>
    </div>
  </ModalShell>
</template>
