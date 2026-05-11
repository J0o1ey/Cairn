<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useProjectsStore } from '@/stores/projects';
import { usePrefsStore } from '@/stores/prefs';
import { useUiStore } from '@/stores/ui';
import {
  formatDate,
  projectStatusBadgeClass,
  projectStatusLabel,
  reasonBadgeText,
  workingIntentBadgeText,
} from '@/composables/useFormatters';
import NewProjectModal from '@/components/modals/NewProjectModal.vue';
import RenameModal from '@/components/modals/RenameModal.vue';
import ReopenModal from '@/components/modals/ReopenModal.vue';
import type { ProjectSummary } from '@/types/api';

const router = useRouter();
const projects = useProjectsStore();
const prefs = usePrefsStore();
const ui = useUiStore();

const showRename = ref(false);
const renameTarget = ref<{ id: string; title: string }>({ id: '', title: '' });
const showReopen = ref(false);
const reopenTarget = ref<{ id: string; title: string }>({ id: '', title: '' });

const allCount = computed(() => projects.projects.length);

function openProject(p: ProjectSummary) {
  router.push({ name: 'graph', params: { id: p.id } });
}

function openRename(p: ProjectSummary, ev?: Event) {
  ev?.stopPropagation();
  renameTarget.value = { id: p.id, title: p.title };
  showRename.value = true;
}

function openReopen(p: ProjectSummary, ev?: Event) {
  ev?.stopPropagation();
  reopenTarget.value = { id: p.id, title: p.title };
  showReopen.value = true;
}

async function toggleStop(p: ProjectSummary, ev: Event) {
  ev.stopPropagation();
  const next = p.status === 'active' ? 'stopped' : 'active';
  try {
    await projects.setProjectStatus(p.id, next);
    ui.showToast(p.status === 'active' ? '项目已暂停' : '项目已继续');
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : '操作失败', 'error');
  }
}

function requestDelete(p: ProjectSummary, ev: Event) {
  ev.stopPropagation();
  ui.requestDelete(p.id, p.title);
}

async function viewYaml(p: ProjectSummary, ev: Event) {
  ev.stopPropagation();
  ui.openExportPreview({ projectId: p.id, title: `${p.id} - ${p.title}`, tab: 'yaml' });
}

async function viewReport(p: ProjectSummary, ev: Event) {
  ev.stopPropagation();
  ui.openExportPreview({ projectId: p.id, title: `${p.id} - ${p.title}`, tab: 'report' });
}

async function stopAll() {
  await projects.stopAllActiveProjects();
  ui.showToast('已暂停所有进行中的项目');
}
</script>

