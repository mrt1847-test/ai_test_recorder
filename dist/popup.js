const startBtn = document.getElementById('start-record');
const stopBtn = document.getElementById('stop-record');
const timeline = document.getElementById('timeline');
const selectorList = document.getElementById('selector-list');
const iframeBanner = document.getElementById('iframe-banner');
const codeOutput = document.getElementById('code-output');
const logEntries = document.getElementById('log-entries');
const resetBtn = document.getElementById('reset-btn');
const elementSelectBtn = document.getElementById('element-select-btn');
const deleteEventBtn = document.getElementById('delete-event-btn');
const elementPanel = document.getElementById('element-panel');
const elementStatusEl = document.getElementById('element-status');
const elementPathContainer = document.getElementById('element-path');
const elementPathItems = document.getElementById('element-path-items');
const elementCandidatesContainer = document.getElementById('element-candidates');
const elementActionsContainer = document.getElementById('element-actions');
const elementAttrPanel = document.getElementById('element-attribute-panel');
const elementAttrNameInput = document.getElementById('element-attr-name');
const elementAttrApplyBtn = document.getElementById('element-attr-apply');
const elementCodePreview = document.getElementById('element-code-preview');
const elementCodeEl = document.getElementById('element-code');
const elementCancelBtn = document.getElementById('element-cancel-btn');
const overlayToggleBtn = document.getElementById('overlay-toggle-btn');
const verifyActionsContainer = document.getElementById('verify-actions');
const waitActionsContainer = document.getElementById('wait-actions');
const waitInputPanel = document.getElementById('wait-input-panel');
const waitTimeInput = document.getElementById('wait-time-input');
const waitTimeApplyBtn = document.getElementById('wait-time-apply');
const interactionActionsContainer = document.getElementById('interaction-actions');
const actionBtn = document.getElementById('action-btn');
const actionMenu = document.getElementById('action-menu');
const aiEndpointInput = document.getElementById('ai-endpoint');
const aiApiKeyInput = document.getElementById('ai-api-key');
const aiModelInput = document.getElementById('ai-model');
const aiSettingsSaveBtn = document.getElementById('ai-settings-save');
const aiSettingsStatusEl = document.getElementById('ai-settings-status');
const aiReviewBtnWrapper = document.getElementById('ai-review-btn-wrapper');
const aiReviewBtn = document.getElementById('ai-review-btn');
const aiReviewStatusEl = document.getElementById('ai-review-status');
const aiReviewHelpEl = document.getElementById('ai-review-help');
const codeReviewSummaryEl = document.getElementById('code-review-summary');
const codeReviewDiffEl = document.getElementById('code-review-diff');
const sendRecordingBtn = document.getElementById('send-recording-btn');
const tcIdInput = document.getElementById('tc-id-input');
const projectIdInput = document.getElementById('project-id-input');
let recording = false;
let selectedFramework = 'playwright';
let selectedLanguage = 'python';
let currentEventIndex = -1; // 현재 선택된 이벤트 인덱스
let allEvents = []; // 모든 이벤트 저장
let runtimeListenerRegistered = false;
let replayState = {
  running: false,
  events: [],
  index: 0,
  tabId: null,
  pending: false,
  awaitingNavigation: false,
  awaitingContent: false,
  navigationGuard: null,
  scheduledTimer: null
};
let replayTabListenerRegistered = false;

const STEP_DELAY_MS = 150;
const NAVIGATION_RECOVERY_DELAY_MS = 800;
const DOM_COMPLETE_DELAY_MS = 250;
const MAX_NAVIGATION_WAIT_MS = 15000;
const EVENT_SCHEMA_VERSION = 2;
let codeEditor = null;

function updateDeleteButtonState() {
  if (!deleteEventBtn) return;
  const hasSelection = currentEventIndex >= 0 && currentEventIndex < allEvents.length;
  deleteEventBtn.disabled = !hasSelection;
}

function getCodeText() {
  if (codeEditor) {
    return codeEditor.getValue();
  }
  return codeOutput ? codeOutput.value || '' : '';
}

function setCodeText(text) {
  const next = text || '';
  if (codeEditor && codeEditor.getValue() !== next) {
    const cursor = codeEditor.getCursor();
    codeEditor.setValue(next);
    if (cursor) {
      const totalLines = Math.max(codeEditor.lineCount() - 1, 0);
      codeEditor.setCursor({ line: Math.min(cursor.line, totalLines), ch: cursor.ch });
    }
  }
  if (codeOutput && codeOutput.value !== next) {
    codeOutput.value = next;
  }
}

function getCodeMirrorMode(language) {
  const lang = language || selectedLanguage || 'javascript';
  if (lang === 'python' || lang === 'python-class') {
    return 'text/x-python';
  }
  if (lang === 'typescript') {
    return 'text/typescript';
  }
  return 'text/javascript';
}

function refreshCodeEditorMode() {
  if (codeEditor) {
    codeEditor.setOption('mode', getCodeMirrorMode(selectedLanguage));
  }
}

function initCodeEditor() {
  if (!codeOutput || typeof CodeMirror !== 'function') return;
  codeEditor = CodeMirror.fromTextArea(codeOutput, {
    lineNumbers: true,
    theme: 'neo',
    scrollbarStyle: 'native'
  });
  refreshCodeEditorMode();
  codeEditor.setSize('100%', 'auto');
  codeEditor.on('change', () => {
    codeOutput.value = codeEditor.getValue();
  });
  codeEditor.refresh();
}

initCodeEditor();
updateDeleteButtonState();

function normalizeEventRecord(event) {
  if (!event || typeof event !== 'object') return event;
  if (!event.version) {
    event.version = 1;
  }
  if (!event.metadata) {
    event.metadata = { schemaVersion: event.version };
  } else if (event.metadata.schemaVersion === undefined) {
    event.metadata.schemaVersion = event.version;
  }
  if (event.page === undefined) {
    event.page = null;
  }
  if (event.frame === undefined && event.iframeContext) {
    event.frame = { iframeContext: event.iframeContext };
  }
  if (event.manual === true) {
    event.manual = {
      id: event.manualActionId || null,
      type: event.manualActionType || null,
      resultName: event.manualResultName || null,
      attributeName: event.manualAttribute || null
    };
  }
  return event;
}

function normalizeRequestedUrl(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (/^\/\//.test(trimmed)) {
    return 'https:' + trimmed;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return trimmed;
  }
  return 'https://' + trimmed;
}

const selectionState = {
  active: false,
  stage: 'idle', // idle | await-root | await-candidate | await-action | await-child
  stack: [],
  pendingAction: null,
  pendingAttribute: '',
  codePreview: ''
};
let manualActions = [];
let manualActionSerial = 1;
let overlayVisible = false;
const aiSuggestionState = new Map();
const aiSettingsDefaults = { endpoint: '', apiKey: '', model: '' };
let aiSettings = { ...aiSettingsDefaults };
let aiSettingsLoaded = false;
let aiSettingsDirty = false;
const aiCodeReviewState = {
  status: 'idle',
  updatedAt: null,
  summary: '',
  changes: []
};
function resolveTimelineSelector(event) {
  if (!event) return '';
  const cleanedPrimary = normalizeTimelineSelectorValue(event.primarySelector);
  if (cleanedPrimary) return cleanedPrimary;
  if (Array.isArray(event.selectorCandidates)) {
    const candidate = event.selectorCandidates.find((c) => normalizeTimelineSelectorValue(c && c.selector));
    if (candidate && normalizeTimelineSelectorValue(candidate.selector)) {
      return normalizeTimelineSelectorValue(candidate.selector);
    }
  }
  const xpathValue = normalizeTimelineSelectorValue(event.primarySelectorXPath);
  if (xpathValue) return xpathValue;
  const textValue = normalizeTimelineSelectorValue(event.primarySelectorText);
  if (textValue) return textValue;
  const storedValue = normalizeTimelineSelectorValue(event.primarySelectorValue);
  if (storedValue) return storedValue;
  const rawSelector = normalizeTimelineSelectorValue(event.selector);
  if (rawSelector) return rawSelector;
  if (event.tag && typeof event.tag === 'string') {
    return event.tag.toLowerCase();
  }
  return '';
}

function normalizeTimelineSelectorValue(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length === 0) return '';
  if (/셀렉터$/i.test(trimmed)) return '';
  return trimmed;
}

function formatSelectorTypeLabel(type) {
  if (!type) return '선택된 셀렉터';
  const lowered = type.toLowerCase();
  switch (lowered) {
    case 'css':
      return 'CSS 셀렉터';
    case 'text':
      return '텍스트 셀렉터';
    case 'xpath':
      return 'XPath 셀렉터';
    case 'xpath-full':
      return '절대 XPath 셀렉터';
    case 'id':
      return 'ID 셀렉터';
    case 'class':
      return '클래스 셀렉터';
    case 'class-tag':
      return '태그+클래스 셀렉터';
    case 'tag':
      return '태그 셀렉터';
    case 'data-testid':
    case 'data-test':
    case 'data-qa':
    case 'data-cy':
    case 'data-id':
      return `${lowered.toUpperCase()} 셀렉터`;
    default:
      return `${lowered.toUpperCase()} 셀렉터`;
  }
}

const LANGUAGE_OPTIONS = {
  playwright: [
    { value: 'python', label: 'Python' },
    { value: 'python-class', label: 'Python (Class)' },
    { value: 'javascript', label: 'JavaScript' },
    { value: 'typescript', label: 'TypeScript' }
  ],
  selenium: [
    { value: 'python', label: 'Python' },
    { value: 'python-class', label: 'Python (Class)' },
    { value: 'javascript', label: 'JavaScript' },
    { value: 'typescript', label: 'TypeScript' }
  ],
  cypress: [
    { value: 'javascript', label: 'JavaScript' },
    { value: 'typescript', label: 'TypeScript' }
  ]
};
let recordingStartUrl = '';
chrome.storage.local.get({ recordingStartUrl: '' }, (data) => {
  if (data && typeof data.recordingStartUrl === 'string') {
    recordingStartUrl = data.recordingStartUrl;
  }
});
const contentScriptReadyTabs = new Set();
const inspectedTabId = null; // 팝업에서는 devtools API를 사용할 수 없음

function sanitizeAiSettingValue(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim();
}

function setAiSettingsStatus(text, tone) {
  if (!aiSettingsStatusEl) return;
  aiSettingsStatusEl.className = 'ai-settings-status';
  if (tone === 'error') {
    aiSettingsStatusEl.classList.add('error');
  } else if (tone === 'pending') {
    aiSettingsStatusEl.classList.add('pending');
  } else if (tone === 'success') {
    aiSettingsStatusEl.classList.add('success');
  }
  aiSettingsStatusEl.textContent = text || '';
}

function applyAiSettingsToInputs(settings = {}) {
  if (aiEndpointInput) {
    aiEndpointInput.value = settings.endpoint || '';
  }
  if (aiApiKeyInput) {
    aiApiKeyInput.value = settings.apiKey || '';
  }
  if (aiModelInput) {
    aiModelInput.value = settings.model || '';
  }
}

function isAiConfigured() {
  return !!(aiSettings && typeof aiSettings === 'object' && aiSettings.endpoint && aiSettings.endpoint.trim());
}

function loadAiSettingsFromStorage() {
  chrome.storage.local.get({ aiSettings: { ...aiSettingsDefaults } }, (data) => {
    const stored = data && data.aiSettings ? data.aiSettings : {};
    aiSettings = {
      endpoint: sanitizeAiSettingValue(stored.endpoint),
      apiKey: sanitizeAiSettingValue(stored.apiKey),
      model: sanitizeAiSettingValue(stored.model)
    };
    aiSettingsLoaded = true;
    const shouldSyncInputs = !aiSettingsDirty;
    if (shouldSyncInputs) {
      applyAiSettingsToInputs(aiSettings);
      if (!isAiConfigured()) {
        setAiSettingsStatus('AI API 엔드포인트를 설정하세요.', 'pending');
      } else {
        setAiSettingsStatus('AI 설정이 로드되었습니다.', 'success');
      }
    }
    refreshSelectorListForCurrentEvent();
  });
}

function markAiSettingsDirty() {
  aiSettingsDirty = true;
  setAiSettingsStatus('저장되지 않은 변경 사항이 있습니다.', 'pending');
}

function saveAiSettings() {
  const nextSettings = {
    endpoint: sanitizeAiSettingValue(aiEndpointInput ? aiEndpointInput.value : ''),
    apiKey: sanitizeAiSettingValue(aiApiKeyInput ? aiApiKeyInput.value : ''),
    model: sanitizeAiSettingValue(aiModelInput ? aiModelInput.value : '')
  };
  setAiSettingsStatus('저장 중...', 'pending');
  chrome.storage.local.set({ aiSettings: nextSettings }, () => {
    if (chrome.runtime.lastError) {
      setAiSettingsStatus(`AI 설정 저장에 실패했습니다: ${chrome.runtime.lastError.message}`, 'error');
      return;
    }
    aiSettings = nextSettings;
    aiSettingsDirty = false;
    setAiSettingsStatus('AI 설정이 저장되었습니다.', 'success');
    refreshSelectorListForCurrentEvent();
    setAiReviewStatus(aiCodeReviewState.status || 'idle', aiReviewStatusEl ? aiReviewStatusEl.textContent : '');
  });
}

if (aiSettingsSaveBtn) {
  aiSettingsSaveBtn.addEventListener('click', () => {
    if (!aiSettingsLoaded && !aiSettingsDirty) {
      loadAiSettingsFromStorage();
      return;
    }
    saveAiSettings();
  });
}

[aiEndpointInput, aiApiKeyInput, aiModelInput].forEach((input) => {
  if (!input) return;
  input.addEventListener('input', markAiSettingsDirty);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes.aiSettings) return;
  const next = changes.aiSettings.newValue || aiSettingsDefaults;
  aiSettings = {
    endpoint: sanitizeAiSettingValue(next.endpoint),
    apiKey: sanitizeAiSettingValue(next.apiKey),
    model: sanitizeAiSettingValue(next.model)
  };
  if (!aiSettingsDirty) {
    applyAiSettingsToInputs(aiSettings);
    if (!isAiConfigured()) {
      setAiSettingsStatus('AI API 엔드포인트를 설정하세요.', 'pending');
    } else {
      setAiSettingsStatus('AI 설정이 저장되었습니다.', 'success');
    }
  }
  refreshSelectorListForCurrentEvent();
  if (aiReviewBtn) {
    aiReviewBtn.disabled = !isAiConfigured() || aiCodeReviewState.status === 'loading';
  }
  updateAiReviewTooltip();
  setAiReviewStatus(aiCodeReviewState.status || 'idle', aiReviewStatusEl ? aiReviewStatusEl.textContent : '');
});

loadAiSettingsFromStorage();
if (aiReviewBtn) {
  aiReviewBtn.disabled = !isAiConfigured();
}
updateAiReviewTooltip();

function setAiReviewStatus(status, message) {
  if (!aiReviewStatusEl) return;
  aiReviewStatusEl.className = 'code-review-status';
  if (!isAiConfigured()) {
    aiReviewStatusEl.textContent = '';
    aiCodeReviewState.status = 'disabled';
    if (aiReviewBtn) {
      aiReviewBtn.disabled = true;
    }
    updateAiReviewTooltip();
    return;
  }
  if (status === 'loading') {
    aiReviewStatusEl.classList.add('info');
    aiReviewStatusEl.textContent = message || 'AI가 코드 검토 중입니다...';
  } else if (status === 'error') {
    aiReviewStatusEl.classList.add('error');
    aiReviewStatusEl.textContent = message || 'AI 코드 검토가 실패했습니다.';
  } else if (status === 'success') {
    aiReviewStatusEl.classList.add('success');
    aiReviewStatusEl.textContent = message || 'AI 코드 검토가 완료되었습니다.';
  } else if (status === 'info') {
    aiReviewStatusEl.classList.add('info');
    aiReviewStatusEl.textContent = message || '';
  } else {
    aiReviewStatusEl.textContent = message || '';
  }
  aiCodeReviewState.status = status;
  updateAiReviewTooltip();
}

function toggleAiReviewLoading(loading) {
  if (!aiReviewBtn) return;
  const disabled = !!loading || !isAiConfigured();
  aiReviewBtn.disabled = disabled;
  aiReviewBtn.classList.toggle('loading', !!loading);
  updateAiReviewTooltip();
}

function getAiReviewTooltipText() {
  if (!isAiConfigured()) {
    return 'AI API를 설정하면 현재 테스트 케이스와 생성된 코드를 AI에 보내 개선 제안과 수정본을 받을 수 있습니다.';
  }
  if (aiCodeReviewState.status === 'loading') {
    return 'AI가 생성된 코드와 테스트 케이스를 검토 중입니다. 잠시만 기다려 주세요.';
  }
  return 'AI 검토는 테스트 케이스와 생성된 코드를 AI에 전달해 개선 제안과 수정본을 받아 자동으로 적용합니다.';
}

function updateAiReviewTooltip() {
  if (!aiReviewHelpEl) return;
  const text = getAiReviewTooltipText();
  aiReviewHelpEl.setAttribute('data-tooltip', text);
  aiReviewHelpEl.setAttribute('aria-label', text);
  aiReviewHelpEl.setAttribute('title', text);
  if (aiReviewBtnWrapper) {
    const buttonTooltip = !isAiConfigured()
      ? 'AI 검토를 사용하려면 AI API 설정을 먼저 완료하세요.'
      : '';
    aiReviewBtnWrapper.setAttribute('data-tooltip', buttonTooltip);
  }
}

function clearCodeReviewArtifacts(options = {}) {
  if (codeReviewSummaryEl) {
    codeReviewSummaryEl.innerHTML = '';
    if (!options.keepSummaryVisible) {
      codeReviewSummaryEl.classList.add('hidden');
    }
  }
  if (codeReviewDiffEl) {
    codeReviewDiffEl.innerHTML = '';
    if (!options.keepDiffVisible) {
      codeReviewDiffEl.classList.add('hidden');
    }
  }
}

function escapeForDiff(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function computeLineDiff(oldText, newText) {
  const oldLines = (oldText || '').split(/\r?\n/);
  const newLines = (newText || '').split(/\r?\n/);
  const m = oldLines.length;
  const n = newLines.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      if (oldLines[i] === newLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ type: 'equal', value: oldLines[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'removed', value: oldLines[i] });
      i += 1;
    } else {
      ops.push({ type: 'added', value: newLines[j] });
      j += 1;
    }
  }
  while (i < m) {
    ops.push({ type: 'removed', value: oldLines[i] });
    i += 1;
  }
  while (j < n) {
    ops.push({ type: 'added', value: newLines[j] });
    j += 1;
  }
  return ops;
}

function compressDiff(ops) {
  const result = [];
  let buffer = [];
  const flushBuffer = () => {
    if (buffer.length === 0) return;
    if (buffer.length > 6) {
      result.push(...buffer.slice(0, 3));
      result.push({ type: 'context', value: '…' });
      result.push(...buffer.slice(-3));
    } else {
      result.push(...buffer);
    }
    buffer = [];
  };
  ops.forEach((op) => {
    if (op.type === 'equal') {
      buffer.push(op);
    } else {
      flushBuffer();
      result.push(op);
    }
  });
  flushBuffer();
  return result;
}

function renderCodeDiff(oldText, newText) {
  if (!codeReviewDiffEl) return;
  const ops = computeLineDiff(oldText, newText);
  const includeOnlyChanges = ops.every((op) => op.type === 'equal');
  const displayOps = includeOnlyChanges ? [] : compressDiff(ops);
  codeReviewDiffEl.innerHTML = '';
  if (displayOps.length === 0) {
    codeReviewDiffEl.classList.add('hidden');
    return;
  }
  const fragment = document.createDocumentFragment();
  displayOps.forEach((op) => {
    const line = document.createElement('div');
    line.className = `code-diff-line ${op.type}`;
    const marker = document.createElement('span');
    marker.className = 'code-diff-marker';
    if (op.type === 'added') {
      marker.textContent = '+';
    } else if (op.type === 'removed') {
      marker.textContent = '−';
    } else if (op.type === 'context') {
      marker.textContent = '…';
    } else {
      marker.textContent = '';
    }
    const text = document.createElement('span');
    text.innerHTML = escapeForDiff(op.value);
    line.appendChild(marker);
    line.appendChild(text);
    fragment.appendChild(line);
  });
  codeReviewDiffEl.appendChild(fragment);
  codeReviewDiffEl.classList.remove('hidden');
}

function renderCodeReviewSummary(summary, suggestions) {
  if (!codeReviewSummaryEl) return;
  codeReviewSummaryEl.innerHTML = '';
  const fragment = document.createDocumentFragment();
  if (summary) {
    const summaryHeading = document.createElement('strong');
    summaryHeading.textContent = '요약';
    const summaryText = document.createElement('div');
    summaryText.textContent = summary;
    fragment.appendChild(summaryHeading);
    fragment.appendChild(summaryText);
  }
  if (Array.isArray(suggestions) && suggestions.length > 0) {
    const listTitle = document.createElement('strong');
    listTitle.textContent = '개선 사항';
    fragment.appendChild(listTitle);
    const list = document.createElement('ul');
    suggestions.forEach((item) => {
      if (!item) return;
      const text = typeof item === 'string' ? item : item.description || item.note || item.summary;
      if (!text) return;
      const li = document.createElement('li');
      li.textContent = text;
      list.appendChild(li);
    });
    if (list.children.length > 0) {
      fragment.appendChild(list);
    }
  }
  if (fragment.childNodes.length === 0) {
    codeReviewSummaryEl.classList.add('hidden');
    return;
  }
  codeReviewSummaryEl.appendChild(fragment);
  codeReviewSummaryEl.classList.remove('hidden');
}

function normalizeCodeReviewResponse(response) {
  if (!response || typeof response !== 'object') {
    return { ok: false, reason: 'AI 응답 형식이 올바르지 않습니다.' };
  }
  if (response.ok === false) {
    return { ok: false, reason: response.reason || response.error || 'AI 코드 검토 요청에 실패했습니다.' };
  }
  const data = response.result && typeof response.result === 'object' ? response.result : response;
  let updatedCode = null;
  if (typeof data.updatedCode === 'string') {
    updatedCode = data.updatedCode;
  } else if (typeof data.code === 'string') {
    updatedCode = data.code;
  } else if (data.result && typeof data.result.code === 'string') {
    updatedCode = data.result.code;
  }
  const summary = typeof data.summary === 'string' ? data.summary : (typeof data.overview === 'string' ? data.overview : '');
  const suggestions = Array.isArray(data.suggestions)
    ? data.suggestions
    : (Array.isArray(data.changes) ? data.changes : []);
  return {
    ok: true,
    updatedCode,
    summary,
    suggestions
  };
}

function requestAiCodeReview() {
  if (!codeOutput && !codeEditor) {
    setAiReviewStatus('error', '코드 프리뷰 영역을 찾을 수 없습니다.');
    return;
  }
  const originalCode = getCodeText();
  if (!originalCode.trim()) {
    setAiReviewStatus('info', '생성된 코드가 없습니다. 이벤트를 먼저 기록하세요.');
    return;
  }
  toggleAiReviewLoading(true);
  setAiReviewStatus('loading', 'AI가 코드 개선점을 분석 중입니다...');
  clearCodeReviewArtifacts();

  const testCaseInput = document.getElementById('test-purpose');
  const testCaseDescription = testCaseInput ? (testCaseInput.value || '') : '';
  const requestPayload = {
    type: 'REQUEST_AI_CODE_REVIEW',
    testCase: testCaseDescription,
    code: originalCode,
    framework: selectedFramework,
    language: selectedLanguage,
    events: allEvents,
    manualActions,
    aiModel: aiSettings.model || ''
  };

  chrome.runtime.sendMessage(requestPayload, (response) => {
    toggleAiReviewLoading(false);
    if (chrome.runtime.lastError) {
      setAiReviewStatus('error', chrome.runtime.lastError.message || 'AI 코드 검토 요청 중 오류가 발생했습니다.');
      return;
    }
    const normalized = normalizeCodeReviewResponse(response);
    if (!normalized.ok) {
      setAiReviewStatus('error', normalized.reason || 'AI 코드 검토를 불러오지 못했습니다.');
      return;
    }
    const { updatedCode, summary, suggestions } = normalized;
    if (typeof updatedCode === 'string' && updatedCode.trim() && updatedCode !== originalCode) {
      setCodeText(updatedCode);
      renderCodeDiff(originalCode, updatedCode);
      renderCodeReviewSummary(summary, suggestions);
      setAiReviewStatus('success', 'AI 검토 결과를 코드에 적용했습니다.');
      aiCodeReviewState.updatedAt = Date.now();
      aiCodeReviewState.summary = summary || '';
      aiCodeReviewState.changes = suggestions || [];
    } else {
      renderCodeReviewSummary(summary, suggestions);
      codeReviewDiffEl && codeReviewDiffEl.classList.add('hidden');
      setAiReviewStatus('info', 'AI가 추가 수정 사항을 제안하지 않았습니다.');
    }
  });
}

if (aiReviewBtn) {
  aiReviewBtn.addEventListener('click', () => {
    if (aiCodeReviewState.status === 'loading') return;
    requestAiCodeReview();
  });
}

if (chrome.tabs && chrome.tabs.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    contentScriptReadyTabs.delete(tabId);
  });
}

if (chrome.tabs && chrome.tabs.onReplaced) {
  chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
    contentScriptReadyTabs.delete(removedTabId);
  });
}

function ensureContentScriptInjected(tabId) {
  if (tabId === undefined || tabId === null) {
    return Promise.reject(new Error('invalid_tab'));
  }
  if (contentScriptReadyTabs.has(tabId)) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'ENSURE_CONTENT_SCRIPT', tabId }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response || response.ok === false) {
        reject(new Error(response && response.reason ? response.reason : 'failed_to_inject'));
        return;
      }
      contentScriptReadyTabs.add(tabId);
      resolve();
    });
  });
}

function sendMessageWithInjection(tabId, message, callback) {
  ensureContentScriptInjected(tabId)
    .then(() => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          if (callback) callback(null, new Error(chrome.runtime.lastError.message));
          return;
        }
        if (callback) callback(response, null);
      });
    })
    .catch((error) => {
      if (callback) callback(null, error);
    });
}

