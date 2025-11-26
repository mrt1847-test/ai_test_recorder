# 팝업 열기 문제 해결 가이드

## 문제: "확장 프로그램이 응답하지 않음"

로그에서 다음과 같은 메시지가 보이는 경우:
```
[TestArchitect] ⚠️ 메시지 전송 최대 시도 횟수 도달 - 확장 프로그램이 응답하지 않음
```

## 단계별 진단 방법

### 1단계: 확장 프로그램 ID 확인

가장 흔한 문제는 잘못된 확장 프로그램 ID를 사용하는 것입니다.

#### 확장 프로그램 ID 찾기

1. Chrome에서 `chrome://extensions/` 접속
2. 개발자 모드 활성화 (우측 상단)
3. "AI Test Recorder - UI Pro" 확장 프로그램 찾기
4. 확장 프로그램 카드에서 **ID 복사** (예: `abcdefghijklmnopqrstuvwxyz123456`)

#### ID 확인 테스트

자동화 툴의 브라우저 콘솔에서 다음 코드를 실행해보세요:

```javascript
// 1. 확장 프로그램 ID 설정 (위에서 복사한 ID로 교체)
const EXTENSION_ID = 'YOUR_EXTENSION_ID_HERE';

// 2. 간단한 테스트: 확장 프로그램 ID 가져오기
chrome.runtime.sendMessage(
  EXTENSION_ID,
  { type: 'GET_EXTENSION_ID' },
  (response) => {
    if (chrome.runtime.lastError) {
      console.error('❌ 에러:', chrome.runtime.lastError.message);
      console.log('💡 가능한 원인:');
      console.log('   1. 확장 프로그램 ID가 잘못되었습니다');
      console.log('   2. 확장 프로그램이 설치되지 않았습니다');
      console.log('   3. 확장 프로그램이 비활성화되어 있습니다');
    } else {
      console.log('✅ 성공! 확장 프로그램 ID:', response.extensionId);
    }
  }
);
```

### 2단계: 확장 프로그램 Service Worker 확인

확장 프로그램이 메시지를 받고 있는지 확인:

1. `chrome://extensions/` 접속
2. "AI Test Recorder - UI Pro" 확장 프로그램 찾기
3. **"Service Worker"** 링크 클릭 (새 창/탭 열림)
4. 자동화 툴에서 메시지를 보내면서 Service Worker 콘솔 확인

다음과 같은 로그가 보여야 합니다:
```
[Background] 외부 메시지 수신: {type: "OPEN_POPUP"} from: ...
[Background] OPEN_POPUP 요청 처리 시작, 즉시 응답: {ok: true, extensionId: "..."}
[Background] 팝업이 열렸습니다. Tab ID: ...
```

**만약 로그가 보이지 않으면:**
- 확장 프로그램 ID가 잘못되었거나
- 확장 프로그램이 메시지를 받지 못하고 있는 것입니다

### 3단계: 도메인 확인

현재 페이지의 도메인이 `externally_connectable`에 포함되어 있는지 확인:

1. 자동화 툴 페이지에서 브라우저 콘솔 열기
2. 다음 코드 실행:
```javascript
console.log('현재 URL:', window.location.href);
console.log('현재 도메인:', window.location.origin);
```

현재 지원되는 도메인:
- `http://localhost:*/*` (모든 포트)
- `https://*/*` (모든 HTTPS 도메인)

**만약 다른 포트를 사용하는 경우:**
- 예: `http://localhost:3001`
- `manifest.json`의 `externally_connectable.matches`에 추가 필요

### 4단계: 메시지 전송 방식 확인

올바른 메시지 형식:

```javascript
// ✅ 올바른 방법
chrome.runtime.sendMessage(
  '확장프로그램ID',
  { type: 'OPEN_POPUP' },
  (response) => {
    if (chrome.runtime.lastError) {
      console.error('에러:', chrome.runtime.lastError);
    } else {
      console.log('성공:', response);
    }
  }
);
```

**자주 하는 실수:**

```javascript
// ❌ 잘못된 방법 1: ID 없이 호출
chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }, ...);

// ❌ 잘못된 방법 2: 잘못된 타입
chrome.runtime.sendMessage('ID', 'OPEN_POPUP', ...);

// ❌ 잘못된 방법 3: 콜백 없이 호출
chrome.runtime.sendMessage('ID', { type: 'OPEN_POPUP' });
```

## 완전한 테스트 코드

자동화 툴 페이지의 콘솔에서 다음 코드를 실행하여 전체 흐름을 테스트:

