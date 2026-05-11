<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useProjectsStore } from '@/stores/projects';
import { usePrefsStore, type LayoutMode } from '@/stores/prefs';
import { useUiStore } from '@/stores/ui';
import { useReplayStore } from '@/stores/replay';
import { reasonTriggerLabel, formatTime, projectStatusBadgeClass, projectStatusLabel } from '@/composables/useFormatters';
import GraphCanvas from '@/components/GraphCanvas.vue';
import SidePanel from '@/components/SidePanel.vue';
import ReplayControls from '@/components/ReplayControls.vue';
import RenameModal from '@/components/modals/RenameModal.vue';
import ReopenModal from '@/components/modals/ReopenModal.vue';
import IntentModal from '@/components/modals/IntentModal.vue';
import ConcludeModal from '@/components/modals/ConcludeModal.vue';
import CompleteModal from '@/components/modals/CompleteModal.vue';
import HintModal from '@/components/modals/HintModal.vue';

const route = useRoute();
const router = useRouter();
const projects = useProjectsStore();
const prefs = usePrefsStore();
const ui = useUiStore();
const replay = useReplayStore();

const projectId = computed(() => String(route.params.id || ''));
const graphRef = ref<InstanceType<typeof GraphCanvas> | null>(null);
const layoutEl = ref<HTMLDivElement | null>(null);

// ────────────────────── 侧栏拖拽 ──────────────────────
function clampPanelWidth(width: number): number {
  const containerWidth = layoutEl.value?.getBoundingClientRect().width ?? window.innerWidth;
  const min = 260;
  const max = Math.max(min, containerWidth - 260);
  return Math.min(max, Math.max(min, width));
}
function handlePanelResize(ev: PointerEvent) {
  if (!prefs.isResizingPanel) return;
  const rect = layoutEl.value?.getBoundingClientRect();
  if (!rect) return;
  prefs.sidePanelWidth = clampPanelWidth(rect.right - ev.clientX);
}
function stopPanelResize() {
  if (!prefs.isResizingPanel) return;
  prefs.isResizingPanel = false;
  prefs.saveSidePanelWidth();
}
function startPanelResize(ev: PointerEvent) {
  ev.preventDefault();
  const target = ev.currentTarget as HTMLElement | null;
  target?.setPointerCapture?.(ev.pointerId);
  prefs.isResizingPanel = true;
  handlePanelResize(ev);
}

const showRename = ref(false);
const showReopen = ref(false);
const showIntent = ref(false);
const showConclude = ref(false);
const showComplete = ref(false);
const showHint = ref(false);

const concludeIntentId = ref('');

watch(
  () => projectId.value,
  async id => {
    if (!id) return;
    projects.selectedProjectId = id;
    projects.clearSelection();
    try {
      await projects.loadProject(id);
    } catch (e) {
      ui.showToast(e instanceof Error ? e.message : '加载项目失败', 'error');
    }
  },
  { immediate: true },
);

onMounted(() => {
  projects.startPolling();
  window.addEventListener('pointermove', handlePanelResize);
  window.addEventListener('pointerup', stopPanelResize);
  window.addEventListener('pointercancel', stopPanelResize);
});

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', handlePanelResize);
  window.removeEventListener('pointerup', stopPanelResize);
  window.removeEventListener('pointercancel', stopPanelResize);
  if (replay.active) {
    void replay.exit();
  }
  projects.selectedProjectId = '';
  projects.project = null;
});

const selectedActionableOpen = computed(() => {
  const i = projects.selectedOpenIntentRecord;
  if (!i) return null;
  const actor = prefs.actorName;
  return !i.worker || i.worker === actor ? i : null;
});
const selectedReleasableOpen = computed(() => {
  const i = projects.selectedOpenIntentRecord;
  if (!i?.worker) return null;
  return i.worker === prefs.actorName ? i : null;
});
const primaryActionLabel = computed(() => {
  const i = projects.selectedOpenIntentRecord;
  if (!i) return '认领';
  if (!i.worker) return '认领';
  return i.worker === prefs.actorName ? '心跳' : '已被认领';
});

function backToList() {
  router.push({ name: 'list' });
}