function withActiveTab(callback) {
  const deliverTab = (tab) => {
    if (!tab) {
      callback(null);
      return;
    }
    // panel.js와 동일하게 URL 필터링 없이 주입 시도
    // background.js에서 주입 불가능한 페이지는 자동으로 에러 처리됨
    ensureContentScriptInjected(tab.id)
      .then(() => callback(tab))
      .catch((error) => {
        console.error('[AI Test Recorder] Failed to inject content script:', error);
        const errorMsg = error.message || '';
        if (errorMsg.includes('Cannot access contents of url')) {
          alert('이 페이지에서는 콘텐츠 스크립트를 주입할 수 없습니다. 일반 웹 페이지에서 시도해주세요.');
        } else {
          alert('콘텐츠 스크립트를 주입할 수 없습니다. 페이지를 새로고침한 후 다시 시도해주세요.');
        }
        callback(null);
      });
  };

  // 팝업에서는 모든 창에서 활성 탭을 찾되, 일반 브라우저 창의 탭만 선택
  // popup 창이 아닌 실제 브라우저 창의 탭을 찾기 위해 windowType 확인
  chrome.tabs.query({ active: true }, (tabs) => {
    if (!tabs || tabs.length === 0) {
      deliverTab(null);
      return;
    }
    
    // 각 탭의 창 타입 확인하여 일반 브라우저 창의 탭만 선택
    const windowPromises = tabs.map(tab => {
      return new Promise((resolve) => {
        chrome.windows.get(tab.windowId, (win) => {
          if (chrome.runtime.lastError) {
            resolve({ tab, isNormal: false });
            return;
          }
          // 'normal' 타입 창의 탭만 선택 (popup, devtools 등 제외)
          resolve({ tab, isNormal: win.type === 'normal' });
        });
      });
    });
    
    Promise.all(windowPromises).then((results) => {
      // 일반 브라우저 창의 탭만 필터링
      const normalTabs = results
        .filter(r => r.isNormal)
        .map(r => r.tab);
      
      // 일반 웹 페이지 탭만 필터링 (chrome://, chrome-extension:// 등 제외)
      const webTabs = (normalTabs.length > 0 ? normalTabs : tabs).filter(tab => {
        const url = tab.url || '';
        return !url.startsWith('chrome://') && 
               !url.startsWith('chrome-extension://') && 
               !url.startsWith('about:') &&
               !url.startsWith('edge://');
      });
      
      // 웹 탭이 있으면 첫 번째 웹 탭, 없으면 첫 번째 일반 탭 사용
      const tab = webTabs && webTabs.length > 0 ? webTabs[0] : 
                  (normalTabs.length > 0 ? normalTabs[0] : 
                   (tabs && tabs[0] ? tabs[0] : null));
      
      if (tab) {
        console.log('[AI Test Recorder] Selected tab:', tab.id, tab.url);
      }
      
      deliverTab(tab);
    });
  });
}

function triggerStartRecording(options = {}, callback) {
  const source = options.source || 'panel';
  if (recording) {
    if (typeof callback === 'function') callback({ok: false, reason: 'already_recording'});
      return;
    }
  const urlInput = document.getElementById('test-url');
  const rawUrl = options.url !== undefined ? options.url : (urlInput ? urlInput.value : '');
  const requestedUrl = normalizeRequestedUrl(rawUrl);
  if (urlInput && requestedUrl && urlInput.value !== requestedUrl) {
    urlInput.value = requestedUrl;
  }

  withActiveTab((currentTab) => {
    if (!currentTab) {
      if (typeof callback === 'function') callback({ok: false, reason: 'no_active_tab'});
      if (source === 'panel') {
        alert('활성 탭을 찾을 수 없습니다.');
      }
      return;
    }

    const startUrl = requestedUrl || currentTab.url || '';
    recordingStartUrl = startUrl;
    chrome.storage.local.set({ recordingStartUrl: startUrl });

    const beginRecording = () => {
    recording = true;
      if (startBtn) startBtn.disabled = true;
      if (stopBtn) stopBtn.disabled = false;
      chrome.storage.local.set({events: [], recording: true});
      allEvents = [];
      timeline.innerHTML = '';
      selectorList.innerHTML = '';
      setCodeText('');
      logEntries.innerHTML = '';
      currentEventIndex = -1;
      updateDeleteButtonState();
    listenEvents();

      sendMessageWithInjection(currentTab.id, {type: 'RECORDING_START'}, (response, error) => {
        if (error) {
          const tabId = currentTab.id;
          const onUpdated = (updatedTabId, changeInfo) => {
            if (updatedTabId === tabId && changeInfo.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(onUpdated);
              sendMessageWithInjection(tabId, {type: 'RECORDING_START'});
            }
          };
          chrome.tabs.onUpdated.addListener(onUpdated);
        }
      });

      if (typeof callback === 'function') callback({ok: true});
    };

    if (requestedUrl) {
      chrome.tabs.update(currentTab.id, {url: requestedUrl}, () => {
        setTimeout(beginRecording, 1000);
      });
    } else {
      beginRecording();
    }
  });
}

function triggerStopRecording(options = {}, callback) {
  if (!recording) {
    if (typeof callback === 'function') callback({ok: false, reason: 'not_recording'});
    return;
  }
  recording = false;
  if (startBtn) startBtn.disabled = false;
  if (stopBtn) stopBtn.disabled = true;
  chrome.storage.local.remove(['recording']);
  
  withActiveTab((tab) => {
    if (tab) {
      sendMessageWithInjection(tab.id, {type: 'RECORDING_STOP'});
    }
  });

  updateCode({ refreshTimeline: true, preserveSelection: true });
  if (typeof callback === 'function') callback({ok: true});
}

function handleOverlayCommand(msg, sendResponse) {
  const command = msg && msg.command;
  if (command === 'start_record') {
    triggerStartRecording({source: 'overlay'}, (result) => {
      sendResponse(result || {ok: true});
    });
    return true;
  }
  if (command === 'stop_record') {
    triggerStopRecording({source: 'overlay'}, (result) => {
      sendResponse(result || {ok: true});
    });
    return true;
  }
  if (command === 'element_select') {
    if (selectionState.active) {
      sendResponse({ok: false, reason: 'selection_in_progress'});
    } else {
      startSelectionWorkflow();
      sendResponse({ok: true});
    }
    return false;
  }
  sendResponse({ok: false, reason: 'unknown_command'});
  return false;
}

// 프레임워크와 언어 선택 드롭다운
const frameworkSelect = document.getElementById('framework-select');
const languageSelect = document.getElementById('language-select');

function populateLanguageOptions(framework, options = {}) {
  if (!languageSelect) return;
  const { preserveSelection = false } = options;
  const frameworkKey = framework && LANGUAGE_OPTIONS[framework] ? framework : 'playwright';
  const choices = LANGUAGE_OPTIONS[frameworkKey];
  const previousValue = preserveSelection ? (languageSelect.value || selectedLanguage) : selectedLanguage;
  languageSelect.innerHTML = '';
  let nextValue = null;
  choices.forEach((choice, index) => {
    const optionEl = document.createElement('option');
    optionEl.value = choice.value;
    optionEl.textContent = choice.label;
    languageSelect.appendChild(optionEl);
    if (!nextValue) {
      nextValue = choice.value;
    }
    if (previousValue && choice.value === previousValue) {
      nextValue = choice.value;
    }
  });
  if (nextValue) {
    languageSelect.value = nextValue;
    selectedLanguage = nextValue;
    refreshCodeEditorMode();
  }
}

if (languageSelect) {
  populateLanguageOptions(selectedFramework, { preserveSelection: true });
}

// 프레임워크 변경 이벤트
if (frameworkSelect) {
  frameworkSelect.addEventListener('change', (e) => {
    selectedFramework = e.target.value;
    populateLanguageOptions(selectedFramework, { preserveSelection: true });
    updateCode({ preloadedEvents: allEvents }); // 실시간 코드 업데이트
    updateSelectionCodePreview();
  });
}

// 언어 변경 이벤트
if (languageSelect) {
  languageSelect.addEventListener('change', (e) => {
    selectedLanguage = e.target.value;
    refreshCodeEditorMode();
    updateCode({ preloadedEvents: allEvents }); // 실시간 코드 업데이트
    updateSelectionCodePreview();
  });
}

startBtn.addEventListener('click', ()=>{
  triggerStartRecording({source: 'panel'}, (result) => {
    if (!result || result.ok) return;
    if (result.reason === 'no_active_tab') {
      alert('활성 탭을 찾을 수 없습니다.');
    }
  });
});

stopBtn.addEventListener('click', ()=>{
  triggerStopRecording({source: 'panel'});
});

if (sendRecordingBtn) {
  sendRecordingBtn.addEventListener('click', () => {
    handleSendRecording();
  });
}

resetBtn.addEventListener('click', () => {
  // 전체 삭제
  chrome.storage.local.clear(() => {
  recording = false;
    recordingStartUrl = '';
    allEvents = [];
    timeline.innerHTML = '';
    selectorList.innerHTML = '';
    setCodeText('');
    logEntries.innerHTML = '';
    currentEventIndex = -1;
    updateDeleteButtonState();
    // 모든 탭에 녹화 중지 메시지 전송
    withActiveTab((tab) => {
      if (tab) {
        sendMessageWithInjection(tab.id, {type: 'RECORDING_STOP'});
      }
    });
    manualActions = [];
    manualActionSerial = 1;
    persistManualActions(manualActions, () => {
  updateCode({ refreshTimeline: true, preserveSelection: false });
    });
    cancelSelectionWorkflow('요소 선택 흐름이 초기화되었습니다.', 'info');
  });
});

if (deleteEventBtn) {
  deleteEventBtn.addEventListener('click', () => {
    deleteCurrentEvent();
  });
}

listenEvents();
updateCode();
  loadTimeline();

if (elementSelectBtn) {
  elementSelectBtn.addEventListener('click', () => {
    if (selectionState.active) {
      cancelSelectionWorkflow('요소 선택을 취소했습니다.');
    } else {
      startSelectionWorkflow();
    }
  });
}

// 통합 Action 메뉴 처리
if (actionBtn && actionMenu) {
  actionBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    actionMenu.classList.toggle('hidden');
  });
  
  // 메뉴 외부 클릭 시 닫기
  document.addEventListener('click', (e) => {
    if (actionBtn && actionMenu && 
        !actionBtn.contains(e.target) && 
        !actionMenu.contains(e.target)) {
      actionMenu.classList.add('hidden');
    }
  });
  
  // 액션 선택 처리
  actionMenu.addEventListener('click', (e) => {
    const button = e.target.closest('button[data-action-type]');
    if (!button) return;
    
    const actionType = button.getAttribute('data-action-type');
    const action = button.getAttribute('data-action');
    
    actionMenu.classList.add('hidden');
    
    if (actionType === 'interaction') {
      handleInteractionAction(action);
    } else if (actionType === 'verify') {
      handleVerifyAction(action);
    } else if (actionType === 'wait') {
      handleWaitAction(action);
    }
  });
}

if (overlayToggleBtn) {
  overlayToggleBtn.addEventListener('click', () => {
    requestOverlayVisibility(!overlayVisible, { revert: true });
  });
}

if (elementCancelBtn) {
  elementCancelBtn.addEventListener('click', () => {
    cancelSelectionWorkflow('사용자 요청으로 취소되었습니다.');
  });
}

if (elementActionsContainer) {
  elementActionsContainer.addEventListener('click', (event) => {
    const button = event.target && event.target.closest('button[data-action]');
    if (!button) return;
    const action = button.getAttribute('data-action');
    handleElementAction(action);
  });
}

if (elementAttrApplyBtn) {
  elementAttrApplyBtn.addEventListener('click', () => {
    const attrName = elementAttrNameInput ? elementAttrNameInput.value.trim() : '';
    selectionState.pendingAttribute = attrName;
    applySelectionAction('get_attribute', {attributeName: attrName});
  });
}

// Verify 액션 처리
if (verifyActionsContainer) {
  verifyActionsContainer.addEventListener('click', (event) => {
    const button = event.target && event.target.closest('button[data-verify]');
    if (!button) return;
    const verifyType = button.getAttribute('data-verify');
    handleVerifyAction(verifyType);
  });
}

// Wait 액션 처리
if (waitActionsContainer) {
  waitActionsContainer.addEventListener('click', (event) => {
    const button = event.target && event.target.closest('button[data-wait]');
    if (!button) return;
    const waitType = button.getAttribute('data-wait');
    handleWaitAction(waitType);
  });
}

if (waitTimeApplyBtn) {
  waitTimeApplyBtn.addEventListener('click', () => {
    const timeValue = waitTimeInput ? waitTimeInput.value.trim() : '';
    if (!timeValue || isNaN(parseInt(timeValue))) {
      alert('올바른 대기 시간을 입력하세요 (밀리초)');
      return;
    }
    addWaitAction('wait', parseInt(timeValue));
  });
}

// 상호작용 액션 처리
if (interactionActionsContainer) {
  interactionActionsContainer.addEventListener('click', (event) => {
    const button = event.target && event.target.closest('button[data-interaction]');
    if (!button) return;
    const interactionType = button.getAttribute('data-interaction');
    handleInteractionAction(interactionType);
  });
}

if (elementAttrNameInput) {
  elementAttrNameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (elementAttrApplyBtn) {
        elementAttrApplyBtn.click();
      }
    }
  });
}

chrome.storage.local.get({ overlayVisible: false }, (data) => {
  const storedOverlayVisible = !!data.overlayVisible;
  applyOverlayVisibility(storedOverlayVisible, { persist: false });
  if (storedOverlayVisible) {
    requestOverlayVisibility(true, { revert: false });
  } else {
    syncOverlayVisibility();
  }
});

function getAiStateKey(event) {
  if (!event || typeof event !== 'object') return null;
  if (event.id) return `id:${event.id}`;
  if (event.manual && event.manual.id) return `manual:${event.manual.id}`;
  if (event.timestamp) return `ts:${event.timestamp}`;
  if (event.createdAt) return `created:${event.createdAt}`;
  return null;
}

function getAiState(event) {
  const key = getAiStateKey(event);
  if (!key) return { status: 'idle', error: null };
  let state = aiSuggestionState.get(key);
  if (!state) {
    if (event && Array.isArray(event.aiSelectorCandidates) && event.aiSelectorCandidates.length > 0) {
      state = { status: 'loaded', error: null, updatedAt: event.aiSelectorsUpdatedAt || null };
    } else {
      state = { status: 'idle', error: null };
    }
    aiSuggestionState.set(key, state);
  }
  return state;
}

function setAiState(event, patch) {
  const key = getAiStateKey(event);
  if (!key) return null;
  const prev = aiSuggestionState.get(key) || { status: 'idle', error: null };
  const next = { ...prev, ...patch };
  aiSuggestionState.set(key, next);
  return next;
}

function formatAiStatusTime(timestamp) {
  if (!timestamp) return '';
  try {
    const date = new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  } catch (err) {
    return '';
  }
}

function appendAiMessage(text, tone = 'info') {
  if (!selectorList) return false;
  const box = document.createElement('div');
  box.className = `selector-ai-message ${tone}`;
  box.textContent = text;
  selectorList.appendChild(box);
  return true;
}

const selectorTabState = {
  active: 'unique',
  grouped: null,
  event: null,
  resolvedIndex: null,
  contentEl: null,
  buttons: null
};

function getCandidateMatchCount(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  if (typeof candidate.matchCount === 'number') return candidate.matchCount;
  if (typeof candidate.contextMatchCount === 'number') return candidate.contextMatchCount;
  return null;
}

function extractAttributes(node) {
  const attributes = {};
  if (!node || typeof node !== 'object') return attributes;
  if (node.attributes && typeof node.attributes === 'object' && !Array.isArray(node.attributes)) {
    const keys = Object.keys(node.attributes).slice(0, 8);
    keys.forEach((key) => {
      attributes[key] = node.attributes[key];
    });
  }
  if (Array.isArray(node.dataAttributes)) {
    node.dataAttributes.slice(0, 8).forEach((attr) => {
      if (attr && attr.name) {
        attributes[attr.name] = attr.value || '';
      }
    });
  }
  return attributes;
}

function sanitizeDomNode(summary) {
  if (!summary || typeof summary !== 'object') return null;
  const node = {};
  if (summary.tag) {
    node.tag = summary.tag;
  }
  if (summary.id) {
    node.id = summary.id;
  }
  if (Array.isArray(summary.classes) && summary.classes.length) {
    node.classes = summary.classes.slice(0, 8);
  }
  const attrs = summary.attributes && typeof summary.attributes === 'object' ? summary.attributes : null;
  if (attrs && Object.keys(attrs).length) {
    node.attributes = { ...attrs };
  }
  if (summary.text) {
    node.text = summary.text;
  }
  if (summary.value) {
    node.value = summary.value;
  }
  node.children = [];
  return node.tag || node.text || node.id || (node.classes && node.classes.length) || (node.attributes && Object.keys(node.attributes).length)
    ? node
    : null;
}

function buildDomTree(event) {
  if (!event || typeof event !== 'object') return null;
  const context = event.domContext || {};
  const pathSummaries = [];

  if (context.root) {
    pathSummaries.push(context.root);
  }

  const ancestorSummaries = Array.isArray(context.ancestors)
    ? context.ancestors.slice().reverse()
    : [];
  ancestorSummaries.forEach((summary) => {
    pathSummaries.push(summary);
  });

  let rootNode = null;
  let currentNode = null;

  pathSummaries.forEach((summary) => {
    const node = sanitizeDomNode(summary);
    if (!node) return;
    node.children = node.children || [];
    if (!rootNode) {
      rootNode = node;
    } else if (currentNode) {
      if (!currentNode.children) currentNode.children = [];
      currentNode.children.push(node);
    }
    currentNode = node;
  });

  const targetSummary = context.self || event.target || null;
  let parentNode = currentNode;

  if (!rootNode) {
    if (targetSummary) {
      rootNode = sanitizeDomNode(targetSummary) || null;
      if (rootNode) {
        rootNode.target = true;
        parentNode = rootNode;
      }
    }
  }

  if (!rootNode) {
    return null;
  }

  if (!parentNode) {
    parentNode = rootNode;
  }

  const siblingSummaries = Array.isArray(context.siblings) ? context.siblings.slice() : [];
  const entries = siblingSummaries.map((summary) => ({
    summary,
    isTarget: false
  }));
  if (targetSummary) {
    entries.push({ summary: targetSummary, isTarget: true });
  }

  if (entries.length) {
    entries.sort((a, b) => {
      const aIndex = a.summary && a.summary.position && typeof a.summary.position.index === 'number'
        ? a.summary.position.index
        : (a.isTarget ? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER - 1);
      const bIndex = b.summary && b.summary.position && typeof b.summary.position.index === 'number'
        ? b.summary.position.index
        : (b.isTarget ? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER - 1);
      return aIndex - bIndex;
    });

    parentNode.children = entries
      .map(({ summary, isTarget }) => {
        const node = sanitizeDomNode(summary);
        if (!node) return null;
        if (isTarget) {
          node.target = true;
          const childSummaries = Array.isArray(context.children) ? context.children : [];
          node.children = childSummaries
            .map((child) => sanitizeDomNode(child))
            .filter(Boolean);
        }
        return node;
      })
      .filter(Boolean);
  } else if (targetSummary) {
    const node = sanitizeDomNode(targetSummary);
    if (node) {
      node.target = true;
      const childSummaries = Array.isArray(context.children) ? context.children : [];
      node.children = childSummaries
        .map((child) => sanitizeDomNode(child))
        .filter(Boolean);
      if (!parentNode.children) parentNode.children = [];
      parentNode.children.push(node);
    }
  }

  function pruneEmptyChildren(node) {
    if (!node || !Array.isArray(node.children)) return;
    node.children = node.children.filter(Boolean);
    node.children.forEach((child) => pruneEmptyChildren(child));
    if (!node.children.length) {
      delete node.children;
    }
  }

  pruneEmptyChildren(rootNode);

  return rootNode;
}

function sanitizeTarget(target) {
  if (!target || typeof target !== 'object') return null;
  const domContext = target.domContext || null;
  const baseSummary = domContext && domContext.self
    ? domContext.self
    : {
        tag: target.tag || null,
        id: target.id || null,
        classes: Array.isArray(target.classes) ? target.classes : null,
        attributes: extractAttributes(target),
        text: target.text || null,
        value: target.value || null
      };
  const sanitized = sanitizeDomNode(baseSummary);
  if (sanitized) {
    delete sanitized.children;
  }
  return sanitized;
}

function buildAiRequestPayload(event) {
  if (!event || typeof event !== 'object') return null;
  const iframeContext = event.iframeContext || (event.frame && event.frame.iframeContext) || null;
  const domRoot = buildDomTree(event);
  const domPayload = domRoot ? { root: domRoot } : null;
  return {
    action: event.action || null,
    value: event.value !== undefined ? event.value : null,
    timestamp: event.timestamp || null,
    iframeContext,
    dom: domPayload,
    target: sanitizeTarget(event.target),
    page: event.page ? { url: event.page.url || null, title: event.page.title || null } : null,
    clientRect: event.clientRect || null,
    metadata: event.metadata && typeof event.metadata === 'object'
      ? {
          schemaVersion: event.metadata.schemaVersion || EVENT_SCHEMA_VERSION,
          userAgent: event.metadata.userAgent || null,
          domEvent: event.metadata.domEvent || null
        }
      : null,
    prompt: {
      goal: '주어진 이벤트와 DOM 스냅샷을 분석해 안정적인 셀렉터 후보를 찾는다',
      constraints: [
        '출력은 JSON 객체만 허용하며, 최상위 키는 "candidates" 하나여야 한다',
        '변동성이 상품명이나 숫자 는 지양한다',
        '"candidates" 값은 최대 5개의 항목을 가진 배열이어야 한다',
        '각 배열 항목은 { "selector": string, "reason": string } 형태여야 한다',
        '추가 설명, 예시 코드, 텍스트 문단 등은 금지한다'
      ]
    }
  };
}

function normalizeAiCandidates(candidates) {
  if (!Array.isArray(candidates)) return [];
  const seen = new Set();
  return candidates
    .map((candidate) => {
      if (!candidate || typeof candidate !== 'object') return null;
      const selector = typeof candidate.selector === 'string' ? candidate.selector.trim() : '';
      if (!selector) return null;
      if (seen.has(selector)) {
        return null;
      }
      seen.add(selector);
      const normalized = { ...candidate, selector };
      normalized.type = normalized.type || inferSelectorType(selector);
      normalized.reason = normalized.reason || 'AI 추천';
      if (normalized.rawSelector === undefined) {
        normalized.rawSelector = candidate.rawSelector || selector;
      }
      if (normalized.rawType === undefined) {
        normalized.rawType = candidate.rawType || normalized.type;
      }
      if (normalized.rawMatchCount === undefined && typeof normalized.matchCount === 'number') {
        normalized.rawMatchCount = normalized.matchCount;
      }
      if (normalized.rawUnique === undefined && typeof normalized.unique === 'boolean') {
        normalized.rawUnique = normalized.unique;
      }
      if (normalized.rawReason === undefined && normalized.reason) {
        normalized.rawReason = normalized.reason;
      }
      if (normalized.type !== 'text') {
        delete normalized.matchMode;
        delete normalized.textValue;
      } else {
        normalized.matchMode = normalized.matchMode || 'exact';
      }
      normalized.source = 'ai';
      return normalized;
    })
    .filter(Boolean)
    .slice(0, 12);
}

function persistAiCandidates(eventIndex, candidates, updatedAt, callback) {
  if (eventIndex === undefined || eventIndex === null || eventIndex < 0) {
    if (typeof callback === 'function') callback();
    return;
  }
  chrome.storage.local.get({ events: [] }, (res) => {
    const events = Array.isArray(res.events) ? res.events : [];
    if (eventIndex >= 0 && eventIndex < events.length && events[eventIndex] && typeof events[eventIndex] === 'object') {
      events[eventIndex].aiSelectorCandidates = candidates;
      events[eventIndex].aiSelectorsUpdatedAt = updatedAt;
      chrome.storage.local.set({ events }, () => {
        if (typeof callback === 'function') callback();
      });
    } else if (typeof callback === 'function') {
      callback();
    }
  });
}

function requestAiSelectorsForEvent(event, eventIndex) {
  const targetEvent = eventIndex >= 0 && allEvents[eventIndex] ? allEvents[eventIndex] : event;
  if (!targetEvent) return;
  if (!isAiConfigured()) {
    setAiState(targetEvent, {
      status: 'error',
      error: 'AI API 설정이 필요합니다. 상단에서 엔드포인트와 (필요 시) API 키를 저장하세요.'
    });
    showSelectors(null, targetEvent, eventIndex);
    return;
  }
  setAiState(targetEvent, { status: 'loading', error: null });
  showSelectors(null, targetEvent, eventIndex);
  const payload = buildAiRequestPayload(targetEvent);
  if (!payload) {
    setAiState(targetEvent, { status: 'error', error: '요청에 필요한 정보가 부족합니다.' });
    showSelectors(null, targetEvent, eventIndex);
    return;
  }
  const requestContext = {
    testCase: document.getElementById('test-purpose') ? (document.getElementById('test-purpose').value || '') : '',
    testUrl: document.getElementById('test-url') ? (document.getElementById('test-url').value || '') : '',
    framework: selectedFramework,
    language: selectedLanguage,
    aiModel: aiSettings.model || '',
    tabId: null // 팝업에서는 withActiveTab에서 처리
  };
  chrome.runtime.sendMessage(
    {
      type: 'REQUEST_AI_SELECTORS',
      event: payload,
      context: requestContext
    },
    (response) => {
      if (chrome.runtime.lastError) {
        setAiState(targetEvent, {
          status: 'error',
          error: chrome.runtime.lastError.message || 'AI 추천 요청 중 오류가 발생했습니다.'
        });
        showSelectors(null, targetEvent, eventIndex);
        return;
      }
      if (!response || response.ok === false) {
        const message = response && (response.reason || response.error || response.message)
          ? response.reason || response.error || response.message
          : 'AI 추천을 불러오지 못했습니다.';
        setAiState(targetEvent, { status: 'error', error: message });
        showSelectors(null, targetEvent, eventIndex);
        return;
      }
      const normalizedCandidates = normalizeAiCandidates(response.candidates);
      const updatedAt = Date.now();
      targetEvent.aiSelectorCandidates = normalizedCandidates;
      targetEvent.aiSelectorsUpdatedAt = updatedAt;
      if (eventIndex >= 0 && allEvents[eventIndex]) {
        allEvents[eventIndex] = targetEvent;
      }
      persistAiCandidates(eventIndex, normalizedCandidates, updatedAt, () => {
        setAiState(targetEvent, { status: 'loaded', error: null, updatedAt });
        showSelectors(null, targetEvent, eventIndex);
      });
    }
  );
}

function renderAiRequestControls(event, resolvedIndex) {
  if (!selectorList) return;
  const header = document.createElement('div');
  header.className = 'selector-ai-control';

  const title = document.createElement('span');
  title.className = 'selector-ai-title';
  title.textContent = 'AI 추천 셀렉터';
  header.appendChild(title);

  const actions = document.createElement('div');
  actions.className = 'selector-ai-actions';

  const hasEvent = !!event && resolvedIndex !== undefined && resolvedIndex !== null && resolvedIndex >= 0;
  const aiConfigured = isAiConfigured();
  const state = hasEvent ? getAiState(event) : { status: 'idle', error: null };
  const canRequest = hasEvent && aiConfigured;

  const button = document.createElement('button');
  button.className = 'selector-ai-button';
  if (!aiConfigured) {
    button.textContent = 'AI 설정 필요';
    button.disabled = true;
  } else if (!hasEvent) {
    button.textContent = 'AI 추천 요청';
    button.disabled = true;
  } else if (state.status === 'loading') {
    button.textContent = '요청 중...';
    button.disabled = true;
  } else if (state.status === 'error') {
    button.textContent = '다시 시도';
  } else if (state.status === 'loaded') {
    button.textContent = 'AI 다시 요청';
  } else {
    button.textContent = 'AI 추천 요청';
  }
  if (!canRequest) {
    button.disabled = true;
  }
  button.addEventListener('click', () => {
    if (!canRequest || getAiState(event).status === 'loading') {
      return;
    }
    requestAiSelectorsForEvent(event, resolvedIndex);
  });

  const statusEl = document.createElement('span');
  statusEl.className = 'selector-ai-status';
  if (!aiConfigured) {
    statusEl.textContent = '상단 AI 설정을 저장하면 추천을 요청할 수 있습니다.';
    statusEl.classList.add('error');
  } else if (!canRequest) {
    statusEl.textContent = '타임라인에서 이벤트를 선택하면 AI 추천을 요청할 수 있습니다.';
    statusEl.classList.add('muted');
  } else if (state.status === 'loading') {
    statusEl.textContent = 'AI가 분석 중입니다...';
    statusEl.classList.add('info');
  } else if (state.status === 'error') {
    statusEl.textContent = state.error || 'AI 추천을 불러오지 못했습니다.';
    statusEl.classList.add('error');
  } else if (state.status === 'loaded') {
    const timeText = state.updatedAt ? ` (업데이트 ${formatAiStatusTime(state.updatedAt)})` : '';
    statusEl.textContent = `AI 추천 결과가 준비되었습니다${timeText}`;
    statusEl.classList.add('success');
  } else {
    statusEl.textContent = '필요할 때 AI 추천을 받아보세요.';
    statusEl.classList.add('muted');
  }

  const buttonWrapper = document.createElement('div');
  buttonWrapper.className = 'selector-ai-button-wrapper';
  buttonWrapper.setAttribute(
    'data-tooltip',
    'AI가 이벤트 컨텍스트와 테스트 목적을 분석해 안정적인 셀렉터를 추천합니다.'
  );
  buttonWrapper.appendChild(button);
  const copyButtonWrapper = document.createElement('div');
  copyButtonWrapper.className = 'selector-ai-button-wrapper';
  copyButtonWrapper.setAttribute(
    'data-tooltip',
    '현재 이벤트와 컨텍스트로 생성된 AI 요청 프롬프트를 클립보드에 복사합니다.'
  );
  const copyButton = document.createElement('button');
  copyButton.className = 'selector-ai-button ghost';
  copyButton.textContent = '프롬프트 복사';
  if (!hasEvent) {
    copyButton.disabled = true;
  }
  copyButton.addEventListener('click', () => {
    if (!hasEvent) return;
    copyAiSelectorRequest(event);
  });
  copyButtonWrapper.appendChild(copyButton);
  actions.appendChild(buttonWrapper);
  actions.appendChild(copyButtonWrapper);
  actions.appendChild(statusEl);
  header.appendChild(actions);
  selectorList.appendChild(header);
}

