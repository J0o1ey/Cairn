import type { ProjectDetail } from '@/types/api';

export type TimelineEventType =
  | 'project_created'
  | 'hint_added'
  | 'reason_started'
  | 'intent_declared'
  | 'intent_running'
  | 'intent_concluded'
  | 'project_completed';

export type TimelineTargetType = 'fact' | 'intent' | 'hints' | 'reason';

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  timestamp: string;
  actor: string;
  title: string;
  meta: string[];
  targetType: TimelineTargetType;
  targetId: string;
  order: number | string;
  intentId: string | null;
  producedFactId: string | null;
  sourceFactIds: string[];
  isLast?: boolean;
}

const TIMELINE_BADGE_LABELS: Record<TimelineEventType, string> = {
  project_created: '项目创建',
  hint_added: '提示',
  reason_started: '推理',
  intent_declared: '意图',
  intent_running: '执行',
  intent_concluded: '结案',
  project_completed: '完成',
};

const TIMELINE_BADGE_CLASSES: Record<TimelineEventType, string> = {
  project_created: 'bg-slate-100 text-slate-600',
  hint_added: 'bg-amber-50 text-amber-700',
  reason_started: 'bg-sky-50 text-sky-700',
  intent_declared: 'bg-violet-50 text-violet-700',
  intent_running: 'bg-amber-50 text-amber-700',
  intent_concluded: 'bg-teal-50 text-teal-700',
  project_completed: 'bg-rose-50 text-rose-700',
};

const TIMELINE_DOT_CLASSES: Record<TimelineEventType, string> = {
  project_created: 'bg-slate-400',
  hint_added: 'bg-amber-400',
  reason_started: 'bg-sky-400',
  intent_declared: 'bg-violet-400',
  intent_running: 'bg-amber-400',
  intent_concluded: 'bg-teal-400',
  project_completed: 'bg-rose-400',
};

export function timelineEventBadge(event: TimelineEvent): string {
  return TIMELINE_BADGE_LABELS[event.type] ?? '事件';
}
export function timelineEventBadgeClass(event: TimelineEvent): string {
  return TIMELINE_BADGE_CLASSES[event.type] ?? 'bg-slate-100 text-slate-600';
}
export function timelineEventDotClass(event: TimelineEvent): string {
  return TIMELINE_DOT_CLASSES[event.type] ?? 'bg-slate-300';
}

export function timelineEventIsInteractive(event: TimelineEvent | null | undefined): boolean {
  if (!event) return false;
  return ['fact', 'intent', 'hints', 'reason'].includes(event.targetType);
}

export function timelineEventTriggersGraphFocus(event: TimelineEvent | null | undefined): boolean {
  if (!event) return false;
  return event.targetType === 'fact' || event.targetType === 'intent';
}

/** 各类型事件在回放中相对于基础步长的加权（与原 Alpine 版完全一致）。*/
export const REPLAY_EVENT_WEIGHTS: Record<TimelineEventType, number> = {
  reason_started: 1.6,
  intent_declared: 1.05,
  intent_running: 0.75,
  intent_concluded: 1.6,
  project_completed: 1.6,
  project_created: 0.8,
  hint_added: 0.8,
};

export function replayEventWeight(event: TimelineEvent | null | undefined): number {
  if (!event) return 1;
  return REPLAY_EVENT_WEIGHTS[event.type] ?? 1;
}

export function replayEventDurationMs(event: TimelineEvent | null | undefined, baseStepMs: number): number {
  const base = Number.isFinite(baseStepMs) && baseStepMs > 0 ? baseStepMs : 1100;
  return Math.round(base * replayEventWeight(event));
}

/** 累计前 index 个事件的加权时长，单位毫秒。*/
export function replayTimelineElapsedDurationMs(
  events: TimelineEvent[],
  index: number,
  baseStepMs: number,
): number {
  let elapsed = 0;
  const upper = Math.min(events.length, Math.max(0, index));
  for (let i = 0; i < upper; i += 1) {
    elapsed += replayEventDurationMs(events[i], baseStepMs);
  }
  return elapsed;
}

export function formatDurationMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function buildTimelineEvents(project: ProjectDetail | null): TimelineEvent[] {
  if (!project) return [];
  const events: TimelineEvent[] = [];
  let order = 0;
  const facts = project.facts;
  const origin = facts.find(f => f.id === 'origin') ?? null;
  const goal = facts.find(f => f.id === 'goal') ?? null;

  events.push({
    id: `project-created-${project.project.id}`,
    type: 'project_created',
    timestamp: project.project.created_at,
    actor: 'system',
    title: project.project.title,
    meta: [origin ? origin.description : null, goal ? `目标：${goal.description}` : null].filter(
      (v): v is string => Boolean(v),
    ),
    targetType: 'fact',
    targetId: 'origin',
    order: order++,
    intentId: null,
    producedFactId: null,
    sourceFactIds: [],
  });

  for (const hint of project.hints) {
    events.push({
      id: `hint-${hint.id}`,
      type: 'hint_added',
      timestamp: hint.created_at,
      actor: hint.creator,
      title: hint.content,
      meta: [],
      targetType: 'hints',
      targetId: hint.id,
      order: order++,
      intentId: null,
      producedFactId: null,
      sourceFactIds: [],
    });
  }

  for (const intent of project.intents) {
    events.push({
      id: `intent-declared-${intent.id}`,
      type: 'intent_declared',
      timestamp: intent.created_at,
      actor: intent.creator,
      title: intent.description,
      meta: [intent.id, `来源 ${intent.from.join(', ')}`],
      targetType: 'intent',
      targetId: intent.id,
      order: order++,
      intentId: intent.id,
      producedFactId: null,
      sourceFactIds: [...intent.from],
    });

    if (!intent.concluded_at || !intent.to) continue;

    if (intent.to === 'goal') {
      events.push({
        id: `project-completed-${intent.id}`,
        type: 'project_completed',
        timestamp: intent.concluded_at,
        actor: intent.worker || intent.creator,
        title: intent.description,
        meta: [intent.id, `来源 ${intent.from.join(', ')}`],
        targetType: 'fact',
        targetId: 'goal',
        order: order++,
        intentId: intent.id,
        producedFactId: 'goal',
        sourceFactIds: [...intent.from],
      });
      continue;
    }

    const fact = facts.find(f => f.id === intent.to);
    events.push({
      id: `intent-concluded-${intent.id}`,
      type: 'intent_concluded',
      timestamp: intent.concluded_at,
      actor: intent.worker || intent.creator,
      title: fact ? fact.description : intent.description,
      meta: [intent.id, `产生 ${intent.to}`, `来源 ${intent.from.join(', ')}`],
      targetType: 'fact',
      targetId: intent.to,
      order: order++,
      intentId: intent.id,
      producedFactId: intent.to,
      sourceFactIds: [...intent.from],
    });
  }

  events.sort((a, b) => {
    const ta = a.timestamp || '';
    const tb = b.timestamp || '';
    if (ta === tb) return Number(a.order) - Number(b.order);
    return ta.localeCompare(tb);
  });

  if (events.length > 0) {
    events[events.length - 1].isLast = true;
  }
  return events;
}
