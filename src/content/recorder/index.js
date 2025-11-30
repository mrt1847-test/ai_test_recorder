/**
 * 사용자 상호작용을 캡처하여 이벤트 레코드로 변환한다.
 * 클릭/입력 등의 DOM 이벤트를 감지하고 Chrome 스토리지 및
 * DevTools 패널로 전달한다.
 */
import { createEventRecord } from '../events/schema.js';
import { getIframeContext, getSelectorCandidates } from '../selectors/index.js';
import { elementSelectionState, inputTimers, recorderState } from '../state.js';
import { ensureRecordingState, removeHighlight } from '../overlay/index.js';
import { buildDomContextSnapshot } from '../utils/dom.js';

const INPUT_DEBOUNCE_DELAY = 800;

/**
 * 생성된 이벤트 레코드를 백그라운드에 저장 요청한다.
 */
function persistEvent(eventRecord) {
  chrome.runtime.sendMessage({ type: 'SAVE_EVENT', event: eventRecord }, () => {});
}

// 현재 세션 ID 저장
let currentSessionId = null;

/**
 * 현재 세션 ID 설정
 */
export function setCurrentSessionId(sessionId) {
  currentSessionId = sessionId;
  // window 객체에도 저장 (다른 모듈에서 접근 가능)
  if (typeof window !== 'undefined') {
    window.__ai_test_recorder_session_id__ = sessionId;
  }
}

/**
 * 현재 세션 ID 가져오기
 */
function getCurrentSessionId() {
  // 먼저 로컬 변수 확인
  if (currentSessionId) {
    return currentSessionId;
  }
  // window 객체에서 확인
  if (typeof window !== 'undefined' && window.__ai_test_recorder_session_id__) {
    return window.__ai_test_recorder_session_id__;
  }
  // storage에서 확인 (fallback)
  try {
    chrome.storage.local.get(['recordingData'], (result) => {
      if (result.recordingData && result.recordingData.sessionId) {
        currentSessionId = result.recordingData.sessionId;
      }
    });
  } catch (err) {
    // ignore
  }
  return currentSessionId;
}

/**
 * 새 이벤트를 DevTools 패널로 브로드캐스트하고 Electron에도 실시간 전송한다.
 */
function broadcastRecordedEvent(eventRecord) {
  // 기존: DevTools 패널로 전송
  chrome.runtime.sendMessage({ type: 'EVENT_RECORDED', event: eventRecord }, () => {});
  
  // 추가: Electron으로 실시간 전송
  chrome.runtime.sendMessage({ 
    type: 'DOM_EVENT', 
    event: eventRecord,
    sessionId: getCurrentSessionId()
  }, () => {});
}

/**
 * 대상 요소의 화면 좌표/크기를 반올림해 반환한다.
 */