async function toggleStop() {
  if (!projects.project || projects.project.project.status === 'completed') return;
  const next = projects.project.project.status === 'active' ? 'stopped' : 'active';
  try {
    await projects.setProjectStatus(projects.project.project.id, next);
    ui.showToast(next === 'stopped' ? '项目已暂停' : '项目已继续');
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : '操作失败', 'error');
  }
}

async function sendHeartbeat() {
  const intent = selectedActionableOpen.value;
  if (!intent || !projects.project) return;
  try {
    await projects.heartbeatIntent(projects.project.project.id, intent.id, prefs.actorName);
    ui.showToast('已发送心跳');
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : '心跳失败', 'error');
  }
}

async function release() {
  const intent = selectedReleasableOpen.value;
  if (!intent || !projects.project) return;
  try {
    await projects.releaseIntent(projects.project.project.id, intent.id, prefs.actorName);
    ui.showToast('意图已释放');
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : '释放失败', 'error');
  }
}

function openConclude() {
  const intent = selectedActionableOpen.value;
  if (!intent) return;
  concludeIntentId.value = intent.id;
  showConclude.value = true;
}

function setLayoutMode(mode: LayoutMode) {
  prefs.setLayoutMode(mode);
  prefs.save();
}

function fit() {
  graphRef.value?.fit();
}

function deleteThisProject() {
  if (!projects.project) return;
  ui.requestDelete(projects.project.project.id, projects.project.project.title);
}

function viewYaml() {
  if (!projects.project) return;
  ui.openExportPreview({
    projectId: projects.project.project.id,
    title: `${projects.project.project.id} - ${projects.project.project.title}`,
    tab: 'yaml',
  });
}
function viewReport() {
  if (!projects.project) return;
  ui.openExportPreview({
    projectId: projects.project.project.id,
    title: `${projects.project.project.id} - ${projects.project.project.title}`,
    tab: 'report',
  });
}
</script>

