/**
 * 페이지 상단에 표시되는 오버레이 및 하이라이트 UI를 관리한다.
 * - 녹화 제어 버튼
 * - 요소 하이라이트 및 셀렉터 팝오버
 * - 위치/상태 복원 및 Chrome 메시지 연동
 */
import { getSelectorCandidates, getIframeContext } from '../selectors/index.js';
import { elementSelectionState, overlayControlsState, recorderState } from '../state.js';
import { buildDomContextSnapshot } from '../utils/dom.js';
import { createEventRecord } from '../events/schema.js';

/**
 * 현재 오버레이 위치를 저장해 새로고침 후에도 동일 위치를 유지한다.
 */
function saveOverlayPosition(left, top) {
  chrome.storage.local.set({ overlayPosition: { left, top } });
}

/**
 * 오버레이 상태 텍스트를 갱신하고 톤(색상)을 적용한다.
 */
export function setOverlayStatus(message, tone = 'info') {
  if (!overlayControlsState.status) return;
  overlayControlsState.status.textContent = message || '';
  overlayControlsState.status.setAttribute('data-tone', tone || 'info');
  overlayControlsState.status.style.display = message ? 'block' : 'none';
}

/**
 * 녹화 버튼 활성화 상태 및 선택 플래그를 UI에 반영한다.
 */
export function updateOverlayControlsState() {
  if (!overlayControlsState.buttons.start || !overlayControlsState.container) return;
  overlayControlsState.buttons.start.disabled = !!recorderState.isRecording;
  overlayControlsState.buttons.stop.disabled = !recorderState.isRecording;
  // Action 버튼은 녹화 중이고 하이라이트된 요소가 있을 때만 활성화
  if (overlayControlsState.buttons.action) {
    overlayControlsState.buttons.action.disabled = !recorderState.isRecording || !recorderState.currentHighlightedElement;
  }
  overlayControlsState.container.toggleAttribute('data-selecting', !!elementSelectionState.mode);
}

/**
 * 드래그 중 마우스 이동 이벤트로 컨트롤 패널 위치를 업데이트한다.
 */
function onOverlayDragMove(event) {
  if (!overlayControlsState.dragging || !overlayControlsState.container) return;
  const container = overlayControlsState.container;
  const width = container.offsetWidth;
  const height = container.offsetHeight;
  let newLeft = event.clientX - overlayControlsState.dragOffsetX;
  let newTop = event.clientY - overlayControlsState.dragOffsetY;
  const margin = 8;
  newLeft = Math.max(margin, Math.min(newLeft, window.innerWidth - width - margin));
  newTop = Math.max(margin, Math.min(newTop, window.innerHeight - height - margin));
  container.style.left = `${newLeft}px`;
  container.style.top = `${newTop}px`;
  container.style.right = '';
  container.style.bottom = '';
}

/**
 * 드래그를 종료하고 위치를 저장한다.
 */
function stopOverlayDrag() {
  if (!overlayControlsState.dragging || !overlayControlsState.container) return;
  overlayControlsState.dragging = false;
  document.removeEventListener('mousemove', onOverlayDragMove, true);
  document.removeEventListener('mouseup', stopOverlayDrag, true);
  const rect = overlayControlsState.container.getBoundingClientRect();
  saveOverlayPosition(rect.left, rect.top);
}

/**
 * 사용자가 헤더를 누르면 드래그 상태를 시작한다.
 */
function startOverlayDrag(event) {
  if (!overlayControlsState.container) return;
  const rect = overlayControlsState.container.getBoundingClientRect();
  overlayControlsState.dragging = true;
  overlayControlsState.dragOffsetX = event.clientX - rect.left;
  overlayControlsState.dragOffsetY = event.clientY - rect.top;
  overlayControlsState.container.style.left = `${rect.left}px`;
  overlayControlsState.container.style.top = `${rect.top}px`;
  overlayControlsState.container.style.right = '';
  overlayControlsState.container.style.bottom = '';
  document.addEventListener('mousemove', onOverlayDragMove, true);
  document.addEventListener('mouseup', stopOverlayDrag, true);
  event.preventDefault();
}

