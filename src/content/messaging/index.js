import { executeSelectionAction } from '../replay/index.js';
import { executeReplayStep } from '../replay/index.js';
import { beginChildSelection, beginRootSelection, cancelSelection, handleParentSelectionRequest } from '../selection/index.js';
import { getRecordingState, startRecording, stopRecording } from '../recorder/index.js';
import { ensureRecordingState } from '../overlay/index.js';

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
          startRecording();
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
        default: {
          sendResponse({ ok: false, reason: 'unknown_message_type' });
        }
      }
    })();
    return true;
  });
}

