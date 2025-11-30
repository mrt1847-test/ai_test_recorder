# CDP를 통한 사이드 패널 열기 가이드

## 개요

외부 자동화 툴(Electron 앱 등)에서 Chrome DevTools Protocol (CDP)을 사용하여 사이드 패널을 열 수 있습니다.

## 방법 1: WebSocket을 통한 명령 전송 (권장)

이미 설정된 WebSocket (`ws://localhost:3000`)을 통해 사이드 패널을 열 수 있습니다.

### WebSocket 메시지 형식

```json
{
  "type": "OPEN_SIDE_PANEL",
  "params": {
    "tcId": "8",
    "projectId": "1",
    "sessionId": "session-1234567890",
    "url": "http://localhost:3000/record?tcId=8&projectId=1&sessionId=session-1234567890"
  }
}
```

### 응답 메시지

```json
{
  "type": "OPEN_SIDE_PANEL_RESPONSE",
  "success": true,
  "message": "사이드 패널이 열렸습니다"
}
```

### 예제 코드 (Node.js)

```javascript
const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:3000');

ws.on('open', () => {
  console.log('WebSocket 연결됨');
  
  // 사이드 패널 열기 요청
  ws.send(JSON.stringify({
    type: 'OPEN_SIDE_PANEL',
    params: {
      tcId: '8',
      projectId: '1',
      sessionId: 'session-1234567890',
      url: 'http://localhost:3000/record?tcId=8&projectId=1&sessionId=session-1234567890'
    }
  }));
});

ws.on('message', (data) => {
  const message = JSON.parse(data.toString());
  console.log('응답 받음:', message);
});
```

## 방법 2: Chrome Extension Runtime.sendMessage를 CDP로 호출

CDP를 통해 확장 프로그램의 `runtime.sendMessage`를 직접 호출할 수 있습니다.

### CDP 명령

```javascript
// CDP를 통해 확장 프로그램과 통신
const extensionId = 'YOUR_EXTENSION_ID'; // 확장 프로그램 ID

// Runtime.evaluate를 사용하여 확장 프로그램에 메시지 전송
await cdpSession.send('Runtime.evaluate', {
  expression: `
    chrome.runtime.sendMessage('${extensionId}', {
      type: 'OPEN_SIDE_PANEL',
      tcId: '8',
      projectId: '1',
      sessionId: 'session-1234567890',
      url: 'http://localhost:3000/record?tcId=8&projectId=1&sessionId=session-1234567890'
    });
  `
});
```

### 더 나은 방법: Runtime.callFunctionOn 사용

```javascript
await cdpSession.send('Runtime.callFunctionOn', {
  functionDeclaration: `
    function openSidePanel(extensionId, params) {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage(extensionId, {
          type: 'OPEN_SIDE_PANEL',
          params: params
        }, (response) => {
          resolve(response);
        });
      });
    }
  `,
  arguments: [
    { value: extensionId },
        {
          value: {
            tcId: '8',
            projectId: '1',
            sessionId: 'session-1234567890',
            url: 'http://localhost:3000/record?tcId=8&projectId=1&sessionId=session-1234567890'
          }
        }
  ],
  returnByValue: true
});
```

## 방법 3: externall_connectable을 통한 직접 통신

`manifest.json`에 이미 `externally_connectable`이 설정되어 있으므로, 자동화 툴에서 직접 메시지를 보낼 수 있습니다.

### 예제 코드

```javascript
// 자동화 툴에서 확장 프로그램과 직접 통신
const extensionId = 'YOUR_EXTENSION_ID';

chrome.runtime.sendMessage(extensionId, {
  type: 'OPEN_SIDE_PANEL',
  params: {
    tcId: '8',
    projectId: '1',
    sessionId: 'session-1234567890',
    url: 'http://localhost:3000/record?tcId=8&projectId=1&sessionId=session-1234567890'
  }
}, (response) => {
  if (chrome.runtime.lastError) {
    console.error('오류:', chrome.runtime.lastError);
  } else {
    console.log('응답:', response);
  }
});
```

## 방법 4: CDP로 Chrome 확장 프로그램 런타임 제어

Playwright나 Puppeteer를 사용하는 경우:

```javascript
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--disable-extensions-except=/path/to/extension', '--load-extension=/path/to/extension']
  });

  const extensionId = 'YOUR_EXTENSION_ID';
  const page = await browser.newPage();

  // 확장 프로그램의 Background Script에 메시지 전송
  await page.evaluate(async (extId, params) => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(extId, {
        type: 'OPEN_SIDE_PANEL',
        params: params
      }, (response) => {
        resolve(response);
      });
    });
  }, extensionId, {
    tcId: '8',
    projectId: '1',
    sessionId: 'session-1234567890',
    url: 'http://localhost:3000/record?tcId=8&projectId=1&sessionId=session-1234567890'
  });
})();
```

## 지원되는 메시지 타입

### OPEN_SIDE_PANEL
사이드 패널을 엽니다.

**요청:**
```json
{
  "type": "OPEN_SIDE_PANEL",
  "params": {
    "tcId": "8",
    "projectId": "1",
    "sessionId": "session-1234567890",
    "url": "http://localhost:3000/record?tcId=8&projectId=1&sessionId=session-1234567890"
  }
}
```

**응답:**
```json
{
  "success": true,
  "message": "사이드 패널이 열렸습니다",
  "recordingData": {
    "tcId": "8",
    "projectId": "1",
    "sessionId": "session-1234567890",
    "url": "...",
    "timestamp": 1234567890123
  }
}
```

## 주의사항

1. **확장 프로그램 ID 확인**: CDP를 사용하려면 확장 프로그램 ID를 알아야 합니다.
   - `chrome://extensions`에서 확인
   - 또는 `chrome.runtime.id`로 확인

2. **WebSocket 서버**: WebSocket을 사용하는 경우 `ws://localhost:3000` 서버가 실행 중이어야 합니다.

3. **권한**: `externally_connectable`에 자동화 툴의 origin이 포함되어 있어야 합니다.

## 통합 예제 (Electron 앱)

```javascript
const { app, BrowserWindow } = require('electron');
const WebSocket = require('ws');

let ws = null;

function connectToExtension() {
  ws = new WebSocket('ws://localhost:3000');
  
  ws.on('open', () => {
    console.log('확장 프로그램과 연결됨');
  });
  
  ws.on('message', (data) => {
    const message = JSON.parse(data.toString());
    console.log('확장 프로그램 메시지:', message);
  });
}

function openSidePanel(tcId, projectId, sessionId) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'OPEN_SIDE_PANEL',
      params: {
        tcId: tcId,
        projectId: projectId,
        sessionId: sessionId,
        url: `http://localhost:3000/record?tcId=${tcId}&projectId=${projectId}&sessionId=${sessionId}`
      }
    }));
  }
}

// 사용 예
openSidePanel('8', '1', 'session-1234567890');
```

## 문제 해결

1. **사이드 패널이 열리지 않는 경우**:
   - Chrome 버전이 114 이상인지 확인
   - 확장 프로그램이 활성화되어 있는지 확인
   - 콘솔 로그 확인 (Background Service Worker)

2. **WebSocket 연결 실패**:
   - `ws://localhost:3000` 서버가 실행 중인지 확인
   - 확장 프로그램이 WebSocket에 연결되었는지 확인

3. **메시지 전달 실패**:
   - `externally_connectable` 설정 확인
   - 확장 프로그램 ID 확인