<template>
  <div class="flex-1 flex flex-col overflow-hidden">
    <header
      class="bg-white border-b border-slate-200/70 px-6 lg:px-10 py-4 flex items-center gap-4 shrink-0"
    >
      <div class="flex items-center gap-3 min-w-0">
        <div class="brand-logo h-10 w-10 rounded-xl shrink-0 overflow-hidden">
          <img src="/favicon.svg" alt="" class="w-6 h-6 block" />
        </div>
        <div class="flex flex-col leading-tight">
          <span class="brand-wordmark text-[17px]">NeoBreach</span>
          <span class="text-[10px] uppercase tracking-[0.18em] text-slate-400">Hack to evolve. Evolve to hack.</span>
        </div>
      </div>
      <div class="flex-1"></div>
      <div class="flex items-center gap-3 text-[11px] text-slate-500">
        <div class="flex items-center gap-3 px-3.5 py-1.5 rounded-full border border-slate-200/70">
          <span class="inline-flex items-center gap-1.5 shrink-0" title="全部项目">
            <span class="font-medium uppercase tracking-[0.12em] text-slate-400">全部</span>
            <span class="font-semibold text-slate-700 tabular-nums">{{ allCount }}</span>
          </span>
          <span class="h-3 w-px bg-slate-200"></span>
          <span class="inline-flex items-center gap-1.5 shrink-0" title="进行中的项目">
            <span class="h-1.5 w-1.5 rounded-full bg-teal-500"></span>
            <span class="font-semibold text-teal-700 tabular-nums">{{ projects.countByStatus('active') }}</span>
          </span>
          <span class="inline-flex items-center gap-1.5 shrink-0" title="已暂停的项目">
            <span class="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
            <span class="font-semibold text-amber-700 tabular-nums">{{ projects.countByStatus('stopped') }}</span>
          </span>
          <span class="inline-flex items-center gap-1.5 shrink-0" title="已完成的项目">
            <span class="h-1.5 w-1.5 rounded-full bg-slate-400"></span>
            <span class="font-semibold text-slate-600 tabular-nums">{{ projects.countByStatus('completed') }}</span>
          </span>
        </div>
        <button
          type="button"
          @click="stopAll"
          :disabled="!projects.hasActiveProjects || projects.isStoppingAllProjects"
          class="h-9 px-3.5 rounded-xl border border-amber-200 text-xs text-amber-700 hover:bg-amber-50 transition inline-flex items-center gap-1.5 shrink-0 disabled:cursor-not-allowed disabled:opacity-40"
          title="暂停所有进行中的项目"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M6 6h12v12H6z" /></svg>
          {{ projects.isStoppingAllProjects ? '暂停中...' : '暂停全部' }}
        </button>
      </div>
      <div class="flex items-center gap-2">
        <button
          @click="ui.showNewProject = true"
          class="h-9 px-4 rounded-xl bg-brand-600 text-white text-xs font-medium hover:bg-brand-700 transition inline-flex items-center gap-2"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
          新建项目
        </button>
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
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
        </button>
      </div>
    </header>

    <div class="flex-1 overflow-y-auto px-6 lg:px-10 py-6 lg:py-8">
      <template v-if="projects.projects.length === 0">
        <div class="flex flex-col items-center justify-center h-full text-slate-400 select-none">
          <div class="brand-logo h-24 w-24 rounded-3xl mb-7">
            <img src="/favicon.svg" alt="" class="w-12 h-12 block" />
          </div>
          <p class="text-2xl font-semibold tracking-tight">
            <span class="brand-wordmark">NeoBreach</span>
            <span class="text-slate-500"> · 开启你的第一段探索</span>
          </p>
          <p class="text-sm mt-2 text-slate-400">从一个起点出发，定义目标，让事实图自我生长。</p>
          <button
            @click="ui.showNewProject = true"
            class="mt-7 h-10 px-5 rounded-xl bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition inline-flex items-center gap-2"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
            新建项目
          </button>
        </div>
      </template>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-5">
        <div
          v-for="p in projects.projects"
          :key="p.id"
          class="group h-full flex flex-col bg-white rounded-3xl border border-slate-200/70 p-6 cursor-pointer overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 shadow-card hover:shadow-card-hover"
          @click="openProject(p)"
        >
          <div class="flex items-center justify-between mb-4">
            <span class="text-[11px] font-mono text-slate-400 tracking-wider uppercase">{{ p.id }}</span>
            <span
              class="px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-[0.08em]"
              :class="projectStatusBadgeClass(p.status)"
            >
              {{ projectStatusLabel(p.status) }}
            </span>
          </div>

          <div class="mb-4 flex-1">
            <div class="flex items-start gap-2">
              <h3
                class="min-w-0 flex-1 text-[18px] font-semibold text-slate-800 leading-snug break-words [overflow-wrap:anywhere] group-hover:text-brand-700 transition-colors"
              >
                {{ p.title }}
              </h3>
              <button
                type="button"
                @click="openRename(p, $event)"
                class="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-400 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-400"
                title="重命名项目"
                :aria-label="`重命名 ${p.title}`"
              >
                <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
                  <path d="m16.862 4.487 1.65-1.65a1.875 1.875 0 1 1 2.652 2.652l-9.193 9.193a4.5 4.5 0 0 1-1.897 1.13L6 17l1.188-4.074a4.5 4.5 0 0 1 1.13-1.897l8.544-8.542Z" />
                  <path d="M19.5 7.125 16.875 4.5" />
                  <path d="M5.25 18.75h13.5" />
                </svg>
              </button>
            </div>
            <div v-if="p.status !== 'completed'" class="mt-3 flex flex-wrap items-center gap-1.5">
              <div
                v-if="p.reason"
                class="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[10px] font-medium text-sky-700 reason-chip-running"
              >
                {{ reasonBadgeText(p.reason, true) }}
              </div>
              <div
                v-if="p.working_intent_count > 0"
                class="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-medium text-amber-700 intent-chip-running"
              >
                {{ workingIntentBadgeText(p.working_intent_count) }}
              </div>
            </div>
          </div>

          <div class="grid grid-cols-3 gap-2 text-center mb-3">
            <div class="rounded-xl bg-slate-50/70 px-2 py-2">
              <div class="text-[10px] uppercase tracking-[0.14em] text-slate-400">事实</div>
              <div class="text-sm font-semibold text-slate-700 tabular-nums mt-0.5">{{ p.fact_count }}</div>
            </div>
            <div class="rounded-xl bg-slate-50/70 px-2 py-2">
              <div class="text-[10px] uppercase tracking-[0.14em] text-slate-400">意图</div>
              <div class="text-sm font-semibold text-slate-700 tabular-nums mt-0.5">{{ p.intent_count }}</div>
            </div>
            <div class="rounded-xl bg-slate-50/70 px-2 py-2">
              <div class="text-[10px] uppercase tracking-[0.14em] text-slate-400">提示</div>
              <div class="text-sm font-semibold text-slate-700 tabular-nums mt-0.5">{{ p.hint_count }}</div>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
            <template v-if="p.status !== 'completed'">
              <span v-if="p.working_intent_count > 0" class="inline-flex items-center gap-1 text-amber-500">
                <span class="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
                进行中 {{ p.working_intent_count }}
              </span>
              <span v-if="p.unclaimed_intent_count > 0" class="inline-flex items-center gap-1 text-slate-500">
                <span class="h-1.5 w-1.5 rounded-full bg-slate-300"></span>
                未认领 {{ p.unclaimed_intent_count }}
              </span>
            </template>
            <span class="ml-auto text-[11px] text-slate-400">{{ formatDate(p.created_at) }}</span>
          </div>

          <div class="mt-4 pt-4 border-t border-slate-100 flex items-center justify-end gap-1.5">
            <div class="flex items-center justify-end gap-1.5 flex-wrap">
              <button
                type="button"
                @click="viewYaml(p, $event)"
                class="h-8 px-2.5 rounded-lg border border-slate-200 text-[11px] text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition"
              >
                快照
              </button>
              <button
                v-if="p.status === 'completed'"
                type="button"
                @click="viewReport(p, $event)"
                class="h-8 px-2.5 rounded-lg border border-emerald-200 text-[11px] text-emerald-600 hover:bg-emerald-50 transition"
              >
                报告
              </button>
              <button
                v-if="p.status !== 'completed'"
                type="button"
                @click="toggleStop(p, $event)"
                class="h-8 px-2.5 rounded-lg border text-[11px] transition"
                :class="p.status === 'active' ? 'border-amber-200 text-amber-600 hover:bg-amber-50' : 'border-teal-200 text-teal-600 hover:bg-teal-50'"
              >
                {{ p.status === 'active' ? '暂停' : '继续' }}
              </button>
              <button
                v-if="p.status === 'completed'"
                type="button"
                @click="openReopen(p, $event)"
                class="h-8 px-2.5 rounded-lg border border-sky-200 text-[11px] text-sky-600 hover:bg-sky-50 transition"
              >
                重新打开
              </button>
              <button
                type="button"
                @click="requestDelete(p, $event)"
                class="h-8 px-2.5 rounded-lg border border-rose-200 text-[11px] text-rose-500 hover:bg-rose-50 hover:text-rose-600 transition"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <NewProjectModal />
    <RenameModal v-model:show="showRename" :project-id="renameTarget.id" :original-title="renameTarget.title" />
    <ReopenModal v-model:show="showReopen" :project-id="reopenTarget.id" :project-title="reopenTarget.title" />
  </div>
</template>