function legacyCopyToClipboard(text) {
  return new Promise((resolve, reject) => {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';
      document.body.appendChild(textarea);
      textarea.focus({ preventScroll: true });
      textarea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (!successful) {
        reject(new Error('execCommand copy failed'));
        return;
      }
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

function canUseAsyncClipboard() {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  if (!window.isSecureContext) return false;
  if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') return false;
  const protocol = (window.location && window.location.protocol) || '';
  if (protocol && protocol.toLowerCase().startsWith('devtools')) return false;
  return true;
}

function copyTextToClipboard(text) {
  if (canUseAsyncClipboard()) {
    return navigator.clipboard.writeText(text).catch((err) => {
      console.warn('[AI Test Recorder] navigator.clipboard.writeText failed, falling back:', err);
      return legacyCopyToClipboard(text);
    });
  }
  return legacyCopyToClipboard(text);
}

function buildAiSelectorPrompt(event) {
  const payload = buildAiRequestPayload(event);
  if (!payload) return null;
  const requestContext = {
    testCase: document.getElementById('test-purpose') ? (document.getElementById('test-purpose').value || '') : '',
    testUrl: document.getElementById('test-url') ? (document.getElementById('test-url').value || '') : '',
    framework: selectedFramework,
    language: selectedLanguage,
    aiModel: aiSettings.model || '',
    tabId: null // 팝업에서는 withActiveTab에서 처리
  };
  const requestEnvelope = {
    type: 'REQUEST_AI_SELECTORS',
    event: payload,
    context: requestContext
  };
  return JSON.stringify(requestEnvelope, null, 2);
}

function copyAiSelectorRequest(event) {
  if (!event) {
    alert('타임라인에서 이벤트를 먼저 선택하세요.');
    return;
  }
  const promptText = buildAiSelectorPrompt(event);
  if (!promptText) {
    alert('이벤트 정보가 부족해 프롬프트를 생성할 수 없습니다.');
    return;
  }
  copyTextToClipboard(promptText)
    .then(() => {
      alert('AI 요청 프롬프트를 클립보드에 복사했습니다.');
    })
    .catch((error) => {
      console.error('[AI Test Recorder] Failed to copy AI prompt:', error);
      alert(`프롬프트 복사에 실패했습니다: ${error.message}`);
    });
}

function applyOverlayVisibility(visible, options = {}) {
  overlayVisible = !!visible;
  if (overlayToggleBtn) {
    overlayToggleBtn.setAttribute('aria-pressed', overlayVisible ? 'true' : 'false');
    overlayToggleBtn.classList.toggle('active', overlayVisible);
    overlayToggleBtn.textContent = overlayVisible ? '오버레이 숨기기' : '오버레이 표시';
  }
  if (options.persist) {
    chrome.storage.local.set({ overlayVisible });
  }
}

function requestOverlayVisibility(targetVisible, options = {}) {
  const desired = !!targetVisible;
  withActiveTab((tab) => {
    if (!tab) {
      applyOverlayVisibility(false, { persist: true });
      return;
    }
    sendMessageWithInjection(tab.id, { type: 'OVERLAY_VISIBILITY_SET', visible: desired }, (response, error) => {
      if (error) {
        console.warn('오버레이 표시 상태를 변경할 수 없습니다:', error.message);
        if (options.revert !== false) {
          applyOverlayVisibility(false, { persist: false });
        }
        return;
      }
      if (response && response.ok === false) {
        console.warn('오버레이 표시 요청이 실패했습니다:', response.reason);
        if (options.revert !== false) {
          applyOverlayVisibility(false, { persist: false });
        }
        return;
      }
      const actual = response && Object.prototype.hasOwnProperty.call(response, 'visible') ? !!response.visible : desired;
      applyOverlayVisibility(actual, { persist: true });
    });
  });
}

function syncOverlayVisibility() {
  withActiveTab((tab) => {
    if (!tab) return;
    sendMessageWithInjection(tab.id, { type: 'OVERLAY_VISIBILITY_GET' }, (response) => {
      if (response && response.ok) {
        applyOverlayVisibility(!!response.visible, { persist: false });
      }
    });
  });
}

function refreshSelectorListForCurrentEvent() {
  if (currentEventIndex >= 0 && allEvents[currentEventIndex]) {
    const currentEvent = allEvents[currentEventIndex];
    showSelectors(currentEvent.selectorCandidates || [], currentEvent, currentEventIndex);
  }
}

function deleteCurrentEvent() {
  if (currentEventIndex < 0 || currentEventIndex >= allEvents.length) return;
  const targetIndex = currentEventIndex;
  const updatedEvents = allEvents.slice();
  updatedEvents.splice(targetIndex, 1);
  chrome.storage.local.set({ events: updatedEvents }, () => {
    if (chrome.runtime.lastError) {
      console.error('[AI Test Recorder] Failed to delete event:', chrome.runtime.lastError);
      alert('이벤트를 삭제할 수 없습니다. 다시 시도해주세요.');
      return;
    }
    const nextIndex = updatedEvents.length > 0 ? Math.min(targetIndex, updatedEvents.length - 1) : -1;
    currentEventIndex = nextIndex;
    const normalized = syncTimelineFromEvents(updatedEvents, {
      preserveSelection: nextIndex !== -1,
      selectLast: false,
      resetAiState: false
    });
    updateDeleteButtonState();
    updateCode({ preloadedEvents: normalized });
  });
}

function syncTimelineFromEvents(events, options = {}) {
  const {
    preserveSelection = false,
    selectLast = false,
    resetAiState = false
  } = options;
  const previousIndex = preserveSelection ? currentEventIndex : -1;
  const normalizedEvents = Array.isArray(events)
    ? events.map((ev) => normalizeEventRecord(ev))
    : [];

  const nextAiState = new Map();
  normalizedEvents.forEach((event) => {
    const key = getAiStateKey(event);
    if (!key) return;
    const existing = resetAiState ? null : aiSuggestionState.get(key);
    const hasCandidates = Array.isArray(event.aiSelectorCandidates) && event.aiSelectorCandidates.length > 0;
    if (existing && existing.status === 'loading') {
      nextAiState.set(key, existing);
    } else if (hasCandidates) {
      nextAiState.set(key, {
        status: 'loaded',
        error: null,
        updatedAt: event.aiSelectorsUpdatedAt || (existing && existing.updatedAt) || null
      });
    } else if (existing) {
      nextAiState.set(key, existing);
    } else {
      nextAiState.set(key, { status: 'idle', error: null });
    }
  });
  aiSuggestionState.clear();
  nextAiState.forEach((state, key) => aiSuggestionState.set(key, state));

  allEvents = normalizedEvents;
  if (timeline) {
    timeline.innerHTML = '';
    normalizedEvents.forEach((event, index) => {
      appendTimelineItem(event, index);
    });
    const items = timeline.querySelectorAll('.timeline-item');
    items.forEach((item) => item.classList.remove('selected'));
  }

  let indexToSelect = -1;
  if (preserveSelection && previousIndex >= 0 && previousIndex < normalizedEvents.length) {
    indexToSelect = previousIndex;
  } else if (selectLast && normalizedEvents.length > 0) {
    indexToSelect = normalizedEvents.length - 1;
  }

  if (indexToSelect >= 0) {
    currentEventIndex = indexToSelect;
    const selectedItem = timeline
      ? timeline.querySelector(`[data-event-index="${indexToSelect}"]`)
      : null;
    if (selectedItem) {
      selectedItem.classList.add('selected');
    }
    const selectedEvent = normalizedEvents[indexToSelect];
    showSelectors(selectedEvent.selectorCandidates || [], selectedEvent, indexToSelect);
    showIframe(selectedEvent.iframeContext);
  } else {
    currentEventIndex = -1;
    if (selectorList) {
      selectorList.innerHTML = '';
    }
    showIframe(null);
  }

  updateDeleteButtonState();
  return normalizedEvents;
}

function loadTimeline() {
  chrome.runtime.sendMessage({type:'GET_EVENTS'}, (res) => {
    const events = (res && res.events) || [];
    const normalized = syncTimelineFromEvents(events, { selectLast: true, resetAiState: true });
    updateCode({ preloadedEvents: normalized });
  });
}

function listenEvents() {
  if (runtimeListenerRegistered) return;
  chrome.runtime.onMessage.addListener(function handler(msg, sender, sendResponse) {
    if (msg.type === 'OVERLAY_COMMAND') {
      const handledAsync = handleOverlayCommand(msg, sendResponse);
      return handledAsync;
    }
    if (msg.type === 'OVERLAY_VISIBILITY_CHANGED') {
      applyOverlayVisibility(!!msg.visible, { persist: true });
      return;
    }
    if (msg.type === 'EVENT_RECORDED') {
      const normalizedEvent = normalizeEventRecord(msg.event);
      const stateKey = getAiStateKey(normalizedEvent);
      if (stateKey) {
        aiSuggestionState.delete(stateKey);
      }
      allEvents.push(normalizedEvent);
      const index = allEvents.length - 1;
      appendTimelineItem(normalizedEvent, index);
      // 자동으로 마지막 이벤트 선택
      currentEventIndex = index;
      document.querySelectorAll('.timeline-item').forEach(item => item.classList.remove('selected'));
      const lastItem = document.querySelector(`[data-event-index="${index}"]`);
      if (lastItem) {
        lastItem.classList.add('selected');
      }
      showSelectors(normalizedEvent.selectorCandidates || [], normalizedEvent, index);
      showIframe(normalizedEvent.iframeContext);
      updateDeleteButtonState();
      // 실시간 코드 업데이트
      updateCode({ preloadedEvents: allEvents });
    }
    if (msg.type === 'ELEMENT_HOVERED') {
      // 마우스 오버 시 DevTools에 셀렉터 정보 표시
      if (msg.selectors && msg.selectors.length > 0) {
        showSelectors(msg.selectors, null, -1);
      }
    }
    if (msg.type === 'ELEMENT_SELECTION_PICKED') {
      handleElementSelectionPicked(msg);
    }
    if (msg.type === 'ELEMENT_SELECTION_ERROR') {
      handleElementSelectionError(msg);
    }
    if (msg.type === 'ELEMENT_SELECTION_CANCELLED') {
      handleElementSelectionCancelled(msg);
    }
    if (msg.type === 'REPLAY_STEP_RESULT') {
      const div = document.createElement('div');
      div.style.padding = '4px 8px';
      div.style.margin = '2px 0';
      div.style.borderRadius = '4px';
      const indexLabel = (msg.stepIndex !== undefined ? msg.stepIndex + 1 : msg.step || '?');
      const totalLabel = msg.total || '?';
      if (msg.ok) {
        div.style.background = '#e8f5e9';
        div.style.color = '#2e7d32';
        const detailParts = [];
        if (msg.used) {
          detailParts.push(msg.used);
        }
        if (msg.selector) {
          detailParts.push(`(${msg.selector})`);
        }
        if (msg.manualActionType === 'extract_text' && msg.value !== undefined && msg.value !== null) {
          detailParts.push(`text="${msg.value}"`);
        }
        if (msg.manualActionType === 'get_attribute') {
          const attrLabel = msg.attributeName || 'attr';
          detailParts.push(`${attrLabel}="${msg.value ?? ''}"`);
        }
        const detailText = detailParts.length ? ` - ${detailParts.join(' ')}` : '';
        div.textContent = `[${indexLabel}/${totalLabel}] ✓ OK${detailText}`;
      } else {
        div.style.background = '#ffebee';
        div.style.color = '#c62828';
        const detailParts = [];
        if (msg.manualActionType === 'get_attribute' && msg.attributeName) {
          detailParts.push(`attr=${msg.attributeName}`);
        }
        if (msg.selector) {
          detailParts.push(`selector=${msg.selector}`);
        }
        const detailText = detailParts.length ? ` (${detailParts.join(', ')})` : '';
        div.textContent = `[${indexLabel}/${totalLabel}] ✗ FAIL - ${msg.reason || 'unknown error'}${detailText}`;
      }
      logEntries.appendChild(div);
      // 자동 스크롤
      logEntries.scrollTop = logEntries.scrollHeight;
      handleReplayStepResult(msg);
    }
    if (msg.type === 'REPLAY_FINISHED') {
      const d = document.createElement('div');
      d.textContent = '✓ 리플레이 완료';
      d.style.color = '#2196f3';
      d.style.fontWeight = 'bold';
      d.style.padding = '8px';
      d.style.marginTop = '8px';
      d.style.borderTop = '1px solid #ddd';
      logEntries.appendChild(d);
      logEntries.scrollTop = logEntries.scrollHeight;
    }
  });
  runtimeListenerRegistered = true;
}

function appendTimelineItem(ev, index) {
  const div = document.createElement('div');
  div.className = 'timeline-item';
  div.dataset.eventIndex = index;
  const timestamp = ev.timestamp ? new Date(ev.timestamp) : null;
  const timeLabel = timestamp
    ? `${String(timestamp.getHours()).padStart(2, '0')}:${String(timestamp.getMinutes()).padStart(2, '0')}:${String(timestamp.getSeconds()).padStart(2, '0')}`
    : '--:--:--';
  const actionLabel = ev.action || 'event';
  const usedSelector = resolveTimelineSelector(ev);
  const row = document.createElement('div');
  row.className = 'timeline-row';
  const timeSpan = document.createElement('span');
  timeSpan.className = 'time';
  timeSpan.textContent = timeLabel;
  const eventSpan = document.createElement('span');
  eventSpan.className = 'event';
  eventSpan.textContent = actionLabel;
  row.appendChild(timeSpan);
  row.appendChild(eventSpan);

  const selectorLine = document.createElement('div');
  selectorLine.className = 'selector-line';
  const selectorValue = document.createElement('span');
  selectorValue.className = 'value';
  selectorValue.textContent = usedSelector || '';
  selectorLine.appendChild(selectorValue);

  div.appendChild(row);
  div.appendChild(selectorLine);
  div.style.cursor = 'pointer';
  div.addEventListener('click', () => {
    // 이전 선택 해제
    document.querySelectorAll('.timeline-item').forEach(item => item.classList.remove('selected'));
    // 현재 선택
    div.classList.add('selected');
    currentEventIndex = index;
      // 해당 이벤트의 셀렉터 표시
      showSelectors(ev.selectorCandidates || [], ev, index);
      showIframe(ev.iframeContext);
      updateDeleteButtonState();
  });
  timeline.appendChild(div);
}

function showSelectors(list, event, eventIndex) {
  if (!selectorList) return;
  selectorList.innerHTML = '';

  const hasEventContext = !!event;
  const resolvedIndex = hasEventContext
    ? (eventIndex !== undefined && eventIndex !== null ? eventIndex : allEvents.indexOf(event))
    : -1;

  renderAiRequestControls(event, resolvedIndex);

  if (!hasEventContext) {
    selectorTabState.grouped = null;
    selectorTabState.contentEl = null;
    selectorTabState.buttons = null;
    const baseCandidates = Array.isArray(list) ? list : [];
    if (!Array.isArray(baseCandidates) || baseCandidates.length === 0) {
      const emptyMessage = document.createElement('div');
      emptyMessage.className = 'selector-empty';
      emptyMessage.textContent = '셀렉터 후보가 없습니다.';
      selectorList.appendChild(emptyMessage);
      return;
    }
    renderSelectorGroup(baseCandidates, {
      source: 'base',
      event: null,
      resolvedIndex,
      listRef: baseCandidates,
      container: selectorList
    });
    return;
  }

  const aiState = getAiState(event);
  const aiCandidates = Array.isArray(event.aiSelectorCandidates) ? event.aiSelectorCandidates : [];
  if (aiState.status === 'loading') {
    appendAiMessage('AI가 추천 셀렉터를 분석하는 중입니다...', 'loading');
  } else if (aiState.status === 'error') {
    appendAiMessage(aiState.error || 'AI 추천을 불러오지 못했습니다.', 'error');
  } else if (aiCandidates.length === 0) {
    appendAiMessage('AI 추천 후보가 아직 없습니다.', 'empty');
  }

  const baseCandidates = Array.isArray(event.selectorCandidates) ? event.selectorCandidates : [];
  const grouped = buildSelectorTabGroups(event, baseCandidates, aiCandidates);
  selectorTabState.grouped = grouped;
  selectorTabState.event = event;
  selectorTabState.resolvedIndex = resolvedIndex;

  const uniqueCount = getGroupCount(grouped.unique);
  const repeatCount = getGroupCount(grouped.repeat);

  let desiredActive = selectorTabState.active;
  if (desiredActive !== 'unique' && desiredActive !== 'repeat') {
    desiredActive = 'unique';
  }
  if (desiredActive === 'unique' && uniqueCount === 0 && repeatCount > 0) {
    desiredActive = 'repeat';
  } else if (desiredActive === 'repeat' && repeatCount === 0 && uniqueCount > 0) {
    desiredActive = 'unique';
  }
  selectorTabState.active = desiredActive;

  const tabsHeader = document.createElement('div');
  tabsHeader.className = 'selector-tab-header';

  const uniqueBtn = document.createElement('button');
  uniqueBtn.type = 'button';
  uniqueBtn.className = 'selector-tab-button';
  tabsHeader.appendChild(uniqueBtn);

  const repeatBtn = document.createElement('button');
  repeatBtn.type = 'button';
  repeatBtn.className = 'selector-tab-button';
  tabsHeader.appendChild(repeatBtn);

  selectorList.appendChild(tabsHeader);

  const tabContent = document.createElement('div');
  tabContent.className = 'selector-tab-content';
  selectorList.appendChild(tabContent);

  selectorTabState.contentEl = tabContent;
  selectorTabState.buttons = { unique: uniqueBtn, repeat: repeatBtn };

  uniqueBtn.addEventListener('click', () => {
    if (getGroupCount(selectorTabState.grouped?.unique) === 0) return;
    if (selectorTabState.active !== 'unique') {
      selectorTabState.active = 'unique';
      updateSelectorTabUI();
    }
  });

  repeatBtn.addEventListener('click', () => {
    if (getGroupCount(selectorTabState.grouped?.repeat) === 0) return;
    if (selectorTabState.active !== 'repeat') {
      selectorTabState.active = 'repeat';
      updateSelectorTabUI();
    }
  });

  updateSelectorTabUI();

  if (uniqueCount === 0 && repeatCount === 0) {
    const emptyMessage = document.createElement('div');
    emptyMessage.className = 'selector-empty';
    emptyMessage.textContent = '셀렉터 후보가 없습니다.';
    tabContent.appendChild(emptyMessage);
  }
}

function renderSelectorGroup(candidates, options = {}) {
  const {
    source = 'base',
    event = null,
    resolvedIndex = -1,
    listRef = Array.isArray(candidates) ? candidates : [],
    container = selectorList,
    allowNonUnique = false,
    indices = null,
    mode = 'default'
  } = options;

  const iterateIndices = Array.isArray(indices)
    ? indices
    : Array.isArray(listRef)
      ? listRef.map((_, idx) => idx)
      : Array.isArray(candidates)
        ? candidates.map((_, idx) => idx)
        : [];

  if (!container || !Array.isArray(iterateIndices) || iterateIndices.length === 0) return;

  iterateIndices.forEach((listIndex) => {
    const candidateRef = Array.isArray(listRef) && listRef[listIndex]
      ? listRef[listIndex]
      : (Array.isArray(candidates) ? candidates[listIndex] : null);
    if (!candidateRef || !candidateRef.selector) return;
    const autoCandidate = mode === 'repeat' && candidateRef.__autoDerived ? candidateRef.__autoDerived : null;
    const effectiveCandidate = autoCandidate ? autoCandidate : candidateRef;
    const sourceIndex = typeof effectiveCandidate.__sourceIndex === 'number'
      ? effectiveCandidate.__sourceIndex
      : (typeof candidateRef.__sourceIndex === 'number' ? candidateRef.__sourceIndex : listIndex);
    const displayCandidate = (mode === 'repeat' && effectiveCandidate.rawSelector)
      ? {
          ...effectiveCandidate,
          selector: effectiveCandidate.rawSelector,
          type: effectiveCandidate.rawType || effectiveCandidate.type || inferSelectorType(effectiveCandidate.rawSelector),
          matchCount: effectiveCandidate.rawMatchCount !== undefined ? effectiveCandidate.rawMatchCount : effectiveCandidate.matchCount,
          reason: effectiveCandidate.rawReason || effectiveCandidate.reason || ''
        }
      : effectiveCandidate;
    const selectorType = displayCandidate.type || inferSelectorType(displayCandidate.selector);
    const matchCount = typeof displayCandidate.matchCount === 'number' ? displayCandidate.matchCount : null;
    const contextMatchCount = typeof displayCandidate.contextMatchCount === 'number' ? displayCandidate.contextMatchCount : null;
    const effectiveCount = matchCount !== null ? matchCount : contextMatchCount;
    const isTextSelector = selectorType === 'text';
    if (!allowNonUnique && !isTextSelector) {
      if (effectiveCount !== null && effectiveCount !== 1) {
        return;
      }
      if (displayCandidate.unique === false) {
        return;
      }
    }
    const item = document.createElement('div');
    item.className = 'selector-item';
    const candidateMatchMode = displayCandidate.matchMode || (autoCandidate ? autoCandidate.matchMode : candidateRef.matchMode) || (selectorType === 'text' ? 'exact' : null);
    const primaryMatchMode = event && event.primarySelectorMatchMode
      ? event.primarySelectorMatchMode
      : (selectorType === 'text' ? 'exact' : null);
    const isApplied =
      !!event &&
      event.primarySelector === displayCandidate.selector &&
      (event.primarySelectorType ? event.primarySelectorType === (displayCandidate.type || selectorType) : true) &&
      (selectorType !== 'text' || candidateMatchMode === primaryMatchMode);
    const scoreLabel = typeof displayCandidate.score === 'number'
      ? `${displayCandidate.score}%`
      : (typeof effectiveCandidate.score === 'number' ? `${effectiveCandidate.score}%` : '');
    const typeLabel = (selectorType || 'css').toUpperCase();
    item.innerHTML = `
      <div class="selector-main">
        <span class="type">${typeLabel}</span>
        <span class="sel">${displayCandidate.selector}</span>
        <span class="score">${scoreLabel}</span>
      </div>
      <div class="selector-actions">
        <button class="apply-btn" ${isApplied ? 'style="background: #4CAF50; color: white;"' : ''}>${isApplied ? '✓ 적용됨' : 'Apply'}</button>
        <button class="highlight-btn">Highlight</button>
      </div>
      <div class="reason">${displayCandidate.reason || candidateRef.reason || ''}</div>`;

    const applyBtn = item.querySelector('.apply-btn');
    const highlightBtn = item.querySelector('.highlight-btn');
    if (applyBtn) {
      applyBtn.addEventListener('click', () => {
        applySelector({ ...displayCandidate }, resolvedIndex, source, sourceIndex);
      });
    }
    if (highlightBtn) {
      highlightBtn.addEventListener('click', () => {
        highlightSelector(displayCandidate);
      });
    }

    if (selectorType === 'text') {
      const toggle = document.createElement('div');
      toggle.className = 'match-toggle';
      const exactBtn = document.createElement('button');
      exactBtn.className = 'match-btn';
      exactBtn.textContent = '정확히';
      const containsBtn = document.createElement('button');
      containsBtn.className = 'match-btn';
      containsBtn.textContent = '포함';

      const updateButtons = () => {
        const currentMode = (autoCandidate ? autoCandidate.matchMode : candidateRef.matchMode) || 'exact';
        exactBtn.classList.toggle('active', currentMode === 'exact');
        containsBtn.classList.toggle('active', currentMode === 'contains');
      };

      const setMode = (mode) => {
        if (mode === (candidateRef.matchMode || 'exact')) return;
        candidateRef.matchMode = mode;
        if (candidateRef.__autoDerived) {
          candidateRef.__autoDerived.matchMode = mode;
        }
        if (Array.isArray(listRef) && listRef[listIndex]) {
          listRef[listIndex].matchMode = mode;
          if (listRef[listIndex].__autoDerived) {
            listRef[listIndex].__autoDerived.matchMode = mode;
          }
        }
        if (event) {
          if (source === 'ai') {
            if (!Array.isArray(event.aiSelectorCandidates)) {
              event.aiSelectorCandidates = [];
            }
            if (event.aiSelectorCandidates[sourceIndex]) {
              event.aiSelectorCandidates[sourceIndex].matchMode = mode;
            }
          } else if (Array.isArray(event.selectorCandidates) && event.selectorCandidates[sourceIndex]) {
            event.selectorCandidates[sourceIndex].matchMode = mode;
          }
        }
        if (
          event &&
          event.primarySelector === candidateRef.selector &&
          (event.primarySelectorType ? event.primarySelectorType === selectorType : true)
        ) {
          event.primarySelectorMatchMode = mode;
          applySelector({ ...candidateRef, matchMode: mode }, resolvedIndex, source, sourceIndex);
        }
        if (mode === (candidateRef.matchMode || 'exact')) return;
        candidateRef.matchMode = mode;
        if (Array.isArray(listRef) && listRef[listIndex]) {
          listRef[listIndex].matchMode = mode;
        }
        if (event) {
          if (source === 'ai') {
            if (!Array.isArray(event.aiSelectorCandidates)) {
              event.aiSelectorCandidates = [];
            }
            if (event.aiSelectorCandidates[sourceIndex]) {
              event.aiSelectorCandidates[sourceIndex].matchMode = mode;
            }
          } else if (Array.isArray(event.selectorCandidates) && event.selectorCandidates[sourceIndex]) {
            event.selectorCandidates[sourceIndex].matchMode = mode;
          }
        }
        if (
          event &&
          event.primarySelector === displayCandidate.selector &&
          (event.primarySelectorType ? event.primarySelectorType === selectorType : true)
        ) {
          event.primarySelectorMatchMode = mode;
          applySelector({ ...candidateRef, matchMode: mode }, resolvedIndex, source, sourceIndex);
        }
        updateButtons();
      };

      exactBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setMode('exact');
      });
      containsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setMode('contains');
      });

      toggle.appendChild(exactBtn);
      toggle.appendChild(containsBtn);
      item.appendChild(toggle);
      updateButtons();
    }

    if (mode === 'repeat') {
      const positionInfo = resolveSelectorPosition(event);
      const metaLines = [];
      const displayCount = typeof matchCount === 'number'
        ? matchCount
        : (typeof candidateRef.rawMatchCount === 'number' ? candidateRef.rawMatchCount : effectiveCount);
      if (typeof displayCount === 'number') {
        metaLines.push(`현재 ${displayCount}개 요소와 일치`);
      }
      if (positionInfo && positionInfo.nthOfType) {
        metaLines.push(`선택 시 :nth-of-type(${positionInfo.nthOfType}) 자동 적용`);
      }
      if (metaLines.length) {
        const note = document.createElement('div');
        note.className = 'selector-repeat-note';
        note.textContent = metaLines.join(' • ');
        item.appendChild(note);
      }
    }

    container.appendChild(item);
  });
}

