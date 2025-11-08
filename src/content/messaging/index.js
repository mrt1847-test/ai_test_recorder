import { executeSelectionAction } from '../replay/index.js';
import { executeReplayStep } from '../replay/index.js';
import { beginChildSelection, beginRootSelection, cancelSelection, handleParentSelectionRequest } from '../selection/index.js';
import { getRecordingState, startRecording, stopRecording } from '../recorder/index.js';
import { ensureRecordingState, setOverlayVisibility, isOverlayVisible } from '../overlay/index.js';
import { countMatchesForSelector, parseSelectorForMatching } from '../utils/dom.js';

export function initMessageBridge() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      if (!message || typeof message !== 'object') {
        sendResponse({ ok: false, reason: 'invalid_message' });
        return;
      }

      switch (message.type) {
        case 'CHECK_RECORDING_STATUS': {
          sendResponse({ recording: getRecordingState() });
          return;
        }
        case 'RECORDING_START': {
          startRecording({ resetEvents: true });
          sendResponse({ ok: true });
          return;
        }
        case 'RECORDING_STOP': {
          stopRecording();
          sendResponse({ ok: true });
          return;
        }
        case 'ELEMENT_SELECTION_START': {
          beginRootSelection();
          sendResponse({ ok: true });
          return;
        }
        case 'ELEMENT_SELECTION_PICK_CHILD': {
          const result = beginChildSelection();
          sendResponse(result);
          return;
        }
        case 'ELEMENT_SELECTION_PICK_PARENT': {
          const result = handleParentSelectionRequest();
          sendResponse(result);
          return;
        }
        case 'ELEMENT_SELECTION_CANCEL': {
          cancelSelection();
          chrome.runtime.sendMessage({ type: 'ELEMENT_SELECTION_CANCELLED' });
          sendResponse({ ok: true });
          return;
        }
        case 'ELEMENT_SELECTION_EXECUTE': {
          const { path = [], action = '' } = message;
          const result = executeSelectionAction(action, path);
          sendResponse(result);
          return;
        }
        case 'REPLAY_EXECUTE_STEP': {
          const payload = await executeReplayStep({
            event: message.event,
            index: message.index,
            total: message.total,
            timeoutMs: message.timeoutMs || 6000
          });
          sendResponse(payload);
          return;
        }
        case 'OVERLAY_SET_RECORDING': {
          ensureRecordingState(!!message.recording);
          sendResponse({ ok: true });
          return;
        }
        case 'OVERLAY_VISIBILITY_SET': {
          setOverlayVisibility(!!message.visible, { notify: message.notify !== false });
          sendResponse({ ok: true, visible: isOverlayVisible() });
          return;
        }
        case 'OVERLAY_VISIBILITY_GET': {
          sendResponse({ ok: true, visible: isOverlayVisible() });
          return;
        }
        case 'EVALUATE_SELECTORS': {
          const selectors = Array.isArray(message.selectors) ? message.selectors : [];
          const results = selectors.map((entry) => {
            const info = entry && typeof entry === 'object' ? entry : { selector: entry };
            const selector = typeof info.selector === 'string' ? info.selector.trim() : '';
            const type = typeof info.type === 'string' ? info.type : undefined;
            const matchMode = typeof info.matchMode === 'string' ? info.matchMode : undefined;
            if (!selector) {
              return { selector: '', matchCount: 0, unique: false, error: 'invalid_selector' };
            }
            try {
              const parsed = parseSelectorForMatching(selector, type);
              const count = countMatchesForSelector(parsed, document, { matchMode });
              return {
                selector,
                type: parsed.type || type || null,
                matchCount: count,
                unique: count === 1
              };
            } catch (err) {
              return {
                selector,
                type: type || null,
                matchCount: 0,
                unique: false,
                error: err && err.message ? err.message : 'evaluation_failed'
              };
            }
          });
          sendResponse({ ok: true, results });
          return;
        }
        default: {
          sendResponse({ ok: false, reason: 'unknown_message_type' });
        }
      }
    })();
    return true;
  });
}

