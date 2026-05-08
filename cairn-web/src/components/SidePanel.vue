<script setup lang="ts">
import { computed, ref } from 'vue';
import { useProjectsStore } from '@/stores/projects';
import { useReplayStore } from '@/stores/replay';
import {
  buildTimelineEvents,
  formatDurationMs,
  replayTimelineElapsedDurationMs,
  type TimelineEvent,
  timelineEventBadge,
  timelineEventBadgeClass,
  timelineEventDotClass,
  timelineEventIsInteractive,
  timelineEventTriggersGraphFocus,
} from '@/composables/useTimeline';
import { formatTime, formatTimelineDate } from '@/composables/useFormatters';

type SideTab = 'detail' | 'hints' | 'log';
const sideTab = ref<SideTab>('detail');

const projects = useProjectsStore();
const replay = useReplayStore();

const timelineEvents = computed<TimelineEvent[]>(() => {
  if (replay.active) return replay.visibleEvents;
  return buildTimelineEvents(projects.project);
});

/**
 * 「图谱选中节点」自动映射回时间线中的对应条目。
 *  - intent 节点：优先映射到 intent_declared，回退到任意带该 intentId 的事件。
 *  - 单选 fact 节点：映射到 targetType=fact 且 targetId 等于该节点 id 的事件
 *    （多选事实时不参与，因为没有"单一锚点"）。
 */
function timelineTargetForGraphSelection(allowMultiFact: boolean): TimelineEvent | null {
  const events = timelineEvents.value;
  const node = projects.selectedNode;
  if (!node) return null;
  if (node.type === 'intent') {
    return (
      events.find(e => e.type === 'intent_declared' && e.intentId === node.id) ||
      events.find(e => e.intentId === node.id) ||
      null
    );
  }
  if (!allowMultiFact && projects.selectedFacts.length > 1) return null;
  return events.find(e => e.targetType === 'fact' && e.targetId === node.id) || null;
}

const activeTimelineEntry = computed<TimelineEvent | null>(() => {
  const explicitId = projects.selectedTimelineEntryId;
  if (explicitId) {
    return timelineEvents.value.find(e => e.id === explicitId) || null;
  }
  return timelineTargetForGraphSelection(false);
});

interface TimelineSummary {
  sequenceLabel: string;
  sequencePercent: number;
  timeLabel: string;
  timePercent: number;
}

const selectedTimelineSummary = computed<TimelineSummary | null>(() => {
  const target = activeTimelineEntry.value;
  if (!target) return null;
  const events = timelineEvents.value;
  const index = events.findIndex(e => e.id === target.id);
  if (index < 0) return null;

  const total = events.length;
  const sequencePercent = total <= 1 ? 100 : Math.round((index / (total - 1)) * 100);

  const replayMode = replay.active;
  const stepMs = Number(replay.stepMs) || 1100;
  const totalDuration = replayMode
    ? replayTimelineElapsedDurationMs(events, Math.max(0, total - 1), stepMs)
    : Math.max(0, Date.parse(events[total - 1].timestamp) - Date.parse(events[0].timestamp));
  const elapsedDuration = replayMode
    ? replayTimelineElapsedDurationMs(events, index, stepMs)
    : Math.max(0, Date.parse(target.timestamp) - Date.parse(events[0].timestamp));
  const timePercent = totalDuration === 0 ? 100 : Math.round((elapsedDuration / totalDuration) * 100);

  return {
    sequencePercent,
    sequenceLabel: `${index + 1} / ${total} · ${sequencePercent}%`,
    timePercent,
    timeLabel: `${formatDurationMs(elapsedDuration)} / ${formatDurationMs(totalDuration)} · ${timePercent}%`,
  };
});

function timelineEntryIsActive(entry: TimelineEvent): boolean {
  return activeTimelineEntry.value?.id === entry.id;
}

type IntentLite = {
  to: string | null;
  worker: string | null;
  description: string;
  from: string[];
  creator: string;
};

