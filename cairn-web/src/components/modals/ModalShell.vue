<script setup lang="ts">
defineProps<{
  show: boolean;
  maxWidth?: string;
}>();
defineEmits<{
  (e: 'close'): void;
}>();
</script>

<template>
  <transition name="modal">
    <div
      v-if="show"
      class="fixed inset-0 z-50 flex items-center justify-center overlay"
      @click.self="$emit('close')"
    >
      <div
        class="bg-white rounded-2xl shadow-2xl w-full mx-4 border border-slate-200/60 overflow-hidden"
        :class="maxWidth || 'max-w-lg'"
        @click.stop
      >
        <slot />
      </div>
    </div>
  </transition>
</template>
