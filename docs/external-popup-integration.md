# 자동화 툴에서 크롬 확장 프로그램 팝업 열기

## 개요

자동화 툴(웹 애플리케이션)에서 크롬 확장 프로그램의 팝업을 자동으로 열 수 있습니다. 이 기능을 통해 사용자가 녹화 버튼을 누르면 확장 프로그램이 자동으로 실행되어 URL의 파라미터(tcId, projectId 등)를 자동으로 설정할 수 있습니다.

## 설정 방법

### 1. 확장 프로그램 ID 확인

먼저 확장 프로그램의 ID를 확인해야 합니다. 두 가지 방법이 있습니다:

#### 방법 A: 확장 프로그램에서 직접 가져오기
```javascript
// 확장 프로그램 ID를 가져오는 함수
async function getExtensionId() {
  return new Promise((resolve, reject) => {
    // 확장 프로그램 ID를 가져오려고 시도
    // 먼저 저장된 ID가 있는지 확인
    const savedId = localStorage.getItem('testRecorderExtensionId');
    if (savedId) {
      resolve(savedId);
      return;
    }
    
    // Chrome Extension API를 통해 ID 가져오기
    chrome.runtime.sendMessage(
      'YOUR_EXTENSION_ID_HERE', // 확장 프로그램 설치 후 실제 ID로 교체
      { type: 'GET_EXTENSION_ID' },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        if (response && response.extensionId) {
          localStorage.setItem('testRecorderExtensionId', response.extensionId);
          resolve(response.extensionId);
        } else {
          reject(new Error('Extension ID not found'));
        }
      }
    );
  });
}
```

#### 방법 B: Chrome 확장 프로그램 페이지에서 확인
1. Chrome에서 `chrome://extensions/` 접속
2. 개발자 모드 활성화
3. "AI Test Recorder - UI Pro" 확장 프로그램 찾기
4. 확장 프로그램 카드에서 ID 복사 (예: `abcdefghijklmnopqrstuvwxyz123456`)

### 2. 자동화 툴에서 팝업 열기

자동화 툴의 웹 페이지에서 다음 코드를 사용하여 팝업을 엽니다:

```javascript
/**
 * 크롬 확장 프로그램 팝업 열기
 * @param {string} extensionId - 크롬 확장 프로그램 ID
 */
async function openTestRecorderPopup(extensionId) {
  return new Promise((resolve, reject) => {
    // Chrome Extension API가 사용 가능한지 확인
    if (!window.chrome || !window.chrome.runtime) {
      reject(new Error('Chrome Extension API is not available'));
      return;
    }
    
    // 확장 프로그램에 메시지 전송하여 팝업 열기
    chrome.runtime.sendMessage(
      extensionId,
      { type: 'OPEN_POPUP' },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        
        if (response && response.ok) {
          console.log('팝업이 성공적으로 열렸습니다.', response);
          resolve(response);
        } else {
          reject(new Error('Failed to open popup'));
        }
      }
    );
  });
}
```

### 3. 녹화 버튼에 통합

자동화 툴에서 녹화 버튼 클릭 시 팝업을 여는 예제:

```javascript
// 녹화 버튼 클릭 핸들러
async function handleRecordButtonClick(tcId, projectId, sessionId) {
  try {
    // 1. 확장 프로그램 ID 가져오기
    const extensionId = await getExtensionId();
    
    // 2. URL로 이동 (파라미터 포함)
    const recordUrl = `http://localhost:3000/record?tcId=${tcId}&projectId=${projectId}&sessionId=${sessionId}`;
    window.location.href = recordUrl;
    
    // 3. 약간의 지연 후 팝업 열기 (URL 이동 완료 대기)
    setTimeout(async () => {
      try {
        await openTestRecorderPopup(extensionId);
      } catch (error) {
        console.error('팝업 열기 실패:', error);
        alert('확장 프로그램 팝업을 열 수 없습니다. 확장 프로그램이 설치되어 있는지 확인해주세요.');
      }
    }, 500);
    
  } catch (error) {
    console.error('오류 발생:', error);
    // 확장 프로그램이 없는 경우에도 URL 이동은 계속 진행
    window.location.href = recordUrl;
  }
}

// HTML에서 사용
// <button onclick="handleRecordButtonClick(8, 1, 'session-123')">녹화 시작</button>
```

### 4. 완전한 통합 예제

React 예제:

```javascript
import { useState, useEffect } from 'react';