const projectStatus = computed(() => projects.project?.project.status);

const intentStatusLabel = (i: IntentLite) => {
  if (i.to) return '已结案';
  if (
    i.description === 'bootstrap' &&
    i.creator === 'dispatcher.bootstrap' &&
    i.from.length === 1 &&
    i.from[0] === 'origin'
  ) {
    return i.worker ? '启动中' : '启动待执行';
  }
  // 项目已完成 / 已暂停时，未结案的意图实际上不再被消费，
  // 用「未参与完成」/「已搁置」更贴近语义，避免出现"项目跑完了还未认领"的歧义。
  if (projectStatus.value === 'completed') return '未参与完成';
  if (projectStatus.value === 'stopped') return i.worker ? '已暂停' : '已搁置';
  return i.worker ? '进行中' : '未认领';
};
const intentStatusClass = (i: IntentLite) => {
  if (i.to) return 'text-teal-600';
  if (
    i.description === 'bootstrap' &&
    i.creator === 'dispatcher.bootstrap' &&
    i.from.length === 1 &&
    i.from[0] === 'origin'
  ) {
    return i.worker ? 'text-orange-600' : 'text-orange-400';
  }
  if (projectStatus.value === 'completed' || projectStatus.value === 'stopped') {
    return 'text-slate-400';
  }
  return i.worker ? 'text-amber-600' : 'text-slate-400';
};

function selectTimelineEntry(entry: TimelineEvent) {
  if (!timelineEventIsInteractive(entry)) return;
  if (timelineEventTriggersGraphFocus(entry)) {
    if (entry.targetType === 'fact') {
      projects.selectFact(entry.targetId);
    } else if (entry.targetType === 'intent') {
      projects.selectIntent(entry.targetId);
    }
    // 同时把显式 timelineEntryId 置为该 entry，让 hint/reason 等非图形事件也能高亮摘要。
    projects.selectedTimelineEntryId = entry.id;
    return;
  }
  // hints / reason 等不映射到图形节点的事件，仅记录显式选中。
  projects.selectedTimelineEntryId = entry.id;
}

function selectHintEntry(hintId: string) {
  if (!hintId) return;
  const entry = timelineEvents.value.find(e => e.type === 'hint_added' && e.targetId === hintId);
  if (!entry) return;
  sideTab.value = 'log';
  projects.selectedTimelineEntryId = entry.id;
}

function removeFactSelection(id: string) {
  const idx = projects.selectedFacts.indexOf(id);
  if (idx >= 0) projects.toggleSelectFact(id);
}

function entryClass(entry: TimelineEvent): string {
  const base = timelineEventIsInteractive(entry) ? 'cursor-pointer hover:bg-slate-50/70' : 'cursor-default';
  if (timelineEntryIsActive(entry)) {
    return `${base} bg-brand-50/80 ring-1 ring-brand-200`;
  }
  return base;
}
</script>