/**
 * 오버레이 명령에 대한 응답을 UI 메시지로 변환한다.
 */
function handleOverlayCommandResponse(command, response) {
  if (!response || response.ok) {
    if (command === 'start_record') {
      setOverlayStatus('녹화를 시작했습니다.', 'success');
    } else if (command === 'stop_record') {
      setOverlayStatus('녹화를 중지했습니다.', 'success');
    } else if (command === 'element_select') {
      setOverlayStatus('요소 선택 모드를 시작합니다. 페이지에서 요소를 클릭하세요.', 'info');
    }
    return;
  }
  const reason = response.reason || 'unknown';
  let message = '요청을 처리할 수 없습니다.';
  if (reason === 'already_recording') {
    message = '이미 녹화 중입니다.';
  } else if (reason === 'no_active_tab') {
    message = '활성 탭을 찾을 수 없습니다.';
  } else if (reason === 'not_recording') {
    message = '현재 녹화 중이 아닙니다.';
  } else if (reason === 'selection_in_progress') {
    message = '이미 요소 선택이 진행 중입니다.';
  } else if (reason === 'parent_not_selected') {
    message = '먼저 부모 요소를 선택하세요.';
  } else if (reason === 'unsupported_action') {
    message = '지원하지 않는 동작입니다.';
  }
  setOverlayStatus(message, 'error');
}

/**
 * DevTools 패널로 명령을 전송하고 응답 처리.
 */
export function sendOverlayCommand(command, options = {}) {
  chrome.runtime.sendMessage({ type: 'OVERLAY_COMMAND', command, options }, (response) => {
    if (chrome.runtime.lastError) {
      setOverlayStatus('DevTools 패널과 통신할 수 없습니다. 패널이 열려 있는지 확인하세요.', 'error');
      return;
    }
    handleOverlayCommandResponse(command, response);
  });
}

/**
 * 저장된 위치가 있다면 오버레이를 그 좌표로 이동시킨다.
 */
function restoreOverlayPosition(container) {
  chrome.storage.local.get({ overlayPosition: null }, (data) => {
    const pos = data.overlayPosition;
    if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
      container.style.left = `${pos.left}px`;
      container.style.top = `${pos.top}px`;
      container.style.right = '';
      container.style.bottom = '';
    }
  });
}

/**
 * DevTools 패널과 동일한 UI 컨트롤을 페이지에 생성한다.
 */
