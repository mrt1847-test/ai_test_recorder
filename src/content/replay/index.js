import { findElementByPath, getSelectorCore, locateElementForEvent } from '../dom/locator.js';

export async function executeReplayStep({ event, index = 0, total = 0, timeoutMs = 6000 }) {
  const { element, info } = await locateElementForEvent(event, timeoutMs);
  if (!element) {
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

