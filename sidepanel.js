// sidepanel.js
let recordingData = null;
let isRecording = false;
let recordedEvents = [];

// Storage에서 녹화 데이터 가져오기
async function loadRecordingData() {
  try {
    const result = await chrome.storage.local.get(['recordingData']);
    if (result.recordingData) {
      recordingData = result.recordingData;
      displayRecordingData();
    }
  } catch (error) {
    console.error('녹화 데이터 로드 실패:', error);
  }
}

// 녹화 데이터 표시
function displayRecordingData() {
  if (!recordingData) return;
  
  document.getElementById('tc-id').textContent = recordingData.tcId || '-';
  document.getElementById('project-id').textContent = recordingData.projectId || '-';
  document.getElementById('session-id').textContent = recordingData.sessionId || '-';
}

// 녹화 시작
async function startRecording() {
  if (!recordingData) {
    alert('녹화 데이터가 없습니다.');
    return;
  }
  
  isRecording = true;
  recordedEvents = [];
  
  // UI 업데이트
  document.getElementById('start-btn').style.display = 'none';
  document.getElementById('stop-btn').style.display = 'block';
  
  const statusEl = document.getElementById('status');
  statusEl.style.display = 'block';
  statusEl.className = 'status recording';
  statusEl.textContent = '녹화 중...';
  
  // 기존 녹화 시스템과 통합: recording 플래그 설정 및 이벤트 초기화
  await chrome.storage.local.set({ 
    recording: true,
    events: []
  });
  
  // Content Script에 녹화 시작 메시지 전송
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs && tabs[0]) {
    chrome.tabs.sendMessage(tabs[0].id, {
      type: 'START_RECORDING',
      sessionId: recordingData.sessionId
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[Side Panel] Content Script에 녹화 시작 메시지 전송 실패:', chrome.runtime.lastError);
      }
    });
  }
  
  // 이벤트 수를 주기적으로 업데이트
  updateEventsCount();
  const countInterval = setInterval(updateEventsCount, 1000);
  window.recordingCountInterval = countInterval;
  
  console.log('녹화 시작:', recordingData);
}

// 녹화 중지
async function stopRecording() {
  if (!isRecording) return;
  
  isRecording = false;
  
  // 이벤트 카운트 업데이트 중지
  if (window.recordingCountInterval) {
    clearInterval(window.recordingCountInterval);
    window.recordingCountInterval = null;
  }
  
  // UI 업데이트
  document.getElementById('start-btn').style.display = 'block';
  document.getElementById('stop-btn').style.display = 'none';
  
  const statusEl = document.getElementById('status');
  statusEl.className = 'status stopped';
  statusEl.textContent = '중지됨';
  
  // 기존 녹화 시스템과 통합: recording 플래그 제거
  await chrome.storage.local.remove(['recording']);
  
  // Content Script에 녹화 중지 메시지 전송
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs && tabs[0]) {
    chrome.tabs.sendMessage(tabs[0].id, {
      type: 'STOP_RECORDING',
      sessionId: recordingData.sessionId
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[Side Panel] Content Script에 녹화 중지 메시지 전송 실패:', chrome.runtime.lastError);
      }
    });
  }
  
  // 녹화 데이터 전송
  await sendRecordingData();
  
  console.log('녹화 중지:', recordedEvents.length, 'events');
}

// 이벤트 개수 업데이트
async function updateEventsCount() {
  try {
    const result = await chrome.storage.local.get(['events']);
    const events = result.events || [];
    recordedEvents = events;
    document.getElementById('events-count').textContent = 
      `캡처된 이벤트: ${events.length}개`;
  } catch (error) {
    console.error('이벤트 개수 업데이트 실패:', error);
  }
}

// 녹화 데이터 전송
async function sendRecordingData() {
  if (!recordingData) {
    console.warn('전송할 녹화 데이터가 없습니다');
    return;
  }
  
  try {
    // 저장된 이벤트 가져오기
    const result = await chrome.storage.local.get(['events']);
    const events = result.events || [];
    
    if (events.length === 0) {
      console.warn('전송할 녹화 이벤트가 없습니다');
      return;
    }
    
    const response = await fetch('http://localhost:3000/api/recording', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'recording_complete',
        sessionId: recordingData.sessionId,
        tcId: recordingData.tcId,
        projectId: recordingData.projectId,
        events: events,
        metadata: {
          browser: 'chrome',
          timestamp: Date.now()
        }
      })
    });
    
    const result = await response.json();
    
    if (result.success || response.ok) {
      console.log('녹화 데이터 전송 성공:', result);
      alert('녹화 데이터가 저장되었습니다!');
    } else {
      console.error('녹화 데이터 전송 실패:', result.error);
      alert('녹화 데이터 저장 실패: ' + (result.error || '알 수 없는 오류'));
    }
  } catch (error) {
    console.error('녹화 데이터 전송 오류:', error);
    alert('녹화 데이터 전송 오류: ' + error.message);
  }
}

// 이벤트 수신 (Background Script로부터)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EVENT_RECORDED') {
    // 이벤트가 기록되었다는 알림만 받음
    // 실제 이벤트는 storage에서 가져옴
    updateEventsCount();
  }
  
  return true;
});

// 초기화
document.addEventListener('DOMContentLoaded', async () => {
  await loadRecordingData();
  
  // 녹화 상태 확인
  const result = await chrome.storage.local.get(['recording']);
  if (result.recording) {
    isRecording = true;
    document.getElementById('start-btn').style.display = 'none';
    document.getElementById('stop-btn').style.display = 'block';
    const statusEl = document.getElementById('status');
    statusEl.style.display = 'block';
    statusEl.className = 'status recording';
    statusEl.textContent = '녹화 중...';
    updateEventsCount();
    window.recordingCountInterval = setInterval(updateEventsCount, 1000);
  }
  
  document.getElementById('start-btn').addEventListener('click', startRecording);
  document.getElementById('stop-btn').addEventListener('click', stopRecording);
});