export function createOverlayControls() {
  if (overlayControlsState.container) return;
  if (window !== window.top) return;

  const container = document.createElement('div');
  container.id = '__ai_test_overlay__';
  container.style.position = 'fixed';
  container.style.right = '24px';
  container.style.bottom = '24px';
  container.style.background = 'rgba(15, 23, 42, 0.65)';
  container.style.backdropFilter = 'blur(12px)';
  container.style.border = '1px solid rgba(255,255,255,0.18)';
  container.style.borderRadius = '12px';
  container.style.padding = '12px';
  container.style.color = '#fff';
  container.style.fontFamily = 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
  container.style.fontSize = '12px';
  container.style.boxShadow = '0 12px 24px rgba(11, 15, 25, 0.35)';
  container.style.zIndex = '2147483646';
  container.style.minWidth = '200px';
  container.style.userSelect = 'none';

  const handle = document.createElement('div');
  handle.style.display = 'flex';
  handle.style.alignItems = 'center';
  handle.style.justifyContent = 'space-between';
  handle.style.fontWeight = '600';
  handle.style.fontSize = '11px';
  handle.style.textTransform = 'uppercase';
  handle.style.letterSpacing = '0.08em';
  handle.style.marginBottom = '10px';
  handle.style.cursor = 'move';

  const handleTitle = document.createElement('span');
  handleTitle.textContent = 'Recorder Controls';
  handleTitle.style.flex = '1 1 auto';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = 'x';
  closeBtn.setAttribute('aria-label', '오버레이 닫기');
  closeBtn.style.cssText = 'margin-left:8px;flex:0 0 auto;width:20px;height:20px;border:none;border-radius:4px;background:transparent;color:rgba(255,255,255,0.7);font-size:12px;line-height:1;cursor:pointer;padding:0;';
  closeBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    event.preventDefault();
    setOverlayVisibility(false);
  });
  closeBtn.addEventListener('mousedown', (event) => {
    event.stopPropagation();
  });
  closeBtn.addEventListener('mouseenter', () => {
    closeBtn.style.background = 'rgba(255,255,255,0.15)';
  });
  closeBtn.addEventListener('mouseleave', () => {
    closeBtn.style.background = 'transparent';
  });

  handle.appendChild(handleTitle);
  handle.appendChild(closeBtn);

  const buttonsRow = document.createElement('div');
  buttonsRow.style.display = 'flex';
  buttonsRow.style.gap = '8px';
  buttonsRow.style.flexWrap = 'nowrap';

  const buttonStyle = 'flex:1 1 auto;padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.14);color:#fff;font-size:12px;font-weight:600;cursor:pointer;transition:all 0.2s ease;text-align:center;';

  const startBtn = document.createElement('button');
  startBtn.textContent = 'Start';
  startBtn.style.cssText = buttonStyle;
  startBtn.addEventListener('click', () => {
    setOverlayStatus('녹화를 시작하는 중...', 'info');
    sendOverlayCommand('start_record');
  });

  const stopBtn = document.createElement('button');
  stopBtn.textContent = 'Stop';
  stopBtn.style.cssText = buttonStyle;
  stopBtn.addEventListener('click', () => {
    setOverlayStatus('녹화를 중지하는 중...', 'info');
    sendOverlayCommand('stop_record');
  });

  const selectBtn = document.createElement('button');
  selectBtn.textContent = 'Select';
  selectBtn.style.cssText = buttonStyle;
  selectBtn.addEventListener('click', () => {
    setOverlayStatus('요소 선택 모드를 준비하는 중...', 'info');
    sendOverlayCommand('element_select');
  });

  // Action 드롭다운 컨테이너
  const actionContainer = document.createElement('div');
  actionContainer.style.cssText = 'position:relative;flex:1 1 auto;';
  
  const actionBtn = document.createElement('button');
  actionBtn.textContent = 'Action ▼';
  actionBtn.style.cssText = buttonStyle;
  actionBtn.disabled = true;
  
  const actionMenu = document.createElement('div');
  actionMenu.style.cssText = `
    position:absolute;
    bottom:100%;
    left:0;
    margin-bottom:4px;
    background:rgba(15,23,42,0.95);
    backdrop-filter:blur(12px);
    border:1px solid rgba(255,255,255,0.18);
    border-radius:8px;
    padding:4px;
    min-width:140px;
    max-height:200px;
    overflow-y:auto;
    display:none;
    z-index:1000;
    box-shadow:0 8px 24px rgba(11,15,25,0.4);
  `;
  
  const actionOptions = [
    { value: 'click', label: '클릭' },
    { value: 'doubleClick', label: '더블 클릭' },
    { value: 'rightClick', label: '우클릭' },
    { value: 'hover', label: '호버' },
    { value: 'type', label: '입력' },
    { value: 'clear', label: '입력 필드 비우기' },
    { value: 'select', label: '드롭다운 선택' }
  ];
  
  actionOptions.forEach(option => {
    const optionBtn = document.createElement('button');
    optionBtn.textContent = option.label;
    optionBtn.setAttribute('data-action', option.value);
    optionBtn.style.cssText = `
      display:block;
      width:100%;
      padding:8px 10px;
      text-align:left;
      border:none;
      background:transparent;
      color:#fff;
      font-size:12px;
      cursor:pointer;
      border-radius:4px;
      transition:background 0.15s ease;
    `;
    optionBtn.addEventListener('mouseenter', () => {
      optionBtn.style.background = 'rgba(255,255,255,0.15)';
    });
    optionBtn.addEventListener('mouseleave', () => {
      optionBtn.style.background = 'transparent';
    });
    optionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = optionBtn.getAttribute('data-action');
      handleOverlayAction(action);
      actionMenu.style.display = 'none';
    });
    actionMenu.appendChild(optionBtn);
  });
  
  actionBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (actionBtn.disabled) return;
    const isVisible = actionMenu.style.display === 'block';
    actionMenu.style.display = isVisible ? 'none' : 'block';
  });
  
  // 외부 클릭 시 메뉴 닫기
  document.addEventListener('click', (e) => {
    if (!actionContainer.contains(e.target)) {
      actionMenu.style.display = 'none';
    }
  }, true);
  
  actionContainer.appendChild(actionBtn);
  actionContainer.appendChild(actionMenu);

  buttonsRow.appendChild(startBtn);
  buttonsRow.appendChild(stopBtn);
  buttonsRow.appendChild(selectBtn);
  buttonsRow.appendChild(actionContainer);

  const status = document.createElement('div');
  status.style.marginTop = '10px';
  status.style.fontSize = '11px';
  status.style.padding = '6px 8px';
  status.style.borderRadius = '8px';
  status.style.background = 'rgba(255,255,255,0.12)';
  status.style.display = 'none';

  container.appendChild(handle);
  container.appendChild(buttonsRow);
  container.appendChild(status);

  handle.addEventListener('mousedown', startOverlayDrag, true);

  const observer = new MutationObserver(() => {
    // button disable 상태 등 속성 변경시 최신 상태를 반영.
    updateOverlayControlsState();
  });
  observer.observe(container, { attributes: true });

  overlayControlsState.container = container;
  overlayControlsState.handle = handle;
  overlayControlsState.buttons = { start: startBtn, stop: stopBtn, select: selectBtn, action: actionBtn };
  overlayControlsState.actionMenu = actionMenu;
  overlayControlsState.status = status;
  overlayControlsState.closeButton = closeBtn;
  overlayControlsState.visible = false;

  container.style.display = 'none';
  document.body.appendChild(container);
  restoreOverlayPosition(container);
  updateOverlayControlsState();
  setOverlayStatus('', 'info');
}

