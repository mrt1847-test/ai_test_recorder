import { initMessageBridge } from './messaging/index.js';
import { initRecorderListeners, startRecording, stopRecording } from './recorder/index.js';
import { initOverlaySystem, ensureRecordingState, removeHighlight } from './overlay/index.js';
import { initSelectionInterceptors } from './selection/index.js';

const GLOBAL_FLAG = '__ai_test_recorder_loaded';

function restoreRecordingState() {
  chrome.storage.local.get(['recording'], (result) => {
    if (result.recording) {
      startRecording({ resetEvents: false });
    } else {
      ensureRecordingState(false);
      removeHighlight();
    }
  });
}

export function initializeContentScript() {
  if (window[GLOBAL_FLAG]) return;
  window[GLOBAL_FLAG] = true;

  initOverlaySystem();
  initRecorderListeners();
  initSelectionInterceptors();
  initMessageBridge();
  restoreRecordingState();
}

