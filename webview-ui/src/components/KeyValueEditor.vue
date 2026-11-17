<script setup lang="ts">
import { computed, ref } from 'vue';
import { newId } from '@shared/protocol';
import type { KeyValueItem } from '@shared/protocol';

const props = defineProps<{
  items: KeyValueItem[];
  addLabel: string;
  bulkEnabled?: boolean;
}>();

const emit = defineEmits<{
  (event: 'update:items', items: KeyValueItem[]): void;
}>();

const bulk = ref(false);
const bulkText = ref('');

const activeCount = computed(() => props.items.filter((item) => item.enabled && item.key.trim()).length);

function addItem(): void {
  emit('update:items', [...props.items, { id: newId('kv'), key: '', value: '', enabled: true }]);
}

function removeItem(id: string): void {
  emit(
    'update:items',
    props.items.filter((item) => item.id !== id),
  );
}

function updateField(item: KeyValueItem, field: 'key' | 'value', value: string): void {
  emit(
    'update:items',
    props.items.map((current) => (current.id === item.id ? { ...current, [field]: value } : current)),
  );
}

function toggleItem(item: KeyValueItem): void {
  emit(
    'update:items',
    props.items.map((current) => (current.id === item.id ? { ...current, enabled: !current.enabled } : current)),
  );
}

function toggleBulk(): void {
  if (bulk.value) {
    emit('update:items', parseBulk(bulkText.value));
    bulk.value = false;
    return;
  }
  bulkText.value = props.items.map((item) => `${item.key}: ${item.value}`).join('\n');
  bulk.value = true;
}

function parseBulk(text: string): KeyValueItem[] {
  const result: KeyValueItem[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separator = trimmed.indexOf(':');
    if (separator === -1) {
      result.push({ id: newId('kv'), key: trimmed, value: '', enabled: true });
      continue;
    }
    result.push({
      id: newId('kv'),
      key: trimmed.slice(0, separator).trim(),
      value: trimmed.slice(separator + 1).trim(),
      enabled: true,
    });
  }
  return result;
}
</script>

<template>
  <div class="kv-editor">
    <div class="kv-toolbar">
      <button class="btn btn-secondary" @click="addItem">{{ props.addLabel }}</button>
      <button v-if="props.bulkEnabled" class="btn btn-secondary" @click="toggleBulk">
        {{ bulk ? '表格编辑' : '批量编辑' }}
      </button>
      <span class="spacer"></span>
      <span class="hint">{{ activeCount }} 项启用</span>
    </div>

    <div v-if="bulk" class="bulk-area">
      <textarea v-model="bulkText" class="mono" rows="8" spellcheck="false" placeholder="每行一条：Key: Value"></textarea>
      <div class="hint">切换回「表格编辑」时应用修改</div>
    </div>

    <div v-else class="kv-rows">
      <div v-for="item in props.items" :key="item.id" class="kv-row">
        <input type="checkbox" :checked="item.enabled" @change="toggleItem(item)" />
        <input
          class="kv-key"
          :value="item.key"
          placeholder="Key"
          spellcheck="false"
          @input="updateField(item, 'key', ($event.target as HTMLInputElement).value)"
        />
        <input
          class="kv-value"
          :value="item.value"
          placeholder="Value"
          spellcheck="false"
          @input="updateField(item, 'value', ($event.target as HTMLInputElement).value)"
        />
        <button class="icon-btn" title="删除" @click="removeItem(item.id)">×</button>
      </div>
      <div v-if="!props.items.length" class="hint">暂无内容</div>
    </div>
  </div>
</template>