export function isOverlayVisible() {
  return !!overlayControlsState.visible;
}

/**
 * 오버레이 표시 여부를 토글하고 필요 시 상태를 저장/통지한다.
 */
export function setOverlayVisibility(visible, options = {}) {
  if (window !== window.top) return false;
  if (!overlayControlsState.container) {
    createOverlayControls();
  }
  const container = overlayControlsState.container;
  if (!container) return false;

  const target = !!visible;
  const changed = overlayControlsState.visible !== target;
  overlayControlsState.visible = target;

  if (target) {
    container.style.display = 'block';
    updateOverlayControlsState();
  } else {
    stopOverlayDrag();
    container.style.display = 'none';
    setOverlayStatus('', 'info');
  }

  if (changed) {
    chrome.storage.local.set({ overlayVisible: target });
  }

  if (changed && options.notify !== false) {
    // DevTools 패널과 동기화를 위해 변경 사실을 알린다.
    chrome.runtime.sendMessage({ type: 'OVERLAY_VISIBILITY_CHANGED', visible: target });
  }

  return changed;
}

/**
 * 하이라이트 팝오버에 표시할 HTML 문자열을 생성한다.
 */
function buildOverlayHtml(topSelector, selectors) {
  if (!topSelector) {
    return '<div style="color: #ff9800;">No selector found</div>';
  }
  // 첫 번째 후보 외의 셀렉터가 있다면 개수를 알려준다.
  const more = selectors.length > 1 ? `<div style="font-size: 10px; color: #888; margin-top: 4px;">+${selectors.length - 1} more</div>` : '';
  return `
    <div style="font-weight: bold; margin-bottom: 4px; color: #4CAF50;">${topSelector.selector}</div>
    <div style="font-size: 10px; color: #aaa;">Score: ${topSelector.score}% • ${topSelector.reason}</div>
    ${more}
  `;
}