function buildSelectorTabGroups(event, baseCandidates, aiCandidates) {
  const safeBase = Array.isArray(baseCandidates) ? baseCandidates : [];
  const safeAi = Array.isArray(aiCandidates) ? aiCandidates : [];
  const uniqueBaseList = [];
  const uniqueAiList = [];

  const createGroup = (listRef) => ({
    listRef,
    indices: []
  });

  const groups = {
    unique: {
      base: createGroup(uniqueBaseList),
      ai: createGroup(uniqueAiList)
    },
    repeat: {
      base: createGroup(safeBase),
      ai: createGroup(safeAi)
    }
  };

  const addIndex = (group, source, index) => {
    const arr = group[source].indices;
    if (!arr.includes(index)) {
      arr.push(index);
    }
  };

  const registerUnique = (source, candidate, originalIndex, options = {}) => {
    if (!candidate || !candidate.selector) return;
    const targetList = source === 'ai' ? uniqueAiList : uniqueBaseList;
    const stored = { ...candidate, __sourceIndex: originalIndex };
    if (options.derived === true) {
      stored.__derived = true;
    }
    const newIndex = targetList.push(stored) - 1;
    addIndex(groups.unique, source, newIndex);
  };

  const assign = (listRef, source) => {
    if (!Array.isArray(listRef)) return;
    listRef.forEach((candidate, index) => {
      if (!candidate || !candidate.selector) return;
      const finalMatchCount = typeof candidate.matchCount === 'number' ? candidate.matchCount : null;
      const isAlreadyUnique = candidate.unique === true || finalMatchCount === 1;

      if (isAlreadyUnique) {
        registerUnique(source, candidate, index);
      }

      addIndex(groups.repeat, source, index);

      if (isAlreadyUnique) return;

      const derivedCandidate = enforceNthSelectorIfNeeded({ ...candidate }, event);
      if (derivedCandidate && derivedCandidate.unique === true) {
        registerUnique(source, derivedCandidate, index, { derived: true });
        const auto = {
          ...derivedCandidate,
          rawSelector: candidate.selector,
          rawType: candidate.type || inferSelectorType(candidate.selector),
          rawMatchCount: candidate.matchCount,
          rawReason: candidate.reason,
          __sourceIndex: index,
          __derived: true
        };
        listRef[index] = { ...candidate, __autoDerived: auto };
      }
    });
  };

  assign(safeBase, 'base');
  assign(safeAi, 'ai');

  return groups;
}

function getGroupCount(group) {
  if (!group) return 0;
  const baseCount = Array.isArray(group.base?.indices) ? group.base.indices.length : 0;
  const aiCount = Array.isArray(group.ai?.indices) ? group.ai.indices.length : 0;
  return baseCount + aiCount;
}

function updateSelectorTabUI() {
  const {
    grouped,
    active,
    contentEl,
    buttons,
    event,
    resolvedIndex
  } = selectorTabState;
  if (!grouped || !contentEl) return;

  const uniqueCount = getGroupCount(grouped.unique);
  const repeatCount = getGroupCount(grouped.repeat);

  if (buttons && buttons.unique) {
    buttons.unique.textContent = `유일 후보 (${uniqueCount})`;
    buttons.unique.classList.toggle('active', active === 'unique');
    buttons.unique.disabled = uniqueCount === 0;
  }
  if (buttons && buttons.repeat) {
    buttons.repeat.textContent = `반복 구조 후보 (${repeatCount})`;
    buttons.repeat.classList.toggle('active', active === 'repeat');
    buttons.repeat.disabled = repeatCount === 0;
  }

  contentEl.innerHTML = '';
  const currentGroup = grouped[active];
  if (!currentGroup) {
    const empty = document.createElement('div');
    empty.className = 'selector-empty';
    empty.textContent = '셀렉터 후보가 없습니다.';
    contentEl.appendChild(empty);
    return;
  }

  const allowNonUnique = active === 'repeat';
  const mode = allowNonUnique ? 'repeat' : 'default';

  if (active === 'repeat') {
    const info = document.createElement('div');
    info.className = 'selector-repeat-info';
    info.textContent = '반복 구조 후보는 선택 시 위치 기반 :nth-of-type()이 자동 적용됩니다.';
    contentEl.appendChild(info);
  }

  const renderSection = (title, data, source) => {
    if (!data || !Array.isArray(data.indices) || data.indices.length === 0) return;
    const header = document.createElement('div');
    header.className = 'selector-section-title';
    header.textContent = title;
    contentEl.appendChild(header);
    renderSelectorGroup(data.listRef || [], {
      source,
      event,
      resolvedIndex,
      listRef: data.listRef || [],
      container: contentEl,
      allowNonUnique,
      indices: data.indices,
      mode
    });
  };

  const hasAi = Array.isArray(currentGroup.ai?.indices) && currentGroup.ai.indices.length > 0;
  const hasBase = Array.isArray(currentGroup.base?.indices) && currentGroup.base.indices.length > 0;

  renderSection('AI 추천', currentGroup.ai, 'ai');
  renderSection('기본 추천', currentGroup.base, 'base');

  if (!hasAi && !hasBase) {
    const empty = document.createElement('div');
    empty.className = 'selector-empty';
    empty.textContent = active === 'repeat'
      ? '반복 구조 후보가 없습니다.'
      : '유일 후보가 없습니다.';
    contentEl.appendChild(empty);
  }
}

function showIframe(ctx) {
  if (ctx) iframeBanner.classList.remove('hidden'); else iframeBanner.classList.add('hidden');
}

function getTargetPositionInfo(event) {
  if (!event || typeof event !== 'object') return null;
  const target = event.target || null;
  const extractFromPosition = (pos, source) => {
    if (!pos || typeof pos !== 'object') return null;
    const nth = typeof pos.nthOfType === 'number' ? pos.nthOfType : null;
    if (!nth || nth < 1) return null;
    const total = typeof pos.total === 'number' ? pos.total : null;
    return {
      nthOfType: nth,
      total,
      index: typeof pos.index === 'number' ? pos.index : null,
      tag: source && source.tag ? String(source.tag).toLowerCase() : (target && target.tag ? String(target.tag).toLowerCase() : null),
      repeats: source && typeof source.repeats === 'boolean'
        ? source.repeats
        : (typeof total === 'number' ? total > 1 : false)
    };
  };

  const direct = target && target.position ? extractFromPosition(target.position, target) : null;
  if (direct) return direct;

  const targetDomContext = target && target.domContext && target.domContext.self ? target.domContext.self : null;
  const contextSelf = event.domContext && event.domContext.self ? event.domContext.self : null;
  const fallbackSelf = targetDomContext || contextSelf || null;
  if (fallbackSelf && fallbackSelf.position) {
    return extractFromPosition(fallbackSelf.position, fallbackSelf);
  }

  return null;
}

function resolveSelectorPosition(event) {
  const info = getTargetPositionInfo(event);
  if (info && info.nthOfType) {
    if (!info.repeats && event && typeof event.primarySelectorNth === 'number') {
      const nth = event.primarySelectorNth;
      return {
        ...info,
        nthOfType: nth,
        total: info.total || event.primarySelectorNthTotal || null,
        index: typeof info.index === 'number' ? info.index : (nth > 0 ? nth - 1 : null),
        tag: info.tag || event.primarySelectorNthTag || null,
        repeats: true
      };
    }
    return info;
  }
  if (!event || typeof event !== 'object') return info;
  if (typeof event.primarySelectorNth === 'number') {
    const nth = event.primarySelectorNth;
    return {
      nthOfType: nth,
      total: event.primarySelectorNthTotal || null,
      index: typeof event.primarySelectorNthIndex === 'number'
        ? event.primarySelectorNthIndex
        : (nth > 0 ? nth - 1 : null),
      tag: event.primarySelectorNthTag || null,
      repeats: true
    };
  }
  return info;
}

function selectorLikelyStable(selector) {
  if (!selector || typeof selector !== 'string') return false;
  // id, data-* 속성, aria-* 속성 등이 포함되면 충분히 안정적인 것으로 판단
  if (/#/.test(selector)) return true;
  if (/\[data-[^\]=]+=['"][^'"]+['"]/.test(selector)) return true;
  if (/\[aria-[^\]=]+=['"][^'"]+['"]/.test(selector)) return true;
  if (/\[id=['"][^'"]+['"]/.test(selector)) return true;
  return false;
}

function appendNthToSelector(selector, nth) {
  if (!selector || typeof selector !== 'string') return null;
  const trimmed = selector.trim();
  if (!trimmed || /:nth-(child|of-type)\(/i.test(trimmed)) return null;
  const match = trimmed.match(/([^\s>+~]+)$/);
  if (!match) return null;
  const lastPart = match[1];
  const pseudoIndex = lastPart.indexOf(':');
  const basePart = pseudoIndex >= 0 ? lastPart.slice(0, pseudoIndex) : lastPart;
  const pseudoPart = pseudoIndex >= 0 ? lastPart.slice(pseudoIndex) : '';
  const newLastPart = `${basePart}:nth-of-type(${nth})${pseudoPart}`;
  const prefix = match.index ? trimmed.slice(0, match.index) : '';
  return `${prefix}${newLastPart}`;
}

function enforceNthSelectorIfNeeded(candidate, event) {
  if (!candidate || !event) return candidate;
  const type = candidate.type || inferSelectorType(candidate.selector);
  if (!type || type === 'xpath' || type === 'xpath-full') {
    return candidate;
  }
  const positionInfo = getTargetPositionInfo(event);
  if (!positionInfo) return candidate;
  const nth = positionInfo.nthOfType;
  const total = positionInfo.total;
  const matchCount = typeof candidate.matchCount === 'number' ? candidate.matchCount : null;
  const repeated = positionInfo.repeats === true || (typeof positionInfo.total === 'number' && positionInfo.total > 1);
  const needsNth =
    (matchCount !== null && matchCount > 1) ||
    candidate.unique === false ||
    (!selectorLikelyStable(candidate.selector) && repeated);
  if (!needsNth) return candidate;
  const reasonParts = (candidate.reason ? candidate.reason.split(' • ') : []).filter(Boolean);
  const nthLabel = `nth-of-type(${nth}) 적용`;

  if (type === 'text') {
    const filtered = reasonParts.filter((part) => !/개 요소와 일치|유일 일치/.test(part));
    if (!reasonParts.includes(nthLabel)) {
      filtered.push(nthLabel);
    }
    return {
      ...candidate,
      reason: filtered.join(' • '),
      unique: true,
      matchCount: 1,
      __nthApplied: nth,
      __nthTotal: total,
      __nthTag: positionInfo.tag || null
    };
  }

  const appended = appendNthToSelector(candidate.selector, nth);
  if (!appended) return candidate;
  if (!reasonParts.includes(nthLabel)) {
    reasonParts.push(nthLabel);
  }
  const filtered = reasonParts.filter((part) => !/개 요소와 일치|유일 일치/.test(part));
  if (!filtered.includes(nthLabel)) {
    filtered.push(nthLabel);
  }
  return {
    ...candidate,
    selector: appended,
    reason: filtered.join(' • '),
    unique: true,
    matchCount: 1,
    __nthApplied: nth,
    __nthTotal: total,
    __nthTag: positionInfo.tag || null
  };
}

function mergeCandidateIntoCollection(collection, listIndex, candidateToApply) {
  if (!Array.isArray(collection) || listIndex < 0 || listIndex >= collection.length) return;
  const existing = collection[listIndex] || null;
  const merged = existing ? { ...existing, ...candidateToApply } : { ...candidateToApply };
  if (existing) {
    const shouldPreserveSelector =
      existing.selector &&
      existing.rawSelector &&
      existing.selector !== existing.rawSelector &&
      candidateToApply.selector === existing.rawSelector;
    if (shouldPreserveSelector) {
      merged.selector = existing.selector;
      merged.type = existing.type;
      merged.reason = existing.reason;
      if (existing.matchCount !== undefined) merged.matchCount = existing.matchCount;
      if (existing.unique !== undefined) merged.unique = existing.unique;
      if (existing.uniqueInContext !== undefined) merged.uniqueInContext = existing.uniqueInContext;
    }
    if (existing.rawSelector !== undefined && merged.rawSelector === undefined) {
      merged.rawSelector = existing.rawSelector;
    }
    if (existing.rawType !== undefined && merged.rawType === undefined) {
      merged.rawType = existing.rawType;
    }
    if (existing.rawReason !== undefined && merged.rawReason === undefined) {
      merged.rawReason = existing.rawReason;
    }
    if (existing.rawMatchCount !== undefined && merged.rawMatchCount === undefined) {
      merged.rawMatchCount = existing.rawMatchCount;
    }
  }
  delete merged.__autoDerived;
  collection[listIndex] = merged;
}

function applySelector(s, eventIndex, source = 'base', listIndex = -1) {
  const targetIndex = eventIndex !== undefined && eventIndex !== null ? eventIndex : currentEventIndex;
  if (targetIndex < 0) {
    alert('먼저 타임라인에서 이벤트를 선택하세요.');
    return;
  }
  chrome.storage.local.get({events:[]}, res => {
    const evs = res.events || [];
    if (targetIndex >= 0 && targetIndex < evs.length) {
      const targetEvent = evs[targetIndex];
      let candidateToApply = enforceNthSelectorIfNeeded({ ...s }, targetEvent) || { ...s };
      const selectorType = candidateToApply.type || inferSelectorType(candidateToApply.selector);

      if (source === 'ai') {
        if (!Array.isArray(targetEvent.aiSelectorCandidates)) {
          targetEvent.aiSelectorCandidates = [];
        }
        mergeCandidateIntoCollection(targetEvent.aiSelectorCandidates, listIndex, candidateToApply);
      } else if (Array.isArray(targetEvent.selectorCandidates)) {
        mergeCandidateIntoCollection(targetEvent.selectorCandidates, listIndex, candidateToApply);
      }

      targetEvent.primarySelector = candidateToApply.selector;
      targetEvent.primarySelectorType = selectorType;
      if (selectorType === 'text') {
        targetEvent.primarySelectorMatchMode = candidateToApply.matchMode || 'exact';
      } else {
        delete targetEvent.primarySelectorMatchMode;
      }
      if (selectorType === 'text' && candidateToApply.textValue) {
        targetEvent.primarySelectorText = candidateToApply.textValue;
      } else {
        delete targetEvent.primarySelectorText;
      }
      if (selectorType === 'xpath' && (candidateToApply.xpathValue || s.xpathValue)) {
        targetEvent.primarySelectorXPath = candidateToApply.xpathValue || s.xpathValue;
      } else if (selectorType !== 'xpath') {
        delete targetEvent.primarySelectorXPath;
      }
      if (candidateToApply.__nthApplied) {
        targetEvent.primarySelectorNth = candidateToApply.__nthApplied;
        targetEvent.primarySelectorNthTotal = candidateToApply.__nthTotal || null;
        targetEvent.primarySelectorNthTag = candidateToApply.__nthTag || null;
      } else {
        delete targetEvent.primarySelectorNth;
        delete targetEvent.primarySelectorNthTotal;
        delete targetEvent.primarySelectorNthTag;
      }

      chrome.storage.local.set({events: evs}, () => {
        if (allEvents[targetIndex]) {
          allEvents[targetIndex].primarySelector = candidateToApply.selector;
          allEvents[targetIndex].primarySelectorType = selectorType;
          if (selectorType === 'text') {
            allEvents[targetIndex].primarySelectorMatchMode = targetEvent.primarySelectorMatchMode;
            if (candidateToApply.textValue) {
              allEvents[targetIndex].primarySelectorText = candidateToApply.textValue;
            } else {
              delete allEvents[targetIndex].primarySelectorText;
            }
          } else {
            delete allEvents[targetIndex].primarySelectorMatchMode;
            delete allEvents[targetIndex].primarySelectorText;
          }
          if (selectorType === 'xpath' && (candidateToApply.xpathValue || s.xpathValue)) {
            allEvents[targetIndex].primarySelectorXPath = candidateToApply.xpathValue || s.xpathValue;
          } else if (selectorType !== 'xpath') {
            delete allEvents[targetIndex].primarySelectorXPath;
          }
          if (candidateToApply.__nthApplied) {
            allEvents[targetIndex].primarySelectorNth = candidateToApply.__nthApplied;
            allEvents[targetIndex].primarySelectorNthTotal = candidateToApply.__nthTotal || null;
            allEvents[targetIndex].primarySelectorNthTag = candidateToApply.__nthTag || null;
          } else {
            delete allEvents[targetIndex].primarySelectorNth;
            delete allEvents[targetIndex].primarySelectorNthTotal;
            delete allEvents[targetIndex].primarySelectorNthTag;
          }
          if (source === 'ai') {
            allEvents[targetIndex].aiSelectorCandidates = targetEvent.aiSelectorCandidates;
          } else if (Array.isArray(targetEvent.selectorCandidates)) {
            allEvents[targetIndex].selectorCandidates = targetEvent.selectorCandidates;
          }
        }
        const timelineItem = document.querySelector(`[data-event-index="${targetIndex}"]`);
        if (timelineItem) {
          const usedSelector = candidateToApply.selector;
          timelineItem.textContent = new Date(targetEvent.timestamp).toLocaleTimeString() + ' - ' + targetEvent.action + ' - ' + usedSelector;
        }
        if (currentEventIndex === targetIndex && allEvents[targetIndex]) {
          showSelectors(null, allEvents[targetIndex], targetIndex);
        }
        updateCode({ refreshTimeline: true, preserveSelection: true });
      });
    }
  });
}

function highlightSelector(candidate) {
  withActiveTab((tab) => {
    if (!tab) return;
    chrome.scripting.executeScript({
      target:{tabId:tab.id},
      func: (selCandidate)=>{
        function findByCandidate(cand) {
          if (!cand) return null;
          const selector = cand.selector || '';
          const type = cand.type || null;
          try {
            if (type === 'xpath' || selector.startsWith('xpath=')) {
              const expression = selector.startsWith('xpath=') ? selector.slice(6) : selector;
              const res = document.evaluate(expression, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
              return res.singleNodeValue || null;
            }
            if (type === 'text' || selector.startsWith('text=')) {
              const raw = selector.replace(/^text=/, '');
              const trimmed = raw.replace(/^['"]|['"]$/g, '');
              const decoded = trimmed.replace(/\\"/g, '"').replace(/\\'/g, "'");
              return Array.from(document.querySelectorAll('*')).find(x => (x.innerText||'').trim().includes(decoded));
            }
            return document.querySelector(selector);
          } catch(err) {
            return null;
          }
        }

        try {
          const el = findByCandidate(selCandidate);
        if (!el) return;
          const prev = {
            outline: el.style.outline,
            outlineOffset: el.style.outlineOffset
          };
        el.style.outline = '3px solid rgba(0,150,136,0.8)';
          el.style.outlineOffset = '2px';
          setTimeout(()=> {
            el.style.outline = prev.outline;
            el.style.outlineOffset = prev.outlineOffset;
          }, 1500);
      } catch(e){}
      },
      args:[candidate]
    });
  });
}

function setElementStatus(message, tone = 'info') {
  if (!elementStatusEl) return;
  elementStatusEl.textContent = message || '';
  elementStatusEl.setAttribute('data-tone', tone || 'info');
  elementStatusEl.style.display = message ? 'block' : 'none';
}

function updateElementButtonState() {
  if (!elementSelectBtn) return;
  if (selectionState.active) {
    elementSelectBtn.classList.add('active');
    elementSelectBtn.textContent = '선택 중단';
  } else {
    elementSelectBtn.classList.remove('active');
    elementSelectBtn.textContent = '요소 선택';
  }
}

function ensureElementPanelVisibility() {
  if (!elementPanel) return;
  if (selectionState.active || selectionState.stack.length > 0) {
    elementPanel.classList.remove('hidden');
  } else {
    elementPanel.classList.add('hidden');
  }
}

function resetSelectionUI() {
  if (elementPathItems) elementPathItems.innerHTML = '';
  if (elementPathContainer) elementPathContainer.classList.add('hidden');
  if (elementCandidatesContainer) elementCandidatesContainer.innerHTML = '';
  if (elementActionsContainer) elementActionsContainer.classList.add('hidden');
  if (elementAttrPanel) elementAttrPanel.classList.add('hidden');
  if (elementAttrNameInput) elementAttrNameInput.value = '';
  if (elementCodePreview) elementCodePreview.classList.add('hidden');
  if (elementCodeEl) elementCodeEl.textContent = '';
}

function resetSelectionState(options = {}) {
  selectionState.active = false;
  selectionState.stage = 'idle';
  selectionState.stack = [];
  selectionState.pendingAction = null;
  selectionState.pendingAttribute = '';
  selectionState.codePreview = '';
  if (!options.keepStatus) {
    setElementStatus('');
  }
  resetSelectionUI();
  updateElementButtonState();
  ensureElementPanelVisibility();
}

function getCurrentSelectionNode() {
  if (!selectionState.stack.length) return null;
  return selectionState.stack[selectionState.stack.length - 1];
}

function renderSelectionPath() {
  if (!elementPathItems || !elementPathContainer) return;
  elementPathItems.innerHTML = '';
  if (selectionState.stack.length === 0) {
    elementPathContainer.classList.add('hidden');
    return;
  }
  elementPathContainer.classList.remove('hidden');
  selectionState.stack.forEach((node, index) => {
    const item = document.createElement('div');
    item.className = 'element-path-item';
    const label = index === 0 ? 'ROOT' : `CHILD ${index}`;
    const selected = node.selectedCandidate ? node.selectedCandidate.selector : '(미선택)';
    item.innerHTML = `<span class="label">${label}</span><span class="value">${selected}</span>`;
    elementPathItems.appendChild(item);
  });
}

function createSelectionCandidateItem(node, candidate) {
  const item = document.createElement('div');
  item.className = 'selector-item';
  const selectorType = candidate.type || inferSelectorType(candidate.selector);
  const relationLabel = candidate.relation === 'relative' ? ' (REL)' : '';
  const scoreLabel = typeof candidate.score === 'number' ? `${candidate.score}%` : '';
  const badges = [];
  if (candidate.unique === true) badges.push('유일');
  if (typeof candidate.matchCount === 'number' && candidate.matchCount > 1) {
    badges.push(`${candidate.matchCount}개 일치`);
  }
  if (candidate.relation === 'relative' && typeof candidate.contextMatchCount === 'number') {
    badges.push(`부모 내 ${candidate.contextMatchCount}개`);
  }
  const badgeLine = badges.filter(Boolean).join(' • ');
  const isSelected = node.selectedCandidate && node.selectedCandidate.selector === candidate.selector && (node.selectedCandidate.type || inferSelectorType(node.selectedCandidate.selector)) === (candidate.type || inferSelectorType(candidate.selector));
  item.innerHTML = `
    <div class="selector-main">
      <span class="type">${(selectorType || 'css').toUpperCase()}${relationLabel}</span>
      <span class="sel">${candidate.selector}</span>
      <span class="score">${scoreLabel}</span>
    </div>
    <div class="selector-actions">
      <button class="apply-btn" ${isSelected ? 'style="background: #4CAF50; color: white;"' : ''}>${isSelected ? '✓ 선택됨' : '선택'}</button>
    </div>
    <div class="reason">${[candidate.reason || '', badgeLine].filter(Boolean).join(' • ')}</div>`;
  const applyBtn = item.querySelector('.apply-btn');
  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      applyCandidateToNode(node, candidate);
    });
  }
  if (selectorType === 'text') {
    if (!candidate.matchMode) candidate.matchMode = 'exact';
    const toggle = document.createElement('div');
    toggle.className = 'match-toggle';
    const exactBtn = document.createElement('button');
    exactBtn.className = 'match-btn';
    exactBtn.textContent = '정확히';
    const containsBtn = document.createElement('button');
    containsBtn.className = 'match-btn';
    containsBtn.textContent = '포함';

    const refresh = () => {
      const mode = candidate.matchMode || 'exact';
      exactBtn.classList.toggle('active', mode === 'exact');
      containsBtn.classList.toggle('active', mode === 'contains');
      if (node.selectedCandidate && node.selectedCandidate.selector === candidate.selector) {
        node.selectedCandidate.matchMode = mode;
        updateSelectionCodePreview();
      }
    };

    const setMode = (mode) => {
      if (candidate.matchMode === mode) return;
      candidate.matchMode = mode;
      if (node && node.candidates) {
        const index = node.candidates.indexOf(candidate);
        if (index >= 0) {
          node.candidates[index].matchMode = mode;
        }
      }
      refresh();
    };

    exactBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setMode('exact');
    });
    containsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setMode('contains');
    });

    toggle.appendChild(exactBtn);
    toggle.appendChild(containsBtn);
    item.appendChild(toggle);
    refresh();
  }
  return item;
}

function renderSelectionCandidates(node) {
  if (!elementCandidatesContainer || !node) return;
  elementCandidatesContainer.innerHTML = '';
  const candidates = node.candidates || [];
  if (!candidates.length) {
    const empty = document.createElement('div');
    empty.style.padding = '8px';
    empty.style.color = '#777';
    empty.textContent = '후보가 없습니다.';
    elementCandidatesContainer.appendChild(empty);
    return;
  }
  candidates.forEach((candidate) => {
    elementCandidatesContainer.appendChild(createSelectionCandidateItem(node, candidate));
  });
}

function updateSelectionActionsVisibility() {
  if (!elementActionsContainer) return;
  const currentNode = getCurrentSelectionNode();
  if (currentNode && currentNode.selectedCandidate) {
    elementActionsContainer.classList.remove('hidden');
  } else {
    elementActionsContainer.classList.add('hidden');
  }
  if (elementAttrPanel) elementAttrPanel.classList.add('hidden');
  if (elementAttrNameInput) elementAttrNameInput.value = '';
}

function buildSelectionPathArray() {
  return selectionState.stack
    .map((node) => {
      if (!node.selectedCandidate) return null;
      const candidate = node.selectedCandidate;
      return {
        selector: candidate.selector,
        type: candidate.type || inferSelectorType(candidate.selector),
        textValue: candidate.textValue || null,
        xpathValue: candidate.xpathValue || null,
        relation: candidate.relation || null,
        reason: candidate.reason || '',
        matchMode: candidate.matchMode || null,
        iframeContext: (node.element && node.element.iframeContext) || null
      };
    })
    .filter(Boolean);
}

