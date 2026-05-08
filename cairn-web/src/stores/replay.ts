import { defineStore } from 'pinia';
import { api } from '@/api/client';
import type { ProjectDetail, Hint, Fact } from '@/types/api';
import {
  buildTimelineEvents,
  replayEventWeight,
  type TimelineEvent,
} from '@/composables/useTimeline';
import { useProjectsStore } from './projects';

interface ReplayFrame {
  event: TimelineEvent;
  project: ProjectDetail;
}

interface ReplayState {
  active: boolean;
  playing: boolean;
  /** 单步基础时长（毫秒）。原版用字符串以适配 select 双向绑定。*/
  stepMs: string;
  frameIndex: number;
  frames: ReplayFrame[];
  visibleEvents: TimelineEvent[];
  sourceProject: ProjectDetail | null;
  timer: ReturnType<typeof setTimeout> | null;
}

function clone<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      /* fallthrough */
    }
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

const weight = replayEventWeight;

/**
 * 给定原始 sourceProject，构造初始（仅含 origin/goal、无 intents/hints）的项目快照。
 */
function buildInitialReplayProject(source: ProjectDetail): ProjectDetail {
  const origin = source.facts.find(f => f.id === 'origin');
  const goal = source.facts.find(f => f.id === 'goal');
  return {
    project: { ...clone(source.project), status: 'active', reason: null },
    facts: [origin, goal].filter((f): f is Fact => Boolean(f)).map(clone),
    intents: [],
    hints: [],
  };
}

/**
 * 将基础时间线事件扩展为「reason_started → intent_declared → intent_running → intent_concluded」
 * 的回放序列（与原 Alpine 实现 buildReplayFrames 完全一致）。
 */
function expandReplayEvents(source: ProjectDetail, baseEvents: TimelineEvent[]): TimelineEvent[] {
  const sourceIntents = new Map(source.intents.map(i => [i.id, i] as const));
  const replayEvents: TimelineEvent[] = [];
  for (const event of baseEvents) {
    if (event.type !== 'intent_declared' || !event.intentId) {
      replayEvents.push(clone(event));
      continue;
    }
    const sourceIntent = sourceIntents.get(event.intentId);
    replayEvents.push({
      id: `reason-started-${event.intentId}`,
      type: 'reason_started',
      timestamp: sourceIntent?.created_at || event.timestamp,
      actor: sourceIntent?.creator || event.actor || 'reasoner',
      title: sourceIntent?.description || event.title,
      meta: [
        sourceIntent?.id || event.intentId,
        `来源 ${(sourceIntent?.from || event.sourceFactIds || []).join(', ')}`,
      ],
      targetType: 'reason',
      targetId: sourceIntent?.id || event.intentId,
      order: `${event.order}.reason`,
      intentId: sourceIntent?.id || event.intentId,
      producedFactId: null,
      sourceFactIds: [...(sourceIntent?.from || event.sourceFactIds || [])],
    });
    replayEvents.push(clone(event));
    if (!sourceIntent?.worker) continue;
    replayEvents.push({
      id: `intent-running-${sourceIntent.id}`,
      type: 'intent_running',
      timestamp: sourceIntent.last_heartbeat_at || sourceIntent.created_at,
      actor: sourceIntent.worker,
      title: sourceIntent.description,
      meta: [sourceIntent.id, `执行者 ${sourceIntent.worker}`],
      targetType: 'intent',
      targetId: sourceIntent.id,
      order: `${event.order}.run`,
      intentId: sourceIntent.id,
      producedFactId: null,
      sourceFactIds: [...sourceIntent.from],
    });
  }
  return replayEvents;
}

/**
 * 将单个事件应用到回放中累积的 project 快照（原地修改）。
 */
function applyReplayEvent(
  replayProject: ProjectDetail,
  source: ProjectDetail,
  event: TimelineEvent,
): void {
  const sourceIntent = event.intentId
    ? source.intents.find(i => i.id === event.intentId) || null
    : null;

  if (event.type === 'project_created') {
    replayProject.project.title = source.project.title;
    replayProject.project.status = 'active';
    return;
  }
  if (event.type === 'hint_added') {
    const hint = source.hints.find(h => h.id === event.targetId);
    if (hint && !replayProject.hints.some(h => h.id === hint.id)) {
      replayProject.hints.push(clone<Hint>(hint));
    }
    return;
  }
  if (event.type === 'reason_started') {
    replayProject.project.reason = {
      worker: event.actor || 'reasoner',
      trigger: 'new_facts',
      started_at: event.timestamp,
      last_heartbeat_at: event.timestamp,
    };
    return;
  }
  if (event.type === 'intent_declared') {
    if (!sourceIntent) return;
    replayProject.project.reason = null;
    if (!replayProject.intents.some(i => i.id === sourceIntent.id)) {
      replayProject.intents.push({
        id: sourceIntent.id,
        from: [...sourceIntent.from],
        to: null,
        description: sourceIntent.description,
        creator: sourceIntent.creator,
        worker: null,
        last_heartbeat_at: null,
        created_at: sourceIntent.created_at,
        concluded_at: null,
      });
    }
    return;
  }
  if (event.type === 'intent_running') {
    if (!sourceIntent) return;
    const existing = replayProject.intents.find(i => i.id === sourceIntent.id);
    if (!existing) return;
    existing.worker = sourceIntent.worker || sourceIntent.creator;
    existing.last_heartbeat_at = sourceIntent.last_heartbeat_at || sourceIntent.created_at;
    return;
  }
  if (event.type !== 'intent_concluded' && event.type !== 'project_completed') return;
  if (!sourceIntent) return;

  const existing = replayProject.intents.find(i => i.id === sourceIntent.id);
  if (existing) {
    existing.to = sourceIntent.to;
    existing.worker = sourceIntent.worker || sourceIntent.creator;
    existing.last_heartbeat_at = sourceIntent.last_heartbeat_at;
    existing.concluded_at = sourceIntent.concluded_at;
  }
  if (event.type === 'project_completed') {
    replayProject.project.status = 'completed';
    return;
  }
  const produced = source.facts.find(f => f.id === sourceIntent.to);
  if (produced && !replayProject.facts.some(f => f.id === produced.id)) {
    replayProject.facts.push(clone<Fact>(produced));
  }
}

