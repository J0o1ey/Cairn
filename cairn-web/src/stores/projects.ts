import { defineStore } from 'pinia';
import { api } from '@/api/client';
import type {
  CompleteRequest,
  ConcludeResponse,
  CreateHintRequest,
  CreateIntentRequest,
  CreateProjectRequest,
  Fact,
  Hint,
  Intent,
  ProjectDetail,
  ProjectMeta,
  ProjectStatus,
  ProjectSummary,
  ReopenRequest,
  ReopenResponse,
  Settings,
} from '@/types/api';

interface SelectedNode {
  type: 'fact' | 'intent';
  id: string;
}

interface ProjectsState {
  projects: ProjectSummary[];
  project: ProjectDetail | null;
  selectedProjectId: string;
  selectedNode: SelectedNode | null;
  selectedFacts: string[];
  selectedTimelineEntryId: string | null;
  pollTimer: ReturnType<typeof setInterval> | null;
  polling: boolean;
  isStoppingAllProjects: boolean;
  settings: Settings;
}

export const useProjectsStore = defineStore('projects', {
  state: (): ProjectsState => ({
    projects: [],
    project: null,
    selectedProjectId: '',
    selectedNode: null,
    selectedFacts: [],
    selectedTimelineEntryId: null,
    pollTimer: null,
    polling: true,
    isStoppingAllProjects: false,
    settings: { intent_timeout: 5, reason_timeout: 5 },
  }),
  getters: {
    countByStatus: state => (status: ProjectStatus) =>
      state.projects.filter(p => p.status === status).length,
    hasActiveProjects: state => state.projects.some(p => p.status === 'active'),
    projectIsActive: state => state.project?.project.status === 'active',
    selectedFactRecords(): Fact[] {
      if (!this.project) return [];
      const ids = new Set(this.selectedFacts);
      return this.project.facts.filter(f => ids.has(f.id));
    },
    selectedFactRecord(): Fact | null {
      if (!this.project) return null;
      const id = this.selectedNode?.type === 'fact' ? this.selectedNode.id : null;
      if (!id) return null;
      return this.project.facts.find(f => f.id === id) ?? null;
    },
    selectedFactProducingIntent(): Intent | null {
      const fact = this.selectedFactRecord;
      if (!fact || !this.project) return null;
      return this.project.intents.find(i => i.to === fact.id) ?? null;
    },
    selectedIntentRecord(): Intent | null {
      if (!this.project) return null;
      const id = this.selectedNode?.type === 'intent' ? this.selectedNode.id : null;
      if (!id) return null;
      return this.project.intents.find(i => i.id === id) ?? null;
    },
    selectedOpenIntentRecord(): Intent | null {
      const i = this.selectedIntentRecord;
      return i && !i.concluded_at ? i : null;
    },
    canActOnSelectedFacts(state): boolean {
      return (
        state.project?.project.status === 'active' &&
        state.selectedFacts.length > 0 &&
        !state.selectedFacts.includes('goal')
      );
    },
    projectCanWriteHints(state): boolean {
      const status = state.project?.project.status;
      return Boolean(status && ['active', 'stopped', 'completed'].includes(status));
    },
  },
  actions: {
    selectFact(id: string) {
      this.selectedNode = { type: 'fact', id };
      this.selectedFacts = [id];
      this.selectedTimelineEntryId = null;
    },
    toggleSelectFact(id: string) {
      const idx = this.selectedFacts.indexOf(id);
      if (idx >= 0) {
        this.selectedFacts.splice(idx, 1);
        if (this.selectedFacts.length === 0) {
          this.selectedNode = null;
        } else {
          this.selectedNode = { type: 'fact', id: this.selectedFacts[this.selectedFacts.length - 1] };
        }
      } else {
        this.selectedFacts.push(id);
        this.selectedNode = { type: 'fact', id };
      }
      this.selectedTimelineEntryId = null;
    },
    selectIntent(id: string) {
      this.selectedNode = { type: 'intent', id };
      this.selectedFacts = [];
      this.selectedTimelineEntryId = null;
    },
    clearSelection() {
      this.selectedNode = null;
      this.selectedFacts = [];
      this.selectedTimelineEntryId = null;
    },

    async loadProjects() {
      try {
        const data = await api<ProjectSummary[]>('GET', '/projects');
        if (Array.isArray(data)) this.projects = data;
      } catch (e) {
        console.error(e);
      }
    },
    async loadProject(id: string) {
      try {
        const data = await api<ProjectDetail>('GET', `/projects/${id}`);
        if (data) this.project = data;
      } catch (e) {
        console.error(e);
        throw e;
      }
    },
    async loadSettings() {
      try {
        const s = await api<Settings>('GET', '/settings');
        if (s) this.settings = s;
      } catch (e) {
        console.error(e);
      }
    },
    async saveSettings(payload: Settings) {
      const s = await api<Settings>('PUT', '/settings', payload);
      if (s) this.settings = s;
      return this.settings;
    },

    async createProject(payload: CreateProjectRequest): Promise<ProjectDetail> {
      const data = await api<ProjectDetail>('POST', '/projects', payload);
      if (!data) throw new Error('创建失败');
      await this.loadProjects();
      return data;
    },
    async deleteProject(projectId: string) {
      await api('DELETE', `/projects/${projectId}`);
      await this.loadProjects();
    },
    async renameProject(projectId: string, title: string): Promise<ProjectMeta> {
      const data = await api<ProjectMeta>('PUT', `/projects/${projectId}/title`, { title });
      if (!data) throw new Error('重命名失败');
      if (this.project && this.project.project.id === projectId) {
        this.project = { ...this.project, project: data };
      }
      await this.loadProjects();
      return data;
    },
    async setProjectStatus(projectId: string, status: 'active' | 'stopped'): Promise<ProjectMeta> {
      const data = await api<ProjectMeta>('PUT', `/projects/${projectId}/status`, { status });
      if (!data) throw new Error('状态更新失败');
      if (this.project && this.project.project.id === projectId) {
        this.project = { ...this.project, project: data };
      }
      await this.loadProjects();
      return data;
    },
    async stopAllActiveProjects() {
      if (this.isStoppingAllProjects) return;
      this.isStoppingAllProjects = true;
      try {
        const actives = this.projects.filter(p => p.status === 'active').map(p => p.id);
        await Promise.all(actives.map(id => this.setProjectStatus(id, 'stopped').catch(() => undefined)));
        await this.loadProjects();
      } finally {
        this.isStoppingAllProjects = false;
      }
    },
    async reopenProject(projectId: string, payload: ReopenRequest): Promise<ReopenResponse> {
      const data = await api<ReopenResponse>('POST', `/projects/${projectId}/reopen`, payload);
      if (!data) throw new Error('重新打开失败');
      await this.loadProjects();
      if (this.selectedProjectId === projectId && this.project) {
        await this.loadProject(projectId);
      }
      return data;
    },

    async createIntent(projectId: string, payload: CreateIntentRequest): Promise<Intent> {
      const data = await api<Intent>('POST', `/projects/${projectId}/intents`, payload);
      if (!data) throw new Error('创建意图失败');
      if (this.project?.project.id === projectId) {
        await this.loadProject(projectId);
      }
      return data;
    },
    async heartbeatIntent(projectId: string, intentId: string, worker: string): Promise<Intent> {
      const data = await api<Intent>(
        'POST',
        `/projects/${projectId}/intents/${intentId}/heartbeat`,
        { worker },
      );
      if (!data) throw new Error('心跳失败');
      if (this.project?.project.id === projectId) await this.loadProject(projectId);
      return data;
    },
    async releaseIntent(projectId: string, intentId: string, worker: string): Promise<Intent> {
      const data = await api<Intent>(
        'POST',
        `/projects/${projectId}/intents/${intentId}/release`,
        { worker },
      );
      if (!data) throw new Error('释放失败');
      if (this.project?.project.id === projectId) await this.loadProject(projectId);
      return data;
    },
    async concludeIntent(
      projectId: string,
      intentId: string,
      worker: string,
      description: string,
    ): Promise<ConcludeResponse> {
      const data = await api<ConcludeResponse>(
        'POST',
        `/projects/${projectId}/intents/${intentId}/conclude`,
        { worker, description },
      );
      if (!data) throw new Error('结案失败');
      if (this.project?.project.id === projectId) await this.loadProject(projectId);
      return data;
    },
    async completeProject(projectId: string, payload: CompleteRequest): Promise<Intent> {
      const data = await api<Intent>('POST', `/projects/${projectId}/complete`, payload);
      if (!data) throw new Error('完成项目失败');
      if (this.project?.project.id === projectId) await this.loadProject(projectId);
      await this.loadProjects();
      return data;
    },
    async addHint(projectId: string, payload: CreateHintRequest): Promise<Hint> {
      const data = await api<Hint>('POST', `/projects/${projectId}/hints`, payload);
      if (!data) throw new Error('添加提示失败');
      if (this.project?.project.id === projectId) await this.loadProject(projectId);
      return data;
    },

    startPolling(intervalMs = 5000) {
      this.stopPolling();
      this.pollTimer = setInterval(async () => {
        if (!this.polling) return;
        if (this.selectedProjectId && this.project) {
          await this.loadProject(this.selectedProjectId).catch(() => undefined);
        } else {
          await this.loadProjects();
        }
      }, intervalMs);
    },
    stopPolling() {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    },
    setPolling(value: boolean) {
      this.polling = value;
    },
  },
});
