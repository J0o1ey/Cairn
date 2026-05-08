<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import { usePrefsStore } from '@/stores/prefs';
import { useProjectsStore } from '@/stores/projects';
import Toast from '@/components/Toast.vue';
import ExportPreviewModal from '@/components/modals/ExportPreviewModal.vue';
import LocalPrefsModal from '@/components/modals/LocalPrefsModal.vue';
import SettingsModal from '@/components/modals/SettingsModal.vue';
import DeleteModal from '@/components/modals/DeleteModal.vue';

const prefs = usePrefsStore();
const projects = useProjectsStore();

onMounted(async () => {
  prefs.load();
  await projects.loadProjects();
  await projects.loadSettings();
  projects.startPolling();
});

onBeforeUnmount(() => {
  projects.stopPolling();
});
</script>

<template>
  <div class="h-full w-full flex flex-col" :class="{ 'select-none cursor-col-resize': prefs.isResizingPanel }">
    <router-view />
    <Toast />
    <LocalPrefsModal />
    <SettingsModal />
    <DeleteModal />
    <ExportPreviewModal />
  </div>
</template>
