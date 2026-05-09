import { defineStore } from 'pinia';

export type ToastType = 'info' | 'error';
export type ExportTab = 'yaml' | 'timeline' | 'report';

interface Toast {
  show: boolean;
  message: string;
  type: ToastType;
  /** 用于强制重启 transition */
  key: number;
}

interface DeleteConfirm {
  id: string;
  title: string;
}

interface ExportPreview {
  show: boolean;
  tab: ExportTab;
  projectId: string;
  title: string;
  /** YAML / Timeline / Markdown 报告 共用的源文本（用于"复制"按钮） */
  text: string;
  /** YAML / Timeline 走 v-html 的预渲染高亮 HTML；report Tab 不使用 */
  html: string;
  /** report Tab 使用的原始 markdown，由 MarkdownView 组件渲染 */
  markdown: string;
  loading: boolean;
}

interface UiState {
  toast: Toast;
  toastTimer: ReturnType<typeof setTimeout> | null;
  showNewProject: boolean;
  showLocalPrefs: boolean;
  showSettings: boolean;
  showDelete: boolean;
  deleteConfirm: DeleteConfirm;
  isDeletingProject: boolean;
  exportPreview: ExportPreview;
}

export const useUiStore = defineStore('ui', {
  state: (): UiState => ({
    toast: { show: false, message: '', type: 'info', key: 0 },
    toastTimer: null,
    showNewProject: false,
    showLocalPrefs: false,
    showSettings: false,
    showDelete: false,
    deleteConfirm: { id: '', title: '' },
    isDeletingProject: false,
    exportPreview: {
      show: false,
      tab: 'yaml',
      projectId: '',
      title: '',
      text: '',
      html: '',
      markdown: '',
      loading: false,
    },
  }),
  actions: {
    showToast(message: string, type: ToastType = 'info') {
      if (this.toastTimer) clearTimeout(this.toastTimer);
      this.toast = { show: true, message, type, key: this.toast.key + 1 };
      this.toastTimer = setTimeout(() => {
        this.toast.show = false;
      }, 3000);
    },
    requestDelete(id: string, title: string) {
      if (!id) return;
      this.deleteConfirm = { id, title };
      this.showDelete = true;
    },
    closeDelete(force = false) {
      if (this.isDeletingProject && !force) return;
      this.showDelete = false;
      this.deleteConfirm = { id: '', title: '' };
    },
    closeExportPreview() {
      this.exportPreview.show = false;
    },
    openExportPreview(payload: {
      projectId: string;
      title: string;
      tab: ExportTab;
    }) {
      this.exportPreview = {
        show: true,
        tab: payload.tab,
        projectId: payload.projectId,
        title: payload.title,
        text: '',
        html: '',
        markdown: '',
        loading: true,
      };
    },
    setExportPreviewContent(text: string, html: string, markdown = '') {
      this.exportPreview.text = text;
      this.exportPreview.html = html;
      this.exportPreview.markdown = markdown;
      this.exportPreview.loading = false;
    },
    setExportPreviewTab(tab: ExportTab) {
      this.exportPreview.tab = tab;
      this.exportPreview.loading = true;
    },
  },
});
