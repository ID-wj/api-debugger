<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import BodyEditor from './components/BodyEditor.vue';
import CurlDialog from './components/CurlDialog.vue';
import KeyValueEditor from './components/KeyValueEditor.vue';
import RequestTabs from './components/RequestTabs.vue';
import ResponsePane from './components/ResponsePane.vue';
import TabBar from './components/TabBar.vue';
import UrlBar from './components/UrlBar.vue';
import { onExtensionMessage, postToExtension } from './bridge';
import { useRequestState } from './composables/useRequestState';
import type { HttpMethod, KeyValueItem, RequestBody } from '@shared/protocol';

const {
  request,
  result,
  errorMessage,
  pending,
  requestTab,
  responseTab,
  activeId,
  tabItems,
  curlDialog,
  toast,
  environmentLabel,
  timeoutLabel,
  send,
  cancel,
  saveRequest,
  copyToClipboard,
  createTab,
  activateTab,
  closeTab,
  openCurlDialog,
  closeCurlDialog,
  applyImportedRequest,
  copyCurl,
  handleMessage,
} = useRequestState();

let disposeListener: (() => void) | undefined;

onMounted(() => {
  disposeListener = onExtensionMessage(handleMessage);
  postToExtension({ type: 'ready' });
});

onBeforeUnmount(() => {
  disposeListener?.();
});

function countEnabled(items: KeyValueItem[]): number {
  return items.filter((item) => item.enabled && item.key.trim().length > 0).length;
}

const requestTabs = computed(() => [
  { id: 'params', label: 'Params', badge: countEnabled(request.value.params) },
  { id: 'headers', label: 'Headers', badge: countEnabled(request.value.headers) },
  { id: 'body', label: 'Body', badge: request.value.body.mode === 'none' ? 0 : 1 },
]);

function setMethod(method: HttpMethod): void {
  request.value.method = method;
}

function setUrl(url: string): void {
  request.value.url = url;
}

function setRequestTab(tab: string): void {
  requestTab.value = tab;
}

function setResponseTab(tab: string): void {
  responseTab.value = tab;
}

function setParams(items: KeyValueItem[]): void {
  request.value.params = items;
}

function setHeaders(items: KeyValueItem[]): void {
  request.value.headers = items;
}

function setBody(body: RequestBody): void {
  request.value.body = body;
}
</script>

<template>
  <div class="app">
    <RequestTabs
      :items="tabItems"
      :active="activeId"
      @activate="activateTab"
      @close="closeTab"
      @create="createTab()"
    />

    <UrlBar
      :method="request.method"
      :url="request.url"
      :pending="pending"
      :environment="environmentLabel"
      :timeout="timeoutLabel"
      @update:method="setMethod"
      @update:url="setUrl"
      @send="send"
      @cancel="cancel"
      @save="saveRequest"
      @curl="openCurlDialog('export')"
    />

    <div class="request-pane">
      <TabBar :tabs="requestTabs" :active="requestTab" @update:active="setRequestTab" />
      <div class="request-content">
        <KeyValueEditor
          v-if="requestTab === 'params'"
          :items="request.params"
          add-label="添加参数"
          bulk-enabled
          @update:items="setParams"
        />
        <KeyValueEditor
          v-else-if="requestTab === 'headers'"
          :items="request.headers"
          add-label="添加请求头"
          bulk-enabled
          @update:items="setHeaders"
        />
        <BodyEditor v-else :body="request.body" @update:body="setBody" />
      </div>
    </div>

    <ResponsePane
      :result="result"
      :error="errorMessage"
      :pending="pending"
      :tab="responseTab"
      @update:tab="setResponseTab"
      @copy="copyToClipboard"
    />

    <CurlDialog
      v-if="curlDialog"
      :mode="curlDialog.mode"
      :initial-text="curlDialog.text"
      :request="request"
      @close="closeCurlDialog"
      @apply="applyImportedRequest"
      @copy="copyCurl"
    />

    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>
