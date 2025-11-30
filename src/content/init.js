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
      
      // 필수 파라미터(tcId, projectId, sessionId)가 모두 있으면 사이드 패널 자동 열기 요청
      if (tcId && projectId && sessionId) {
        console.log('[Content Script] ✅ 필수 파라미터 감지, 사이드 패널 열기 요청:', params);
        
        // 약간의 지연을 두어 페이지가 완전히 로드된 후 실행
        setTimeout(() => {
          chrome.runtime.sendMessage({
            type: 'OPEN_RECORDING_PANEL',
            tcId: tcId,
            projectId: projectId,
            sessionId: sessionId,
            url: window.location.href
          }, (response) => {
            if (chrome.runtime.lastError) {
              console.error('[Content Script] ❌ 사이드 패널 열기 요청 실패:', chrome.runtime.lastError);
              // 재시도 (1초 후)
              setTimeout(() => {
                console.log('[Content Script] 🔄 사이드 패널 열기 재시도');
                chrome.runtime.sendMessage({
                  type: 'OPEN_RECORDING_PANEL',
                  tcId: tcId,
                  projectId: projectId,
                  sessionId: sessionId,
                  url: window.location.href
                }, (retryResponse) => {
                  if (chrome.runtime.lastError) {
                    console.error('[Content Script] ❌ 재시도도 실패:', chrome.runtime.lastError);
                  } else {
                    console.log('[Content Script] ✅ 재시도 성공:', retryResponse);
                  }
                });
              }, 1000);
            } else {
              console.log('[Content Script] ✅ 사이드 패널 열기 요청 성공:', response);
            }
          });
        }, 500);
      } else {
        console.log('[Content Script] ⚠️ 필수 파라미터 부족:', { tcId: !!tcId, projectId: !!projectId, sessionId: !!sessionId });
      }
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
        const savedParams = {
          tcId: params.tcId || null,
          projectId: params.projectId || null,
          sessionId: params.sessionId || null,
          url: window.location.href,
          timestamp: Date.now()
        };
        
        chrome.storage.local.set({
          testArchitectParams: savedParams
        });
        console.log('[Content Script] 커스텀 이벤트에서 파라미터 저장:', savedParams);
        
        // 필수 파라미터가 모두 있으면 사이드 패널 자동 열기 요청
        if (params.tcId && params.projectId && params.sessionId) {
          console.log('[Content Script] 커스텀 이벤트에서 사이드 패널 열기 요청:', savedParams);
          chrome.runtime.sendMessage({
            type: 'OPEN_RECORDING_PANEL',
            tcId: params.tcId,
            projectId: params.projectId,
            sessionId: params.sessionId,
            url: window.location.href
          }, (response) => {
            if (chrome.runtime.lastError) {
              console.error('[Content Script] 사이드 패널 열기 요청 실패:', chrome.runtime.lastError);
            } else {
              console.log('[Content Script] 사이드 패널 열기 요청 성공:', response);
            }
          });
        }
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

