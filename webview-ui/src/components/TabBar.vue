<script setup lang="ts">
defineProps<{
  tabs: Array<{ id: string; label: string; badge?: number }>;
  active: string;
}>();

const emit = defineEmits<{
  (event: 'update:active', value: string): void;
}>();
</script>

<template>
  <div class="tabs">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      class="tab"
      :class="{ active: tab.id === active }"
      @click="emit('update:active', tab.id)"
    >
      {{ tab.label }}
      <span v-if="tab.badge" class="tab-badge">{{ tab.badge }}</span>
    </button>
  </div>
</template>