<template>
  <div class="flex border-b border-slate-100 shrink-0 bg-white">
    <button
      @click="sideTab = 'detail'"
      class="flex-1 px-3 py-3 text-[13px] font-medium transition"
      :class="sideTab === 'detail' ? 'text-brand-600 border-b-2 border-brand-500' : 'text-slate-400 hover:text-slate-600'"
    >
      详情
    </button>
    <button
      @click="sideTab = 'hints'"
      class="flex-1 px-3 py-3 text-[13px] font-medium transition"
      :class="sideTab === 'hints' ? 'text-brand-600 border-b-2 border-brand-500' : 'text-slate-400 hover:text-slate-600'"
    >
      提示
      <span class="ml-0.5 text-[10px] opacity-60">{{ projects.project?.hints.length ?? 0 }}</span>
    </button>
    <button
      @click="sideTab = 'log'"
      class="flex-1 px-3 py-3 text-[13px] font-medium transition"
      :class="sideTab === 'log' ? 'text-brand-600 border-b-2 border-brand-500' : 'text-slate-400 hover:text-slate-600'"
    >
      日志
    </button>
  </div>

  <!-- 时间线摘要（任何 Tab 下选中节点 / 条目时都常驻可见，方便快速感知进度） -->
  <transition name="summary">
    <section
      v-if="selectedTimelineSummary"
      class="shrink-0 border-b border-slate-200/70 bg-slate-50/40 px-4 py-3"
    >
      <div class="space-y-2.5">
        <div class="space-y-1">
          <div class="flex items-center justify-between gap-3 text-[11px]">
            <span class="text-slate-400">序号</span>
            <span class="font-mono text-slate-600">{{ selectedTimelineSummary.sequenceLabel }}</span>
          </div>
          <div class="h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div
              class="h-full rounded-full bg-brand-400 transition-all duration-300"
              :style="{ width: selectedTimelineSummary.sequencePercent + '%' }"
            ></div>
          </div>
        </div>
        <div class="space-y-1">
          <div class="flex items-center justify-between gap-3 text-[11px]">
            <span class="text-slate-400">时间跨度</span>
            <span class="font-mono text-slate-600 text-right">{{ selectedTimelineSummary.timeLabel }}</span>
          </div>
          <div class="h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div
              class="h-full rounded-full bg-teal-400 transition-all duration-300"
              :style="{ width: selectedTimelineSummary.timePercent + '%' }"
            ></div>
          </div>
        </div>
        <div v-if="activeTimelineEntry" class="flex items-center gap-2 pt-1">
          <span
            class="px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide"
            :class="timelineEventBadgeClass(activeTimelineEntry)"
          >
            {{ timelineEventBadge(activeTimelineEntry) }}
          </span>
          <span class="text-[11px] text-slate-500 truncate">{{ activeTimelineEntry.title || activeTimelineEntry.targetId }}</span>
          <button
            v-if="sideTab !== 'log'"
            type="button"
            @click="sideTab = 'log'"
            class="ml-auto shrink-0 text-[11px] text-brand-500 hover:text-brand-600 underline-offset-2 hover:underline"
          >
            查看日志 →
          </button>
        </div>
      </div>
    </section>
  </transition>

  <!-- Detail -->
  <div v-show="sideTab === 'detail'" class="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/40">
    <div
      v-if="!projects.selectedNode"
      class="rounded-2xl border border-dashed border-slate-200 bg-white/80 px-5 py-10 text-center shadow-sm"
    >
      <p class="text-sm text-slate-400">点击节点或边查看详情</p>
      <p class="text-xs text-slate-300 mt-1">按住 Shift 可多选</p>
    </div>

    <!-- 多选事实 -->
    <div v-if="projects.selectedNode?.type === 'fact' && projects.selectedFacts.length > 1" class="space-y-3">
      <article
        v-for="fact in projects.selectedFactRecords"
        :key="fact.id"
        class="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden"
      >
        <div class="px-4 py-3 border-b border-slate-100 bg-slate-50/80">
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2 min-w-0">
              <span
                class="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold shrink-0"
                :class="{
                  'bg-teal-50 text-teal-700': fact.id === 'origin',
                  'bg-rose-50 text-rose-600': fact.id === 'goal',
                  'bg-brand-50 text-brand-700': fact.id !== 'origin' && fact.id !== 'goal',
                }"
              >
                {{ fact.id }}
              </span>
              <span class="text-[11px] text-slate-400 uppercase tracking-wider">事实</span>
            </div>
            <button
              type="button"
              @click="removeFactSelection(fact.id)"
              class="text-[11px] text-slate-400 hover:text-slate-600 transition"
            >
              移除
            </button>
          </div>
        </div>
        <div class="p-4 space-y-3">
          <p class="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap break-words">{{ fact.description }}</p>
        </div>
      </article>
    </div>

    <!-- 单选事实 -->
    <section
      v-if="projects.selectedNode?.type === 'fact' && projects.selectedFactRecord && projects.selectedFacts.length <= 1"
      class="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden"
    >
      <div class="px-4 py-3 border-b border-slate-100 bg-slate-50/80">
        <div class="flex items-center gap-2">
          <span
            class="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold"
            :class="{
              'bg-teal-50 text-teal-700': projects.selectedFactRecord.id === 'origin',
              'bg-rose-50 text-rose-600': projects.selectedFactRecord.id === 'goal',
              'bg-brand-50 text-brand-700': !['origin', 'goal'].includes(projects.selectedFactRecord.id),
            }"
          >
            {{ projects.selectedFactRecord.id }}
          </span>
          <span class="text-[11px] text-slate-400 font-medium uppercase tracking-wider">事实</span>
        </div>
      </div>
      <div class="p-4 space-y-4">
        <p class="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap break-words">
          {{ projects.selectedFactRecord.description }}
        </p>
        <template v-if="projects.selectedFactProducingIntent">
          <div class="pt-4 border-t border-slate-100 space-y-3 text-xs">
            <p class="text-[10px] font-semibold text-brand-500 uppercase tracking-widest">来源意图</p>
            <div class="flex justify-between gap-3"><span class="text-slate-400">意图</span><span class="font-mono text-slate-600 break-all">{{ projects.selectedFactProducingIntent.id }}</span></div>
            <div class="flex justify-between gap-3"><span class="text-slate-400">来源</span><span class="font-mono text-slate-600 break-all">{{ projects.selectedFactProducingIntent.from.join(', ') }}</span></div>
            <div class="flex justify-between gap-3"><span class="text-slate-400">提出人</span><span class="text-slate-600 break-all">{{ projects.selectedFactProducingIntent.creator }}</span></div>
            <div class="flex justify-between gap-3"><span class="text-slate-400">执行者</span><span class="text-slate-600 break-all">{{ projects.selectedFactProducingIntent.worker || '—' }}</span></div>
            <div class="flex justify-between gap-3"><span class="text-slate-400">结案时间</span><span class="text-slate-600 break-words">{{ formatTime(projects.selectedFactProducingIntent.concluded_at || projects.selectedFactProducingIntent.created_at) }}</span></div>
          </div>
        </template>
      </div>
    </section>

    <!-- 意图 -->
    <section
      v-if="projects.selectedNode?.type === 'intent' && projects.selectedIntentRecord"
      class="rounded-2xl border border-violet-200/80 bg-white shadow-sm overflow-hidden"
    >
      <div class="px-4 py-3 border-b border-violet-100 bg-violet-50/70">
        <div class="flex items-center gap-2">
          <span class="px-2 py-0.5 rounded-md bg-violet-100 text-violet-700 text-[10px] font-mono font-bold">
            {{ projects.selectedIntentRecord.id }}
          </span>
          <span class="text-[11px] font-medium" :class="intentStatusClass(projects.selectedIntentRecord)">
            {{ intentStatusLabel(projects.selectedIntentRecord) }}
          </span>
        </div>
      </div>
      <div class="p-4 space-y-4">
        <p class="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap break-words">
          {{ projects.selectedIntentRecord.description }}
        </p>
        <div class="pt-4 border-t border-slate-100 space-y-3 text-xs">
          <div class="flex justify-between gap-3"><span class="text-slate-400">来源</span><span class="font-mono text-slate-600 break-all">{{ projects.selectedIntentRecord.from.join(', ') }}</span></div>
          <div class="flex justify-between gap-3"><span class="text-slate-400">目标</span><span class="font-mono text-slate-600 break-all">{{ projects.selectedIntentRecord.to || '—' }}</span></div>
          <div class="flex justify-between gap-3"><span class="text-slate-400">提出人</span><span class="text-slate-600 break-all">{{ projects.selectedIntentRecord.creator }}</span></div>
          <div class="flex justify-between gap-3"><span class="text-slate-400">执行者</span><span class="text-slate-600 break-all">{{ projects.selectedIntentRecord.worker || '—' }}</span></div>
          <div class="flex justify-between gap-3"><span class="text-slate-400">心跳</span><span class="text-slate-600 break-words">{{ projects.selectedIntentRecord.last_heartbeat_at ? formatTime(projects.selectedIntentRecord.last_heartbeat_at) : '—' }}</span></div>
          <div class="flex justify-between gap-3"><span class="text-slate-400">创建时间</span><span class="text-slate-600 break-words">{{ formatTime(projects.selectedIntentRecord.created_at) }}</span></div>
          <div v-if="projects.selectedIntentRecord.concluded_at" class="flex justify-between gap-3"><span class="text-slate-400">结案时间</span><span class="text-slate-600 break-words">{{ formatTime(projects.selectedIntentRecord.concluded_at) }}</span></div>
        </div>
      </div>
    </section>
  </div>

  <!-- Hints -->
  <div v-show="sideTab === 'hints'" class="flex-1 overflow-y-auto p-4 space-y-3 bg-amber-50/25">
    <div
      v-if="!projects.project || projects.project.hints.length === 0"
      class="rounded-2xl border border-dashed border-amber-200 bg-white/80 px-5 py-10 text-center shadow-sm"
    >
      <p class="text-sm text-slate-300">暂无提示</p>
    </div>
    <button
      v-for="h in projects.project?.hints || []"
      :key="h.id"
      type="button"
      @click="selectHintEntry(h.id)"
      class="w-full text-left rounded-2xl border border-amber-200/80 bg-white shadow-sm overflow-hidden transition hover:bg-amber-50/40"
    >
      <div class="px-4 py-3 border-b border-amber-100 bg-amber-50/80">
        <div class="flex items-center justify-between gap-3 text-[11px]">
          <div class="flex items-center gap-2 min-w-0">
            <span class="w-2 h-2 rounded-full bg-amber-400 shrink-0"></span>
            <span class="font-medium text-amber-800 truncate">{{ h.creator }}</span>
          </div>
          <span class="text-amber-600/80 shrink-0 tabular-nums">{{ formatTime(h.created_at) }}</span>
        </div>
      </div>
      <div class="p-4">
        <p class="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap break-words">{{ h.content }}</p>
      </div>
    </button>
  </div>

  <!-- Log -->
  <div v-show="sideTab === 'log'" class="flex-1 overflow-y-auto p-4 space-y-3">
    <p v-if="timelineEvents.length === 0" class="text-sm text-slate-300 text-center mt-12">暂无活动</p>
    <div
      v-for="entry in timelineEvents"
      :key="entry.id"
      class="flex items-stretch gap-3"
    >
      <div class="flex flex-col items-center shrink-0">
        <div class="w-2.5 h-2.5 rounded-full mt-1.5" :class="timelineEventDotClass(entry)"></div>
        <div class="w-px flex-1 bg-slate-100 mt-2" v-show="!entry.isLast"></div>
      </div>
      <button
        type="button"
        class="min-w-0 flex-1 text-left rounded-xl px-0.5 py-0.5 transition"
        :class="entryClass(entry)"
        @click="selectTimelineEntry(entry)"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-[11px] font-medium text-slate-400 tabular-nums">{{ formatTime(entry.timestamp) }}</span>
          <span
            class="px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide"
            :class="timelineEventBadgeClass(entry)"
          >
            {{ timelineEventBadge(entry) }}
          </span>
          <span class="text-[11px] text-slate-300">{{ formatTimelineDate(entry.timestamp) }}</span>
        </div>
        <p v-if="entry.title" class="text-sm text-slate-700 leading-relaxed break-words mt-1">{{ entry.title }}</p>
        <p
          v-if="entry.actor || entry.meta.length > 0"
          class="text-[11px] text-slate-400 mt-1 break-words"
        >
          {{ [entry.actor, ...entry.meta].filter(Boolean).join(' · ') }}
        </p>
      </button>
    </div>
  </div>
</template>
