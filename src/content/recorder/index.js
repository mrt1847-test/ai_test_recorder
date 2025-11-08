import { createEventRecord } from '../events/schema.js';
import { getIframeContext, getSelectorCandidates } from '../selectors/index.js';
import { elementSelectionState, inputTimers, recorderState } from '../state.js';
import { ensureRecordingState, removeHighlight } from '../overlay/index.js';
import { buildDomContextSnapshot } from '../utils/dom.js';

const INPUT_DEBOUNCE_DELAY = 800;

function persistEvent(eventRecord) {
  chrome.runtime.sendMessage({ type: 'SAVE_EVENT', event: eventRecord }, () => {});
}

function broadcastRecordedEvent(eventRecord) {
  chrome.runtime.sendMessage({ type: 'EVENT_RECORDED', event: eventRecord }, () => {});
}

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

function buildEventForTarget({ action, target, value = null }) {
  const selectors = getSelectorCandidates(target) || [];
  const iframeContext = getIframeContext(target);
  const clientRect = buildClientRect(target);
  const metadata = { domEvent: action };
  const domContext = buildDomContextSnapshot(target);
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

function recordDomEvent({ action, target, value }) {
  if (!target) return;
  const eventRecord = buildEventForTarget({ action, target, value });
  persistEvent(eventRecord);
  broadcastRecordedEvent(eventRecord);
}

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
  removeHighlight();
}

export function initRecorderListeners() {
  document.addEventListener('click', (event) => {
    try {
      handleClick(event);
    } catch (err) {
      console.error('[AI Test Recorder] Failed to handle click event:', err);
    }
  }, true);

  document.addEventListener('input', (event) => {
    try {
      handleInput(event);
    } catch (err) {
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