function updateSelectionCodePreview() {
  if (!elementCodePreview || !elementCodeEl) return;
  const path = buildSelectionPathArray();
  if (!path.length) {
    elementCodePreview.classList.add('hidden');
    elementCodeEl.textContent = '';
    return;
  }
  const previewLines = buildSelectionPreviewLines(path, selectedFramework, selectedLanguage);
  elementCodeEl.textContent = previewLines.join('\n');
  elementCodePreview.classList.remove('hidden');
}

function applyCandidateToNode(node, candidate) {
  if (!node) return;
  node.selectedCandidate = {
    ...candidate,
    type: candidate.type || inferSelectorType(candidate.selector)
  };
  renderSelectionCandidates(node);
  renderSelectionPath();
  selectionState.stage = 'await-action';
  setElementStatus('동작을 선택하세요.', 'info');
  updateSelectionActionsVisibility();
  updateSelectionCodePreview();
}

function startSelectionWorkflow() {
  resetSelectionState({keepStatus: true});
  selectionState.active = true;
  selectionState.stage = 'await-root';
  setElementStatus('페이지에서 요소를 클릭하세요.', 'info');
  ensureElementPanelVisibility();
  updateElementButtonState();
  requestElementPick('root');
}

function cancelSelectionWorkflow(message = '', tone = 'info') {
  if (selectionState.active || selectionState.stage !== 'idle') {
    sendSelectionMessage({type: 'ELEMENT_SELECTION_CANCEL'}, () => {});
  }
  resetSelectionState({keepStatus: true});
  if (message) {
    setElementStatus(message, tone);
  } else {
    setElementStatus('');
  }
}

function sendSelectionMessage(payload, callback) {
  withActiveTab((tab) => {
    if (!tab) {
      if (callback) callback({ok: false, reason: 'no_active_tab'});
      return;
    }
    sendMessageWithInjection(tab.id, payload, (response, error) => {
      if (error) {
        if (callback) callback({ok: false, reason: error.message});
        return;
      }
      if (callback) callback(response || {ok: true});
    });
  });
}

function requestElementPick(mode) {
  const message = mode === 'child' ? {type: 'ELEMENT_SELECTION_PICK_CHILD'} : {type: 'ELEMENT_SELECTION_START'};
  sendSelectionMessage(message, (resp) => {
    if (resp && resp.ok === false && resp.reason) {
      setElementStatus(`요소 선택을 시작할 수 없습니다: ${resp.reason}`, 'error');
      if (mode === 'root') {
        cancelSelectionWorkflow('', 'info');
      }
    }
  });
}

function handleElementSelectionPicked(msg) {
  if (!selectionState.active) {
    selectionState.active = true;
    updateElementButtonState();
  }
  const candidates = (msg.selectors || []).map((cand) => ({
    ...cand,
    type: cand.type || inferSelectorType(cand.selector)
  }));
  const node = {
    element: msg.element || {},
    candidates,
    selectedCandidate: null,
    stage: msg.stage || (selectionState.stack.length === 0 ? 'root' : 'child')
  };
  selectionState.stack.push(node);
  selectionState.stage = 'await-candidate';
  renderSelectionPath();
  renderSelectionCandidates(node);
  updateSelectionActionsVisibility();
  updateSelectionCodePreview();
  ensureElementPanelVisibility();
  setElementStatus('후보 중 하나를 선택하세요.', 'info');
}

function handleElementSelectionError(msg) {
  const reason = msg && msg.reason ? msg.reason : '요소를 선택할 수 없습니다.';
  setElementStatus(reason, 'error');
  const stage = msg && msg.stage ? msg.stage : 'root';
  if (selectionState.active) {
    requestElementPick(stage === 'child' ? 'child' : 'root');
  }
}

function handleElementSelectionCancelled() {
  if (!selectionState.active && selectionState.stack.length === 0) return;
  cancelSelectionWorkflow('페이지에서 요소 선택이 취소되었습니다.', 'info');
}

function handleElementAction(action) {
  if (!action) return;
  const currentNode = getCurrentSelectionNode();
  if (!currentNode || !currentNode.selectedCandidate) {
    setElementStatus('먼저 후보를 선택하세요.', 'error');
    return;
  }
  switch (action) {
    case 'click':
      applySelectionAction('click');
      break;
    case 'text':
      applySelectionAction('extract_text');
      break;
    case 'value':
      applySelectionAction('get_attribute', {attributeName: 'value'});
      break;
    case 'attribute':
      if (elementAttrPanel) {
        elementAttrPanel.classList.remove('hidden');
      }
      if (elementAttrNameInput) {
        elementAttrNameInput.value = '';
        elementAttrNameInput.focus();
      }
      selectionState.pendingAction = 'attribute';
      setElementStatus('추출할 속성명을 입력하고 적용을 누르세요.', 'info');
      break;
    case 'child':
      startChildSelection();
      break;
    case 'parent':
      startParentSelection();
      break;
    case 'commit':
      applySelectionAction('commit');
      break;
    case 'finish':
      cancelSelectionWorkflow('요소 선택을 종료했습니다.');
      break;
    default:
      break;
  }
}

function startChildSelection() {
  const currentNode = getCurrentSelectionNode();
  if (!currentNode || !currentNode.selectedCandidate) {
    setElementStatus('먼저 후보를 선택하세요.', 'error');
    return;
  }
  selectionState.stage = 'await-child';
  updateSelectionActionsVisibility();
  setElementStatus('부모 요소 내부에서 자식 요소를 클릭하세요.', 'info');
  requestElementPick('child');
}

function startParentSelection() {
  const currentNode = getCurrentSelectionNode();
  if (!currentNode || !currentNode.selectedCandidate) {
    setElementStatus('먼저 후보를 선택하세요.', 'error');
    return;
  }
  selectionState.stage = 'await-parent';
  updateSelectionActionsVisibility();
  setElementStatus('상위 요소 정보를 가져오는 중입니다...', 'info');
  sendSelectionMessage({type: 'ELEMENT_SELECTION_PICK_PARENT'}, (resp) => {
    if (resp && resp.ok === false) {
      selectionState.stage = 'await-action';
      updateSelectionActionsVisibility();
      let message = '상위 요소를 찾을 수 없습니다.';
      if (resp.reason === 'no_parent') {
        message = '더 이상 상위 요소가 없습니다.';
      } else if (resp.reason === 'current_not_selected') {
        message = '먼저 요소를 선택하세요.';
      }
      setElementStatus(message, 'error');
    }
  });
}

function buildManualActionEntry(actionType, path, options = {}) {
  if (!path || !path.length) return null;
  const serial = manualActionSerial++;
  const entry = {
    id: `manual-${Date.now()}-${serial}`,
    serial,
    actionType,
    path,
    createdAt: Date.now(),
    iframeContext: path[path.length - 1] && path[path.length - 1].iframeContext ? path[path.length - 1].iframeContext : null
  };
  if (actionType === 'extract_text') {
    entry.resultName = options.resultName || `text_result_${serial}`;
  }
  if (actionType === 'get_attribute') {
    const attrName = (options.attributeName || selectionState.pendingAttribute || '').trim();
    if (!attrName) return null;
    entry.attributeName = attrName;
    entry.resultName = options.resultName || `${attrName}_value_${serial}`;
  }
  return entry;
}

/**
 * ExtensionEvent 형식으로 변환 및 키워드 기반 TC 스텝 생성 함수들
 */

/**
 * DOM 경로 생성 헬퍼
 * @param {object} event - 이벤트 객체
 * @returns {string|undefined} DOM 경로 문자열
 */
function buildDomPathFromEvent(event) {
  if (!event || !event.target) {
    return undefined;
  }
  
  // target.domContext가 있으면 사용
  if (event.target.domContext) {
    // domContext가 문자열이면 그대로 반환
    if (typeof event.target.domContext === 'string') {
      return event.target.domContext;
    }
    // 객체면 경로를 구성
    if (typeof event.target.domContext === 'object') {
      // 간단한 경로 구성 (실제 구현은 domContext 구조에 따라 달라질 수 있음)
      const parts = [];
      if (event.target.tag) {
        parts.push(event.target.tag.toLowerCase());
      }
      if (event.target.id) {
        parts.push(`#${event.target.id}`);
      }
      if (event.target.classes && event.target.classes.length > 0) {
        parts.push(`.${event.target.classes[0]}`);
      }
      return parts.length > 0 ? parts.join('') : undefined;
    }
  }
  
  // primarySelector를 기반으로 경로 추정
  if (event.primarySelector) {
    return event.primarySelector;
  }
  
  return undefined;
}

/**
 * 현재 이벤트를 ExtensionEvent 형식으로 변환
 * @param {object} event - 현재 이벤트 객체
 * @param {object} selectorInfo - 셀렉터 정보
 * @returns {object} ExtensionEvent 형식 객체
 */
function convertToElectronFormat(event, selectorInfo) {
  if (!event) return null;
  
  // target 셀렉터 결정
  const target = event.primarySelector || 
    (selectorInfo?.selector) ||
    (event.selectorCandidates?.[0]?.selector) || 
    '';
  
  // alternativeSelectors 생성
  const alternativeSelectors = (event.selectorCandidates || [])
    .slice(1) // 첫 번째는 target이므로 제외
    .map(c => c && c.selector ? c.selector : null)
    .filter(Boolean);
  
  // uniqueness 계산
  let uniqueness = 'not-found';
  if (event.target) {
    if (event.target.repeats === false) {
      uniqueness = 'unique';
    } else if (event.target.repeats === true) {
      uniqueness = 'multiple';
    }
  } else if (target) {
    // 셀렉터가 있으면 기본적으로 unique로 가정 (실제 검증 필요)
    uniqueness = 'unique';
  }
  
  // DOM 경로 생성
  const domPath = buildDomPathFromEvent(event);
  
  // action 매핑 (input -> type)
  let action = event.action;
  if (action === 'input') {
    action = 'type';
  }
  
  // selectorType 결정
  const selectorType = event.primarySelectorType || 
    selectorInfo?.type || 
    (target.startsWith('//') || target.startsWith('(') ? 'xpath' : 
     target.startsWith('text=') ? 'text' : 'css');
  
  return {
    action: action,
    timestamp: event.timestamp || Date.now(),
    target: target,
    alternativeSelectors: alternativeSelectors,
    selectorType: selectorType,
    uniqueness: uniqueness,
    value: event.value !== undefined && event.value !== null ? String(event.value) : undefined,
    url: event.page?.url || undefined,
    title: event.page?.title || undefined,
    domPath: domPath || undefined,
    description: undefined,
    screenshot: undefined
  };
}

/**
 * Electron 형식 이벤트를 키워드 스텝으로 변환
 * @param {object} electronEvent - ExtensionEvent 형식 객체
 * @param {number} stepNumber - 스텝 번호
 * @returns {object|null} 키워드 스텝 객체
 */
function convertEventToKeywordStep(electronEvent, stepNumber) {
  if (!electronEvent || !electronEvent.action) {
    return null;
  }
  
  const step = {
    stepNumber: stepNumber,
    keyword: electronEvent.action,
    timestamp: electronEvent.timestamp,
    args: [],
    metadata: {}
  };
  
  // action별 인자 구성
  switch (electronEvent.action) {
    case 'goto':
    case 'open':
      step.args = [electronEvent.target]; // URL
      step.metadata = {
        url: electronEvent.url,
        title: electronEvent.title
      };
      break;
      
    case 'click':
      step.args = [electronEvent.target];
      step.metadata = {
        selectorType: electronEvent.selectorType,
        uniqueness: electronEvent.uniqueness,
        alternativeSelectors: electronEvent.alternativeSelectors,
        domPath: electronEvent.domPath,
        url: electronEvent.url
      };
      break;
      
    case 'type':
    case 'setText':
      step.args = [electronEvent.target];
      if (electronEvent.value) {
        step.args.push(electronEvent.value);
      }
      step.metadata = {
        selectorType: electronEvent.selectorType,
        uniqueness: electronEvent.uniqueness,
        alternativeSelectors: electronEvent.alternativeSelectors,
        domPath: electronEvent.domPath,
        url: electronEvent.url
      };
      break;
      
    case 'clear':
      step.args = [electronEvent.target];
      step.metadata = {
        selectorType: electronEvent.selectorType,
        uniqueness: electronEvent.uniqueness,
        alternativeSelectors: electronEvent.alternativeSelectors,
        url: electronEvent.url
      };
      break;
      
    case 'select':
      step.args = [electronEvent.target];
      if (electronEvent.value) {
        step.args.push(electronEvent.value);
      }
      step.metadata = {
        selectorType: electronEvent.selectorType,
        uniqueness: electronEvent.uniqueness,
        alternativeSelectors: electronEvent.alternativeSelectors,
        url: electronEvent.url
      };
      break;
      
    case 'hover':
    case 'doubleClick':
    case 'rightClick':
      step.args = [electronEvent.target];
      step.metadata = {
        selectorType: electronEvent.selectorType,
        uniqueness: electronEvent.uniqueness,
        alternativeSelectors: electronEvent.alternativeSelectors,
        url: electronEvent.url
      };
      break;
      
    case 'verifyText':
      step.args = [electronEvent.target];
      if (electronEvent.value) {
        step.args.push(electronEvent.value);
      }
      step.metadata = {
        selectorType: electronEvent.selectorType,
        uniqueness: electronEvent.uniqueness,
        url: electronEvent.url
      };
      break;
      
    case 'verifyElementPresent':
    case 'verifyElementNotPresent':
      step.args = [electronEvent.target];
      step.metadata = {
        selectorType: electronEvent.selectorType,
        uniqueness: electronEvent.uniqueness,
        url: electronEvent.url
      };
      break;
      
    case 'verifyTitle':
      step.args = [];
      if (electronEvent.value) {
        step.args.push(electronEvent.value); // 타이틀 텍스트
      }
      step.metadata = {
        url: electronEvent.url
      };
      break;
      
    case 'verifyUrl':
      step.args = [];
      if (electronEvent.value) {
        step.args.push(electronEvent.value); // URL
      }
      step.metadata = {};
      break;
      
    case 'waitForElement':
      step.args = [electronEvent.target];
      if (electronEvent.value) {
        step.args.push(electronEvent.value); // 대기 시간
      }
      step.metadata = {
        selectorType: electronEvent.selectorType,
        url: electronEvent.url
      };
      break;
      
    case 'wait':
    case 'sleep':
      step.args = [];
      if (electronEvent.value) {
        step.args.push(electronEvent.value); // 대기 시간
      }
      step.metadata = {
        url: electronEvent.url
      };
      break;
      
    default:
      // 알 수 없는 action은 그대로 전달
      step.args = electronEvent.target ? [electronEvent.target] : [];
      if (electronEvent.value) {
        step.args.push(electronEvent.value);
      }
      step.metadata = {
        selectorType: electronEvent.selectorType,
        uniqueness: electronEvent.uniqueness,
        url: electronEvent.url
      };
  }
  
  // description이 있으면 추가
  if (electronEvent.description) {
    step.description = electronEvent.description;
  }
  
  return step;
}

/**
 * 수동 액션을 키워드 스텝으로 변환
 * @param {object} action - 수동 액션 객체
 * @param {number} stepNumber - 스텝 번호
 * @returns {object|null} 키워드 스텝 객체
 */
function convertManualActionToKeywordStep(action, stepNumber) {
  if (!action || !Array.isArray(action.path) || !action.path.length) {
    return null;
  }
  
  const lastPathItem = action.path[action.path.length - 1];
  const selector = lastPathItem?.selector || '';
  
  const step = {
    stepNumber: stepNumber,
    keyword: action.actionType || 'click',
    timestamp: action.createdAt || Date.now(),
    args: [selector],
    metadata: {
      manual: true,
      actionType: action.actionType
    }
  };
  
  if (action.actionType === 'extract_text') {
    step.keyword = 'extractText';
    if (action.resultName) {
      step.metadata.resultName = action.resultName;
    }
  } else if (action.actionType === 'get_attribute') {
    step.keyword = 'getAttribute';
    if (action.attributeName) {
      step.args.push(action.attributeName);
    }
    if (action.resultName) {
      step.metadata.resultName = action.resultName;
    }
  }
  
  return step;
}

/**
 * Timeline을 키워드 기반 TC 스텝 배열로 변환
 * @param {Array} timeline - buildActionTimeline() 결과
 * @returns {Array} 키워드 기반 TC 스텝 배열
 */
function generateKeywordBasedSteps(timeline) {
  if (!Array.isArray(timeline)) {
    return [];
  }
  
  const steps = [];
  
  timeline.forEach((entry, index) => {
    if (entry.kind === 'event') {
      const { event, selectorInfo } = entry;
      const electronEvent = convertToElectronFormat(event, selectorInfo);
      if (electronEvent) {
        const step = convertEventToKeywordStep(electronEvent, steps.length + 1);
        if (step) {
          steps.push(step);
        }
      }
    } else if (entry.kind === 'manual') {
      const step = convertManualActionToKeywordStep(entry.action, steps.length + 1);
      if (step) {
        steps.push(step);
      }
    }
  });
  
  return steps;
}

/**
 * 키워드 기반 TC를 JSON 형식으로 내보내기
 * @param {string} testCaseName - 테스트 케이스 이름
 * @param {Function} callback - 콜백 함수 (jsonString, steps) => void
 */
function exportKeywordBasedTC(testCaseName, callback) {
  chrome.runtime.sendMessage({type:'GET_EVENTS'}, (res) => {
    const events = (res && res.events) || [];
    const normalizedEvents = events.map(normalizeEventRecord);
    
    loadManualActions((manualActions) => {
      const timeline = buildActionTimeline(normalizedEvents, manualActions);
      const keywordSteps = generateKeywordBasedSteps(timeline);
      
      const testCase = {
        name: testCaseName || 'Recorded Test Case',
        steps: keywordSteps,
        metadata: {
          createdAt: Date.now(),
          totalSteps: keywordSteps.length,
          version: '1.0'
        }
      };
      
      const json = JSON.stringify(testCase, null, 2);
      
      if (callback) {
        callback(json, keywordSteps);
      }
    });
  });
}

/**
 * Verify 액션 추가
 */
function handleVerifyAction(verifyType) {
  if (verifyType === 'verifyTitle' || verifyType === 'verifyUrl') {
    // 타이틀/URL 검증은 요소 선택 불필요
    addVerifyAction(verifyType, null, null);
    return;
  }
  
  // 요소 검증은 요소 선택 필요
  const path = buildSelectionPathArray();
  if (!path.length) {
    // 요소 선택 모드로 전환
    if (!selectionState.active) {
      startElementSelection();
    }
    setElementStatus('검증할 요소를 선택하세요.', 'info');
    // verify 액션을 pending으로 설정
    selectionState.pendingAction = verifyType;
    if (verifyActionsContainer) {
      verifyActionsContainer.classList.add('hidden');
    }
    if (elementActionsContainer) {
      elementActionsContainer.classList.remove('hidden');
    }
    return;
  }
  
  let value = null;
  if (verifyType === 'verifyText') {
    // 텍스트 검증은 현재 요소의 텍스트를 가져와야 함
    const lastPathItem = path[path.length - 1];
    if (lastPathItem && lastPathItem.textValue) {
      value = lastPathItem.textValue;
    } else {
      // 사용자에게 텍스트 입력 요청
      const textValue = prompt('검증할 텍스트를 입력하세요:');
      if (textValue === null) return; // 취소
      value = textValue;
    }
  }
  
  addVerifyAction(verifyType, path, value);
}

/**
 * Wait 액션 추가
 */
function handleWaitAction(waitType) {
  if (waitType === 'wait') {
    // 시간 대기는 입력 패널 표시
    if (waitInputPanel) {
      waitInputPanel.classList.remove('hidden');
    }
    if (waitTimeInput) {
      waitTimeInput.focus();
    }
    return;
  }
  
  if (waitType === 'waitForElement') {
    // 요소 대기는 요소 선택 필요
    const path = buildSelectionPathArray();
    if (!path.length) {
      // 요소 선택 모드로 전환
      if (!selectionState.active) {
        startElementSelection();
      }
      setElementStatus('대기할 요소를 선택하세요.', 'info');
      selectionState.pendingAction = 'waitForElement';
      if (waitActionsContainer) {
        waitActionsContainer.classList.add('hidden');
      }
      if (elementActionsContainer) {
        elementActionsContainer.classList.remove('hidden');
      }
      return;
    }
    
    addWaitAction('waitForElement', null, path);
  }
}

/**
 * 상호작용 액션 추가
 */
function handleInteractionAction(interactionType) {
  const path = buildSelectionPathArray();
  
  // type, clear, select는 입력값이 필요할 수 있음
  if (interactionType === 'type') {
    if (!path.length) {
      // 요소 선택 모드로 전환
      if (!selectionState.active) {
        startElementSelection();
      }
      setElementStatus('입력할 요소를 선택하세요.', 'info');
      selectionState.pendingAction = 'type';
      if (interactionActionsContainer) {
        interactionActionsContainer.classList.add('hidden');
      }
      if (elementActionsContainer) {
        elementActionsContainer.classList.remove('hidden');
      }
      return;
    }
    // 입력값 요청
    const inputValue = prompt('입력할 텍스트를 입력하세요:');
    if (inputValue === null) return; // 취소
    addInteractionAction('type', path, inputValue);
    return;
  }
  
  if (interactionType === 'select') {
    if (!path.length) {
      if (!selectionState.active) {
        startElementSelection();
      }
      setElementStatus('선택할 드롭다운 요소를 선택하세요.', 'info');
      selectionState.pendingAction = 'select';
      if (interactionActionsContainer) {
        interactionActionsContainer.classList.add('hidden');
      }
      if (elementActionsContainer) {
        elementActionsContainer.classList.remove('hidden');
      }
      return;
    }
    // 선택값 요청
    const selectValue = prompt('선택할 옵션의 텍스트 또는 값을 입력하세요:');
    if (selectValue === null) return;
    addInteractionAction('select', path, selectValue);
    return;
  }
  
  // click, doubleClick, rightClick, hover, clear는 요소만 필요
  if (!path.length) {
    if (!selectionState.active) {
      startElementSelection();
    }
    setElementStatus(`${interactionType}할 요소를 선택하세요.`, 'info');
    selectionState.pendingAction = interactionType;
    if (interactionActionsContainer) {
      interactionActionsContainer.classList.add('hidden');
    }
    if (elementActionsContainer) {
      elementActionsContainer.classList.remove('hidden');
    }
    return;
  }
  
  addInteractionAction(interactionType, path, null);
}

/**
 * Verify 액션을 이벤트로 추가
 */
function addVerifyAction(verifyType, path, value) {
  withActiveTab((tab) => {
    const timestamp = Date.now();
    const currentUrl = tab?.url || '';
    const currentTitle = tab?.title || '';
    let eventRecord = null;
    
    if (path && path.length > 0) {
      // 요소 기반 검증
      const selectors = path.map((item, idx) => {
        if (!item || !item.selector) return null;
        const type = item.type || inferSelectorType(item.selector);
        return {
          selector: item.selector,
          type,
          textValue: item.textValue || null,
          xpathValue: item.xpathValue || null,
          matchMode: item.matchMode || null,
          score: idx === path.length - 1 ? 100 : 80
        };
      }).filter(Boolean);
      
      if (!selectors.length) {
        alert('셀렉터를 찾을 수 없습니다.');
        return;
      }
      
      const targetEntry = selectors[selectors.length - 1];
      const iframeContext = path[path.length - 1]?.iframeContext || null;
      
      eventRecord = {
        version: EVENT_SCHEMA_VERSION,
        timestamp,
        action: verifyType,
        value: value || null,
        tag: null,
        selectorCandidates: selectors,
        iframeContext,
        page: {
          url: currentUrl,
          title: currentTitle
        },
        frame: { iframeContext },
        target: null,
        clientRect: null,
        metadata: {
          schemaVersion: EVENT_SCHEMA_VERSION,
          userAgent: navigator.userAgent
        },
        manual: {
          id: `verify-${timestamp}`,
          type: verifyType,
          resultName: null,
          attributeName: null
        },
        primarySelector: targetEntry.selector,
        primarySelectorType: targetEntry.type,
        primarySelectorText: targetEntry.textValue,
        primarySelectorXPath: targetEntry.xpathValue,
        primarySelectorMatchMode: targetEntry.matchMode
      };
    } else {
      // 타이틀/URL 검증 (요소 불필요)
      if (verifyType === 'verifyTitle') {
        value = value || currentTitle;
      } else if (verifyType === 'verifyUrl') {
        value = value || currentUrl;
      }
      
      eventRecord = {
        version: EVENT_SCHEMA_VERSION,
        timestamp,
        action: verifyType,
        value: value,
        tag: null,
        selectorCandidates: [],
        iframeContext: null,
        page: {
          url: currentUrl,
          title: currentTitle
        },
        frame: { iframeContext: null },
        target: null,
        clientRect: null,
        metadata: {
          schemaVersion: EVENT_SCHEMA_VERSION,
          userAgent: navigator.userAgent
        },
        manual: {
          id: `verify-${timestamp}`,
          type: verifyType,
          resultName: null,
          attributeName: null
        },
        primarySelector: null,
        primarySelectorType: null
      };
    }
    
    // 이벤트 저장
    chrome.runtime.sendMessage({ type: 'SAVE_EVENT', event: eventRecord }, () => {
      chrome.runtime.sendMessage({type:'GET_EVENTS'}, (res) => {
        const events = (res && res.events) || [];
        allEvents = events.map(normalizeEventRecord);
        updateCode({ preloadedEvents: allEvents });
        refreshTimeline();
      });
    });
    
    if (verifyActionsContainer) {
      verifyActionsContainer.classList.add('hidden');
    }
    setElementStatus(`${verifyType} 액션을 추가했습니다.`, 'success');
  });
}

/**
 * Wait 액션을 이벤트로 추가
 */