function updateOverlayPosition(rect) {
  const { overlayElement } = recorderState;
  if (!overlayElement) return;
  const overlayHeight = overlayElement.offsetHeight;
  const overlayWidth = overlayElement.offsetWidth;
  const overlayTop = rect.top - overlayHeight - 10;
  const overlayBottom = rect.bottom + 10;

  if (overlayTop >= 0) {
    overlayElement.style.top = `${overlayTop}px`;
    overlayElement.style.left = `${rect.left}px`;
  } else {
    overlayElement.style.top = `${overlayBottom}px`;
    overlayElement.style.left = `${rect.left}px`;
  }

  const maxLeft = window.innerWidth - overlayWidth - 10;
  const currentLeft = parseInt(overlayElement.style.left, 10) || 0;
  if (currentLeft > maxLeft) {
    overlayElement.style.left = `${Math.max(10, maxLeft)}px`;
  }
  if (currentLeft < 10) {
    overlayElement.style.left = '10px';
  }
}

/**
 * 선택된 요소의 위치 근처에 셀렉터 정보 풍선을 생성한다.
 */
function createSelectorOverlay(rect, selectors) {
  if (recorderState.overlayElement) {
    recorderState.overlayElement.remove();
    recorderState.overlayElement = null;
  }

  // 새 팝오버를 생성해 선택된 요소의 셀렉터 정보를 표시한다.
  const overlay = document.createElement('div');
  overlay.id = '__ai_test_recorder_overlay__';
  overlay.style.cssText = `
    position: fixed;
    z-index: 999999;
    background: rgba(0, 0, 0, 0.85);
    color: white;
    padding: 8px 12px;
    border-radius: 6px;
    font-family: 'Courier New', monospace;
    font-size: 12px;
    pointer-events: none;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    max-width: 300px;
    word-break: break-all;
    line-height: 1.4;
  `;

  overlay.innerHTML = buildOverlayHtml(selectors[0], selectors);
  document.body.appendChild(overlay);
  recorderState.overlayElement = overlay;
  updateOverlayPosition(rect);
}

/**
 * 현재 하이라이트와 팝오버를 모두 제거한다.
 */
export function removeHighlight() {
  if (recorderState.currentHighlightedElement) {
    recorderState.currentHighlightedElement.style.outline = '';
    recorderState.currentHighlightedElement.style.outlineOffset = '';
    recorderState.currentHighlightedElement = null;
  }
  if (recorderState.overlayElement) {
    recorderState.overlayElement.remove();
    recorderState.overlayElement = null;
  }
  // Action 버튼 상태 업데이트
  updateOverlayControlsState();
}

/**
 * 부모 요소 강조(점선)를 적용해 현재 선택 컨텍스트를 보여준다.
 */
export function applySelectionParentHighlight(element) {
  if (!element || element.nodeType !== 1) return;
  if (elementSelectionState.highlightInfo && elementSelectionState.highlightInfo.element !== element) {
    clearSelectionParentHighlight();
  }
  if (!elementSelectionState.highlightInfo) {
    elementSelectionState.highlightInfo = {
      element,
      outline: element.style.outline,
      outlineOffset: element.style.outlineOffset
    };
    element.style.outline = '2px dashed rgba(255,152,0,0.95)';
    element.style.outlineOffset = '2px';
  }
}

export function clearSelectionParentHighlight() {
  if (elementSelectionState.highlightInfo && elementSelectionState.highlightInfo.element) {
    const { element, outline, outlineOffset } = elementSelectionState.highlightInfo;
    try {
      element.style.outline = outline || '';
      element.style.outlineOffset = outlineOffset || '';
    } catch (e) {
      // ignore
    }
  }
  elementSelectionState.highlightInfo = null;
}

export function flashSelectionElement(element, duration = 1500) {
  if (!element || element.nodeType !== 1) return;
  if (elementSelectionState.childFlashTimeout) {
    clearTimeout(elementSelectionState.childFlashTimeout);
    elementSelectionState.childFlashTimeout = null;
  }
  const prev = {
    outline: element.style.outline,
    outlineOffset: element.style.outlineOffset
  };
  element.style.outline = '2px solid rgba(33,150,243,0.9)';
  element.style.outlineOffset = '2px';
  elementSelectionState.childFlashTimeout = setTimeout(() => {
    try {
      element.style.outline = prev.outline || '';
      element.style.outlineOffset = prev.outlineOffset || '';
    } catch (e) {
      // ignore cleanup errors
    }
    elementSelectionState.childFlashTimeout = null;
  }, duration);
}