```javascript
(async function testExtensionConnection() {
  console.log('🔍 확장 프로그램 연결 테스트 시작...');
  
  // 1. 확장 프로그램 ID 설정
  const EXTENSION_ID = 'YOUR_EXTENSION_ID_HERE'; // 여기에 실제 ID 입력
  
  if (!EXTENSION_ID || EXTENSION_ID === 'YOUR_EXTENSION_ID_HERE') {
    console.error('❌ 먼저 확장 프로그램 ID를 설정하세요!');
    console.log('💡 chrome://extensions/ 에서 ID를 복사하세요');
    return;
  }
  
  // 2. Chrome Extension API 확인
  if (!window.chrome || !window.chrome.runtime) {
    console.error('❌ Chrome Extension API를 사용할 수 없습니다');
    console.log('💡 이 페이지는 Chrome 브라우저에서 열어야 합니다');
    return;
  }
  
  console.log('✅ Chrome Extension API 사용 가능');
  console.log('📋 현재 URL:', window.location.href);
  console.log('📋 확장 프로그램 ID:', EXTENSION_ID);
  
  // 3. GET_EXTENSION_ID 테스트
  console.log('\n🧪 1단계: GET_EXTENSION_ID 테스트...');
  await new Promise((resolve) => {
    chrome.runtime.sendMessage(
      EXTENSION_ID,
      { type: 'GET_EXTENSION_ID' },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error('❌ GET_EXTENSION_ID 실패:', chrome.runtime.lastError.message);
          console.log('\n💡 가능한 원인:');
          console.log('   1. 확장 프로그램 ID가 잘못되었습니다');
          console.log('   2. 확장 프로그램이 설치되지 않았습니다');
          console.log('   3. 확장 프로그램이 비활성화되어 있습니다');
          console.log('   4. 현재 도메인이 externally_connectable에 포함되지 않았습니다');
        } else {
          console.log('✅ GET_EXTENSION_ID 성공:', response);
          if (response.extensionId !== EXTENSION_ID) {
            console.warn('⚠️ 반환된 ID가 설정한 ID와 다릅니다!');
            console.log('   설정한 ID:', EXTENSION_ID);
            console.log('   반환된 ID:', response.extensionId);
          }
        }
        resolve();
      }
    );
  });
  
  // 4. OPEN_POPUP 테스트
  console.log('\n🧪 2단계: OPEN_POPUP 테스트...');
  await new Promise((resolve) => {
    chrome.runtime.sendMessage(
      EXTENSION_ID,
      { type: 'OPEN_POPUP' },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error('❌ OPEN_POPUP 실패:', chrome.runtime.lastError.message);
        } else {
          console.log('✅ OPEN_POPUP 성공:', response);
          if (response.ok) {
            console.log('   팝업이 열렸습니다! Tab ID:', response.tabId);
          }
        }
        resolve();
      }
    );
  });
  
  console.log('\n✅ 테스트 완료!');
})();
```

## 일반적인 문제와 해결책

### 문제 1: "Extension not found" 에러

**원인**: 확장 프로그램 ID가 잘못되었거나 확장 프로그램이 설치되지 않음

**해결**:
1. `chrome://extensions/`에서 확장 프로그램 ID 확인
2. 코드에서 사용하는 ID가 정확한지 확인
3. 확장 프로그램이 활성화되어 있는지 확인

### 문제 2: 메시지를 보냈지만 응답이 없음

**원인**: `sendResponse` 타이밍 문제 또는 확장 프로그램이 메시지를 받지 못함

**해결**:
1. 확장 프로그램 Service Worker 콘솔 확인
2. `[Background] 외부 메시지 수신:` 로그가 보이는지 확인
3. 로그가 보이지 않으면 확장 프로그램 ID 확인

### 문제 3: "Cannot access chrome.runtime" 에러

**원인**: Chrome 브라우저가 아니거나 Extension API를 사용할 수 없는 환경

**해결**:
1. Chrome 또는 Chromium 기반 브라우저 사용
2. 확장 프로그램이 설치되어 있는지 확인

### 문제 4: 특정 포트에서 작동하지 않음

**원인**: `externally_connectable`에 해당 포트가 포함되지 않음

**해결**:
1. `manifest.json` 확인
2. 현재는 `http://localhost:*/*`로 모든 포트 지원
3. 다른 도메인을 사용하는 경우 manifest.json에 추가 필요

## 추가 도움말

문제가 계속되면 다음 정보를 확인하세요:

1. Chrome 버전
2. 확장 프로그램 버전
3. 현재 페이지 URL
4. 브라우저 콘솔의 전체 에러 메시지
5. 확장 프로그램 Service Worker 콘솔의 로그