function addWaitAction(waitType, timeValue, path) {
  withActiveTab((tab) => {
    const timestamp = Date.now();
    const currentUrl = tab?.url || '';
    const currentTitle = tab?.title || '';
    let eventRecord = null;
    
    if (waitType === 'wait') {
      // 시간 대기
      eventRecord = {
        version: EVENT_SCHEMA_VERSION,
        timestamp,
        action: 'wait',
        value: String(timeValue || 1000),
        tag: null,
        selectorCandidates: [],
        iframeContext: null,
        page: {
          url: currentUrl,
          title: currentTitle
        },
        frame: { iframeContext: null },
        target: null,
        clientRect: null,
        metadata: {
          schemaVersion: EVENT_SCHEMA_VERSION,
          userAgent: navigator.userAgent
        },
        manual: {
          id: `wait-${timestamp}`,
          type: 'wait',
          resultName: null,
          attributeName: null
        },
        primarySelector: null,
        primarySelectorType: null
      };
    } else if (waitType === 'waitForElement' && path && path.length > 0) {
      // 요소 대기
      const selectors = path.map((item, idx) => {
        if (!item || !item.selector) return null;
        const type = item.type || inferSelectorType(item.selector);
        return {
          selector: item.selector,
          type,
          textValue: item.textValue || null,
          xpathValue: item.xpathValue || null,
          matchMode: item.matchMode || null,
          score: idx === path.length - 1 ? 100 : 80
        };
      }).filter(Boolean);
      
      if (!selectors.length) {
        alert('셀렉터를 찾을 수 없습니다.');
        return;
      }
      
      const targetEntry = selectors[selectors.length - 1];
      const iframeContext = path[path.length - 1]?.iframeContext || null;
      
      eventRecord = {
        version: EVENT_SCHEMA_VERSION,
        timestamp,
        action: 'waitForElement',
        value: timeValue ? String(timeValue) : null,
        tag: null,
        selectorCandidates: selectors,
        iframeContext,
        page: {
          url: currentUrl,
          title: currentTitle
        },
        frame: { iframeContext },
        target: null,
        clientRect: null,
        metadata: {
          schemaVersion: EVENT_SCHEMA_VERSION,
          userAgent: navigator.userAgent
        },
        manual: {
          id: `wait-${timestamp}`,
          type: 'waitForElement',
          resultName: null,
          attributeName: null
        },
        primarySelector: targetEntry.selector,
        primarySelectorType: targetEntry.type,
        primarySelectorText: targetEntry.textValue,
        primarySelectorXPath: targetEntry.xpathValue,
        primarySelectorMatchMode: targetEntry.matchMode
      };
    } else {
      alert('대기 액션을 생성할 수 없습니다.');
      return;
    }
    
    // 이벤트 저장
    chrome.runtime.sendMessage({ type: 'SAVE_EVENT', event: eventRecord }, () => {
      chrome.runtime.sendMessage({type:'GET_EVENTS'}, (res) => {
        const events = (res && res.events) || [];
        allEvents = events.map(normalizeEventRecord);
        updateCode({ preloadedEvents: allEvents });
        refreshTimeline();
      });
    });
    
    if (waitInputPanel) {
      waitInputPanel.classList.add('hidden');
    }
    if (waitActionsContainer) {
      waitActionsContainer.classList.add('hidden');
    }
    setElementStatus(`${waitType} 액션을 추가했습니다.`, 'success');
  });
}

/**
 * 상호작용 액션을 이벤트로 추가
 */
function addInteractionAction(interactionType, path, value) {
  withActiveTab((tab) => {
    const timestamp = Date.now();
    const currentUrl = tab?.url || '';
    const currentTitle = tab?.title || '';
    
    if (!path || !path.length) {
      alert('요소를 선택하세요.');
      return;
    }
    
    const selectors = path.map((item, idx) => {
      if (!item || !item.selector) return null;
      const type = item.type || inferSelectorType(item.selector);
      return {
        selector: item.selector,
        type,
        textValue: item.textValue || null,
        xpathValue: item.xpathValue || null,
        matchMode: item.matchMode || null,
        score: idx === path.length - 1 ? 100 : 80
      };
    }).filter(Boolean);
    
    if (!selectors.length) {
      alert('셀렉터를 찾을 수 없습니다.');
      return;
    }
    
    const targetEntry = selectors[selectors.length - 1];
    const iframeContext = path[path.length - 1]?.iframeContext || null;
    
    const eventRecord = {
      version: EVENT_SCHEMA_VERSION,
      timestamp,
      action: interactionType,
      value: value || null,
      tag: null,
      selectorCandidates: selectors,
      iframeContext,
      page: {
        url: currentUrl,
        title: currentTitle
      },
      frame: { iframeContext },
      target: null,
      clientRect: null,
      metadata: {
        schemaVersion: EVENT_SCHEMA_VERSION,
        userAgent: navigator.userAgent
      },
      manual: {
        id: `interaction-${timestamp}`,
        type: interactionType,
        resultName: null,
        attributeName: null
      },
      primarySelector: targetEntry.selector,
      primarySelectorType: targetEntry.type,
      primarySelectorText: targetEntry.textValue,
      primarySelectorXPath: targetEntry.xpathValue,
      primarySelectorMatchMode: targetEntry.matchMode
    };
    
    // 이벤트 저장
    chrome.runtime.sendMessage({ type: 'SAVE_EVENT', event: eventRecord }, () => {
      chrome.runtime.sendMessage({type:'GET_EVENTS'}, (res) => {
        const events = (res && res.events) || [];
        allEvents = events.map(normalizeEventRecord);
        updateCode({ preloadedEvents: allEvents });
        refreshTimeline();
      });
    });
    
    if (interactionActionsContainer) {
      interactionActionsContainer.classList.add('hidden');
    }
    setElementStatus(`${interactionType} 액션을 추가했습니다.`, 'success');
  });
}

function persistManualActions(nextActions, callback) {
  manualActions = nextActions;
  chrome.storage.local.set({manualActions: nextActions}, () => {
    if (callback) callback();
  });
}

function addManualAction(entry, callback) {
  const next = [...manualActions, entry];
  persistManualActions(next, callback);
}

function loadManualActions(callback) {
  chrome.storage.local.get({manualActions: []}, (data) => {
    manualActions = Array.isArray(data.manualActions) ? data.manualActions : [];
    const maxSerial = manualActions.reduce((max, item) => Math.max(max, item && item.serial ? item.serial : 0), 0);
    manualActionSerial = Math.max(maxSerial + 1, manualActionSerial);
    if (callback) callback(manualActions);
  });
}

function emitManualActionLines(lines, action, frameworkLower, languageLower, indent, options = {}) {
  if (!lines || !action) return;
  const actionLines = buildManualActionCode(action, frameworkLower, languageLower, indent, options);
  if (!Array.isArray(actionLines) || !actionLines.length) return;
  actionLines.forEach((line) => lines.push(line));
}

function buildActionTimeline(events, manualList) {
  const timeline = [];
  let sequence = 0;
  let maxEventTimestamp = 0;
  if (Array.isArray(events)) {
    events.forEach((event) => {
      const normalizedEvent = normalizeEventRecord(event);
      const timestamp = typeof normalizedEvent.timestamp === 'number' ? normalizedEvent.timestamp : 0;
      if (timestamp > maxEventTimestamp) {
        maxEventTimestamp = timestamp;
      }
      timeline.push({
        kind: 'event',
        time: timestamp,
        sequence: sequence++,
        event: normalizedEvent,
        selectorInfo: selectSelectorForEvent(normalizedEvent)
      });
    });
  }

  let manualFallbackOffset = 0;
  const manualListSafe = Array.isArray(manualList) ? manualList : [];
  manualListSafe.forEach((action) => {
    if (!action || !Array.isArray(action.path) || !action.path.length) return;
    const created = typeof action.createdAt === 'number'
      ? action.createdAt
      : (maxEventTimestamp || Date.now()) + manualFallbackOffset;
    manualFallbackOffset += 1;
    timeline.push({
      kind: 'manual',
      time: created,
      sequence: sequence++,
      action
    });
  });

  timeline.sort((a, b) => {
    if (a.time !== b.time) return a.time - b.time;
    return a.sequence - b.sequence;
  });
  return timeline;
}

function convertManualActionToEvent(action) {
  if (!action || !Array.isArray(action.path) || !action.path.length) return null;
  const path = action.path;
  const selectors = path.map((item, idx) => {
    if (!item || !item.selector) return null;
    const type = item.type || inferSelectorType(item.selector);
    const isTarget = idx === path.length - 1;
    return {
      selector: item.selector,
      type,
      textValue: item.textValue || null,
      xpathValue: item.xpathValue || null,
      matchMode: item.matchMode || null,
      relation: item.relation || null,
      score: isTarget ? 100 : Math.max(60, 85 - (path.length - 1 - idx) * 5),
      reason: item.reason || ''
    };
  }).filter(Boolean);

  if (!selectors.length) return null;

  let actionName = 'click';
  if (action.actionType === 'extract_text') {
    actionName = 'manual_extract_text';
  } else if (action.actionType === 'get_attribute') {
    actionName = 'manual_get_attribute';
  } else if (action.actionType !== 'click') {
    return null;
  }

  const manualEvent = createManualEventRecord(action, selectors, actionName);
  return manualEvent;
}

function createManualEventRecord(action, selectorsList, actionName) {
  if (!selectorsList.length) return null;
  const timestamp = action.createdAt || Date.now();
  const targetEntry = selectorsList[selectorsList.length - 1];
  const primaryType = targetEntry.type || inferSelectorType(targetEntry.selector);
  const frameContext = action.iframeContext || null;
  const manualPayload = {
    id: action.id || null,
    type: action.actionType || null,
    path: action.path || [],
    resultName: action.resultName || null,
    attributeName: action.attributeName || null,
    createdAt: timestamp
  };

  const eventRecord = {
    version: EVENT_SCHEMA_VERSION,
    timestamp,
    action: actionName,
    value: null,
    selectorCandidates: selectorsList,
    primarySelector: targetEntry.selector,
    primarySelectorType: primaryType,
    primarySelectorText: targetEntry.textValue || null,
    primarySelectorXPath: targetEntry.xpathValue || (primaryType === 'xpath' ? getSelectorCore(targetEntry.selector) : null),
    primarySelectorMatchMode: targetEntry.matchMode || null,
    iframeContext: frameContext,
    page: null,
    frame: frameContext ? { iframeContext: frameContext } : null,
    target: null,
    clientRect: null,
    metadata: {
      schemaVersion: EVENT_SCHEMA_VERSION,
      source: 'manual_action'
    },
    manual: manualPayload,
    manualActionType: action.actionType || null,
    manualActionId: action.id || null,
    manualResultName: action.resultName || null,
    manualAttribute: action.attributeName || null
  };

  return normalizeEventRecord(eventRecord);
}

function buildReplayQueue(events, manualList) {
  const timeline = buildActionTimeline(events, manualList);
  const queue = [];
  timeline.forEach((entry) => {
    if (entry.kind === 'event' && entry.event) {
      queue.push(entry.event);
    } else if (entry.kind === 'manual' && entry.action) {
      const manualEvent = convertManualActionToEvent(entry.action);
      if (manualEvent) {
        queue.push(manualEvent);
      }
    }
  });
  return queue;
}

function applySelectionAction(actionType, options = {}) {
  const path = buildSelectionPathArray();
  if (!path.length) {
    setElementStatus('먼저 요소를 선택하세요.', 'error');
    return;
  }
  
  // pendingAction이 verify, wait, interaction인 경우 처리
  if (selectionState.pendingAction) {
    const pending = selectionState.pendingAction;
    if (pending.startsWith('verify')) {
      let value = null;
      if (pending === 'verifyText') {
        const lastPathItem = path[path.length - 1];
        if (lastPathItem && lastPathItem.textValue) {
          value = lastPathItem.textValue;
        } else {
          const textValue = prompt('검증할 텍스트를 입력하세요:');
          if (textValue === null) {
            selectionState.pendingAction = null;
            return;
          }
          value = textValue;
        }
      }
      addVerifyAction(pending, path, value);
      selectionState.pendingAction = null;
      cancelSelectionWorkflow('', 'info');
      return;
    } else if (pending === 'waitForElement') {
      addWaitAction('waitForElement', null, path);
      selectionState.pendingAction = null;
      cancelSelectionWorkflow('', 'info');
      return;
    } else if (['click', 'doubleClick', 'rightClick', 'hover', 'clear', 'type', 'select'].includes(pending)) {
      // 상호작용 액션 처리
      let value = null;
      if (pending === 'type') {
        const inputValue = prompt('입력할 텍스트를 입력하세요:');
        if (inputValue === null) {
          selectionState.pendingAction = null;
          return;
        }
        value = inputValue;
      } else if (pending === 'select') {
        const selectValue = prompt('선택할 옵션의 텍스트 또는 값을 입력하세요:');
        if (selectValue === null) {
          selectionState.pendingAction = null;
          return;
        }
        value = selectValue;
      }
      addInteractionAction(pending, path, value);
      selectionState.pendingAction = null;
      cancelSelectionWorkflow('', 'info');
      return;
    }
  }
  
  if (actionType === 'commit') {
    const entry = buildManualActionEntry('chain', path, options);
    if (!entry) {
      setElementStatus('현재 선택을 코드에 반영할 수 없습니다.', 'error');
      return;
    }
    addManualAction(entry, () => {
      cancelSelectionWorkflow('현재 선택을 코드에 반영했습니다.', 'success');
      updateCode({ preloadedEvents: allEvents });
    });
    selectionState.pendingAction = null;
    selectionState.pendingAttribute = '';
    return;
  }
  if (actionType === 'get_attribute') {
    const attrName = (options.attributeName || selectionState.pendingAttribute || '').trim();
    if (!attrName) {
      setElementStatus('속성명을 입력하세요.', 'error');
      return;
    }
    options.attributeName = attrName;
  }
  const entry = buildManualActionEntry(actionType, path, options);
  if (!entry) {
    setElementStatus('동작을 처리할 수 없습니다.', 'error');
    return;
  }
  addManualAction(entry, () => {
    cancelSelectionWorkflow('', 'info');
    setElementStatus('코드에 동작을 추가했습니다.', 'success');
    updateCode({ preloadedEvents: allEvents });
    if (actionType === 'click') {
      executeSelectionAction('click', path, {}, (result) => {
        if (!result || !result.ok) {
          setElementStatus(`요소 클릭을 수행할 수 없습니다: ${(result && result.reason) || '알 수 없는 오류'}`, 'error');
        } else {
          setElementStatus('요소를 클릭했습니다.', 'success');
        }
      });
    }
  });
  selectionState.pendingAction = null;
  selectionState.pendingAttribute = '';
}

function executeSelectionAction(actionType, path, options = {}, callback) {
  withActiveTab((tab) => {
    if (!tab) {
      if (callback) callback({ok: false, reason: 'no_active_tab'});
      return;
    }
    sendMessageWithInjection(
      tab.id,
      {
        type: 'ELEMENT_SELECTION_EXECUTE',
        action: actionType,
        path,
        options
      },
      (resp, error) => {
        if (error) {
          if (callback) callback({ok: false, reason: error.message});
          return;
        }
        if (callback) callback(resp || {ok: true});
      }
    );
  });
}

function sanitizeIdentifier(name, languageLower, fallback) {
  const defaultName = fallback || 'result';
  if (!name || typeof name !== 'string') return defaultName;
  let sanitized = name.replace(/[^a-zA-Z0-9_]/g, '_');
  if (!sanitized) return defaultName;
  if (/^[0-9]/.test(sanitized)) {
    sanitized = `_${sanitized}`;
  }
  return sanitized;
}

function buildPlaywrightLocatorChain(path, languageLower, indent, serial) {
  const lines = [];
  if (!Array.isArray(path) || path.length === 0) {
    return {lines, finalVar: null};
  }
  const pythonClass = languageLower === 'python-class';
  const pythonLike = languageLower === 'python' || pythonClass;
  let baseExpr = pythonClass ? 'self.page' : 'page';
  let finalVar = null;
  const prefix = typeof serial !== 'undefined' ? serial : Date.now();
  path.forEach((entry, index) => {
    const isLast = index === path.length - 1;
    const varName = pythonLike
      ? `${isLast ? 'target' : 'node'}_${prefix}_${index + 1}`
      : `${isLast ? 'target' : 'node'}_${prefix}_${index + 1}`;
    const locatorExpr = buildPlaywrightLocatorExpression(baseExpr, entry, languageLower);
    if (pythonLike) {
      lines.push(`${indent}${varName} = ${locatorExpr}`);
    } else {
      lines.push(`${indent}const ${varName} = ${locatorExpr};`);
    }
    baseExpr = varName;
    finalVar = varName;
  });
  return {lines, finalVar};
}

function buildSeleniumLocatorChainPython(path, indent, serial, driverVar = 'driver') {
  const lines = [];
  if (!Array.isArray(path) || path.length === 0) {
    return {lines, finalVar: null};
  }
  let baseExpr = driverVar;
  let finalVar = null;
  path.forEach((entry, index) => {
    const spec = buildSeleniumLocatorSpec(entry);
    const varName = `element_${serial}_${index + 1}`;
    const expr = `${baseExpr}.find_element(${spec.byPython}, "${escapeForPythonString(spec.value)}")`;
    lines.push(`${indent}${varName} = ${expr}`);
    baseExpr = varName;
    finalVar = varName;
  });
  return {lines, finalVar};
}

function buildSeleniumLocatorChainJS(path, indent, serial) {
  const lines = [];
  if (!Array.isArray(path) || path.length === 0) {
    return {lines, finalVar: null};
  }
  let baseExpr = 'driver';
  let finalVar = null;
  path.forEach((entry, index) => {
    const spec = buildSeleniumLocatorSpec(entry);
    const varName = `element_${serial}_${index + 1}`;
    const caller = baseExpr === 'driver' ? 'driver' : baseExpr;
    const expr = `${caller}.findElement(${spec.byJS}("${escapeForJSString(spec.value)}"))`;
    lines.push(`${indent}const ${varName} = await ${expr};`);
    baseExpr = varName;
    finalVar = varName;
  });
  return {lines, finalVar};
}

function buildSeleniumLocatorChain(path, languageLower, indent, serial, driverVar = 'driver') {
  if (languageLower === 'python' || languageLower === 'python-class') {
    return buildSeleniumLocatorChainPython(path, indent, serial, driverVar);
  }
  return buildSeleniumLocatorChainJS(path, indent, serial);
}

function buildManualActionCode(action, frameworkLower, languageLower, indent, options = {}) {
  if (!action || !Array.isArray(action.path) || action.path.length === 0) {
    return [];
  }
  const serial = action.serial || Date.now();
  const path = action.path;
  const lines = [];
  let chainResult = null;
  const pythonLike = languageLower === 'python' || languageLower === 'python-class';
  const usageTracker = options.usage || null;

  if (frameworkLower === 'playwright') {
    chainResult = buildPlaywrightLocatorChain(path, languageLower, indent, serial);
  } else if (frameworkLower === 'cypress') {
    const isTypeScript = languageLower === 'typescript';
    const cypressUsage = { usesXPath: false };
    lines.push("describe('AI Test Recorder', () => {");
    lines.push("  it('should run recorded steps', () => {");
    lines.push("    cy.visit('REPLACE_URL');");
    lines.push("");
    let currentFrameContext = null;
    timeline.forEach((entry) => {
      if (entry.kind === 'event') {
        const { event, selectorInfo } = entry;
        const targetFrame = selectorInfo && selectorInfo.iframeContext ? selectorInfo.iframeContext : null;
        if (!framesEqual(targetFrame, currentFrameContext)) {
          if (targetFrame) {
            lines.push("    // TODO: Handle iframe interaction for Cypress manually.");
            currentFrameContext = targetFrame;
          } else if (currentFrameContext) {
            lines.push("    // Returned from iframe context.");
            currentFrameContext = null;
          }
        }
        const actionLine = buildCypressAction(event, selectorInfo, { usage: cypressUsage });
        if (actionLine) {
          lines.push(`    ${actionLine}`);
        } else {
          lines.push("    // Unsupported event action for Cypress.");
        }
      } else if (entry.kind === 'manual') {
        const manualLines = buildManualActionCode(entry.action, frameworkLower, languageLower, '    ', { usage: cypressUsage });
        if (manualLines && manualLines.length) {
          manualLines.forEach((line) => lines.push(line));
        }
      }
    });
    lines.push("  });");
    lines.push("});");
    if (cypressUsage.usesXPath) {
      const pluginImport = isTypeScript ? "import 'cypress-xpath';" : "require('cypress-xpath');";
      lines.unshift(pluginImport);
    }
    lines.unshift("/// <reference types=\"cypress\" />");
  } else if (frameworkLower === 'selenium') {
    const driverVar = languageLower === 'python-class' ? 'self.driver' : 'driver';
    chainResult = buildSeleniumLocatorChain(path, languageLower, indent, serial, driverVar);
  }

  if (!chainResult || !chainResult.finalVar) {
    return lines;
  }

  lines.push(...chainResult.lines);
  const targetVar = chainResult.finalVar;

  if (frameworkLower === 'playwright') {
    if (action.actionType === 'click') {
      if (pythonLike) {
        lines.push(`${indent}${targetVar}.click()`);
      } else {
        lines.push(`${indent}await ${targetVar}.click();`);
      }
    }
    if (action.actionType === 'extract_text') {
      const resultName = sanitizeIdentifier(action.resultName, languageLower, pythonLike ? 'text_result' : 'textResult');
      if (pythonLike) {
        lines.push(`${indent}${resultName} = ${targetVar}.inner_text()`);
      } else {
        lines.push(`${indent}const ${resultName} = await ${targetVar}.innerText();`);
      }
    }
    if (action.actionType === 'get_attribute') {
      const attrName = action.attributeName || '';
      const resultName = sanitizeIdentifier(action.resultName, languageLower, pythonLike ? `${attrName || 'attr'}_value` : `${attrName || 'attr'}Value`);
      if (pythonLike) {
        lines.push(`${indent}${resultName} = ${targetVar}.get_attribute("${escapeForPythonString(attrName)}")`);
      } else {
        lines.push(`${indent}const ${resultName} = await ${targetVar}.getAttribute("${escapeForJSString(attrName)}");`);
      }
    }
  } else if (frameworkLower === 'selenium') {
    if (action.actionType === 'click') {
      if (pythonLike) {
        lines.push(`${indent}${targetVar}.click()`);
      } else {
        lines.push(`${indent}await ${targetVar}.click();`);
      }
    }
    if (action.actionType === 'extract_text') {
      const resultName = sanitizeIdentifier(action.resultName, languageLower, pythonLike ? 'text_result' : 'textResult');
      if (pythonLike) {
        lines.push(`${indent}${resultName} = ${targetVar}.text`);
      } else {
        lines.push(`${indent}const ${resultName} = await ${targetVar}.getText();`);
      }
    }
    if (action.actionType === 'get_attribute') {
      const attrName = action.attributeName || '';
      const resultName = sanitizeIdentifier(action.resultName, languageLower, pythonLike ? `${attrName || 'attr'}_value` : `${attrName || 'attr'}Value`);
      if (pythonLike) {
        lines.push(`${indent}${resultName} = ${targetVar}.get_attribute("${escapeForPythonString(attrName)}")`);
      } else {
        lines.push(`${indent}const ${resultName} = await ${targetVar}.getAttribute("${escapeForJSString(attrName)}");`);
      }
    }
  } else if (frameworkLower === 'cypress') {
    const targetEntry = path[path.length - 1];
    const locatorExpr = buildCypressLocatorExpression(targetEntry, usageTracker);
    if (!locatorExpr) {
      return lines;
    }
    if (action.actionType === 'click') {
      lines.push(`${indent}${locatorExpr}.click();`);
    } else if (action.actionType === 'extract_text') {
      const resultName = sanitizeIdentifier(action.resultName, 'javascript', 'textResult');
      lines.push(`${indent}${locatorExpr}.invoke('text').then((text) => {`);
      lines.push(`${indent}  cy.log('${escapeForJSString(resultName)}: ' + text.trim());`);
      lines.push(`${indent}});`);
    } else if (action.actionType === 'get_attribute') {
      const attrName = action.attributeName || '';
      const resultName = sanitizeIdentifier(action.resultName, 'javascript', `${attrName || 'attr'}Value`);
      lines.push(`${indent}${locatorExpr}.invoke('attr', '${escapeForJSString(attrName)}').then((value) => {`);
      lines.push(`${indent}  cy.log('${escapeForJSString(resultName)}: ' + value);`);
      lines.push(`${indent}});`);
    } else if (action.actionType === 'text') {
      lines.push(`${indent}${locatorExpr}.invoke('text').then((text) => {`);
      lines.push(`${indent}  cy.log('text: ' + text);`);
      lines.push(`${indent}});`);
    } else {
      lines.push(`${indent}// Unsupported manual action "${action.actionType}" for Cypress`);
    }
  }

  return lines;
}

function buildSelectionPreviewLines(path, framework, language) {
  if (!Array.isArray(path) || !path.length) return [];
  const frameworkLower = (framework || '').toLowerCase();
  const languageLower = (language || '').toLowerCase();
  const indent = '';
  const serial = manualActionSerial;
  if (frameworkLower === 'playwright') {
    return buildPlaywrightLocatorChain(path, languageLower, indent, serial).lines;
  }
  if (frameworkLower === 'selenium') {
    const driverVar = languageLower === 'python-class' ? 'self.driver' : 'driver';
    return buildSeleniumLocatorChain(path, languageLower, indent, serial, driverVar).lines;
  }
  if (frameworkLower === 'cypress') {
    const targetEntry = path[path.length - 1];
    const expr = buildCypressLocatorExpression(targetEntry);
    return expr ? [expr] : [];
  }
  return path.map((item) => item && item.selector ? item.selector : '');
}

//

//

//

//

//

//

function resetReplayState() {
  if (replayState.navigationGuard) {
    clearTimeout(replayState.navigationGuard);
  }
  if (replayState.scheduledTimer) {
    clearTimeout(replayState.scheduledTimer);
  }
  replayState = {
    running: false,
    events: [],
    index: 0,
    tabId: null,
    pending: false,
    awaitingNavigation: false,
    awaitingContent: false,
    navigationGuard: null,
    scheduledTimer: null
  };
}

function ensureReplayTabListener() {
  if (replayTabListenerRegistered) return;
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (!replayState.running || tabId !== replayState.tabId) return;
    if (changeInfo.status === 'loading') {
      replayState.awaitingContent = true;
    }
    if (changeInfo.status === 'complete') {
      replayState.awaitingContent = false;
      if (replayState.awaitingNavigation && !replayState.pending) {
        replayState.awaitingNavigation = false;
        scheduleNextStep(NAVIGATION_RECOVERY_DELAY_MS);
      } else if (!replayState.pending) {
        scheduleNextStep(DOM_COMPLETE_DELAY_MS);
      }
    }
  });
  replayTabListenerRegistered = true;
}

function scheduleNextStep(delayMs) {
  if (!replayState.running) return;
  if (replayState.scheduledTimer) {
    clearTimeout(replayState.scheduledTimer);
  }
  replayState.scheduledTimer = setTimeout(() => {
    replayState.scheduledTimer = null;
    sendReplayStep();
  }, Math.max(0, delayMs || 0));
}

function finishReplay() {
  const wasRunning = replayState.running;
  resetReplayState();
  if (wasRunning) {
    const doneMsg = document.createElement('div');
    doneMsg.textContent = '✓ 리플레이 완료';
    doneMsg.style.color = '#2196f3';
    doneMsg.style.fontWeight = 'bold';
    doneMsg.style.padding = '8px';
    doneMsg.style.marginTop = '8px';
    doneMsg.style.borderTop = '1px solid #ddd';
    logEntries.appendChild(doneMsg);
    logEntries.scrollTop = logEntries.scrollHeight;
  }
}

function abortReplay(reason) {
  const message = reason || '알 수 없는 오류로 리플레이가 중단되었습니다.';
  const div = document.createElement('div');
  div.style.padding = '6px 10px';
  div.style.marginTop = '8px';
  div.style.borderRadius = '4px';
  div.style.background = '#ffebee';
  div.style.color = '#c62828';
  div.style.fontWeight = 'bold';
  div.textContent = `✗ 리플레이 종료 - ${message}`;
  logEntries.appendChild(div);
  logEntries.scrollTop = logEntries.scrollHeight;
  resetReplayState();
}

function sendReplayStep() {
  if (!replayState.running) return;
  if (replayState.pending) return;
  if (replayState.index >= replayState.events.length) {
    finishReplay();
    return;
  }
  const currentEvent = replayState.events[replayState.index];
  if (!replayState.tabId) {
    abortReplay('대상 탭을 찾을 수 없습니다.');
    return;
  }
  replayState.pending = true;
  if (replayState.navigationGuard) {
    clearTimeout(replayState.navigationGuard);
    replayState.navigationGuard = null;
  }
  sendMessageWithInjection(
    replayState.tabId,
    {
      type: 'REPLAY_EXECUTE_STEP',
      event: currentEvent,
      index: replayState.index,
      total: replayState.events.length,
      timeoutMs: 10000
    },
    (response, error) => {
      if (error) {
        // 컨텐츠 스크립트가 아직 준비되지 않음 (탭 이동/새로고침 등)
        replayState.pending = false;
        replayState.awaitingContent = true;
        ensureContentScriptInjected(replayState.tabId).catch(() => {});
        return;
      }
      if (!response) {
        // 응답이 없으면 결과 메시지를 기다림
        return;
      }
      if (response.ok === false && response.reason) {
        replayState.pending = false;
        abortReplay(response.reason);
      }
    }
  );
}

