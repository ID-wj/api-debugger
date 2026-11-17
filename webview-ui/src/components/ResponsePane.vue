<script setup lang="ts">
import { computed } from 'vue';
import type { HttpResult } from '@shared/protocol';
import { escapeHtml, formatBytes, prepareBody } from '../utils/format';
import type { DisplayBody } from '../utils/format';

/** Hard cap on the amount of text pushed into the DOM; larger bodies are copied, not rendered. */
const RENDER_LIMIT_BYTES = 64 * 1024;

interface RenderedBody extends DisplayBody {
  exceedsRenderLimit: boolean;
}

const props = defineProps<{
  result: HttpResult | null;
  error: string | null;
  pending: boolean;
  tab: string;
}>();

const emit = defineEmits<{
  (event: 'update:tab', value: string): void;
  (event: 'copy', text: string): void;
}>();

const statusClass = computed(() => {
  const status = props.result?.status ?? 0;
  if (status >= 500 || status === 0) {
    return 'status-error';
  }
  return status >= 400 ? 'status-warn' : 'status-ok';
});

const display = computed<RenderedBody | null>(() => {
  const result = props.result;
  if (!result || result.bodyText === undefined) {
    return null;
  }
  const full = result.bodyText;
  // Megabyte-sized text inside a single <pre> locks up the webview while the engine wraps it:
  // keep the DOM small and leave the full payload to the copy button.
  if (full.length > RENDER_LIMIT_BYTES) {
    const visible = full.slice(0, RENDER_LIMIT_BYTES);
    return { text: visible, html: escapeHtml(visible), kind: 'text' as const, exceedsRenderLimit: true };
  }
  return { ...prepareBody(full, result.contentType), exceedsRenderLimit: false };
});

const isImage = computed(() => Boolean(props.result?.bodyBase64 && /^image\//i.test(props.result.contentType)));

const imageSrc = computed(() => {
  const result = props.result;
  return result ? `data:${result.contentType};base64,${result.bodyBase64 ?? ''}` : '';
});

const headerRows = computed(() => props.result?.headers ?? []);

function copyBody(): void {
  const body = display.value;
  if (!body) {
    return;
  }
  emit('copy', body.exceedsRenderLimit ? props.result?.bodyText ?? body.text : body.text);
}
</script>

<template>
  <section class="response">
    <div v-if="props.error" class="error-box">{{ props.error }}</div>

    <div v-else-if="props.pending" class="empty">请求发送中…</div>

    <template v-else-if="props.result">
      <div class="status-line">
        <span class="status-code" :class="statusClass">{{ props.result.status }} {{ props.result.statusText }}</span>
        <span>{{ props.result.durationMs }} ms</span>
        <span>{{ formatBytes(props.result.size) }}</span>
        <span v-if="props.result.redirected" class="hint">已跟随重定向</span>
        <span v-if="props.result.truncated" class="hint">响应过大，已截断</span>
        <span class="spacer"></span>
        <button class="btn btn-secondary" @click="copyBody">复制响应</button>
      </div>

      <div v-if="props.result.unresolvedVariables.length" class="warn-box">
        未解析变量：{{ props.result.unresolvedVariables.join(', ') }}
      </div>

      <div class="tabs">
        <button class="tab" :class="{ active: props.tab === 'body' }" @click="emit('update:tab', 'body')">Body</button>
        <button class="tab" :class="{ active: props.tab === 'headers' }" @click="emit('update:tab', 'headers')">
          Headers
          <span class="tab-badge">{{ headerRows.length }}</span>
        </button>
      </div>

      <div v-if="props.tab === 'body' && display?.exceedsRenderLimit" class="warn-box">
        响应体过大（{{ formatBytes(props.result.size) }}），仅渲染前 {{ formatBytes(RENDER_LIMIT_BYTES) }}，完整内容请用「复制响应」
      </div>

      <div v-if="props.tab === 'body'" class="body-area">
        <img v-if="isImage" class="preview-image" :src="imageSrc" alt="response preview" />
        <pre v-else-if="display" class="body-text mono" v-html="display.html"></pre>
        <div v-else class="empty">二进制响应（{{ formatBytes(props.result.size) }}）</div>
      </div>

      <div v-else class="headers-area mono">
        <div v-for="[name, value] in headerRows" :key="name" class="header-row">
          <span class="header-name">{{ name }}</span>
          <span>{{ value }}</span>
        </div>
      </div>
    </template>

    <div v-else class="empty">填写 URL 后点击「发送」，或按 Ctrl+Enter</div>
  </section>
</template>