function buildClientRect(target) {
  if (!target || typeof target.getBoundingClientRect !== 'function') {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  const rect = target.getBoundingClientRect();
  return {
    x: Math.round(rect.x || 0),
    y: Math.round(rect.y || 0),
    w: Math.round(rect.width || 0),
    h: Math.round(rect.height || 0)
  };
}

/**
 * DOM 이벤트에서 필요한 부가 정보(셀렉터, iframe 등)를 모아 eventRecord를 만든다.
 */
function buildEventForTarget({ action, target, value = null }) {
  const selectors = getSelectorCandidates(target) || [];
  const iframeContext = getIframeContext(target);
  const clientRect = buildClientRect(target);
  const metadata = { domEvent: action };
  const domContext = buildDomContextSnapshot(target, { includeSelf: true });
  const eventRecord = createEventRecord({
    action,
    value,
    selectors,
    target,
    iframeContext,
    clientRect,
    metadata,
    domContext
  });
  return {
    ...eventRecord,
    selectorCandidates: selectors,
    iframeContext,
    domContext,
    tag: target && target.tagName ? target.tagName : null
  };
}

/**
 * 이벤트를 생성하고 저장/방송까지 수행하는 헬퍼.
 */
function recordDomEvent({ action, target, value }) {
  if (!target) return;
  const eventRecord = buildEventForTarget({ action, target, value });
  persistEvent(eventRecord);
  broadcastRecordedEvent(eventRecord);
}

/**
 * 클릭 이벤트를 감지해 녹화 중일 때만 기록한다.
 */
function handleClick(event) {
  if (!recorderState.isRecording) return;
  if (elementSelectionState.mode) return;
  const target = event.target;
  if (!target || target === document.body || target === document.documentElement) return;
  if (target.id === '__ai_test_recorder_overlay__' || (target.closest && target.closest('#__ai_test_recorder_overlay__'))) {
    return;
  }
  // 우클릭은 별도 처리 (button === 2)
  if (event.button === 2) {
    recordDomEvent({ action: 'rightClick', target });
    return;
  }
  recordDomEvent({ action: 'click', target });
}

/**
 * 입력 이벤트는 debounce를 적용해 마지막 값만 저장한다.
 */
function handleInput(event) {
  if (!recorderState.isRecording) return;
  const target = event.target;
  if (!target || (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && !target.isContentEditable)) {
    return;
  }
  const existingTimer = inputTimers.get(target);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  const timer = setTimeout(() => {
    const currentValue = target.value || target.textContent || '';
    // 값이 비워지면 clear 액션으로 기록
    if (currentValue === '') {
      recordDomEvent({ action: 'clear', target });
    } else {
      recordDomEvent({ action: 'input', target, value: currentValue });
    }
    inputTimers.delete(target);
  }, INPUT_DEBOUNCE_DELAY);
  inputTimers.set(target, timer);
}

/**
 * 포커스를 잃을 때도 debounce를 해제하고 최종 값을 기록한다.
 */
function handleBlur(event) {
  if (!recorderState.isRecording) return;
  const target = event.target;
  if (!target || (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && !target.isContentEditable)) {
    return;
  }
  const existingTimer = inputTimers.get(target);
  if (existingTimer) {
    clearTimeout(existingTimer);
    inputTimers.delete(target);
    const currentValue = target.value || target.textContent || '';
    if (currentValue === '') {
      recordDomEvent({ action: 'clear', target });
    } else {
      recordDomEvent({ action: 'input', target, value: currentValue });
    }
  }
}

/**
 * 더블 클릭 이벤트를 감지해 녹화 중일 때만 기록한다.
 */
function handleDoubleClick(event) {
  if (!recorderState.isRecording) return;
  if (elementSelectionState.mode) return;
  const target = event.target;
  if (!target || target === document.body || target === document.documentElement) return;
  if (target.id === '__ai_test_recorder_overlay__' || (target.closest && target.closest('#__ai_test_recorder_overlay__'))) {
    return;
  }
  recordDomEvent({ action: 'doubleClick', target });
}

/**
 * 우클릭 이벤트를 감지해 녹화 중일 때만 기록한다.
 */
function handleRightClick(event) {
  if (!recorderState.isRecording) return;
  if (elementSelectionState.mode) return;
  const target = event.target;
  if (!target || target === document.body || target === document.documentElement) return;
  if (target.id === '__ai_test_recorder_overlay__' || (target.closest && target.closest('#__ai_test_recorder_overlay__'))) {
    return;
  }
  // contextmenu 이벤트는 기본 동작을 막지 않도록 처리
  recordDomEvent({ action: 'rightClick', target });
}

/**
 * 마우스 호버 이벤트를 감지해 녹화 중일 때만 기록한다.
 * 주의: hover는 자동 수집하지 않음 - 사용자가 Action 메뉴에서 선택했을 때만 수집
 */
// function handleHover(event) {
//   if (!recorderState.isRecording) return;
//   if (elementSelectionState.mode) return;
//   const target = event.target;
//   if (!target || target === document.body || target === document.documentElement) return;
//   if (target.id === '__ai_test_recorder_overlay__' || (target.closest && target.closest('#__ai_test_recorder_overlay__'))) {
//     return;
//   }
//   // hover는 debounce 적용 (너무 많은 이벤트 방지)
//   const existingTimer = inputTimers.get(target);
//   if (existingTimer) {
//     return; // 이미 대기 중이면 무시
//   }
//   const timer = setTimeout(() => {
//     recordDomEvent({ action: 'hover', target });
//     inputTimers.delete(target);
//   }, 300); // 300ms debounce
//   inputTimers.set(target, timer);
// }

/**
 * 드롭다운(select) 변경 이벤트를 감지해 녹화 중일 때만 기록한다.
 */
function handleSelect(event) {
  if (!recorderState.isRecording) return;
  if (elementSelectionState.mode) return;
  const target = event.target;
  if (!target || target.tagName !== 'SELECT') return;
  if (target.id === '__ai_test_recorder_overlay__' || (target.closest && target.closest('#__ai_test_recorder_overlay__'))) {
    return;
  }
  
  // 선택된 옵션의 텍스트 또는 값 가져오기
  const selectedOption = target.options[target.selectedIndex];
  const value = selectedOption ? (selectedOption.text || selectedOption.value || '') : '';
  
  recordDomEvent({ action: 'select', target, value });
}

/**
 * URL 변경 감지 (페이지 네비게이션)
 */
let lastUrl = window.location.href;
let lastTitle = document.title;

async function checkUrlChange() {
  if (!recorderState.isRecording) return;
  
  const currentUrl = window.location.href;
  const currentTitle = document.title;
  
  // storage에서 마지막 URL 가져오기 (전체 페이지 로드 시에도 비교 가능)
  let storedLastUrl = lastUrl;
  try {
    const result = await chrome.storage.local.get(['lastRecordedUrl']);
    if (result.lastRecordedUrl && result.lastRecordedUrl !== currentUrl) {
      storedLastUrl = result.lastRecordedUrl;
    }
  } catch (err) {
    // storage 접근 실패 시 로컬 변수 사용
  }
  
  // URL 또는 타이틀이 변경되었는지 확인
  // storedLastUrl이 있으면 우선적으로 사용 (전체 페이지 로드 시)
  const compareUrl = storedLastUrl && storedLastUrl !== currentUrl ? storedLastUrl : lastUrl;
  const urlChanged = currentUrl !== compareUrl;
  const titleChanged = currentTitle !== lastTitle;
  
  if (urlChanged || titleChanged) {
    // URL 변경 감지 - navigate 액션으로 저장 (UI와 일치)
    const eventRecord = createEventRecord({
      action: 'navigate',
      value: currentUrl,
      selectors: [],
      target: null,
      iframeContext: null,
      clientRect: null,
      metadata: { domEvent: 'navigation' },
      domContext: null
    });
    
    // page 정보 업데이트
    eventRecord.page = {
      url: currentUrl,
      title: currentTitle
    };
    
    // url 필드 추가 (UI에서 사용)
    eventRecord.url = currentUrl;
    
    // primarySelector에 URL 저장 (target 대신)
    eventRecord.primarySelector = currentUrl;
    
    persistEvent(eventRecord);
    broadcastRecordedEvent(eventRecord);
    
    // storage에 현재 URL 저장 (다음 페이지 로드 시 비교용)
    try {
      chrome.storage.local.set({ lastRecordedUrl: currentUrl });
    } catch (err) {
      console.error('[AI Test Recorder] Failed to save last URL:', err);
    }
    
    lastUrl = currentUrl;
    lastTitle = currentTitle;
  }
}

// URL 변경 감지를 위한 MutationObserver 및 interval
let urlCheckInterval = null;
let urlObserver = null;

export function startRecording(options = {}) {
  const { resetEvents = true } = options;
  if (recorderState.isRecording) {
    // 이미 녹화 중이면 상태만 재확인하고 필요한 경우 이벤트 배열 초기화.
    ensureRecordingState(true);
    if (resetEvents) {
      chrome.storage.local.set({ events: [], recording: true });
    } else {
      chrome.storage.local.set({ recording: true });
    }
    return;
  }
  recorderState.isRecording = true;
  ensureRecordingState(true);
  if (resetEvents) {
    chrome.storage.local.set({ events: [], recording: true });
  } else {
    chrome.storage.local.set({ recording: true });
  }
  removeHighlight();
  
  // URL 변경 감지 초기화 - storage에서 이전 URL 가져오기 (전체 페이지 로드 시 비교용)
  const currentUrl = window.location.href;
  const currentTitle = document.title;
  
  // storage에서 이전 URL 가져오기
  chrome.storage.local.get(['lastRecordedUrl'], (result) => {
    if (result.lastRecordedUrl && result.lastRecordedUrl !== currentUrl) {
      // 이전 URL이 있고 현재 URL과 다르면 navigate 이벤트 기록
      lastUrl = result.lastRecordedUrl;
      lastTitle = ''; // 이전 타이틀은 알 수 없으므로 빈 문자열
      
      // URL 변경 이벤트 기록
      setTimeout(() => {
        checkUrlChange();
      }, 100);
    } else {
      // 이전 URL이 없거나 같으면 현재 URL로 초기화
      lastUrl = currentUrl;
      lastTitle = currentTitle;
      
      // storage에 현재 URL 저장
      chrome.storage.local.set({ lastRecordedUrl: currentUrl });
    }
  });
  
  // URL 체크 interval 시작 (아직 시작되지 않은 경우)
  if (!urlCheckInterval) {
    urlCheckInterval = setInterval(() => {
      try {
        checkUrlChange();
      } catch (err) {
        console.error('[AI Test Recorder] Failed to check URL change:', err);
      }
    }, 1000);
  }
  
  // 페이지 언로드 시 현재 URL 저장 (다음 페이지에서 비교용)
  window.addEventListener('beforeunload', () => {
    if (recorderState.isRecording) {
      try {
        chrome.storage.local.set({ lastRecordedUrl: window.location.href });
      } catch (err) {
        console.error('[AI Test Recorder] Failed to save URL on beforeunload:', err);
      }
    }
  });
  
  // 페이지 로드 완료 시 URL 확인 (전체 페이지 로드 후)
  if (document.readyState === 'complete') {
    setTimeout(() => {
      checkUrlChange();
    }, 500);
  } else {
    window.addEventListener('load', () => {
      setTimeout(() => {
        checkUrlChange();
      }, 500);
    });
  }
  
  // DOMContentLoaded 시에도 확인 (더 빠른 감지)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => {
        checkUrlChange();
      }, 300);
    });
  }
}

