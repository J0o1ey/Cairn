import type { Intent } from '@/types/api';

export type OpenIntentNodeType =
  | 'in_progress'
  | 'unclaimed'
  | 'bootstrap_running'
  | 'bootstrap_pending';

export function isBootstrapIntent(intent: Intent | null | undefined): boolean {
  if (!intent) return false;
  return (
    intent.description === 'bootstrap' &&
    intent.creator === 'dispatcher.bootstrap' &&
    Array.isArray(intent.from) &&
    intent.from.length === 1 &&
    intent.from[0] === 'origin' &&
    intent.to === null
  );
}

export function openIntentNodeType(intent: Intent): OpenIntentNodeType {
  if (isBootstrapIntent(intent)) {
    return intent.worker ? 'bootstrap_running' : 'bootstrap_pending';
  }
  return intent.worker ? 'in_progress' : 'unclaimed';
}

export function openIntentNodeLabel(intent: Intent): string {
  return isBootstrapIntent(intent) ? '启动' : '?';
}

export function openIntentNodeSize(intent: Intent): { width: number; height: number } {
  if (isBootstrapIntent(intent)) return { width: 82, height: 30 };
  return { width: 22, height: 22 };
}

export function summarizeFactLabel(fact: { id: string; description: string }): string {
  if (fact.id === 'origin') return '起点';
  if (fact.id === 'goal') return '目标';
  const normalized = (fact.description || '').replace(/\s+/g, ' ').trim();
  const chars = Array.from(normalized);
  if (chars.length <= 24) return normalized || fact.id;
  return `${chars.slice(0, 24).join('')}…`;
}
