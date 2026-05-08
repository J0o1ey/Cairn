import { defineStore } from 'pinia';

export type LayoutMode =
  | 'dagre_tb'
  | 'dagre_lr'
  | 'klay_tb'
  | 'klay_lr'
  | 'elk_tb'
  | 'elk_lr';

const VALID_MODES: LayoutMode[] = [
  'dagre_tb',
  'dagre_lr',
  'klay_tb',
  'klay_lr',
  'elk_tb',
  'elk_lr',
];

const STORAGE_PREFS = 'cairn.localPrefs';
const STORAGE_PANEL_WIDTH = 'cairn.sidePanelWidth';

interface LocalPrefs {
  actor_name: string;
  layout_mode: LayoutMode;
}

interface PrefsState {
  localPrefs: LocalPrefs;
  sidePanelWidth: number;
  isResizingPanel: boolean;
}

export const usePrefsStore = defineStore('prefs', {
  state: (): PrefsState => ({
    localPrefs: { actor_name: 'Human', layout_mode: 'dagre_tb' },
    sidePanelWidth: 320,
    isResizingPanel: false,
  }),
  getters: {
    actorName: state => state.localPrefs.actor_name.trim() || 'Human',
    layoutMode: state => state.localPrefs.layout_mode,
    layoutEngine: state => {
      const mode = state.localPrefs.layout_mode;
      if (mode.startsWith('elk')) return 'elk' as const;
      if (mode.startsWith('klay')) return 'klay' as const;
      return 'dagre' as const;
    },
    layoutDirection: state => (state.localPrefs.layout_mode.endsWith('_lr') ? 'LR' : 'TB'),
  },
  actions: {
    isValidLayoutMode(mode: string): mode is LayoutMode {
      return (VALID_MODES as string[]).includes(mode);
    },
    load() {
      try {
        const raw = localStorage.getItem(STORAGE_PREFS);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<LocalPrefs> & { layout_dir?: string };
          if (typeof parsed.actor_name === 'string') {
            this.localPrefs.actor_name = parsed.actor_name;
          }
          if (parsed.layout_mode && this.isValidLayoutMode(parsed.layout_mode)) {
            this.localPrefs.layout_mode = parsed.layout_mode;
          } else if (parsed.layout_dir === 'LR') {
            this.localPrefs.layout_mode = 'dagre_lr';
          } else if (parsed.layout_dir === 'TB') {
            this.localPrefs.layout_mode = 'dagre_tb';
          }
        }
        const widthRaw = localStorage.getItem(STORAGE_PANEL_WIDTH);
        if (widthRaw !== null) {
          const w = Number(widthRaw);
          if (Number.isFinite(w)) this.sidePanelWidth = w;
        }
      } catch (e) {
        console.error(e);
      }
      if (!this.localPrefs.actor_name.trim()) this.localPrefs.actor_name = 'Human';
      if (!this.isValidLayoutMode(this.localPrefs.layout_mode)) {
        this.localPrefs.layout_mode = 'dagre_tb';
      }
    },
    save() {
      try {
        localStorage.setItem(STORAGE_PREFS, JSON.stringify(this.localPrefs));
      } catch (e) {
        console.error(e);
      }
    },
    saveSidePanelWidth() {
      try {
        localStorage.setItem(STORAGE_PANEL_WIDTH, String(this.sidePanelWidth));
      } catch (e) {
        console.error(e);
      }
    },
    setSidePanelWidth(width: number) {
      this.sidePanelWidth = width;
      this.saveSidePanelWidth();
    },
    setActor(name: string) {
      this.localPrefs.actor_name = name;
    },
    setLayoutMode(mode: LayoutMode) {
      this.localPrefs.layout_mode = mode;
    },
  },
});