function handleReplayStepResult(msg) {
  if (!replayState.running) return;
  const expectedIndex = replayState.index;
  const msgIndex = msg.stepIndex !== undefined ? msg.stepIndex : (msg.step !== undefined ? (msg.step - 1) : expectedIndex);

  if (msgIndex !== expectedIndex) {
    // 다른 스텝의 응답이면 무시
    return;
  }

  replayState.pending = false;

  if (!msg.ok) {
    abortReplay(msg.reason || 'step failed');
    return;
  }

  replayState.index = msgIndex + 1;

  if (replayState.index >= replayState.events.length) {
    finishReplay();
    return;
  }

  if (msg.navigation) {
    replayState.awaitingNavigation = true;
    replayState.awaitingContent = true;
    if (replayState.navigationGuard) {
      clearTimeout(replayState.navigationGuard);
    }
    replayState.navigationGuard = setTimeout(() => {
      replayState.navigationGuard = null;
      abortReplay('페이지 로딩이 너무 오래 걸립니다.');
    }, MAX_NAVIGATION_WAIT_MS);
    return;
  }

  scheduleNextStep(STEP_DELAY_MS);
}

const viewCodeBtn = document.getElementById('view-code');
if (viewCodeBtn) {
  viewCodeBtn.addEventListener('click', async () => {
    updateCode({ preloadedEvents: allEvents });
  });
}

document.getElementById('replay-btn').addEventListener('click', async ()=>{
  startReplay();
});

function startReplay() {
  if (replayState.running) {
    alert('리플레이가 이미 진행 중입니다. 잠시 후 다시 시도하세요.');
    return;
  }
  chrome.runtime.sendMessage({type:'GET_EVENTS'}, (res) => {
  const events = res && res.events || [];
    chrome.storage.local.get({ manualActions: [], recordingStartUrl }, (data) => {
      const manualListRaw = Array.isArray(data.manualActions) ? data.manualActions : [];
      const manualList = manualListRaw.filter(Boolean);
      const replayQueue = buildReplayQueue(events, manualList);
      const normalizedQueue = replayQueue.map((item) => normalizeEventRecord(item));
      if (normalizedQueue.length === 0) {
        alert('재생할 이벤트가 없습니다.');
        return;
      }

      const startUrl = typeof data.recordingStartUrl === 'string' && data.recordingStartUrl
        ? data.recordingStartUrl
        : (recordingStartUrl || '');
      if (!startUrl) {
        alert('녹화 시작 URL 정보를 찾을 수 없습니다. 먼저 새로 녹화를 진행한 뒤 다시 시도하세요.');
        return;
      }
      recordingStartUrl = startUrl;
      chrome.storage.local.set({ recordingStartUrl: startUrl });

      logEntries.innerHTML = '';
      const startMsg = document.createElement('div');
      startMsg.textContent = `리플레이 시작 준비 중… (총 ${normalizedQueue.length}개 스텝)`;
      startMsg.style.color = '#2196f3';
      startMsg.style.fontWeight = 'bold';
      logEntries.appendChild(startMsg);

      const prepareReplayOnTab = (targetTab) => {
        if (!targetTab || typeof targetTab.id !== 'number') {
          alert('리플레이용 탭 정보를 확인할 수 없습니다.');
          return;
        }
        ensureContentScriptInjected(targetTab.id)
          .then(() => {
            ensureReplayTabListener();
            listenEvents();
            replayState.running = true;
            replayState.events = normalizedQueue;
            replayState.index = 0;
            replayState.tabId = targetTab.id;
            replayState.pending = false;
            replayState.awaitingNavigation = false;
            replayState.awaitingContent = false;
            if (replayState.navigationGuard) {
              clearTimeout(replayState.navigationGuard);
              replayState.navigationGuard = null;
            }
            if (replayState.scheduledTimer) {
              clearTimeout(replayState.scheduledTimer);
              replayState.scheduledTimer = null;
            }
            sendReplayStep();
          })
          .catch((error) => {
            console.error('[AI Test Recorder] Failed to inject content script for replay:', error);
            alert('리플레이를 시작할 수 없습니다. 새로고침 후 다시 시도하거나, 페이지 접근 권한을 확인하세요.');
          });
      };

      chrome.windows.create({ url: startUrl, focused: true, type: 'normal' }, (createdWindow) => {
        if (chrome.runtime.lastError || !createdWindow) {
          console.error('[AI Test Recorder] Failed to create replay window:', chrome.runtime.lastError);
          alert('리플레이용 새 창을 열 수 없습니다. 팝업 차단 설정을 확인해 주세요.');
          return;
        }
        const resolveTabInfo = (win, callback) => {
          if (win.tabs && win.tabs.length > 0) {
            callback(win.tabs[0]);
            return;
          }
          if (typeof win.id === 'number') {
            chrome.tabs.query({ windowId: win.id, active: true }, (tabsArr) => {
              callback(tabsArr && tabsArr[0] ? tabsArr[0] : null);
            });
          } else {
            callback(null);
          }
        };
        resolveTabInfo(createdWindow, (targetTab) => {
          if (!targetTab) {
            alert('리플레이용 탭을 확인할 수 없습니다.');
            return;
          }
          prepareReplayOnTab(targetTab);
        });
      });
    });
  });
}

function updateCode(options = {}) {
  const {
    refreshTimeline = false,
    preserveSelection = false,
    selectLast = false,
    resetAiState = false,
    preloadedEvents = null
  } = options || {};

  const handleEvents = (events) => {
    let normalizedEvents;
    if (refreshTimeline) {
      normalizedEvents = syncTimelineFromEvents(events, {
        preserveSelection,
        selectLast,
        resetAiState
      });
    } else {
      normalizedEvents = Array.isArray(events) ? events.map((ev) => normalizeEventRecord(ev)) : [];
      allEvents = normalizedEvents;
    }

    loadManualActions(() => {
      const code = generateCode(normalizedEvents, manualActions, selectedFramework, selectedLanguage);
      setCodeText(code);
      updateSelectionCodePreview();
    });
  };

  if (Array.isArray(preloadedEvents)) {
    handleEvents(preloadedEvents);
    return;
  }

  chrome.runtime.sendMessage({type:'GET_EVENTS'}, (res) => {
    const events = (res && res.events) || [];
    handleEvents(events);
  });
}

function inferSelectorType(selector) {
  if (!selector || typeof selector !== 'string') return null;
  const trimmed = selector.trim();
  if (trimmed.startsWith('xpath=')) return 'xpath';
  if (trimmed.startsWith('//') || trimmed.startsWith('(')) return 'xpath';
  if (trimmed.startsWith('text=')) return 'text';
  if (trimmed.startsWith('#') || trimmed.startsWith('.') || trimmed.startsWith('[')) return 'css';
  return 'css';
}

function selectSelectorForEvent(ev) {
  if (!ev) return {selector:null, type:null, iframeContext:null};
  if (ev.primarySelector) {
    return {
      selector: ev.primarySelector,
      type: ev.primarySelectorType || inferSelectorType(ev.primarySelector),
      textValue: ev.primarySelectorText || null,
      xpathValue: ev.primarySelectorXPath || null,
      matchMode: ev.primarySelectorMatchMode || null,
      iframeContext: ev.iframeContext || null
    };
  }
  if (ev.selectorCandidates && ev.selectorCandidates.length > 0) {
    const sorted = [...ev.selectorCandidates].sort((a, b) => (b.score || 0) - (a.score || 0));
    const best = sorted[0];
    return {
      selector: best.selector,
      type: best.type || inferSelectorType(best.selector),
      textValue: best.textValue || null,
      xpathValue: best.xpathValue || null,
      matchMode: best.matchMode || null,
      iframeContext: ev.iframeContext || null
    };
  }
  if (ev.tag) {
    return {selector: ev.tag.toLowerCase(), type: 'tag', iframeContext: ev.iframeContext || null};
  }
  return {selector:null, type:null, iframeContext: ev.iframeContext || null};
}

