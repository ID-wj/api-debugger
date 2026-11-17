<script setup lang="ts">
import type { HttpMethod } from '@shared/protocol';

interface RequestTabItem {
  id: string;
  method: HttpMethod;
  label: string;
  title: string;
  pending: boolean;
}

const props = defineProps<{
  items: RequestTabItem[];
  active: string;
}>();

const emit = defineEmits<{
  (event: 'activate', id: string): void;
  (event: 'close', id: string): void;
  (event: 'create'): void;
}>();
</script>

<template>
  <div class="request-tabs" role="tablist">
    <div
      v-for="item in props.items"
      :key="item.id"
      class="request-tab"
      :class="{ active: item.id === props.active }"
      role="tab"
      :aria-selected="item.id === props.active"
      :title="item.title"
      @click="emit('activate', item.id)"
      @auxclick.middle.prevent="emit('close', item.id)"
    >
      <span class="method-badge">{{ item.method }}</span>
      <span class="request-tab-label">{{ item.label }}</span>
      <span v-if="item.pending" class="request-tab-pending" title="请求进行中">●</span>
      <button
        v-if="props.items.length > 1"
        class="tab-close"
        title="关闭标签"
        @click.stop="emit('close', item.id)"
      >
        ×
      </button>
    </div>
    <button class="icon-btn new-tab" title="新建请求" @click="emit('create')">＋</button>
  </div>
</template>