function RecordButton({ tcId, projectId }) {
  const [extensionId, setExtensionId] = useState(null);
  const [loading, setLoading] = useState(false);
  
  useEffect(() => {
    // 컴포넌트 마운트 시 확장 프로그램 ID 가져오기
    loadExtensionId();
  }, []);
  
  async function loadExtensionId() {
    try {
      // localStorage에서 저장된 ID 확인
      const savedId = localStorage.getItem('testRecorderExtensionId');
      if (savedId) {
        setExtensionId(savedId);
        return;
      }
      
      // 또는 하드코딩된 ID 사용 (확장 프로그램 설치 후 확인 필요)
      const defaultId = 'YOUR_EXTENSION_ID_HERE';
      setExtensionId(defaultId);
    } catch (error) {
      console.error('Extension ID 로드 실패:', error);
    }
  }
  
  async function handleRecord() {
    setLoading(true);
    
    try {
      // 세션 ID 생성
      const sessionId = `session-${Date.now()}`;
      
      // URL로 이동
      const recordUrl = `/record?tcId=${tcId}&projectId=${projectId}&sessionId=${sessionId}`;
      window.location.href = recordUrl;
      
      // 팝업 열기
      if (extensionId && window.chrome && window.chrome.runtime) {
        setTimeout(() => {
          chrome.runtime.sendMessage(
            extensionId,
            { type: 'OPEN_POPUP' },
            (response) => {
              if (chrome.runtime.lastError) {
                console.warn('팝업 열기 실패:', chrome.runtime.lastError);
              } else {
                console.log('팝업 열기 성공:', response);
              }
              setLoading(false);
            }
          );
        }, 500);
      } else {
        setLoading(false);
      }
    } catch (error) {
      console.error('녹화 시작 실패:', error);
      setLoading(false);
    }
  }
  
  return (
    <button 
      onClick={handleRecord} 
      disabled={loading}
    >
      {loading ? '녹화 준비 중...' : '녹화 시작'}
    </button>
  );
}
```

## 지원되는 메시지 타입

### 1. OPEN_POPUP

팝업을 새 탭에서 엽니다.

**요청:**
```javascript
chrome.runtime.sendMessage(extensionId, { type: 'OPEN_POPUP' }, (response) => {
  // response: { ok: true, tabId: number, extensionId: string }
});
```

**응답:**
```json
{
  "ok": true,
  "tabId": 123456,
  "extensionId": "abcdefghijklmnopqrstuvwxyz123456"
}
```

### 2. GET_EXTENSION_ID

확장 프로그램 ID를 가져옵니다.

**요청:**
```javascript
chrome.runtime.sendMessage(extensionId, { type: 'GET_EXTENSION_ID' }, (response) => {
  // response: { extensionId: string }
});
```

**응답:**
```json
{
  "extensionId": "abcdefghijklmnopqrstuvwxyz123456"
}
```

## URL 파라미터 자동 설정

팝업이 열릴 때 현재 탭의 URL에서 다음 파라미터를 자동으로 추출하여 입력 필드에 설정합니다:

- `tcId` 또는 `tc_id` 또는 `testCaseId` → TC ID 입력 필드
- `projectId` 또는 `project_id` 또는 `projectid` → Project ID 입력 필드

**예시 URL:**
```
http://localhost:3000/record?tcId=8&projectId=1&sessionId=session-1764165096712
```

이 URL로 이동한 상태에서 팝업을 열면:
- TC ID: `8` 자동 입력
- Project ID: `1` 자동 입력

## 주의사항

1. **확장 프로그램 설치 필요**: 크롬 확장 프로그램이 설치되어 있어야 합니다.
2. **Chrome 브라우저 필요**: 이 기능은 Chrome 또는 Chromium 기반 브라우저에서만 동작합니다.
3. **보안**: `externally_connectable` 설정으로 인해 지정된 도메인(`http://localhost:*/*`, `https://*/*`)에서만 메시지를 보낼 수 있습니다.
4. **비동기 처리**: 팝업 열기는 비동기 작업이므로 적절한 오류 처리가 필요합니다.

## 문제 해결

### 팝업이 열리지 않는 경우

1. **확장 프로그램 ID 확인**
   - `chrome://extensions/`에서 확장 프로그램 ID 확인
   - 코드에서 사용하는 ID가 정확한지 확인
   - 확장 프로그램 ID가 변경되었을 수 있으므로 정기적으로 확인 필요

2. **확장 프로그램 활성화 확인**
   - 확장 프로그램이 비활성화되어 있지 않은지 확인
   - 확장 프로그램이 제대로 설치되어 있는지 확인

