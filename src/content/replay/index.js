/**
 * DevTools 패널에서 요청한 리플레이/선택 동작을 실제 DOM에 적용한다.
 * - 녹화된 이벤트 재생
 * - 선택 워크플로우 내 즉시 실행 액션
 */
import { findElementByPath, getSelectorCore, locateElementForEvent } from '../dom/locator.js';

/**
 * 녹화된 단일 이벤트를 실제 DOM에 재적용하고 결과를 DevTools로 통지한다.
 */
export async function executeReplayStep({ event, index = 0, total = 0, timeoutMs = 6000 }) {
  const { element, info } = await locateElementForEvent(event, timeoutMs);
  if (!element) {
    // 요소를 찾지 못했으면 즉시 실패 메시지를 보낸다.
    const payload = {
      type: 'REPLAY_STEP_RESULT',
      ok: false,
      reason: 'not_found',
      stepIndex: index,
      total,
      selector: info && info.selector ? info.selector : (event && event.primarySelector) || null,
      ev: event
    };
    chrome.runtime.sendMessage(payload);
    return { ok: false, reason: 'not_found' };
  }

  let navigationTriggered = false;
  const beforeUnloadHandler = () => {
    // 리플레이 중 네비게이션이 발생했는지를 기록해 전달한다.
    navigationTriggered = true;
  };
  window.addEventListener('beforeunload', beforeUnloadHandler);

  const originalOutline = element.style.outline;
  const originalOutlineOffset = element.style.outlineOffset;
  let success = false;
  let failureReason = '';
  let extractedValue;
  let manualActionType = event && event.manualActionType ? event.manualActionType : null;
  let manualAttributeName = event && event.manualAttribute ? event.manualAttribute : null;

  try {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await new Promise((resolve) => setTimeout(resolve, 200));
    try {
      element.focus({ preventScroll: true });
    } catch (focusErr) {
      try {
        element.focus();
      } catch (focusErr2) {
        // ignore
      }
    }
    // 현재 실행 중인 이벤트임을 눈에 띄게 표시한다.
    element.style.outline = '3px solid rgba(0,150,136,0.6)';
    element.style.outlineOffset = '2px';

    if (event.action === 'click') {
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        throw new Error('element not visible');
      }
      if (element.disabled) {
        throw new Error('element disabled');
      }
      element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    } else if (event.action === 'input') {
      const valueToSet = event.value || '';
      if ('value' in element) {
        element.value = valueToSet;
      } else if (element.isContentEditable) {
        element.textContent = valueToSet;
      }
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (event.action === 'manual_extract_text') {
      extractedValue = element.innerText || element.textContent || '';
      manualActionType = 'extract_text';
    } else if (event.action === 'manual_get_attribute') {
      const attrName = manualAttributeName || event.manualAttribute || event.attributeName || '';
      manualAttributeName = attrName;
      extractedValue = attrName ? element.getAttribute(attrName) : null;
      manualActionType = 'get_attribute';
    } else {
      throw new Error('unsupported action');
    }

    success = true;
  } catch (err) {
    failureReason = err && err.message ? err.message : 'unknown error';
  } finally {
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    try {
      element.style.outline = originalOutline;
      element.style.outlineOffset = originalOutlineOffset;
    } catch (cleanupErr) {
      // ignore style cleanup errors
    }
  }

  const usedSelector = info && info.selector ? info.selector : (event && event.primarySelector) || (event && event.tag ? event.tag.toLowerCase() : null);
  const payload = {
    type: 'REPLAY_STEP_RESULT',
    ok: success,
    reason: success ? undefined : failureReason,
    used: element && element.tagName,
    selector: usedSelector,
    stepIndex: index,
    total,
    navigation: navigationTriggered,
    ev: event,
    manualActionType: manualActionType || undefined,
    manualActionId: event && event.manualActionId ? event.manualActionId : undefined,
    value: extractedValue,
    attributeName: manualAttributeName || undefined,
    resultName: event && event.manualResultName ? event.manualResultName : undefined
  };
  chrome.runtime.sendMessage(payload);

  if (success) {
    return { ok: true, navigation: navigationTriggered, value: extractedValue };
  }
  return { ok: false, reason: failureReason };
}

export function executeSelectionAction(action, path) {
  const target = findElementByPath(path);
  if (!target) {
    return { ok: false, reason: 'not_found' };
  }
  if (action === 'click') {
    try {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // highlight 완료 후 잠시 대기한 뒤 실제 클릭 이벤트를 송출한다.
      setTimeout(() => {
        try {
          target.focus({ preventScroll: true });
        } catch (focusErr) {
          try {
            target.focus();
          } catch (focusErr2) {
            // ignore
          }
        }
        const style = window.getComputedStyle(target);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          return;
        }
        if (target.disabled) {
          return;
        }
        target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }, 120);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err.message || 'click_failed' };
    }
  }
  return { ok: false, reason: 'unsupported_action' };
}

export { getSelectorCore };

