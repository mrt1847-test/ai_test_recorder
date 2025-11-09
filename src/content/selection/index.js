/**
 * DevTools에서 요청하는 요소 선택 워크플로우를 처리한다.
 * 루트/자식/부모 선택 흐름과 하이라이트 상태를 제어한다.
 */
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

/**
 * 부모 하이라이트 및 자식 플래시 상태를 초기화한다.
 */
function resetSelectionHighlight() {
  clearSelectionParentHighlight();
  if (elementSelectionState.childFlashTimeout) {
    clearTimeout(elementSelectionState.childFlashTimeout);
    elementSelectionState.childFlashTimeout = null;
  }
}

/**
 * 루트 요소 선택을 시작하고 내부 상태를 초기화한다.
 */
export function beginRootSelection() {
  elementSelectionState.active = true;
  elementSelectionState.mode = 'root';
  elementSelectionState.parentElement = null;
  elementSelectionState.currentElement = null;
  elementSelectionState.stack = [];
  resetSelectionHighlight();
  updateOverlayControlsState();
}

/**
 * 현재 선택된 요소를 부모로 삼아 자식 선택 단계로 전환한다.
 */
export function beginChildSelection() {
  if (!elementSelectionState.active || !elementSelectionState.currentElement) {
    // 부모가 선택되지 않은 상태에서 자식 요청이 오면 오류.
    return { ok: false, reason: 'parent_not_selected' };
  }
  elementSelectionState.mode = 'child';
  elementSelectionState.parentElement = elementSelectionState.currentElement;
  applySelectionParentHighlight(elementSelectionState.parentElement);
  updateOverlayControlsState();
  return { ok: true };
}

/**
 * 선택 워크플로우를 완전히 종료하고 UI 상태를 초기화한다.
 */
export function cancelSelection() {
  elementSelectionState.mode = null;
  elementSelectionState.active = false;
  elementSelectionState.parentElement = null;
  elementSelectionState.currentElement = null;
  elementSelectionState.stack = [];
  resetSelectionHighlight();
  updateOverlayControlsState();
}

/**
 * DevTools 패널로 보낼 요소 요약 정보를 만든다.
 */
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

/**
 * 루트 단계에서 사용자가 클릭한 요소를 선택 처리한다.
 */
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

/**
 * 자식 선택 단계에서 클릭한 요소를 현재 경로에 추가한다.
 */
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

/**
 * 현재 요소에서 상위 요소로 이동해 부모 선택을 처리한다.
 */
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

/**
 * 선택 모드일 때 클릭 이벤트를 가로채 적절한 핸들러로 전달한다.
 */
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

/**
 * 선택 모드일 때 다른 포인터 이벤트가 전달되지 않도록 차단한다.
 */
function interceptPointerEvent(event) {
  if (!elementSelectionState.mode) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

/**
 * 요소 선택에 필요한 이벤트 인터셉터를 등록한다.
 */
export function initSelectionInterceptors() {
  document.addEventListener('click', (event) => {
    if (handleSelectionClick(event)) {
      // 클릭을 우리가 소비했다면 사용자에게 패널 확인을 안내한다.
      setOverlayStatus('요소 정보를 패널에서 확인하세요.', 'info');
    }
  }, true);

  ['mousedown', 'mouseup', 'pointerdown', 'pointerup'].forEach((type) => {
    document.addEventListener(type, interceptPointerEvent, true);
  });
}

/**
 * DevTools에서 부모 선택을 요청했을 때 내부 핸들러를 호출한다.
 */
export function handleParentSelectionRequest() {
  return handleParentSelection();
}

/**
 * 현재 요소 선택 모드가 활성화되어 있는지 여부를 반환한다.
 */
export function isSelectionActive() {
  return elementSelectionState.active;
}

/**
 * 선택 상태 객체를 그대로 노출해 외부에서 참조할 수 있게 한다.
 */
export function getSelectionState() {
  return elementSelectionState;
}

/**
 * 선택 취소 요청을 처리하고 DevTools에도 취소 사실을 알린다.
 */
export function handleSelectionCancellation() {
  cancelSelection();
  chrome.runtime.sendMessage({ type: 'ELEMENT_SELECTION_CANCELLED' });
}
