<script setup lang="ts">
import { useReplayStore } from '@/stores/replay';
import { useUiStore } from '@/stores/ui';
import { useProjectsStore } from '@/stores/projects';

const replay = useReplayStore();
const ui = useUiStore();
const projects = useProjectsStore();

async function start() {
  if (!projects.project) return;
  const res = await replay.start(projects.project.project.id);
  if (!res.ok && res.reason && res.reason !== 'already_active') {
    ui.showToast(res.reason, 'error');
  }
}

async function exit() {
  await replay.exit(projects.selectedProjectId || projects.project?.project.id);
}
</script>

<template>
  <button
    v-if="!replay.active"
    @click="start"
    class="px-2.5 py-1 rounded-lg border border-violet-200 text-xs text-violet-600 hover:bg-violet-50 transition flex items-center gap-1.5"
  >
    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
      <path d="m8 5 11 7-11 7V5Z" />
      <path d="M4 5v14" />
    </svg>
    回放
  </button>
  <div
    v-else
    class="flex items-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50/80 px-2 py-1 text-xs text-violet-700"
  >
    <span class="font-medium whitespace-nowrap">{{ replay.progressLabel }}</span>
    <button
      @click="replay.togglePlayback()"
      class="inline-flex h-6 w-6 items-center justify-center rounded-md border border-violet-200 bg-white/80 hover:bg-white transition"
      :title="replay.playing ? '暂停回放' : '继续回放'"
    >
      <svg v-if="replay.playing" class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M8 6h3v12H8zM13 6h3v12h-3z" />
      </svg>
      <svg v-else class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
        <path d="m8 5 11 7-11 7V5Z" />
      </svg>
    </button>
    <button
      @click="replay.restart()"
      class="inline-flex h-6 w-6 items-center justify-center rounded-md border border-violet-200 bg-white/80 hover:bg-white transition"
      title="重新开始回放"
    >
      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="1.9" viewBox="0 0 24 24">
        <path d="M3 12a9 9 0 1 0 3-6.708" />
        <path d="M3 3v6h6" />
      </svg>
    </button>
    <select
      :value="replay.stepMs"
      @change="(e: Event) => replay.setSpeed((e.target as HTMLSelectElement).value)"
      class="h-6 rounded-md border border-violet-200 bg-white/80 px-1.5 text-[11px] text-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-100"
      title="回放速度"
    >
      <option value="700">快速</option>
      <option value="1100">正常</option>
      <option value="1600">慢速</option>
    </select>
    <button
      @click="exit"
      class="inline-flex h-6 items-center justify-center rounded-md border border-violet-200 bg-white/80 px-2 hover:bg-white transition"
    >
      退出
    </button>
  </div>
</template>
