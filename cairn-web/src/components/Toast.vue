<script setup lang="ts">
import { useUiStore } from '@/stores/ui';
const ui = useUiStore();
</script>

<template>
  <transition name="toast">
    <div
      v-if="ui.toast.show"
      :key="ui.toast.key"
      class="fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium"
      :class="ui.toast.type === 'error' ? 'bg-red-500 text-white' : 'bg-slate-800 text-white'"
    >
      {{ ui.toast.message }}
    </div>
  </transition>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 220ms ease,
    transform 220ms ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