export function stopRecording() {
  recorderState.isRecording = false;
  ensureRecordingState(false);
  chrome.storage.local.remove(['recording']);
  // 녹화를 멈출 때 하이라이트는 정리해 UI 혼선을 줄인다.
  removeHighlight();
  
  // URL 체크 interval 정리
  if (urlCheckInterval) {
    clearInterval(urlCheckInterval);
    urlCheckInterval = null;
  }
}

export function initRecorderListeners() {
  document.addEventListener('click', (event) => {
    try {
      // 캡처 실패 시 전체 녹화를 중단하지 않도록 try/catch 처리.
      handleClick(event);
    } catch (err) {
      console.error('[AI Test Recorder] Failed to handle click event:', err);
    }
  }, true);

  document.addEventListener('input', (event) => {
    try {
      handleInput(event);
    } catch (err) {
      // 다른 이벤트 핸들링에 영향이 없도록 로그만 출력.
      console.error('[AI Test Recorder] Failed to handle input event:', err);
    }
  }, true);

  document.addEventListener('blur', (event) => {
    try {
      handleBlur(event);
    } catch (err) {
      console.error('[AI Test Recorder] Failed to handle blur event:', err);
    }
  }, true);

  // 드롭다운 선택 이벤트 감지
  document.addEventListener('change', (event) => {
    try {
      handleSelect(event);
    } catch (err) {
      console.error('[AI Test Recorder] Failed to handle select event:', err);
    }
  }, true);

  // 더블 클릭 이벤트 감지
  document.addEventListener('dblclick', (event) => {
    try {
      handleDoubleClick(event);
    } catch (err) {
      console.error('[AI Test Recorder] Failed to handle double click event:', err);
    }
  }, true);

  // 우클릭 이벤트 감지
  document.addEventListener('contextmenu', (event) => {
    try {
      handleRightClick(event);
    } catch (err) {
      console.error('[AI Test Recorder] Failed to handle right click event:', err);
    }
  }, true);

  // hover 자동 수집 비활성화 - 사용자가 Action 메뉴에서 선택했을 때만 수집
  // document.addEventListener('mouseenter', (event) => {
  //   try {
  //     handleHover(event);
  //   } catch (err) {
  //     console.error('[AI Test Recorder] Failed to handle hover event:', err);
  //   }
  // }, true);

  // URL 변경 감지 (history API 감지)
  window.addEventListener('popstate', () => {
    try {
      setTimeout(checkUrlChange, 100);
    } catch (err) {
      console.error('[AI Test Recorder] Failed to handle popstate:', err);
    }
  });

  // pushState/replaceState 감지를 위한 감시
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  
  history.pushState = function(...args) {
    originalPushState.apply(history, args);
    setTimeout(checkUrlChange, 100);
  };
  
  history.replaceState = function(...args) {
    originalReplaceState.apply(history, args);
    setTimeout(checkUrlChange, 100);
  };

  // 주기적으로 URL 변경 확인 (SPA 대응) - startRecording에서 이미 시작했으면 중복 시작하지 않음
  if (!urlCheckInterval) {
    urlCheckInterval = setInterval(() => {
      try {
        checkUrlChange();
      } catch (err) {
        console.error('[AI Test Recorder] Failed to check URL change:', err);
      }
    }, 1000);
  }
  
  // 실제 페이지 이동 감지 (전체 페이지 로드)
  window.addEventListener('beforeunload', () => {
    if (recorderState.isRecording) {
      try {
        chrome.storage.local.set({ lastRecordedUrl: window.location.href });
      } catch (err) {
        console.error('[AI Test Recorder] Failed to save URL on beforeunload:', err);
      }
    }
  });
  
  // 페이지 로드 완료 시 URL 확인 (전체 페이지 로드 후)
  if (document.readyState === 'complete') {
    setTimeout(() => {
      checkUrlChange();
    }, 500);
  } else {
    window.addEventListener('load', () => {
      setTimeout(() => {
        checkUrlChange();
      }, 500);
    });
  }
  
  // DOMContentLoaded 시에도 확인 (더 빠른 감지)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => {
        checkUrlChange();
      }, 300);
    });
  }
  
  // 초기 URL 체크 (페이지 로드 시 이전 URL과 비교)
  // 녹화 중이면 storage에서 이전 URL 가져와서 비교
  chrome.storage.local.get(['recording', 'lastRecordedUrl'], (result) => {
    if (result.recording) {
      const currentUrl = window.location.href;
      if (result.lastRecordedUrl && result.lastRecordedUrl !== currentUrl) {
        // 이전 URL이 있고 현재 URL과 다르면 navigate 이벤트 기록
        lastUrl = result.lastRecordedUrl;
        lastTitle = '';
        
        // URL 변경 이벤트 기록
        setTimeout(() => {
          checkUrlChange();
        }, 200);
      } else {
        // 이전 URL이 없거나 같으면 현재 URL로 초기화
        lastUrl = currentUrl;
        lastTitle = document.title;
        
        // storage에 현재 URL 저장
        chrome.storage.local.set({ lastRecordedUrl: currentUrl });
      }
    }
  });
}

export function getRecordingState() {
  return recorderState.isRecording;
}