/**
 * 지정한 요소를 굵은 테두리와 팝오버로 강조 표시한다.
 */
export function highlightElement(element) {
  if (!element) return;
  const isSameElement = element === recorderState.currentHighlightedElement;
  if (recorderState.currentHighlightedElement && !isSameElement) {
    recorderState.currentHighlightedElement.style.outline = '';
    recorderState.currentHighlightedElement.style.outlineOffset = '';
  }

  recorderState.currentHighlightedElement = element;
  element.style.outline = '3px solid #2196F3';
  element.style.outlineOffset = '2px';
  element.style.transition = 'outline 0.1s ease';

  const selectors = getSelectorCandidates(element);
  const rect = element.getBoundingClientRect();
  createSelectorOverlay(rect, selectors);

  // Action 버튼 상태 업데이트
  updateOverlayControlsState();

  if (!isSameElement) {
    // DevTools 패널에 hover된 요소 정보를 전송해 UI를 동기화한다.
    chrome.runtime.sendMessage({
      type: 'ELEMENT_HOVERED',
      selectors,
      element: {
        tag: element.tagName,
        id: element.id || null,
        classes: Array.from(element.classList || []),
        domContext: buildDomContextSnapshot(element)
      }
    });
  }
}

/**
 * 녹화 중 마우스가 요소 위에 올라가면 해당 요소를 하이라이트한다.
 */
function handleMouseOver(event) {
  if (!recorderState.isRecording) return;
  if (recorderState.mouseoutTimeout) {
    clearTimeout(recorderState.mouseoutTimeout);
    recorderState.mouseoutTimeout = null;
  }
  const target = event.target;
  if (!target || target === document.body || target === document.documentElement) {
    removeHighlight();
    return;
  }
  if (target.id === '__ai_test_recorder_overlay__' || target.closest('#__ai_test_recorder_overlay__')) {
    return;
  }
  if (target !== recorderState.currentHighlightedElement) {
    if (recorderState.hoverTimeout) {
      clearTimeout(recorderState.hoverTimeout);
    }
    recorderState.hoverTimeout = setTimeout(() => highlightElement(target), 30);
  } else if (recorderState.overlayElement) {
    updateOverlayPosition(target.getBoundingClientRect());
  }
}

/**
 * 녹화 중 마우스가 요소 밖으로 나갔을 때 하이라이트를 제거한다.
 */
function handleMouseOut(event) {
  if (!recorderState.isRecording) return;
  const relatedTarget = event.relatedTarget;
  if (relatedTarget && (relatedTarget.id === '__ai_test_recorder_overlay__' || relatedTarget.closest('#__ai_test_recorder_overlay__'))) {
    return;
  }
  if (recorderState.hoverTimeout) {
    clearTimeout(recorderState.hoverTimeout);
    recorderState.hoverTimeout = null;
  }
  if (recorderState.mouseoutTimeout) {
    clearTimeout(recorderState.mouseoutTimeout);
  }
  recorderState.mouseoutTimeout = setTimeout(() => {
    const activeElement = document.elementFromPoint(event.clientX, event.clientY);
    if (!activeElement || activeElement === document.body || activeElement === document.documentElement || (activeElement.id !== '__ai_test_recorder_overlay__' && !activeElement.closest('#__ai_test_recorder_overlay__'))) {
      // 마우스가 완전히 벗어난 경우에만 하이라이트 제거.
      if (activeElement !== recorderState.currentHighlightedElement && activeElement !== document.body && activeElement !== document.documentElement) {
        removeHighlight();
      }
    }
    recorderState.mouseoutTimeout = null;
  }, 200);
}

/**
 * 스크롤 시 하이라이트 팝오버 위치를 일정 간격으로 갱신한다.
 */
function handleScroll() {
  if (!recorderState.isRecording || !recorderState.currentHighlightedElement || !recorderState.overlayElement) return;
  if (recorderState.scrollTimeout) {
    clearTimeout(recorderState.scrollTimeout);
  }
  recorderState.scrollTimeout = setTimeout(() => {
    const rect = recorderState.currentHighlightedElement.getBoundingClientRect();
    updateOverlayPosition(rect);
  }, 50);
}

