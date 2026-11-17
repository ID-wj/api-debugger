import { computed, ref } from 'vue';
import { cloneRequest, createEmptyRequest, newId } from '@shared/protocol';
import type { CurlDialogMode, HttpRequestDraft, HttpResult, PanelSettings, PersistedState } from '@shared/protocol';
import type { ToWebviewMessage } from '@shared/protocol';
import { postToExtension } from '../bridge';

const EMPTY_STATE: PersistedState = {
  globals: {},
  environments: [],
  activeEnvironment: null,
  collections: [],
  history: [],
};

interface RequestTab {
  id: string;
  request: HttpRequestDraft;
  result: HttpResult | null;
  errorMessage: string | null;
  pending: boolean;
  requestId: string | null;
  requestTab: string;
  responseTab: string;
}

function createTabState(request: HttpRequestDraft): RequestTab {
  return {
    id: newId('tab'),
    request,
    result: null,
    errorMessage: null,
    pending: false,
    requestId: null,
    requestTab: 'params',
    responseTab: 'body',
  };
}

/**
 * A tab that still shows the untouched default request can be reused when a request is
 * opened from the collections, the history or an imported cURL command.
 */
function isUntouched(tab: RequestTab): boolean {
  const request = tab.request;
  return (
    request.url.trim().length === 0 &&
    request.params.length === 0 &&
    request.headers.length === 0 &&
    request.body.mode === 'none' &&
    !request.body.rawText &&
    tab.result === null &&
    tab.errorMessage === null &&
    !tab.pending
  );
}

function preferredRequestTab(request: HttpRequestDraft): string {
  if (request.body.mode !== 'none') {
    return 'body';
  }
  return request.headers.length > 0 ? 'headers' : 'params';
}

