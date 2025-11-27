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

/**
 * URL 파라미터를 추출하여 chrome.storage에 저장
 * 자동화 툴에서 녹화 버튼을 눌러 URL로 이동했을 때 파라미터를 자동으로 저장
 */
function extractAndSaveUrlParams() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const tcId = urlParams.get('tcId');
    const projectId = urlParams.get('projectId');
    const sessionId = urlParams.get('sessionId');
    
    // 파라미터가 있으면 저장
    if (tcId || projectId) {
      const params = {
        tcId: tcId || null,
        projectId: projectId || null,
        sessionId: sessionId || null,
        url: window.location.href,
        timestamp: Date.now()
      };
      
      // chrome.storage에 저장
      chrome.storage.local.set({
        testArchitectParams: params
      });
      
      // 전역 변수에도 저장 (백업 및 자동화 툴에서 확인 가능)
      window.testArchitectParams = params;
      
      console.log('[Content Script] URL 파라미터 저장:', params);
    }
    
    // 전역 변수 확인 (자동화 툴에서 설정한 경우)
    if (window.testArchitectParams && typeof window.testArchitectParams === 'object') {
      const params = window.testArchitectParams;
      chrome.storage.local.set({
        testArchitectParams: {
          tcId: params.tcId || null,
          projectId: params.projectId || null,
          sessionId: params.sessionId || null,
          url: window.location.href,
          timestamp: Date.now()
        }
      });
      console.log('[Content Script] 전역 변수에서 파라미터 저장:', params);
    }
    
    // 커스텀 이벤트 리스너 (자동화 툴에서 이벤트 발생 시)
    window.addEventListener('testarchitect-params-ready', (event) => {
      const params = event.detail || {};
      if (params.tcId || params.projectId) {
        chrome.storage.local.set({
          testArchitectParams: {
            tcId: params.tcId || null,
            projectId: params.projectId || null,
            sessionId: params.sessionId || null,
            url: window.location.href,
            timestamp: Date.now()
          }
        });
        console.log('[Content Script] 커스텀 이벤트에서 파라미터 저장:', params);
      }
    }, { once: false });
    
  } catch (error) {
    console.error('[Content Script] URL 파라미터 추출 실패:', error);
  }
}

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

  // URL 파라미터 추출 및 저장 (가장 먼저 실행)
  extractAndSaveUrlParams();
  
  // URL 변경 감지 (SPA 또는 동적 URL 변경 시)
  let lastUrl = window.location.href;
  const urlCheckInterval = setInterval(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      extractAndSaveUrlParams();
    }
  }, 500);
  
  // 페이지 언로드 시 interval 정리
  window.addEventListener('beforeunload', () => {
    clearInterval(urlCheckInterval);
  });

  initOverlaySystem();
  initRecorderListeners();
  initSelectionInterceptors();
  initMessageBridge();
  restoreRecordingState();
}