export function initOverlaySystem() {
  createOverlayControls();
  chrome.storage.local.get({ overlayVisible: false }, (data) => {
    const storedVisible = !!data.overlayVisible;
    setOverlayVisibility(storedVisible, { notify: false });
  });
  document.addEventListener('mouseover', handleMouseOver, true);
  document.addEventListener('mouseout', handleMouseOut, true);
  window.addEventListener('scroll', handleScroll, true);
}

export function ensureRecordingState(isRecording) {
  recorderState.isRecording = isRecording;
  updateOverlayControlsState();
}

/**
 * 오버레이에서 선택한 action을 현재 하이라이트된 요소에 적용
 */
function handleOverlayAction(action) {
  if (!recorderState.isRecording) {
    setOverlayStatus('녹화 중이 아닙니다.', 'error');
    return;
  }
  
  const element = recorderState.currentHighlightedElement;
  if (!element) {
    setOverlayStatus('요소를 먼저 선택하세요. (마우스를 요소 위에 올려보세요)', 'error');
    return;
  }
  
  // type, select 액션은 추가 입력이 필요할 수 있음
  if (action === 'type') {
    const inputValue = prompt('입력할 텍스트를 입력하세요:');
    if (inputValue === null) return; // 취소
    recordOverlayAction(action, element, inputValue);
  } else if (action === 'select') {
    const selectValue = prompt('선택할 옵션의 텍스트 또는 값을 입력하세요:');
    if (selectValue === null) return; // 취소
    recordOverlayAction(action, element, selectValue);
  } else {
    recordOverlayAction(action, element, null);
  }
}

/**
 * 오버레이에서 선택한 action을 이벤트로 기록
 */
function recordOverlayAction(action, target, value) {
  try {
    const selectors = getSelectorCandidates(target) || [];
    const iframeContext = getIframeContext(target);
    const clientRect = target.getBoundingClientRect ? {
      x: Math.round(target.getBoundingClientRect().x || 0),
      y: Math.round(target.getBoundingClientRect().y || 0),
      w: Math.round(target.getBoundingClientRect().width || 0),
      h: Math.round(target.getBoundingClientRect().height || 0)
    } : { x: 0, y: 0, w: 0, h: 0 };
    const domContext = buildDomContextSnapshot(target, { includeSelf: true });
    
    const eventRecord = createEventRecord({
      action,
      value,
      selectors,
      target,
      iframeContext,
      clientRect,
      metadata: { domEvent: action, source: 'overlay' },
      domContext,
      manual: {
        id: `overlay-${Date.now()}`,
        type: action,
        resultName: null,
        attributeName: null
      }
    });
    
    // primary selector 설정
    if (selectors.length > 0) {
      const primary = selectors[0];
      eventRecord.primarySelector = primary.selector;
      eventRecord.primarySelectorType = primary.type || 'css';
      eventRecord.primarySelectorText = primary.textValue || null;
      eventRecord.primarySelectorXPath = primary.xpathValue || null;
      eventRecord.primarySelectorMatchMode = primary.matchMode || null;
    }
    
    // 이벤트 저장
    chrome.runtime.sendMessage({ type: 'SAVE_EVENT', event: eventRecord }, () => {
      if (chrome.runtime.lastError) {
        setOverlayStatus('이벤트 저장 실패: ' + chrome.runtime.lastError.message, 'error');
        return;
      }
      setOverlayStatus(`${action} 액션을 기록했습니다.`, 'success');
      // 하이라이트 유지
      setTimeout(() => {
        setOverlayStatus('', 'info');
      }, 2000);
    });
  } catch (error) {
    console.error('[Overlay] Failed to record action:', error);
    setOverlayStatus('액션 기록 중 오류가 발생했습니다.', 'error');
  }
}

/**
 * 디버깅/테스트 용도로 현재 오버레이 상태를 조회한다.
 */
export function getCurrentOverlayState() {
  return {
    overlayElement: recorderState.overlayElement,
    currentHighlightedElement: recorderState.currentHighlightedElement,
    visible: overlayControlsState.visible
  };
}

