<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { parseCurl, toCurl } from '@shared/curl';
import type { CurlDialogMode, HttpRequestDraft } from '@shared/protocol';

const props = defineProps<{
  mode: CurlDialogMode;
  initialText: string;
  request: HttpRequestDraft;
}>();

const emit = defineEmits<{
  (event: 'close'): void;
  (event: 'apply', request: HttpRequestDraft, warnings: string[]): void;
  (event: 'copy', text: string): void;
}>();

const importPlaceholder =
  '粘贴 curl 命令，例如：\ncurl -X POST \'https://api.example.com/users\' -H \'Content-Type: application/json\' -d \'{"name":"qoder"}\'';
const importHint = '支持 bash / zsh / PowerShell / cmd 写法，{{变量}} 占位符会原样保留';
const exportHint = '可直接粘贴到终端执行；{{变量}} 占位符保持原样';
const emptyUrlHint = '请先填写请求 URL';

const activeMode = ref<CurlDialogMode>(props.mode);
const importText = ref(props.initialText);
const errorMessage = ref('');

watch(
  () => props.initialText,
  (value) => {
    importText.value = value;
  },
);

watch(
  () => props.mode,
  (value) => {
    activeMode.value = value;
    errorMessage.value = '';
  },
);

const exportText = computed(() => toCurl(props.request));
const exportHintText = computed(() => (props.request.url.trim() ? exportHint : emptyUrlHint));

function switchMode(mode: CurlDialogMode): void {
  activeMode.value = mode;
  errorMessage.value = '';
}

function submitImport(): void {
  const result = parseCurl(importText.value);
  if (!result.ok) {
    errorMessage.value = result.error;
    return;
  }
  errorMessage.value = '';
  emit('apply', result.request, result.warnings);
}

function copyExport(): void {
  emit('copy', exportText.value);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    emit('close');
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal" role="dialog" aria-modal="true" aria-label="cURL">
      <div class="modal-header">
        <span class="modal-title">cURL</span>
        <button class="icon-btn" title="关闭" @click="emit('close')">×</button>
      </div>

      <div class="modal-tabs">
        <button class="tab" :class="{ active: activeMode === 'import' }" @click="switchMode('import')">
          导入 cURL
        </button>
        <button class="tab" :class="{ active: activeMode === 'export' }" @click="switchMode('export')">
          导出 cURL
        </button>
      </div>

      <template v-if="activeMode === 'import'">
        <textarea
          v-model="importText"
          class="curl-area mono"
          rows="8"
          spellcheck="false"
          :placeholder="importPlaceholder"
        ></textarea>
        <div v-if="errorMessage" class="error-box">{{ errorMessage }}</div>
        <div v-else class="hint">{{ importHint }}</div>
      </template>

      <template v-else>
        <textarea class="curl-area mono" rows="8" readonly spellcheck="false" :value="exportText"></textarea>
        <div class="hint">{{ exportHintText }}</div>
      </template>

      <div class="modal-footer">
        <button class="btn btn-secondary" @click="emit('close')">取消</button>
        <button v-if="activeMode === 'import'" class="btn" @click="submitImport">导入</button>
        <button v-else class="btn" @click="copyExport">复制</button>
      </div>
    </div>
  </div>
</template>