3. **도메인 확인**
   - `manifest.json`의 `externally_connectable.matches`에 현재 도메인이 포함되어 있는지 확인
   - `http://localhost:3000`은 지원되지만 다른 포트나 도메인은 추가 설정이 필요할 수 있습니다.
   - 포트 번호가 다른 경우 (예: `localhost:3001`) manifest.json에 추가 필요

4. **메시지 전송 확인**
   - 브라우저 개발자 도구 콘솔에서 에러 메시지 확인
   - 확장 프로그램의 Service Worker 콘솔 확인:
     - `chrome://extensions/` → "AI Test Recorder" → "Service Worker" 클릭
     - 콘솔에 `[Background] 외부 메시지 수신:` 로그가 보이는지 확인

5. **확장 프로그램 재로드**
   - 확장 프로그램을 다시 로드해보기
   - `chrome://extensions/`에서 확장 프로그램 카드의 새로고침 버튼 클릭

### "확장 프로그램이 응답하지 않음" 오류

이 오류가 발생하는 주요 원인:

1. **확장 프로그램 ID 오류**
   ```javascript
   // 잘못된 ID 사용
   chrome.runtime.sendMessage('wrong-id', { type: 'OPEN_POPUP' }, ...);
   
   // 올바른 방법: 실제 확장 프로그램 ID 확인
   const extensionId = 'abcdefghijklmnopqrstuvwxyz123456'; // 실제 ID로 교체
   ```

2. **확장 프로그램이 비활성화됨**
   - `chrome://extensions/`에서 확장 프로그램이 활성화되어 있는지 확인

3. **도메인 불일치**
   - 현재 페이지의 도메인이 `externally_connectable.matches`에 포함되어 있는지 확인
   - 예: `http://localhost:3001`에서 접근하는 경우 manifest.json에 추가 필요

4. **타이밍 문제**
   - 페이지 로드 직후 메시지를 보내면 확장 프로그램이 아직 준비되지 않았을 수 있음
   - `DOMContentLoaded` 또는 `window.load` 이벤트 후에 메시지 전송

### 디버깅 방법

#### 1. 확장 프로그램 Service Worker 콘솔 확인
```
1. chrome://extensions/ 접속
2. "AI Test Recorder - UI Pro" 찾기
3. "Service Worker" 링크 클릭
4. 콘솔에서 [Background]로 시작하는 로그 확인
```

#### 2. 자동화 툴 콘솔에서 테스트
```javascript
// 콘솔에서 직접 테스트
const extensionId = 'YOUR_EXTENSION_ID'; // 실제 ID로 교체

chrome.runtime.sendMessage(
  extensionId,
  { type: 'GET_EXTENSION_ID' },
  (response) => {
    if (chrome.runtime.lastError) {
      console.error('에러:', chrome.runtime.lastError);
    } else {
      console.log('성공:', response);
    }
  }
);
```

#### 3. 메시지 전송 함수 개선
```javascript
async function sendMessageWithRetry(extensionId, message, maxRetries = 3) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    
    function trySend() {
      attempts++;
      
      chrome.runtime.sendMessage(extensionId, message, (response) => {
        if (chrome.runtime.lastError) {
          console.error(`[시도 ${attempts}/${maxRetries}] 에러:`, chrome.runtime.lastError);
          
          if (attempts < maxRetries) {
            // 재시도
            setTimeout(trySend, 500);
          } else {
            reject(new Error(`메시지 전송 실패: ${chrome.runtime.lastError.message}`));
          }
          return;
        }
        
        if (response && response.ok) {
          resolve(response);
        } else {
          reject(new Error('응답이 실패했습니다.'));
        }
      });
    }
    
    trySend();
  });
}

// 사용 예제
try {
  const extensionId = 'YOUR_EXTENSION_ID';
  const response = await sendMessageWithRetry(
    extensionId,
    { type: 'OPEN_POPUP' }
  );
  console.log('팝업 열기 성공:', response);
} catch (error) {
  console.error('팝업 열기 실패:', error);
}
```

### URL 파라미터가 설정되지 않는 경우

1. **URL 형식 확인**: 쿼리 파라미터가 올바르게 포함되어 있는지 확인
2. **입력 필드 확인**: 이미 값이 입력되어 있으면 자동 설정되지 않습니다 (기존 값 보존)
3. **팝업 로딩 시간**: URL 이동 후 팝업이 열릴 때까지 약간의 지연이 필요할 수 있습니다.