function tabLabel(request: HttpRequestDraft): string {
  const url = request.url.trim();
  if (!url) {
    return '新请求';
  }
  try {
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}`;
    return path === '/' ? parsed.host : path;
  } catch {
    return url;
  }
}

export function useRequestState() {
  const tabs = ref<RequestTab[]>([createTabState(createEmptyRequest())]);
  const activeId = ref(tabs.value[0].id);
  const state = ref<PersistedState>(EMPTY_STATE);
  const settings = ref<PanelSettings>({ timeout: 30000, followRedirects: true });
  const curlDialog = ref<{ mode: CurlDialogMode; text: string } | null>(null);
  const toast = ref<string | null>(null);

  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  const activeTab = computed<RequestTab>(() => tabs.value.find((tab) => tab.id === activeId.value) ?? tabs.value[0]);
  const request = computed(() => activeTab.value.request);
  const result = computed(() => activeTab.value.result);
  const errorMessage = computed(() => activeTab.value.errorMessage);
  const pending = computed(() => activeTab.value.pending);

  const requestTab = computed({
    get: () => activeTab.value.requestTab,
    set: (value: string) => {
      activeTab.value.requestTab = value;
    },
  });

  const responseTab = computed({
    get: () => activeTab.value.responseTab,
    set: (value: string) => {
      activeTab.value.responseTab = value;
    },
  });

  const tabItems = computed(() =>
    tabs.value.map((tab) => ({
      id: tab.id,
      method: tab.request.method,
      label: tabLabel(tab.request),
      title: tab.request.url.trim() || '未命名请求',
      pending: tab.pending,
    })),
  );

  const environmentLabel = computed(() => {
    const active = state.value.activeEnvironment;
    return active ? `环境：${active}` : '无环境';
  });

  const timeoutLabel = computed(() => `${settings.value.timeout}ms`);

  function createTab(next?: HttpRequestDraft): void {
    const tab = createTabState(next ? cloneRequest(next) : createEmptyRequest());
    tabs.value.push(tab);
    activeId.value = tab.id;
  }

  function activateTab(id: string): void {
    if (tabs.value.some((tab) => tab.id === id)) {
      activeId.value = id;
    }
  }

  function closeTab(id: string): void {
    const index = tabs.value.findIndex((tab) => tab.id === id);
    if (index === -1) {
      return;
    }
    const tab = tabs.value[index];
    if (tab.pending && tab.requestId) {
      postToExtension({ type: 'cancel', requestId: tab.requestId });
    }
    tabs.value.splice(index, 1);
    if (tabs.value.length === 0) {
      createTab();
      return;
    }
    if (activeId.value === id) {
      activeId.value = tabs.value[Math.min(index, tabs.value.length - 1)].id;
    }
  }

  /**
   * Opens a request from the history, the collections or an imported cURL command without
   * discarding what the user is editing: a new tab is created unless the active tab is untouched.
   */
  function openRequestTab(next: HttpRequestDraft): void {
    const focus = preferredRequestTab(next);
    const current = activeTab.value;
    if (isUntouched(current)) {
      current.request = cloneRequest(next);
      current.result = null;
      current.errorMessage = null;
      current.requestTab = focus;
      current.responseTab = 'body';
      return;
    }
    createTab(next);
    activeTab.value.requestTab = focus;
  }

  function send(): void {
    const tab = activeTab.value;
    if (tab.pending) {
      return;
    }
    tab.errorMessage = null;
    tab.requestId = newId('r');
    tab.pending = true;
    postToExtension({ type: 'send', requestId: tab.requestId, request: cloneRequest(tab.request) });
  }

  function cancel(): void {
    const tab = activeTab.value;
    if (!tab.requestId) {
      return;
    }
    postToExtension({ type: 'cancel', requestId: tab.requestId });
  }

  function saveRequest(): void {
    postToExtension({ type: 'saveRequest', request: cloneRequest(activeTab.value.request) });
  }

  function copyToClipboard(text: string): void {
    if (text) {
      postToExtension({ type: 'copyToClipboard', text });
    }
  }

  function showToast(message: string): void {
    toast.value = message;
    if (toastTimer !== undefined) {
      clearTimeout(toastTimer);
    }
    toastTimer = setTimeout(() => {
      toast.value = null;
      toastTimer = undefined;
    }, 2400);
  }

  function openCurlDialog(mode: CurlDialogMode, text = ''): void {
    curlDialog.value = { mode, text };
  }

  function closeCurlDialog(): void {
    curlDialog.value = null;
  }

  function applyImportedRequest(next: HttpRequestDraft, warnings: string[]): void {
    openRequestTab(next);
    curlDialog.value = null;
    showToast(warnings.length > 0 ? `已导入 cURL，忽略 ${warnings.length} 项不支持的内容` : '已导入 cURL 到新标签');
  }

  function copyCurl(text: string): void {
    if (!text) {
      return;
    }
    copyToClipboard(text);
    curlDialog.value = null;
    showToast('cURL 命令已复制到剪贴板');
  }

  function useEnvironment(name: string | null): void {
    postToExtension({ type: 'setActiveEnvironment', name });
  }

  function tabByRequestId(requestId: string | undefined): RequestTab | undefined {
    if (!requestId) {
      return activeTab.value;
    }
    return tabs.value.find((tab) => tab.requestId === requestId);
  }

  function handleMessage(message: ToWebviewMessage): void {
    switch (message.type) {
      case 'init':
        state.value = message.state;
        settings.value = message.settings;
        break;
      case 'state':
        state.value = message.state;
        break;
      case 'pending': {
        const tab = tabByRequestId(message.requestId);
        if (tab) {
          tab.pending = true;
        }
        break;
      }
      case 'response': {
        const tab = tabByRequestId(message.requestId);
        if (tab) {
          tab.result = message.result;
          tab.errorMessage = null;
          tab.pending = false;
        }
        break;
      }
      case 'error': {
        const tab = tabByRequestId(message.requestId);
        if (tab) {
          tab.errorMessage = message.message;
          tab.pending = false;
        }
        break;
      }
      case 'loadRequest':
        openRequestTab(message.request);
        break;
      case 'triggerSend':
        send();
        break;
      case 'openCurlDialog':
        openCurlDialog(message.mode, message.text ?? '');
        break;
      case 'theme':
        // VS Code injects the theme classes on <body>; nothing to do here.
        break;
      default:
        break;
    }
  }

  return {
    request,
    state,
    settings,
    result,
    errorMessage,
    pending,
    requestTab,
    responseTab,
    tabs,
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
    showToast,
    createTab,
    activateTab,
    closeTab,
    openCurlDialog,
    closeCurlDialog,
    applyImportedRequest,
    copyCurl,
    useEnvironment,
    handleMessage,
  };
}