<template>
  <div class="flex-1 flex flex-col overflow-hidden">
    <header
      class="bg-white border-b border-slate-200/70 px-6 lg:px-8 py-3.5 flex items-center gap-3 shrink-0 z-20"
    >
      <button
        @click="backToList"
        class="h-9 w-9 rounded-xl border border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition inline-flex items-center justify-center"
        title="返回列表"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7" /></svg>
      </button>
      <router-link
        :to="{ name: 'list' }"
        class="hidden md:flex items-center gap-2.5 min-w-0"
        title="回到 NeoBreach 首页"
      >
        <div class="brand-logo h-8 w-8 rounded-xl shrink-0 overflow-hidden">
          <img src="/favicon.svg" alt="" class="w-5 h-5 block" />
        </div>
        <span class="brand-wordmark text-[15px] hidden lg:inline">NeoBreach</span>
        <span class="hidden lg:inline h-4 w-px bg-slate-200 mx-1"></span>
      </router-link>
      <div v-if="projects.project" class="flex items-center gap-2 min-w-0">
        <span class="text-[11px] font-mono text-slate-400 uppercase tracking-wider">{{ projects.project.project.id }}</span>
        <h2 class="text-[18px] font-semibold text-slate-800 tracking-tight truncate">{{ projects.project.project.title }}</h2>
        <button
          @click="showRename = true"
          class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-400 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-400"
          title="重命名项目"
        >
          <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="m16.862 4.487 1.65-1.65a1.875 1.875 0 1 1 2.652 2.652l-9.193 9.193a4.5 4.5 0 0 1-1.897 1.13L6 17l1.188-4.074a4.5 4.5 0 0 1 1.13-1.897l8.544-8.542Z" /></svg>
        </button>
        <span
          class="px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-[0.08em] shrink-0"
          :class="projectStatusBadgeClass(projects.project.project.status)"
        >
          {{ projectStatusLabel(projects.project.project.status) }}
        </span>
      </div>
      <div class="flex-1"></div>
      <div
        v-if="projects.project"
        class="hidden md:flex items-center gap-3 text-xs text-slate-500 px-3.5 py-1.5 rounded-full border border-slate-200/70"
      >
        <span class="inline-flex items-center gap-1.5"><span class="text-slate-400">事实</span><span class="font-semibold text-slate-700 tabular-nums">{{ projects.project.facts.length }}</span></span>
        <span class="h-3 w-px bg-slate-200"></span>
        <span class="inline-flex items-center gap-1.5"><span class="text-slate-400">意图</span><span class="font-semibold text-slate-700 tabular-nums">{{ projects.project.intents.length }}</span></span>
      </div>
      <div class="flex items-center gap-1.5">
        <ReplayControls />
        <template v-if="!replay.active">
          <button @click="viewYaml" class="h-9 px-3.5 rounded-xl border border-slate-200 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition">快照</button>
          <button v-if="projects.project?.project.status === 'completed'" @click="viewReport" class="h-9 px-3.5 rounded-xl border border-emerald-200 text-xs text-emerald-600 hover:bg-emerald-50 transition">中文报告</button>
          <button
            v-if="projects.project && projects.project.project.status !== 'completed'"
            @click="toggleStop"
            class="h-9 px-3.5 rounded-xl border text-xs transition"
            :class="projects.project.project.status === 'active' ? 'border-amber-200 text-amber-600 hover:bg-amber-50' : 'border-teal-200 text-teal-600 hover:bg-teal-50'"
          >
            {{ projects.project.project.status === 'active' ? '暂停' : '继续' }}
          </button>
          <button v-if="projects.project?.project.status === 'completed'" @click="showReopen = true" class="h-9 px-3.5 rounded-xl border border-sky-200 text-xs text-sky-600 hover:bg-sky-50 transition">重新打开</button>
          <button @click="deleteThisProject" class="h-9 px-3.5 rounded-xl border border-rose-200 text-xs text-rose-500 hover:bg-rose-50 hover:text-rose-600 transition">删除</button>
        </template>
      </div>
      <div class="flex items-center gap-1.5 ml-1">
        <button
          @click="ui.showLocalPrefs = true"
          class="h-9 max-w-40 px-3 rounded-xl border border-slate-200 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition inline-flex items-center shrink-0"
        >
          <span class="truncate block">{{ prefs.actorName }}</span>
        </button>
        <button
          @click="(projects.loadSettings(), (ui.showSettings = true))"
          class="h-9 w-9 rounded-xl border border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition inline-flex items-center justify-center shrink-0"
          title="服务端设置"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /></svg>
        </button>
      </div>
    </header>

    <div ref="layoutEl" class="flex-1 flex overflow-hidden">
      <!-- Graph -->
      <div class="flex-1 relative min-w-0 flex flex-col">
        <div class="absolute top-4 left-4 z-10 flex items-center gap-1.5">
          <button @click="fit" class="h-9 w-9 bg-white/90 backdrop-blur rounded-xl shadow-card border border-slate-200/60 text-slate-500 hover:text-brand-600 hover:bg-white transition inline-flex items-center justify-center" title="适应视口">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.7" viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M16 3h3a2 2 0 0 1 2 2v3" /><path d="M8 21H5a2 2 0 0 1-2-2v-3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" /></svg>
          </button>
          <select
            :value="prefs.layoutMode"
            @change="(e: Event) => setLayoutMode((e.target as HTMLSelectElement).value as LayoutMode)"
            class="h-9 bg-white/90 backdrop-blur rounded-xl shadow-card border border-slate-200/60 px-3 text-xs text-slate-600 hover:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-300 transition"
            title="布局算法"
          >
            <option value="dagre_tb">Dagre 自上而下 ↓</option>
            <option value="dagre_lr">Dagre 从左到右 →</option>
            <option value="klay_tb">Klay 自上而下 ↓</option>
            <option value="klay_lr">Klay 从左到右 →</option>
            <option value="elk_tb">ELK 自上而下 ↓</option>
            <option value="elk_lr">ELK 从左到右 →</option>
          </select>
        </div>

        <div v-if="projects.project?.project.reason" class="absolute top-16 right-4 z-10 max-w-80">
          <div class="relative overflow-hidden rounded-2xl border border-sky-200/80 bg-white/92 px-3.5 py-3 shadow-lg shadow-sky-100/60 backdrop-blur">
            <div class="flex items-start gap-3">
              <span class="reason-beacon mt-1 shrink-0"></span>
              <div class="min-w-0">
                <div class="text-[10px] font-semibold tracking-[0.12em] text-sky-500">推理进行中</div>
                <div class="mt-0.5 text-sm font-semibold text-slate-700 truncate">{{ projects.project.project.reason.worker }}</div>
                <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                  <span v-if="projects.project.project.reason.trigger">触发 {{ reasonTriggerLabel(projects.project.project.reason.trigger) || projects.project.project.reason.trigger }}</span>
                  <span>心跳 {{ formatTime(projects.project.project.reason.last_heartbeat_at) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="absolute top-4 right-4 z-10 flex flex-wrap justify-end gap-2">
          <div class="flex gap-1.5" v-if="projects.projectIsActive && !replay.active">
            <button
              @click="showIntent = true"
              :disabled="!projects.canActOnSelectedFacts"
              class="px-3 py-1.5 bg-white/90 backdrop-blur border border-brand-200 text-brand-600 rounded-lg shadow-sm text-xs font-medium hover:bg-brand-50 transition disabled:opacity-30 disabled:cursor-not-allowed"
            >
              意图
            </button>
            <button
              @click="showComplete = true"
              :disabled="!projects.canActOnSelectedFacts"
              class="px-3 py-1.5 bg-white/90 backdrop-blur border border-teal-200 text-teal-600 rounded-lg shadow-sm text-xs font-medium hover:bg-teal-50 transition disabled:opacity-30 disabled:cursor-not-allowed"
            >
              完成项目
            </button>
          </div>
          <div class="flex gap-1.5" v-if="projects.projectCanWriteHints && !replay.active">
            <button @click="showHint = true" class="px-3 py-1.5 bg-white/90 backdrop-blur border border-amber-200 text-amber-600 rounded-lg shadow-sm text-xs font-medium hover:bg-amber-50 transition">
              提示
            </button>
          </div>
          <div class="flex gap-1.5" v-if="projects.projectIsActive && !replay.active">
            <button
              @click="sendHeartbeat"
              :disabled="!selectedActionableOpen"
              class="px-3 py-1.5 bg-white/90 backdrop-blur border border-slate-200 text-slate-600 rounded-lg shadow-sm text-xs font-medium hover:bg-slate-50 transition disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {{ primaryActionLabel }}
            </button>
            <button
              @click="release"
              :disabled="!selectedReleasableOpen"
              class="px-3 py-1.5 bg-white/90 backdrop-blur border border-amber-200 text-amber-700 rounded-lg shadow-sm text-xs font-medium hover:bg-amber-50 transition disabled:opacity-30 disabled:cursor-not-allowed"
            >
              释放
            </button>
            <button
              @click="openConclude"
              :disabled="!selectedActionableOpen"
              class="px-3 py-1.5 bg-white/90 backdrop-blur border border-teal-200 text-teal-600 rounded-lg shadow-sm text-xs font-medium hover:bg-teal-50 transition disabled:opacity-30 disabled:cursor-not-allowed"
            >
              结案
            </button>
          </div>
        </div>

        <GraphCanvas ref="graphRef" />
      </div>

      <!-- Side panel resize handle -->
      <div
        @pointerdown="startPanelResize"
        class="w-2 shrink-0 cursor-col-resize group flex items-stretch justify-center touch-none relative z-20"
      >
        <div
          class="w-px transition"
          :class="prefs.isResizingPanel ? 'bg-brand-400' : 'bg-slate-200/70 group-hover:bg-brand-300'"
        ></div>
      </div>

      <!-- Side panel -->
      <aside
        class="border-l border-slate-200/60 bg-white flex flex-col overflow-hidden shrink-0 relative z-20"
        :style="{ width: prefs.sidePanelWidth + 'px', minWidth: prefs.sidePanelWidth + 'px', flexBasis: prefs.sidePanelWidth + 'px' }"
      >
        <SidePanel v-if="projects.project" />
      </aside>
    </div>

    <!-- Modals -->
    <RenameModal
      v-if="projects.project"
      v-model:show="showRename"
      :project-id="projects.project.project.id"
      :original-title="projects.project.project.title"
    />
    <ReopenModal
      v-if="projects.project"
      v-model:show="showReopen"
      :project-id="projects.project.project.id"
      :project-title="projects.project.project.title"
    />
    <IntentModal v-model:show="showIntent" />
    <ConcludeModal v-model:show="showConclude" :intent-id="concludeIntentId" />
    <CompleteModal v-model:show="showComplete" />
    <HintModal v-model:show="showHint" />
  </div>
</template>
