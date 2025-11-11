/**
 * 사용자 상호작용을 캡처하여 이벤트 레코드로 변환한다.
 * 클릭/입력 등의 DOM 이벤트를 감지하고 Chrome 스토리지 및
 * DevTools 패널로 전달한다.
 */
import { createEventRecord } from '../events/schema.js';
import { getIframeContext, getSelectorCandidates } from '../selectors/index.js';
import { elementSelectionState, inputTimers, recorderState } from '../state.js';
import { ensureRecordingState, removeHighlight } from '../overlay/index.js';
import { buildDomContextSnapshot } from '../utils/dom.js';

const INPUT_DEBOUNCE_DELAY = 800;

/**
 * 생성된 이벤트 레코드를 백그라운드에 저장 요청한다.
 */
function persistEvent(eventRecord) {
  chrome.runtime.sendMessage({ type: 'SAVE_EVENT', event: eventRecord }, () => {});
}

/**
 * 새 이벤트를 DevTools 패널로 브로드캐스트한다.
 */
function broadcastRecordedEvent(eventRecord) {
  chrome.runtime.sendMessage({ type: 'EVENT_RECORDED', event: eventRecord }, () => {});
}

/**
 * 대상 요소의 화면 좌표/크기를 반올림해 반환한다.
 */
function buildClientRect(target) {
  if (!target || typeof target.getBoundingClientRect !== 'function') {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  const rect = target.getBoundingClientRect();
  return {
    x: Math.round(rect.x || 0),
    y: Math.round(rect.y || 0),
    w: Math.round(rect.width || 0),
    h: Math.round(rect.height || 0)
  };
}

/**
 * DOM 이벤트에서 필요한 부가 정보(셀렉터, iframe 등)를 모아 eventRecord를 만든다.
 */
function buildEventForTarget({ action, target, value = null }) {
  const selectors = getSelectorCandidates(target) || [];
  const iframeContext = getIframeContext(target);
  const clientRect = buildClientRect(target);
  const metadata = { domEvent: action };
  const domContext = buildDomContextSnapshot(target, { includeSelf: true });
  const eventRecord = createEventRecord({
    action,
    value,
    selectors,
    target,
    iframeContext,
    clientRect,
    metadata,
    domContext
  });
  return {
    ...eventRecord,
    selectorCandidates: selectors,
    iframeContext,
    domContext,
    tag: target && target.tagName ? target.tagName : null
  };
}

/**
 * 이벤트를 생성하고 저장/방송까지 수행하는 헬퍼.
 */
function recordDomEvent({ action, target, value }) {
  if (!target) return;
  const eventRecord = buildEventForTarget({ action, target, value });
  persistEvent(eventRecord);
  broadcastRecordedEvent(eventRecord);
}

/**
 * 클릭 이벤트를 감지해 녹화 중일 때만 기록한다.
 */
function handleClick(event) {
  if (!recorderState.isRecording) return;
  if (elementSelectionState.mode) return;
  const target = event.target;
  if (!target || target === document.body || target === document.documentElement) return;
  if (target.id === '__ai_test_recorder_overlay__' || (target.closest && target.closest('#__ai_test_recorder_overlay__'))) {
    return;
  }
  recordDomEvent({ action: 'click', target });
}

/**
 * 입력 이벤트는 debounce를 적용해 마지막 값만 저장한다.
 */
function handleInput(event) {
  if (!recorderState.isRecording) return;
  const target = event.target;
  if (!target || (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && !target.isContentEditable)) {
    return;
  }
  const existingTimer = inputTimers.get(target);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  const timer = setTimeout(() => {
    recordDomEvent({ action: 'input', target, value: target.value || target.textContent || '' });
    inputTimers.delete(target);
  }, INPUT_DEBOUNCE_DELAY);
  inputTimers.set(target, timer);
}

/**
 * 포커스를 잃을 때도 debounce를 해제하고 최종 값을 기록한다.
 */
function handleBlur(event) {
  if (!recorderState.isRecording) return;
  const target = event.target;
  if (!target || (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && !target.isContentEditable)) {
    return;
  }
  const existingTimer = inputTimers.get(target);
  if (existingTimer) {
    clearTimeout(existingTimer);
    inputTimers.delete(target);
    recordDomEvent({ action: 'input', target, value: target.value || target.textContent || '' });
  }
}

export function startRecording(options = {}) {
  const { resetEvents = true } = options;
  if (recorderState.isRecording) {
    // 이미 녹화 중이면 상태만 재확인하고 필요한 경우 이벤트 배열 초기화.
    ensureRecordingState(true);
    if (resetEvents) {
      chrome.storage.local.set({ events: [], recording: true });
    } else {
      chrome.storage.local.set({ recording: true });
    }
    return;
  }
  recorderState.isRecording = true;
  ensureRecordingState(true);
  if (resetEvents) {
    chrome.storage.local.set({ events: [], recording: true });
  } else {
    chrome.storage.local.set({ recording: true });
  }
  removeHighlight();
}

export function stopRecording() {
  recorderState.isRecording = false;
  ensureRecordingState(false);
  chrome.storage.local.remove(['recording']);
  // 녹화를 멈출 때 하이라이트는 정리해 UI 혼선을 줄인다.
  removeHighlight();
}

export function initRecorderListeners() {
  document.addEventListener('click', (event) => {
    try {
      // 캡처 실패 시 전체 녹화를 중단하지 않도록 try/catch 처리.
      handleClick(event);
    } catch (err) {
      console.error('[AI Test Recorder] Failed to handle click event:', err);
    }
  }, true);

  document.addEventListener('input', (event) => {
    try {
      handleInput(event);
    } catch (err) {
      // 다른 이벤트 핸들링에 영향이 없도록 로그만 출력.
      console.error('[AI Test Recorder] Failed to handle input event:', err);
    }
  }, true);

  document.addEventListener('blur', (event) => {
    try {
      handleBlur(event);
    } catch (err) {
      console.error('[AI Test Recorder] Failed to handle blur event:', err);
    }
  }, true);
}

export function getRecordingState() {
  return recorderState.isRecording;
}