function buildFrames(source: ProjectDetail, baseEvents: TimelineEvent[]): ReplayFrame[] {
  const replayEvents = expandReplayEvents(source, baseEvents);
  const replayProject = buildInitialReplayProject(source);
  const frames: ReplayFrame[] = [];
  for (const event of replayEvents) {
    applyReplayEvent(replayProject, source, event);
    frames.push({ event: clone(event), project: clone(replayProject) });
  }
  if (frames.length > 0) {
    const tail = frames[frames.length - 1];
    tail.project.project.status = source.project.status;
    tail.project.project.reason = clone(source.project.reason);
  }
  return frames;
}

export const useReplayStore = defineStore('replay', {
  state: (): ReplayState => ({
    active: false,
    playing: false,
    stepMs: '1100',
    frameIndex: -1,
    frames: [],
    visibleEvents: [],
    sourceProject: null,
    timer: null,
  }),
  getters: {
    progressLabel(state): string {
      if (!state.active || state.frames.length === 0) return '回放';
      const idx = Math.min(state.frameIndex + 1, state.frames.length);
      return `回放 ${idx} / ${state.frames.length}`;
    },
  },
  actions: {
    /** 启动指定项目的回放：拉取最新快照、构帧、立即播放第一帧。 */
    async start(projectId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
      if (!projectId || this.active) return { ok: false, reason: 'already_active' };
      let source: ProjectDetail;
      try {
        const data = await api<ProjectDetail>('GET', `/projects/${projectId}`);
        if (!data) return { ok: false, reason: 'no_project' };
        source = data;
      } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : '加载失败' };
      }
      const baseEvents = buildTimelineEvents(source);
      const frames = buildFrames(source, baseEvents);
      if (frames.length === 0) return { ok: false, reason: '暂无可回放的时间线' };

      this.stopTimer();
      this.frames = frames;
      this.sourceProject = source;
      this.frameIndex = -1;
      this.visibleEvents = [];
      this.active = true;
      this.playing = true;

      const projects = useProjectsStore();
      projects.setPolling(false);
      projects.clearSelection();

      this.applyFrame(0);
      this.scheduleTick();
      return { ok: true };
    },

    /** 应用第 i 帧：替换 projects.project 为该帧累积出的 project，并重算 visibleEvents。 */
    applyFrame(frameIndex: number) {
      if (!this.active) return;
      const frame = this.frames[frameIndex];
      if (!frame) return;
      this.frameIndex = frameIndex;
      const projects = useProjectsStore();
      projects.project = clone(frame.project);
      // 时间线侧边栏仅展示真实事件（不暴露 reason_started 中间过渡）
      const visible = this.frames
        .slice(0, frameIndex + 1)
        .map(f => clone(f.event))
        .filter(e => e.type !== 'reason_started');
      visible.forEach((e, i, arr) => {
        e.isLast = i === arr.length - 1;
      });
      this.visibleEvents = visible;
    },

    advance() {
      if (!this.active) return;
      if (this.frameIndex >= this.frames.length - 1) {
        this.playing = false;
        this.stopTimer();
        return;
      }
      this.applyFrame(this.frameIndex + 1);
      this.scheduleTick();
    },

    togglePlayback() {
      if (!this.active) return;
      if (this.playing) {
        this.playing = false;
        this.stopTimer();
        return;
      }
      if (this.frameIndex >= this.frames.length - 1) {
        this.restart();
        return;
      }
      this.playing = true;
      this.scheduleTick();
    },

    restart() {
      if (!this.active || this.frames.length === 0) return;
      this.stopTimer();
      const projects = useProjectsStore();
      projects.clearSelection();
      this.playing = true;
      this.applyFrame(0);
      this.scheduleTick();
    },

    /** 退出回放：重置状态，恢复轮询并刷新真实项目数据。 */
    async exit(reloadProjectId?: string) {
      if (!this.active) return;
      this.stopTimer();
      const stepMs = this.stepMs;
      this.active = false;
      this.playing = false;
      this.frameIndex = -1;
      this.frames = [];
      this.visibleEvents = [];
      this.sourceProject = null;
      this.stepMs = stepMs;
      const projects = useProjectsStore();
      projects.setPolling(true);
      if (reloadProjectId) {
        try {
          await projects.loadProject(reloadProjectId);
        } catch {
          /* ignore */
        }
      }
    },

    setSpeed(value: string) {
      this.stepMs = value;
      if (this.active && this.playing) {
        this.stopTimer();
        this.scheduleTick();
      }
    },

    scheduleTick() {
      if (!this.active || !this.playing) return;
      if (this.frameIndex >= this.frames.length - 1) {
        this.playing = false;
        return;
      }
      this.stopTimer();
      const current = this.frames[this.frameIndex];
      const base = Number(this.stepMs) || 1100;
      const delay = Math.round(base * weight(current?.event));
      this.timer = setTimeout(() => this.advance(), delay);
    },

    stopTimer() {
      if (!this.timer) return;
      clearTimeout(this.timer);
      this.timer = null;
    },
  },
});

export type { ReplayFrame, ReplayState };
