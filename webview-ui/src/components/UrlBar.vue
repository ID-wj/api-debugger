<script setup lang="ts">
import { HTTP_METHODS } from '@shared/protocol';
import type { HttpMethod } from '@shared/protocol';

const props = defineProps<{
  method: HttpMethod;
  url: string;
  pending: boolean;
  environment: string;
  timeout: string;
}>();

const emit = defineEmits<{
  (event: 'update:method', value: HttpMethod): void;
  (event: 'update:url', value: string): void;
  (event: 'send'): void;
  (event: 'cancel'): void;
  (event: 'save'): void;
  (event: 'curl'): void;
}>();

const urlPlaceholder = 'https://api.example.com/users/{{userId}}';
</script>

<template>
  <div class="url-bar">
    <select
      class="method-select"
      :value="props.method"
      @change="emit('update:method', ($event.target as HTMLSelectElement).value as HttpMethod)"
    >
      <option v-for="method in HTTP_METHODS" :key="method" :value="method">{{ method }}</option>
    </select>

    <input
      class="url-input mono"
      :value="props.url"
      :placeholder="urlPlaceholder"
      spellcheck="false"
      @input="emit('update:url', ($event.target as HTMLInputElement).value)"
      @keydown.enter.prevent="emit('send')"
    />

    <span class="env-chip" :title="`超时 ${props.timeout}`">{{ props.environment }}</span>
    <button class="btn btn-secondary" title="导入或导出 cURL" @click="emit('curl')">cURL</button>
    <button class="btn btn-secondary" title="保存到收藏" @click="emit('save')">保存</button>
    <button v-if="props.pending" class="btn btn-danger" @click="emit('cancel')">取消</button>
    <button v-else class="btn" title="发送 (Ctrl+Enter)" @click="emit('send')">发送</button>
  </div>
</template>
