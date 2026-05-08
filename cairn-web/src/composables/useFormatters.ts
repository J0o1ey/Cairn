import type { ProjectStatus, ProjectReason } from '@/types/api';

const STATUS_LABEL: Record<ProjectStatus, string> = {
  active: '进行中',
  stopped: '已暂停',
  completed: '已完成',
};

const TRIGGER_LABEL: Record<string, string> = {
  heartbeat: '心跳',
  trigger: '触发',
  manual: '手动',
  timer: '定时',
};

export function projectStatusLabel(status: string | null | undefined): string {
  if (!status) return '';
  return STATUS_LABEL[status as ProjectStatus] ?? status;
}

export function projectStatusBadgeClass(status: string | null | undefined): string {
  switch (status) {
    case 'active':
      return 'bg-teal-50 text-teal-600';
    case 'stopped':
      return 'bg-amber-50 text-amber-700';
    case 'completed':
      return 'bg-slate-100 text-slate-500';
    default:
      return 'bg-slate-100 text-slate-500';
  }
}

export function reasonTriggerLabel(trigger: string | null | undefined): string {
  if (!trigger) return '';
  return TRIGGER_LABEL[trigger] ?? trigger;
}

export function reasonBadgeText(reason: ProjectReason | null | undefined, compact = false): string {
  if (!reason) return '';
  if (compact) return `推理 · ${reason.worker}`;
  const triggerLabel = reasonTriggerLabel(reason.trigger);
  const trigger = triggerLabel ? `（${triggerLabel}）` : '';
  return `推理中 · ${reason.worker}${trigger}`;
}

export function workingIntentBadgeText(count: number): string {
  return `探索中 · ${count}`;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  // 后端使用 ISO；早期可能没有时区信息，按 UTC 处理。
  const normalized = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`;
  const dt = new Date(normalized);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function formatTime(value: string | null | undefined): string {
  const dt = parseDate(value);
  if (!dt) return '—';
  return dt.toLocaleTimeString('zh-CN', { hour12: false });
}

export function formatDate(value: string | null | undefined): string {
  const dt = parseDate(value);
  if (!dt) return '—';
  return dt.toLocaleDateString('zh-CN');
}

export function formatTimelineDate(value: string | null | undefined): string {
  const dt = parseDate(value);
  if (!dt) return '';
  const today = new Date();
  if (
    dt.getFullYear() === today.getFullYear() &&
    dt.getMonth() === today.getMonth() &&
    dt.getDate() === today.getDate()
  ) {
    return '';
  }
  return dt.toLocaleDateString('zh-CN');
}