function getTextValue(selectorInfo) {
  if (!selectorInfo) return '';
  if (selectorInfo.textValue) return selectorInfo.textValue;
  const selector = selectorInfo.selector || '';
  if (selector.startsWith('text=')) {
    let raw = selector.slice(5);
    raw = raw.replace(/^['"]|['"]$/g, '');
    return raw.replace(/\\"/g, '"').replace(/\\'/g, "'");
  }
  return '';
}

function extractAttributeValue(selector, attrName) {
  if (!selector || !attrName) return '';
  // [data-testid="value"] 형식에서 value 추출
  const attrPattern = new RegExp(`\\[${attrName}\\s*=\\s*["']([^"']+)["']\\]`);
  const match = selector.match(attrPattern);
  if (match && match[1]) {
    return match[1];
  }
  // [data-testid*="value"] 형식 (부분 일치)
  const partialPattern = new RegExp(`\\[${attrName}\\s*\\*=\\s*["']([^"']+)["']\\]`);
  const partialMatch = selector.match(partialPattern);
  if (partialMatch && partialMatch[1]) {
    return partialMatch[1];
  }
  return '';
}

function getXPathValue(selectorInfo) {
  if (!selectorInfo) return '';
  if (selectorInfo.xpathValue) return selectorInfo.xpathValue;
  const selector = selectorInfo.selector || '';
  if (selector.startsWith('xpath=')) {
    return selector.slice(6);
  }
  return selector;
}

function ensureXPathSelector(selector) {
  if (!selector) return '';
  return selector.startsWith('xpath=') ? selector : 'xpath=' + selector;
}

function escapeForDoubleQuotes(str) {
  return (str || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeForPythonString(str) {
  return escapeForDoubleQuotes(str);
}

function escapeForJSString(str) {
  return escapeForDoubleQuotes(str);
}

function getSelectorCore(selector) {
  if (!selector) return '';
  if (selector.startsWith('css=')) return selector.slice(4);
  if (selector.startsWith('xpath=')) return selector.slice(6);
  return selector;
}

function framesEqual(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (a.id || null) === (b.id || null)
    && (a.name || null) === (b.name || null)
    && (a.src || null) === (b.src || null);
}

function buildIframeCssSelector(ctx) {
  if (!ctx) return 'iframe';
  if (ctx.id) return `iframe#${ctx.id}`;
  if (ctx.name) return `iframe[name="${ctx.name}"]`;
  if (ctx.src) return `iframe[src="${ctx.src}"]`;
  return 'iframe';
}

function buildPlaywrightFrameLocatorLines(ctx, languageLower, alias, indent, baseVar = 'page') {
  const selector = buildIframeCssSelector(ctx);
  const pythonLike = languageLower === 'python' || languageLower === 'python-class';
  if (pythonLike) {
    return [`${alias} = ${baseVar}.frame_locator("${escapeForDoubleQuotes(selector)}")`];
  }
  return [`const ${alias} = ${baseVar}.frameLocator('${selector}');`];
}

function buildSeleniumFrameSwitchPython(ctx, driverVar = 'driver') {
  if (!ctx) return null;
  if (ctx.name) return `${driverVar}.switch_to.frame("${ctx.name}")`;
  if (ctx.id) return `${driverVar}.switch_to.frame(${driverVar}.find_element(By.CSS_SELECTOR, "iframe#${ctx.id}"))`;
  if (ctx.src) return `${driverVar}.switch_to.frame(${driverVar}.find_element(By.CSS_SELECTOR, "iframe[src='${ctx.src}']"))`;
  return null;
}

function buildSeleniumFrameSwitchJS(ctx, indent) {
  if (!ctx) return null;
  if (ctx.name) return `${indent}await driver.switchTo().frame("${ctx.name}");`;
  if (ctx.id) return `${indent}await driver.switchTo().frame(await driver.findElement(By.css("iframe#${ctx.id}")));`;
  if (ctx.src) return `${indent}await driver.switchTo().frame(await driver.findElement(By.css("iframe[src='${ctx.src}']")));`;
  return null;
}

function buildSeleniumFrameSwitchTS(ctx) {
  return buildSeleniumFrameSwitchJS(ctx, '  ');
}

function buildPlaywrightLocatorExpression(base, selection, languageLower) {
  const selectorType = selection.type || inferSelectorType(selection.selector);
  const pythonLike = languageLower === 'python' || languageLower === 'python-class';
  
  if (pythonLike) {
    // Python: text 타입
    if (selectorType === 'text') {
      const textVal = getTextValue(selection);
      if (textVal) {
        const matchMode = selection.matchMode || 'exact';
        if (matchMode === 'contains') {
          return `${base}.get_by_text("${escapeForPythonString(textVal)}", exact=False)`;
        }
        return `${base}.get_by_text("${escapeForPythonString(textVal)}", exact=True)`;
      }
    }
    
    // Python: xpath 타입
    if (selectorType === 'xpath' || selectorType === 'xpath-full') {
      const locator = ensureXPathSelector(selection.selector);
      return `${base}.locator("${escapeForPythonString(locator)}")`;
    }
    
    // Python: data-testid 타입
    if (selectorType === 'data-testid') {
      const testIdValue = extractAttributeValue(selection.selector, 'data-testid');
      if (testIdValue) {
        return `${base}.get_by_test_id("${escapeForPythonString(testIdValue)}")`;
      }
    }
    
    // Python: aria-label 타입
    if (selectorType === 'aria-label') {
      const labelValue = extractAttributeValue(selection.selector, 'aria-label');
      if (labelValue) {
        return `${base}.get_by_label("${escapeForPythonString(labelValue)}")`;
      }
    }
    
    // Python: role 타입
    if (selectorType === 'role') {
      const roleValue = extractAttributeValue(selection.selector, 'role');
      if (roleValue) {
        return `${base}.get_by_role("${escapeForPythonString(roleValue)}")`;
      }
    }
    
    // Python: 기본 locator
    return `${base}.locator("${escapeForPythonString(selection.selector)}")`;
  }

  // JavaScript / TypeScript: text 타입
  if (selectorType === 'text') {
    const textVal = getTextValue(selection);
    if (textVal) {
      const matchMode = selection.matchMode || 'exact';
      if (matchMode === 'contains') {
        return `${base}.getByText("${escapeForJSString(textVal)}")`;
      }
      return `${base}.getByText("${escapeForJSString(textVal)}", { exact: true })`;
    }
  }
  
  // JavaScript / TypeScript: xpath 타입
  if (selectorType === 'xpath' || selectorType === 'xpath-full') {
    const locator = ensureXPathSelector(selection.selector);
    return `${base}.locator("${escapeForJSString(locator)}")`;
  }
  
  // JavaScript / TypeScript: data-testid 타입
  if (selectorType === 'data-testid') {
    const testIdValue = extractAttributeValue(selection.selector, 'data-testid');
    if (testIdValue) {
      return `${base}.getByTestId("${escapeForJSString(testIdValue)}")`;
    }
  }
  
  // JavaScript / TypeScript: aria-label 타입
  if (selectorType === 'aria-label') {
    const labelValue = extractAttributeValue(selection.selector, 'aria-label');
    if (labelValue) {
      return `${base}.getByLabel("${escapeForJSString(labelValue)}")`;
    }
  }
  
  // JavaScript / TypeScript: role 타입
  if (selectorType === 'role') {
    const roleValue = extractAttributeValue(selection.selector, 'role');
    if (roleValue) {
      return `${base}.getByRole("${escapeForJSString(roleValue)}")`;
    }
  }
  
  // JavaScript / TypeScript: 기본 locator
  return `${base}.locator("${escapeForJSString(selection.selector)}")`;
}

function buildSeleniumLocatorSpec(selection) {
  const selectorType = selection.type || inferSelectorType(selection.selector);
  if (selectorType === 'xpath') {
    const value = getXPathValue(selection) || getSelectorCore(selection.selector);
    return {byPython: 'By.XPATH', byJS: 'By.xpath', value};
  }
  if (selectorType === 'text') {
    const textVal = getTextValue(selection);
    if (textVal) {
      const matchMode = selection.matchMode || 'exact';
      let expr;
      if (matchMode === 'exact') {
        expr = `//*[normalize-space(.) = "${textVal}"]`;
      } else {
        expr = `//*[contains(normalize-space(.), "${textVal}")]`;
      }
      return {byPython: 'By.XPATH', byJS: 'By.xpath', value: expr};
    }
  }
  const cssValue = getSelectorCore(selection.selector);
  return {byPython: 'By.CSS_SELECTOR', byJS: 'By.css', value: cssValue};
}

function buildPlaywrightLocatorExpressionForAction(base, selectorInfo, pythonLike) {
  const selectorType = selectorInfo.type || inferSelectorType(selectorInfo.selector);
  
  if (pythonLike) {
    // Python: text
    if (selectorType === 'text') {
      const textVal = getTextValue(selectorInfo);
      if (textVal) {
        const matchMode = selectorInfo.matchMode || 'exact';
        if (matchMode === 'contains') {
          return `${base}.get_by_text("${escapeForPythonString(textVal)}", exact=False)`;
        }
        return `${base}.get_by_text("${escapeForPythonString(textVal)}", exact=True)`;
      }
    }
    // Python: xpath
    if (selectorType === 'xpath' || selectorType === 'xpath-full') {
      const locator = ensureXPathSelector(selectorInfo.selector);
      return `${base}.locator("${escapeForPythonString(locator)}")`;
    }
    // Python: data-testid
    if (selectorType === 'data-testid') {
      const testIdValue = extractAttributeValue(selectorInfo.selector, 'data-testid');
      if (testIdValue) {
        return `${base}.get_by_test_id("${escapeForPythonString(testIdValue)}")`;
      }
    }
    // Python: aria-label
    if (selectorType === 'aria-label') {
      const labelValue = extractAttributeValue(selectorInfo.selector, 'aria-label');
      if (labelValue) {
        return `${base}.get_by_label("${escapeForPythonString(labelValue)}")`;
      }
    }
    // Python: role
    if (selectorType === 'role') {
      const roleValue = extractAttributeValue(selectorInfo.selector, 'role');
      if (roleValue) {
        return `${base}.get_by_role("${escapeForPythonString(roleValue)}")`;
      }
    }
    // Python: 기본 locator
    return `${base}.locator("${escapeForPythonString(selectorInfo.selector)}")`;
  }
  
  // JavaScript/TypeScript: text
  if (selectorType === 'text') {
    const textVal = getTextValue(selectorInfo);
    if (textVal) {
      const matchMode = selectorInfo.matchMode || 'exact';
      if (matchMode === 'contains') {
        return `${base}.getByText("${escapeForJSString(textVal)}")`;
      }
      return `${base}.getByText("${escapeForJSString(textVal)}", { exact: true })`;
    }
  }
  // JavaScript/TypeScript: xpath
  if (selectorType === 'xpath' || selectorType === 'xpath-full') {
    const locator = ensureXPathSelector(selectorInfo.selector);
    return `${base}.locator("${escapeForJSString(locator)}")`;
  }
  // JavaScript/TypeScript: data-testid
  if (selectorType === 'data-testid') {
    const testIdValue = extractAttributeValue(selectorInfo.selector, 'data-testid');
    if (testIdValue) {
      return `${base}.getByTestId("${escapeForJSString(testIdValue)}")`;
    }
  }
  // JavaScript/TypeScript: aria-label
  if (selectorType === 'aria-label') {
    const labelValue = extractAttributeValue(selectorInfo.selector, 'aria-label');
    if (labelValue) {
      return `${base}.getByLabel("${escapeForJSString(labelValue)}")`;
    }
  }
  // JavaScript/TypeScript: role
  if (selectorType === 'role') {
    const roleValue = extractAttributeValue(selectorInfo.selector, 'role');
    if (roleValue) {
      return `${base}.getByRole("${escapeForJSString(roleValue)}")`;
    }
  }
  // JavaScript/TypeScript: 기본 locator
  return `${base}.locator("${escapeForJSString(selectorInfo.selector)}")`;
}

function buildPlaywrightPythonAction(ev, selectorInfo, base = 'page') {
  if (!ev || !selectorInfo || !selectorInfo.selector) return null;
  const locatorExpr = buildPlaywrightLocatorExpressionForAction(base, selectorInfo, true);
  const value = escapeForPythonString(ev.value || '');
  const positionInfo = resolveSelectorPosition(ev);
  
  const getLocator = () => {
    if (selectorInfo.type === 'text' && positionInfo && positionInfo.nthOfType && positionInfo.repeats) {
      const index = positionInfo.nthOfType - 1;
      return `${locatorExpr}.nth(${index})`;
    }
    return locatorExpr;
  };
  
  if (ev.action === 'click') {
    return `${getLocator()}.click()`;
  }
  if (ev.action === 'doubleClick') {
    return `${getLocator()}.dblclick()`;
  }
  if (ev.action === 'rightClick') {
    return `${getLocator()}.click(button="right")`;
  }
  if (ev.action === 'hover') {
    return `${getLocator()}.hover()`;
  }
  if (ev.action === 'input' || ev.action === 'type') {
    return `${getLocator()}.fill("${value}")`;
  }
  if (ev.action === 'clear') {
    return `${getLocator()}.clear()`;
  }
  if (ev.action === 'select') {
    if (value) {
      return `${getLocator()}.select_option("${value}")`;
    }
    return `${getLocator()}.select_option()`;
  }
  return null;
}

function buildPlaywrightJSAction(ev, selectorInfo, base = 'page') {
  if (!ev || !selectorInfo || !selectorInfo.selector) return null;
  const locatorExpr = buildPlaywrightLocatorExpressionForAction(base, selectorInfo, false);
  const value = escapeForJSString(ev.value || '');
  const positionInfo = resolveSelectorPosition(ev);
  
  const getLocator = () => {
    if (selectorInfo.type === 'text' && positionInfo && positionInfo.nthOfType && positionInfo.repeats) {
      const index = positionInfo.nthOfType - 1;
      return `${locatorExpr}.nth(${index})`;
    }
    return locatorExpr;
  };
  
  if (ev.action === 'click') {
    return `await ${getLocator()}.click();`;
  }
  if (ev.action === 'doubleClick') {
    return `await ${getLocator()}.dblclick();`;
  }
  if (ev.action === 'rightClick') {
    return `await ${getLocator()}.click({ button: 'right' });`;
  }
  if (ev.action === 'hover') {
    return `await ${getLocator()}.hover();`;
  }
  if (ev.action === 'input' || ev.action === 'type') {
    return `await ${getLocator()}.fill("${value}");`;
  }
  if (ev.action === 'clear') {
    return `await ${getLocator()}.clear();`;
  }
  if (ev.action === 'select') {
    if (value) {
      return `await ${getLocator()}.selectOption("${value}");`;
    }
    return `await ${getLocator()}.selectOption();`;
  }
  return null;
}

function buildSeleniumPythonAction(ev, selectorInfo, driverVar = 'driver') {
  if (!ev || !selectorInfo || !selectorInfo.selector) return null;
  const selectorType = selectorInfo.type || inferSelectorType(selectorInfo.selector);
  const value = escapeForPythonString(ev.value || '');
  const positionInfo = resolveSelectorPosition(ev);
  
  const getElement = () => {
    if (selectorType === 'xpath') {
      const xpath = escapeForPythonString(getXPathValue(selectorInfo));
      return `${driverVar}.find_element(By.XPATH, "${xpath}")`;
    }
    if (selectorType === 'text') {
      const textVal = getTextValue(selectorInfo);
      if (textVal) {
        const matchMode = selectorInfo.matchMode || 'exact';
        let expr = matchMode === 'exact'
          ? `//*[normalize-space(.) = "${textVal}"]`
          : `//*[contains(normalize-space(.), "${textVal}")]`;
        if (positionInfo && positionInfo.nthOfType && positionInfo.repeats) {
          expr = `(${expr})[${positionInfo.nthOfType}]`;
        }
        const escapedExpr = escapeForPythonString(expr);
        return `${driverVar}.find_element(By.XPATH, "${escapedExpr}")`;
      }
    }
    const cssSelector = escapeForPythonString(selectorInfo.selector);
    return `${driverVar}.find_element(By.CSS_SELECTOR, "${cssSelector}")`;
  };
  
  const element = getElement();
  if (!element) return null;
  
  if (ev.action === 'click') {
    return `${element}.click()`;
  }
  if (ev.action === 'doubleClick') {
    return `${element}.double_click()`;
  }
  if (ev.action === 'rightClick') {
    return `${element}.context_click()`;
  }
  if (ev.action === 'hover') {
    return `ActionChains(${driverVar}).move_to_element(${element}).perform()`;
  }
  if (ev.action === 'input' || ev.action === 'type') {
    return `${element}.send_keys("${value}")`;
  }
  if (ev.action === 'clear') {
    return `${element}.clear()`;
  }
  if (ev.action === 'select') {
    if (value) {
      return `Select(${element}).select_by_visible_text("${value}")`;
    }
    return `Select(${element})`;
  }
  return null;
}

function buildSeleniumJSAction(ev, selectorInfo) {
  if (!ev || !selectorInfo || !selectorInfo.selector) return null;
  const selectorType = selectorInfo.type || inferSelectorType(selectorInfo.selector);
  const value = escapeForJSString(ev.value || '');
  const positionInfo = resolveSelectorPosition(ev);
  
  const getElement = () => {
    if (selectorType === 'xpath') {
      const xpath = escapeForJSString(getXPathValue(selectorInfo));
      return `driver.findElement(By.xpath("${xpath}"))`;
    }
    if (selectorType === 'text') {
      const textVal = getTextValue(selectorInfo);
      if (textVal) {
        const matchMode = selectorInfo.matchMode || 'exact';
        let expr = matchMode === 'exact'
          ? `//*[normalize-space(.) = "${textVal}"]`
          : `//*[contains(normalize-space(.), "${textVal}")]`;
        if (positionInfo && positionInfo.nthOfType && positionInfo.repeats) {
          expr = `(${expr})[${positionInfo.nthOfType}]`;
        }
        const escapedExpr = escapeForJSString(expr);
        return `driver.findElement(By.xpath("${escapedExpr}"))`;
      }
    }
    const cssSelector = escapeForJSString(selectorInfo.selector);
    return `driver.findElement(By.css("${cssSelector}"))`;
  };
  
  const element = getElement();
  if (!element) return null;
  
  if (ev.action === 'click') {
    return `  await ${element}.click();`;
  }
  if (ev.action === 'doubleClick') {
    return `  await ${element}.doubleClick();`;
  }
  if (ev.action === 'rightClick') {
    return `  await driver.actions().contextClick(${element}).perform();`;
  }
  if (ev.action === 'hover') {
    return `  await driver.actions().move({ origin: ${element} }).perform();`;
  }
  if (ev.action === 'input' || ev.action === 'type') {
    return `  await ${element}.sendKeys("${value}");`;
  }
  if (ev.action === 'clear') {
    return `  await ${element}.clear();`;
  }
  if (ev.action === 'select') {
    if (value) {
      return `  await new Select(${element}).selectByVisibleText("${value}");`;
    }
    return `  await new Select(${element});`;
  }
  return null;
}

function buildCypressLocatorExpression(selection, usageTracker) {
  if (!selection || !selection.selector) return null;
  const selectorType = selection.type || inferSelectorType(selection.selector);
  if (selectorType === 'text') {
    const textVal = getTextValue(selection);
    if (!textVal) return null;
    return `cy.contains("${escapeForJSString(textVal)}")`;
  }
  if (selectorType === 'xpath') {
    if (usageTracker) {
      usageTracker.usesXPath = true;
    }
    const xpath = escapeForJSString(getXPathValue(selection));
    return `cy.xpath("${xpath}")`;
  }
  const selector = escapeForJSString(getSelectorCore(selection.selector));
  if (!selector) return null;
  return `cy.get("${selector}")`;
}

function buildCypressAction(ev, selectorInfo, options = {}) {
  if (!ev || !selectorInfo) return null;
  const usageTracker = options.usage || null;
  const locatorExpr = buildCypressLocatorExpression(selectorInfo, usageTracker);
  if (!locatorExpr) return null;
  const value = escapeForJSString(ev.value || '');
  if (ev.action === 'click') {
    return `${locatorExpr}.click();`;
  }
  if (ev.action === 'input') {
    if (value) {
      return `${locatorExpr}.clear().type("${value}");`;
    }
    return `${locatorExpr}.clear();`;
  }
  if (ev.action === 'change' && value) {
    return `${locatorExpr}.clear().type("${value}");`;
  }
  return null;
}

function generateCode(events, manualList, framework, language) {
  const lines = [];
  const frameworkLower = (framework || '').toLowerCase();
  const languageLower = (language || '').toLowerCase();
  const manualActionsList = Array.isArray(manualList) ? manualList.filter(Boolean) : [];
  const timeline = buildActionTimeline(events || [], manualActionsList);
  
  if (frameworkLower === 'playwright') {
    if (languageLower === 'python') {
    lines.push("from playwright.sync_api import sync_playwright");
      lines.push("");
    lines.push("with sync_playwright() as p:");
    lines.push("  browser = p.chromium.launch(headless=False)");
    lines.push("  page = browser.new_page()");
      let currentFrameContext = null;
      let frameLocatorIndex = 0;
      let currentBase = 'page';
      timeline.forEach((entry) => {
        if (entry.kind === 'event') {
          const {event, selectorInfo} = entry;
          const targetFrame = selectorInfo && selectorInfo.iframeContext ? selectorInfo.iframeContext : null;
          if (!framesEqual(targetFrame, currentFrameContext)) {
            if (targetFrame) {
              frameLocatorIndex += 1;
              const alias = `frame_locator_${frameLocatorIndex}`;
              const setupLines = buildPlaywrightFrameLocatorLines(targetFrame, languageLower, alias, '  ', 'page');
              setupLines.forEach(line => lines.push(`  ${line}`));
              currentBase = alias;
              currentFrameContext = targetFrame;
            } else {
              currentBase = 'page';
              currentFrameContext = null;
            }
          }
          const actionLine = buildPlaywrightPythonAction(event, selectorInfo, currentBase);
          if (actionLine) {
            lines.push(`  ${actionLine}`);
          }
        } else if (entry.kind === 'manual') {
          emitManualActionLines(lines, entry.action, frameworkLower, languageLower, '  ');
        }
      });
    lines.push("  browser.close()");
    } else if (languageLower === 'python-class') {
      lines.push("from playwright.sync_api import sync_playwright");
      lines.push("");
      lines.push("class GeneratedTestCase:");
      lines.push("  def __init__(self, page):");
      lines.push("    self.page = page");
      lines.push("");
      lines.push("  def run(self):");
      let currentFrameContext = null;
      let frameLocatorIndex = 0;
      let currentBase = 'self.page';
      let hasEmittedAction = false;
      timeline.forEach((entry) => {
        if (entry.kind === 'event') {
          const { event, selectorInfo } = entry;
          const targetFrame = selectorInfo && selectorInfo.iframeContext ? selectorInfo.iframeContext : null;
          if (!framesEqual(targetFrame, currentFrameContext)) {
            if (targetFrame) {
              frameLocatorIndex += 1;
              const alias = `self.frame_locator_${frameLocatorIndex}`;
              const setupLines = buildPlaywrightFrameLocatorLines(targetFrame, languageLower, alias, '    ', 'self.page');
              setupLines.forEach((line) => lines.push(`    ${line}`));
              currentBase = alias;
              currentFrameContext = targetFrame;
            } else {
              currentBase = 'self.page';
              currentFrameContext = null;
            }
          }
          const actionLine = buildPlaywrightPythonAction(event, selectorInfo, currentBase);
          if (actionLine) {
            lines.push(`    ${actionLine}`);
            hasEmittedAction = true;
          }
        } else if (entry.kind === 'manual') {
          emitManualActionLines(lines, entry.action, frameworkLower, languageLower, '    ');
          hasEmittedAction = true;
        }
      });
      if (!hasEmittedAction) {
        lines.push("    pass");
      }
      lines.push("");
      lines.push("def run_test():");
      lines.push("  with sync_playwright() as p:");
      lines.push("    browser = p.chromium.launch(headless=False)");
      lines.push("    page = browser.new_page()");
      lines.push("    test_case = GeneratedTestCase(page)");
      lines.push("    test_case.run()");
      lines.push("    browser.close()");
      lines.push("");
      lines.push("if __name__ == \"__main__\":");
      lines.push("  run_test()");
    } else if (languageLower === 'javascript') {
      lines.push("const { chromium } = require('playwright');");
      lines.push("");
      lines.push("(async () => {");
      lines.push("  const browser = await chromium.launch({ headless: false });");
      lines.push("  const page = await browser.newPage();");
      let currentFrameContext = null;
      let frameLocatorIndex = 0;
      let currentBase = 'page';
      timeline.forEach((entry) => {
        if (entry.kind === 'event') {
          const {event, selectorInfo} = entry;
          const targetFrame = selectorInfo && selectorInfo.iframeContext ? selectorInfo.iframeContext : null;
          if (!framesEqual(targetFrame, currentFrameContext)) {
            if (targetFrame) {
              frameLocatorIndex += 1;
              const alias = `frameLocator${frameLocatorIndex}`;
              const setupLines = buildPlaywrightFrameLocatorLines(targetFrame, languageLower, alias, '  ', 'page');
              setupLines.forEach(line => lines.push(`  ${line}`));
              currentBase = alias;
              currentFrameContext = targetFrame;
            } else {
              currentBase = 'page';
              currentFrameContext = null;
            }
          }
          const actionLine = buildPlaywrightJSAction(event, selectorInfo, currentBase);
          if (actionLine) {
            lines.push(`  ${actionLine}`);
          }
        } else if (entry.kind === 'manual') {
          emitManualActionLines(lines, entry.action, frameworkLower, languageLower, '  ');
        }
      });
      lines.push("  await browser.close();");
      lines.push("})();");
    } else if (languageLower === 'typescript') {
      lines.push("import { chromium } from 'playwright';");
      lines.push("");
      lines.push("(async () => {");
      lines.push("  const browser = await chromium.launch({ headless: false });");
      lines.push("  const page = await browser.newPage();");
      let currentFrameContext = null;
      let frameLocatorIndex = 0;
      let currentBase = 'page';
      timeline.forEach((entry) => {
        if (entry.kind === 'event') {
          const {event, selectorInfo} = entry;
          const targetFrame = selectorInfo && selectorInfo.iframeContext ? selectorInfo.iframeContext : null;
          if (!framesEqual(targetFrame, currentFrameContext)) {
            if (targetFrame) {
              frameLocatorIndex += 1;
              const alias = `frameLocator${frameLocatorIndex}`;
              const setupLines = buildPlaywrightFrameLocatorLines(targetFrame, languageLower, alias, '  ', 'page');
              setupLines.forEach(line => lines.push(`  ${line}`));
              currentBase = alias;
              currentFrameContext = targetFrame;
            } else {
              currentBase = 'page';
              currentFrameContext = null;
            }
          }
          const actionLine = buildPlaywrightJSAction(event, selectorInfo, currentBase);
          if (actionLine) {
            lines.push(`  ${actionLine}`);
          }
        } else if (entry.kind === 'manual') {
          emitManualActionLines(lines, entry.action, frameworkLower, languageLower, '  ');
        }
      });
      lines.push("  await browser.close();");
      lines.push("})();");
    }
  } else if (frameworkLower === 'selenium') {
    if (languageLower === 'python') {
    lines.push("from selenium import webdriver");
      lines.push("from selenium.webdriver.common.by import By");
      lines.push("from selenium.webdriver.common.action_chains import ActionChains");
      lines.push("from selenium.webdriver.support.ui import Select");
      lines.push("");
    lines.push("driver = webdriver.Chrome()");
    lines.push("driver.get('REPLACE_URL')");
      let currentFrame = null;
      timeline.forEach((entry) => {
        if (entry.kind === 'event') {
          const {event, selectorInfo} = entry;
          const targetFrame = selectorInfo && selectorInfo.iframeContext ? selectorInfo.iframeContext : null;
          if (targetFrame) {
            const switchLine = buildSeleniumFrameSwitchPython(targetFrame);
            if (switchLine) {
              lines.push(switchLine);
              currentFrame = targetFrame;
            }
          } else if (currentFrame) {
            lines.push('driver.switch_to.default_content()');
            currentFrame = null;
          }
          const actionLine = buildSeleniumPythonAction(event, selectorInfo);
          if (actionLine) {
            lines.push(actionLine);
          }
        } else if (entry.kind === 'manual') {
          emitManualActionLines(lines, entry.action, frameworkLower, languageLower, '');
        }
      });
    lines.push("driver.quit()");
    } else if (languageLower === 'python-class') {
      lines.push("from selenium import webdriver");
      lines.push("from selenium.webdriver.common.by import By");
      lines.push("from selenium.webdriver.common.action_chains import ActionChains");
      lines.push("from selenium.webdriver.support.ui import Select");
      lines.push("");
      lines.push("class GeneratedTestCase:");
      lines.push("  def __init__(self, driver):");
      lines.push("    self.driver = driver");
      lines.push("");
      lines.push("  def run(self):");
      lines.push("    self.driver.get('REPLACE_URL')");
      let currentFrame = null;
      let hasAction = false;
      timeline.forEach((entry) => {
        if (entry.kind === 'event') {
          const { event, selectorInfo } = entry;
          const targetFrame = selectorInfo && selectorInfo.iframeContext ? selectorInfo.iframeContext : null;
          if (targetFrame) {
            const switchLine = buildSeleniumFrameSwitchPython(targetFrame, 'self.driver');
            if (switchLine) {
              lines.push(`    ${switchLine}`);
              currentFrame = targetFrame;
              hasAction = true;
            }
          } else if (currentFrame) {
            lines.push('    self.driver.switch_to.default_content()');
            currentFrame = null;
            hasAction = true;
          }
          const actionLine = buildSeleniumPythonAction(event, selectorInfo, 'self.driver');
          if (actionLine) {
            lines.push(`    ${actionLine}`);
            hasAction = true;
          }
        } else if (entry.kind === 'manual') {
          emitManualActionLines(lines, entry.action, frameworkLower, languageLower, '    ');
          hasAction = true;
        }
      });
      if (!hasAction) {
        lines.push("    pass");
      }
      lines.push("");
      lines.push("def run_test():");
      lines.push("  driver = webdriver.Chrome()");
      lines.push("  try:");
      lines.push("    test_case = GeneratedTestCase(driver)");
      lines.push("    test_case.run()");
      lines.push("  finally:");
      lines.push("    driver.quit()");
      lines.push("");
      lines.push("if __name__ == \"__main__\":");
      lines.push("  run_test()");
    } else if (languageLower === 'javascript') {
      lines.push("const { Builder, By } = require('selenium-webdriver');");
      lines.push("const chrome = require('selenium-webdriver/chrome');");
      lines.push("");
      lines.push("(async () => {");
      lines.push("  const driver = await new Builder()");
      lines.push("    .forBrowser('chrome')");
      lines.push("    .setChromeOptions(new chrome.Options().addArguments('--headless=new'))");
      lines.push("    .build();");
      lines.push("  await driver.get('REPLACE_URL');");
      let currentFrame = null;
      timeline.forEach((entry) => {
        if (entry.kind === 'event') {
          const {event, selectorInfo} = entry;
          const targetFrame = selectorInfo && selectorInfo.iframeContext ? selectorInfo.iframeContext : null;
          if (targetFrame) {
            const switchLine = buildSeleniumFrameSwitchJS(targetFrame, '  ');
            if (switchLine) {
              lines.push(switchLine);
              currentFrame = targetFrame;
            }
          } else if (currentFrame) {
            lines.push('  await driver.switchTo().defaultContent();');
            currentFrame = null;
          }
          const actionLine = buildSeleniumJSAction(event, selectorInfo);
          if (actionLine) {
            lines.push(actionLine);
          }
        } else if (entry.kind === 'manual') {
          emitManualActionLines(lines, entry.action, frameworkLower, languageLower, '  ');
        }
      });
      lines.push("  await driver.quit();");
      lines.push("})();");
    } else if (languageLower === 'typescript') {
      lines.push("import { Builder, By } from 'selenium-webdriver';");
      lines.push("import * as chrome from 'selenium-webdriver/chrome';");
      lines.push("");
      lines.push("(async () => {");
      lines.push("  const driver = await new Builder()");
      lines.push("    .forBrowser('chrome')");
      lines.push("    .setChromeOptions(new chrome.Options().addArguments('--headless=new'))");
      lines.push("    .build();");
      lines.push("  await driver.get('REPLACE_URL');");
      let currentFrame = null;
      timeline.forEach((entry) => {
        if (entry.kind === 'event') {
          const {event, selectorInfo} = entry;
          const targetFrame = selectorInfo && selectorInfo.iframeContext ? selectorInfo.iframeContext : null;
          if (targetFrame) {
            const switchLine = buildSeleniumFrameSwitchTS(targetFrame);
            if (switchLine) {
              lines.push(switchLine);
              currentFrame = targetFrame;
            }
          } else if (currentFrame) {
            lines.push('  await driver.switchTo().defaultContent();');
            currentFrame = null;
          }
          const actionLine = buildSeleniumJSAction(event, selectorInfo);
          if (actionLine) {
            lines.push(actionLine);
          }
        } else if (entry.kind === 'manual') {
          emitManualActionLines(lines, entry.action, frameworkLower, languageLower, '  ');
        }
      });
      lines.push("  await driver.quit();");
      lines.push("})();");
    }
  }
  return lines.join('\n');
}

// ==================== TestArchitect 데이터 전송 기능 ====================

/**
 * 유일성이 확보된 셀렉터만 필터링
 */
function getUniqueSelectors(selectorCandidates) {
  if (!Array.isArray(selectorCandidates) || selectorCandidates.length === 0) {
    return [];
  }
  
  // 유일성이 확보된 셀렉터만 필터링 (unique === true)
  const uniqueSelectors = selectorCandidates.filter(candidate => {
    return candidate && candidate.unique === true && candidate.selector;
  });
  
  // 유일한 셀렉터가 없으면 점수가 높은 셀렉터 중 최상위 하나만 반환
  if (uniqueSelectors.length === 0) {
    const sorted = [...selectorCandidates]
      .filter(c => c && c.selector)
      .sort((a, b) => (b.score || 0) - (a.score || 0));
    return sorted.length > 0 ? [sorted[0]] : [];
  }
  
  // 점수 순으로 정렬하여 반환
  return uniqueSelectors.sort((a, b) => (b.score || 0) - (a.score || 0));
}

/**
 * 셀렉터를 문서 스펙 형식으로 변환
 */
function buildSelectorObject(selectorCandidate) {
  if (!selectorCandidate || !selectorCandidate.selector) {
    return {};
  }
  
  const selector = selectorCandidate.selector;
  const type = selectorCandidate.type || inferSelectorType(selector);
  
  const selectors = {};
  
  // 셀렉터 타입에 따라 적절한 필드에 할당
  if (type === 'id') {
    let idValue = selector.startsWith('#') ? selector.slice(1) : selector;
    // css= 접두사 제거
    if (idValue.startsWith('css=')) {
      idValue = idValue.slice(4);
      if (idValue.startsWith('#')) {
        idValue = idValue.slice(1);
      }
    }
    selectors.id = `#${idValue}`;
    // CSS 셀렉터로도 추가
    selectors.css = `#${idValue}`;
  } else if (type === 'css' || type === 'class' || type === 'class-tag') {
    let cssValue = selector.startsWith('css=') ? selector.slice(4) : selector;
    // #으로 시작하면 id로도 추가
    if (cssValue.startsWith('#')) {
      selectors.id = cssValue;
    }
    selectors.css = cssValue;
  } else if (type === 'xpath' || type === 'xpath-full') {
    let xpathValue = selector.startsWith('xpath=') ? selector.slice(6) : selector;
    // //로 시작하지 않으면 추가
    if (!xpathValue.startsWith('//') && !xpathValue.startsWith('/')) {
      xpathValue = '//' + xpathValue;
    }
    selectors.xpath = xpathValue;
  } else if (type === 'text') {
    const textValue = selectorCandidate.textValue || getTextValue({ selector });
    if (textValue) {
      // XPath 텍스트 셀렉터
      selectors.text = `//*[text()='${textValue}']`;
      selectors.xpath = `//*[text()='${textValue}']`;
    }
  }
  
  // data-testid 등 속성 기반 셀렉터 처리
  if (type && type.startsWith('data-')) {
    const attrName = type;
    const attrValue = extractAttributeValue(selector, attrName);
    if (attrValue) {
      selectors.dataTestId = `[${attrName}="${attrValue}"]`;
      // CSS 셀렉터로도 추가
      if (!selectors.css) {
        selectors.css = `[${attrName}="${attrValue}"]`;
      }
    }
  }
  
  // name 속성 처리
  if (type === 'name') {
    const nameValue = extractAttributeValue(selector, 'name');
    if (nameValue) {
      selectors.name = `[name="${nameValue}"]`;
      // CSS 셀렉터로도 추가
      if (!selectors.css) {
        selectors.css = `[name="${nameValue}"]`;
      }
    }
  }
  
  return selectors;
}

/**
 * 이벤트를 문서 스펙 형식으로 변환
 */
function convertEventToSpecFormat(event) {
  if (!event) return null;
  
  // 액션 타입 매핑
  const actionTypeMap = {
    'click': 'click',
    'doubleClick': 'dblclick',
    'rightClick': 'click', // 우클릭도 click으로 처리
    'input': 'type',
    'type': 'type',
    'clear': 'type',
    'goto': 'navigate',
    'select': 'select',
    'hover': 'hover',
    'verifyText': 'assert',
    'verifyElementPresent': 'assert',
    'verifyElementNotPresent': 'assert',
    'verifyTitle': 'assert',
    'verifyUrl': 'assert',
    'waitForElement': 'wait',
    'wait': 'wait'
  };
  
  const eventType = actionTypeMap[event.action] || event.action;
  
  // 유일성이 확보된 셀렉터만 사용
  const uniqueSelectors = getUniqueSelectors(event.selectorCandidates || []);
  
  // Target 객체 생성
  let target = null;
  if (event.target || uniqueSelectors.length > 0) {
    const bestSelector = uniqueSelectors.length > 0 ? uniqueSelectors[0] : null;
    const selectorObj = bestSelector ? buildSelectorObject(bestSelector) : {};
    
    target = {
      tagName: event.target?.tag || event.tag || null,
      id: event.target?.id || null,
      className: Array.isArray(event.target?.classes) 
        ? event.target.classes.join(' ') 
        : (event.target?.classes || null),
      type: event.target?.type || null,
      text: event.target?.text || null,
      selectors: selectorObj,
      attributes: {}
    };
    
    // attributes 추출 (data-testid 등)
    if (bestSelector) {
      const selector = bestSelector.selector || '';
      const dataTestId = extractAttributeValue(selector, 'data-testid');
      if (dataTestId) {
        target.attributes['data-testid'] = dataTestId;
      }
      const ariaLabel = extractAttributeValue(selector, 'aria-label');
      if (ariaLabel) {
        target.attributes['aria-label'] = ariaLabel;
      }
    }
    
    // 빈 객체가 되면 null로
    if (!target.tagName && !target.id && !target.className && 
        Object.keys(target.selectors).length === 0) {
      target = null;
    }
  }
  
  // URL 추출
  const url = event.page?.url || event.url || '';
  
  // Viewport 정보 (기본값 사용, 실제로는 탭에서 가져와야 함)
  // TODO: 실제 탭의 viewport 크기를 가져오도록 개선 필요
  const viewport = {
    width: window.screen ? window.screen.width : 1920,
    height: window.screen ? window.screen.height : 1080
  };
  
  // 이벤트별 특수 처리
  const convertedEvent = {
    id: `event-${event.timestamp || Date.now()}`,
    type: eventType,
    timestamp: event.timestamp || Date.now(),
    target: target,
    value: event.value || null,
    url: url,
    viewport: viewport
  };
  
  // navigate 타입은 target이 null
  if (eventType === 'navigate') {
    convertedEvent.target = null;
    convertedEvent.value = url;
  }
  
  // wait 타입 처리
  if (eventType === 'wait') {
    if (event.action === 'waitForElement') {
      convertedEvent.condition = 'visible';
      convertedEvent.timeout = 5000;
    } else if (event.action === 'wait') {
      convertedEvent.condition = 'timeout';
      convertedEvent.timeout = event.value || 1000;
      convertedEvent.target = null;
    }
  }
  
  // assert 타입 처리
  if (eventType === 'assert') {
    if (event.action === 'verifyText') {
      convertedEvent.assertion = 'text';
      convertedEvent.expected = event.value || target?.text || '';
    } else if (event.action === 'verifyElementPresent') {
      convertedEvent.assertion = 'visible';
    } else if (event.action === 'verifyElementNotPresent') {
      convertedEvent.assertion = 'hidden';
    } else if (event.action === 'verifyTitle') {
      convertedEvent.assertion = 'text';
      convertedEvent.target = null;
      convertedEvent.expected = event.value || '';
    } else if (event.action === 'verifyUrl') {
      convertedEvent.assertion = 'attribute';
      convertedEvent.target = null;
      convertedEvent.expected = event.value || url;
    }
  }
  
  return convertedEvent;
}

/**
 * 세션 ID 생성
 */
function generateSessionId() {
  return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 브라우저 및 OS 정보 수집
 */
function getBrowserMetadata() {
  const userAgent = navigator.userAgent;
  let browser = 'unknown';
  let browserVersion = '0.0.0';
  let os = 'unknown';
  let osVersion = 'unknown';
  
  // 브라우저 감지
  if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) {
    browser = 'chrome';
    const match = userAgent.match(/Chrome\/(\d+)/);
    if (match) browserVersion = `${match[1]}.0.0.0`;
  } else if (userAgent.includes('Firefox')) {
    browser = 'firefox';
    const match = userAgent.match(/Firefox\/(\d+)/);
    if (match) browserVersion = `${match[1]}.0.0`;
  } else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) {
    browser = 'safari';
    const match = userAgent.match(/Version\/(\d+)/);
    if (match) browserVersion = `${match[1]}.0`;
  } else if (userAgent.includes('Edg')) {
    browser = 'edge';
    const match = userAgent.match(/Edg\/(\d+)/);
    if (match) browserVersion = `${match[1]}.0.0.0`;
  }
  
  // OS 감지
  if (userAgent.includes('Windows')) {
    os = 'Windows';
    const match = userAgent.match(/Windows NT (\d+\.\d+)/);
    if (match) {
      const version = match[1];
      if (version === '10.0') osVersion = '10';
      else if (version === '6.3') osVersion = '8.1';
      else if (version === '6.2') osVersion = '8';
      else if (version === '6.1') osVersion = '7';
      else osVersion = version;
    }
  } else if (userAgent.includes('Mac OS X')) {
    os = 'macOS';
    const match = userAgent.match(/Mac OS X (\d+[._]\d+)/);
    if (match) osVersion = match[1].replace('_', '.');
  } else if (userAgent.includes('Linux')) {
    os = 'Linux';
  }
  
  return {
    browser,
    browserVersion,
    os,
    osVersion,
    userAgent
  };
}

/**
 * 코드 객체 생성
 */
function buildCodeObject(events, manualActions, framework, language) {
  const code = generateCode(events, manualActions, framework, language);
  
  const codeObj = {};
  
  if (language === 'python' || language === 'python-class') {
    codeObj.python = {
      framework: framework,
      code: code
    };
  }
  
  if (language === 'javascript' || language === 'typescript') {
    codeObj.javascript = {
      framework: framework,
      code: code
    };
  }
  
  return codeObj;
}

/**
 * 녹화 데이터를 문서 스펙 형식으로 변환
 */
function convertRecordingToSpecFormat(events, manualActions, sessionId, tcId, projectId) {
  const normalizedEvents = Array.isArray(events) ? events.map(normalizeEventRecord) : [];
  const convertedEvents = normalizedEvents
    .map(convertEventToSpecFormat)
    .filter(event => event !== null);
  
  // 시작/종료 시간 계산
  const timestamps = convertedEvents.map(e => e.timestamp).filter(Boolean);
  const startTime = timestamps.length > 0 ? Math.min(...timestamps) : Date.now();
  const endTime = timestamps.length > 0 ? Math.max(...timestamps) : Date.now();
  const duration = endTime - startTime;
  
  // 메타데이터 수집
  const browserMetadata = getBrowserMetadata();
  const metadata = {
    ...browserMetadata,
    startTime: startTime,
    endTime: endTime,
    duration: duration
  };
  
  // 코드 객체 생성
  const code = buildCodeObject(normalizedEvents, manualActions, selectedFramework, selectedLanguage);
  
  return {
    type: 'recording_complete',
    sessionId: sessionId,
    tcId: tcId || null,
    projectId: projectId || 1,
    events: convertedEvents,
    code: code,
    metadata: metadata
  };
}

/**
 * TestArchitect로 녹화 데이터 전송
 */
async function sendRecordingData(recordingData) {
  try {
    const response = await fetch('http://localhost:3000/api/recording', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(recordingData)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    const result = await response.json();
    
    if (result.success) {
      console.log('녹화 데이터가 성공적으로 저장되었습니다');
      return result;
    } else {
      console.error('녹화 데이터 저장 실패:', result.error);
      throw new Error(result.error || 'Unknown error');
    }
  } catch (error) {
    console.error('전송 실패:', error);
    throw error;
  }
}

/**
 * 녹화 데이터 전송 처리
 */
function handleSendRecording() {
  const tcId = tcIdInput ? parseInt(tcIdInput.value) || null : null;
  const projectId = projectIdInput ? parseInt(projectIdInput.value) || 1 : 1;
  
  if (!tcId) {
    alert('테스트 케이스 ID(tcId)를 입력해주세요.');
    return;
  }
  
  chrome.runtime.sendMessage({type:'GET_EVENTS'}, async (res) => {
    const events = (res && res.events) || [];
    
    loadManualActions((manualActions) => {
      const sessionId = generateSessionId();
      
      try {
        // 데이터 변환
        const recordingData = convertRecordingToSpecFormat(
          events,
          manualActions,
          sessionId,
          tcId,
          projectId
        );
        
        // 전송
        sendRecordingData(recordingData)
          .then((result) => {
            alert(`녹화 데이터가 성공적으로 전송되었습니다.\nTC ID: ${result.tcId || tcId}\nScript ID: ${result.scriptId || 'N/A'}`);
          })
          .catch((error) => {
            alert(`전송 실패: ${error.message}`);
          });
      } catch (error) {
        alert(`데이터 변환 실패: ${error.message}`);
        console.error('데이터 변환 오류:', error);
      }
    });
  });
}