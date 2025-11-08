import { getChildSelectorCandidates, getIframeContext, getSelectorCandidates, getParentSelectorCandidates } from '../selectors/index.js';
import { elementSelectionState } from '../state.js';
import {
  applySelectionParentHighlight,
  clearSelectionParentHighlight,
  flashSelectionElement,
  highlightElement,
  removeHighlight,
  setOverlayStatus,
  updateOverlayControlsState
} from '../overlay/index.js';
import { buildDomContextSnapshot } from '../utils/dom.js';

function resetSelectionHighlight() {
  clearSelectionParentHighlight();
  if (elementSelectionState.childFlashTimeout) {
    clearTimeout(elementSelectionState.childFlashTimeout);
    elementSelectionState.childFlashTimeout = null;
  }
}

export function beginRootSelection() {
  elementSelectionState.active = true;
  elementSelectionState.mode = 'root';
  elementSelectionState.parentElement = null;
  elementSelectionState.currentElement = null;
  elementSelectionState.stack = [];
  resetSelectionHighlight();
  updateOverlayControlsState();
}

export function beginChildSelection() {
  if (!elementSelectionState.active || !elementSelectionState.currentElement) {
    return { ok: false, reason: 'parent_not_selected' };
  }
  elementSelectionState.mode = 'child';
  elementSelectionState.parentElement = elementSelectionState.currentElement;
  applySelectionParentHighlight(elementSelectionState.parentElement);
  updateOverlayControlsState();
  return { ok: true };
}

export function cancelSelection() {
  elementSelectionState.mode = null;
  elementSelectionState.active = false;
  elementSelectionState.parentElement = null;
  elementSelectionState.currentElement = null;
  elementSelectionState.stack = [];
  resetSelectionHighlight();
  updateOverlayControlsState();
}

function buildElementPayload(element) {
  return {
    tag: element.tagName,
    text: (element.innerText || element.textContent || '').trim().slice(0, 80),
    id: element.id || null,
    classList: Array.from(element.classList || []),
    iframeContext: getIframeContext(element),
    domContext: buildDomContextSnapshot(element)
  };
}

function handleRootSelection(target) {
  elementSelectionState.active = true;
  elementSelectionState.currentElement = target;
  elementSelectionState.parentElement = target;
  elementSelectionState.mode = null;
  elementSelectionState.stack = [{ element: target }];
  applySelectionParentHighlight(target);
  highlightElement(target);
  const selectors = (getSelectorCandidates(target) || []).map((candidate) => ({
    ...candidate,
    relation: candidate.relation || 'global'
  }));
  chrome.runtime.sendMessage({
    type: 'ELEMENT_SELECTION_PICKED',
    stage: 'root',
    selectors,
    element: buildElementPayload(target)
  });
  updateOverlayControlsState();
}

function handleChildSelection(target) {
  if (!elementSelectionState.parentElement || !elementSelectionState.parentElement.contains(target) || target === elementSelectionState.parentElement) {
    chrome.runtime.sendMessage({
      type: 'ELEMENT_SELECTION_ERROR',
      stage: 'child',
      reason: '선택한 요소가 부모 요소 내부에 있지 않습니다.'
    });
    return;
  }
  elementSelectionState.currentElement = target;
  elementSelectionState.stack.push({ element: target });
  const selectors = getChildSelectorCandidates(elementSelectionState.parentElement, target);
  flashSelectionElement(target);
  chrome.runtime.sendMessage({
    type: 'ELEMENT_SELECTION_PICKED',
    stage: 'child',
    selectors,
    element: buildElementPayload(target)
  });
  elementSelectionState.parentElement = target;
  elementSelectionState.mode = null;
  updateOverlayControlsState();
}

function handleParentSelection() {
  if (!elementSelectionState.active || !elementSelectionState.currentElement) {
    return { ok: false, reason: 'current_not_selected' };
  }
  let current = elementSelectionState.currentElement;
  let parent = current ? current.parentElement : null;
  while (parent && parent.nodeType !== 1) {
    parent = parent.parentElement;
  }
  if (!parent) {
    return { ok: false, reason: 'no_parent' };
  }
  elementSelectionState.currentElement = parent;
  elementSelectionState.parentElement = parent;
  elementSelectionState.mode = null;
  applySelectionParentHighlight(parent);
  flashSelectionElement(parent);
  const selectors = getParentSelectorCandidates(current, parent);
  chrome.runtime.sendMessage({
    type: 'ELEMENT_SELECTION_PICKED',
    stage: 'parent',
    selectors,
    element: buildElementPayload(parent)
  });
  updateOverlayControlsState();
  return { ok: true };
}

function handleSelectionClick(event) {
  if (!elementSelectionState.mode) return false;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  const target = event.target;
  if (!target || target === document.body || target === document.documentElement || target.id === '__ai_test_recorder_overlay__' || (target.closest && target.closest('#__ai_test_recorder_overlay__'))) {
    chrome.runtime.sendMessage({
      type: 'ELEMENT_SELECTION_ERROR',
      stage: elementSelectionState.mode === 'child' ? 'child' : 'root',
      reason: '선택할 수 없는 영역입니다. 다른 요소를 선택하세요.'
    });
    return true;
  }

  if (elementSelectionState.mode === 'root') {
    handleRootSelection(target);
    return true;
  }

  if (elementSelectionState.mode === 'child') {
    handleChildSelection(target);
    return true;
  }

  return false;
}

function interceptPointerEvent(event) {
  if (!elementSelectionState.mode) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

export function initSelectionInterceptors() {
  document.addEventListener('click', (event) => {
    if (handleSelectionClick(event)) {
      setOverlayStatus('요소 정보를 패널에서 확인하세요.', 'info');
    }
  }, true);

  ['mousedown', 'mouseup', 'pointerdown', 'pointerup'].forEach((type) => {
    document.addEventListener(type, interceptPointerEvent, true);
  });
}

export function handleParentSelectionRequest() {
  return handleParentSelection();
}

export function isSelectionActive() {
  return elementSelectionState.active;
}

export function getSelectionState() {
  return elementSelectionState;
}

export function handleSelectionCancellation() {
  cancelSelection();
  chrome.runtime.sendMessage({ type: 'ELEMENT_SELECTION_CANCELLED' });
}

