import { getSelectorCandidates, getIframeContext } from '../selectors/index.js';
import { elementSelectionState, overlayControlsState, recorderState } from '../state.js';
import { buildDomContextSnapshot } from '../utils/dom.js';

function saveOverlayPosition(left, top) {
  chrome.storage.local.set({ overlayPosition: { left, top } });
}

export function setOverlayStatus(message, tone = 'info') {
  if (!overlayControlsState.status) return;
  overlayControlsState.status.textContent = message || '';
  overlayControlsState.status.setAttribute('data-tone', tone || 'info');
  overlayControlsState.status.style.display = message ? 'block' : 'none';
}

export function updateOverlayControlsState() {
  if (!overlayControlsState.buttons.start || !overlayControlsState.container) return;
  overlayControlsState.buttons.start.disabled = !!recorderState.isRecording;
  overlayControlsState.buttons.stop.disabled = !recorderState.isRecording;
  overlayControlsState.container.toggleAttribute('data-selecting', !!elementSelectionState.mode);
}

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

function stopOverlayDrag() {
  if (!overlayControlsState.dragging || !overlayControlsState.container) return;
  overlayControlsState.dragging = false;
  document.removeEventListener('mousemove', onOverlayDragMove, true);
  document.removeEventListener('mouseup', stopOverlayDrag, true);
  const rect = overlayControlsState.container.getBoundingClientRect();
  saveOverlayPosition(rect.left, rect.top);
}

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

export function sendOverlayCommand(command, options = {}) {
  chrome.runtime.sendMessage({ type: 'OVERLAY_COMMAND', command, options }, (response) => {
    if (chrome.runtime.lastError) {
      setOverlayStatus('DevTools 패널과 통신할 수 없습니다. 패널이 열려 있는지 확인하세요.', 'error');
      return;
    }
    handleOverlayCommandResponse(command, response);
  });
}

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

  buttonsRow.appendChild(startBtn);
  buttonsRow.appendChild(stopBtn);
  buttonsRow.appendChild(selectBtn);

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
    updateOverlayControlsState();
  });
  observer.observe(container, { attributes: true });

  overlayControlsState.container = container;
  overlayControlsState.handle = handle;
  overlayControlsState.buttons = { start: startBtn, stop: stopBtn, select: selectBtn };
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
    chrome.runtime.sendMessage({ type: 'OVERLAY_VISIBILITY_CHANGED', visible: target });
  }

  return changed;
}

function buildOverlayHtml(topSelector, selectors) {
  if (!topSelector) {
    return '<div style="color: #ff9800;">No selector found</div>';
  }
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

function createSelectorOverlay(rect, selectors) {
  if (recorderState.overlayElement) {
    recorderState.overlayElement.remove();
    recorderState.overlayElement = null;
  }

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
}

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

  if (!isSameElement) {
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
      if (activeElement !== recorderState.currentHighlightedElement && activeElement !== document.body && activeElement !== document.documentElement) {
        removeHighlight();
      }
    }
    recorderState.mouseoutTimeout = null;
  }, 200);
}

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

export function getCurrentOverlayState() {
  return {
    overlayElement: recorderState.overlayElement,
    currentHighlightedElement: recorderState.currentHighlightedElement,
    visible: overlayControlsState.visible
  };
}

