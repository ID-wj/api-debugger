<script setup lang="ts">
import KeyValueEditor from './KeyValueEditor.vue';
import type { BodyMode, KeyValueItem, RawLanguage, RequestBody } from '@shared/protocol';

const props = defineProps<{
  body: RequestBody;
}>();

const emit = defineEmits<{
  (event: 'update:body', body: RequestBody): void;
}>();

const modes: Array<{ id: BodyMode; label: string }> = [
  { id: 'none', label: 'none' },
  { id: 'raw', label: 'raw' },
  { id: 'form-urlencoded', label: 'x-www-form-urlencoded' },
  { id: 'form-data', label: 'form-data' },
];

const languages: RawLanguage[] = ['json', 'xml', 'text'];
const rawPlaceholder = '{\n  "name": "{{userName}}"\n}';
const variableHint = '支持 {{变量}} 占位符';

function setMode(mode: BodyMode): void {
  emit('update:body', { ...props.body, mode });
}

function setLanguage(rawLanguage: RawLanguage): void {
  emit('update:body', { ...props.body, rawLanguage });
}

function setRawText(rawText: string): void {
  emit('update:body', { ...props.body, rawText });
}

function setUrlencoded(urlencoded: KeyValueItem[]): void {
  emit('update:body', { ...props.body, urlencoded });
}

function setFormData(formData: KeyValueItem[]): void {
  emit('update:body', { ...props.body, formData });
}
</script>

<template>
  <div class="body-editor">
    <div class="kv-toolbar">
      <select :value="props.body.mode" @change="setMode(($event.target as HTMLSelectElement).value as BodyMode)">
        <option v-for="mode in modes" :key="mode.id" :value="mode.id">{{ mode.label }}</option>
      </select>
      <select
        v-if="props.body.mode === 'raw'"
        :value="props.body.rawLanguage"
        @change="setLanguage(($event.target as HTMLSelectElement).value as RawLanguage)"
      >
        <option v-for="language in languages" :key="language" :value="language">{{ language }}</option>
      </select>
      <span class="spacer"></span>
      <span class="hint">{{ variableHint }}</span>
    </div>

    <textarea
      v-if="props.body.mode === 'raw'"
      class="raw-input mono"
      rows="10"
      spellcheck="false"
      :value="props.body.rawText"
      :placeholder="rawPlaceholder"
      @input="setRawText(($event.target as HTMLTextAreaElement).value)"
    ></textarea>

    <KeyValueEditor
      v-else-if="props.body.mode === 'form-urlencoded'"
      :items="props.body.urlencoded"
      add-label="添加字段"
      @update:items="setUrlencoded"
    />

    <KeyValueEditor
      v-else-if="props.body.mode === 'form-data'"
      :items="props.body.formData"
      add-label="添加字段"
      @update:items="setFormData"
    />

    <div v-else class="hint">该请求没有 Body。</div>
  </div>
</template>
