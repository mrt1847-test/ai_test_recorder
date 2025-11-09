/**
 * 콘텐츠 스크립트 초기화 루틴을 정의한다.
 * 오버레이/녹화/선택 및 메시징 시스템을 준비하고
 * 이전 녹화 상태를 복원한다.
 */
import { initMessageBridge } from './messaging/index.js';
import { initRecorderListeners, startRecording, stopRecording } from './recorder/index.js';
import { initOverlaySystem, ensureRecordingState, removeHighlight } from './overlay/index.js';
import { initSelectionInterceptors } from './selection/index.js';
import { recorderState } from './state.js';

const GLOBAL_FLAG = '__ai_test_recorder_loaded';

function restoreRecordingState() {
  chrome.storage.local.get(['recording'], (result) => {
    if (result.recording) {
      if (!recorderState.isRecording) {
        recorderState.isRecording = true;
        ensureRecordingState(true);
      }
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

