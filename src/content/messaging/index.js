/**
 * 백그라운드/패널과 콘텐츠 스크립트 간 메시지 브리지.
 * 각 메시지 타입에 대응하는 동작을 라우팅한다.
 */
import { executeSelectionAction } from '../replay/index.js';
import { executeReplayStep } from '../replay/index.js';
import { beginChildSelection, beginRootSelection, cancelSelection, handleParentSelectionRequest } from '../selection/index.js';
import { getRecordingState, startRecording, stopRecording } from '../recorder/index.js';
import { ensureRecordingState, setOverlayVisibility, isOverlayVisible } from '../overlay/index.js';
import { countMatchesForSelector, parseSelectorForMatching } from '../utils/dom.js';

/**
 * 백그라운드/DevTools와의 메시지 브리지를 초기화한다.
 * 각 메시지 타입별로 대응 동작을 수행하고 응답을 돌려준다.
 */
export function initMessageBridge() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      if (!message || typeof message !== 'object') {
        sendResponse({ ok: false, reason: 'invalid_message' });
        return;
      }

      switch (message.type) {
        case 'CHECK_RECORDING_STATUS': {
          // 현재 녹화 여부만 조회.
          sendResponse({ recording: getRecordingState() });
          return;
        }
        case 'RECORDING_START':
        case 'START_RECORDING': {
          // 녹화를 시작하면서 기존 이벤트를 초기화.
          startRecording({ resetEvents: true });
          sendResponse({ ok: true });
          return;
        }
        case 'RECORDING_STOP':
        case 'STOP_RECORDING': {
          // 녹화를 중단하고 상태를 false로 전환.
          stopRecording();
          sendResponse({ ok: true });
          return;
        }
        case 'ELEMENT_SELECTION_START': {
          // 루트 요소 선택을 시작해 overlay가 요소를 받을 준비를 한다.
          beginRootSelection();
          sendResponse({ ok: true });
          return;
        }
        case 'ELEMENT_SELECTION_PICK_CHILD': {
          // 현재 선택된 부모 기준으로 자식 선택 모드를 시작.
          const result = beginChildSelection();
          sendResponse(result);
          return;
        }
        case 'ELEMENT_SELECTION_PICK_PARENT': {
          // 현재 선택에서 한 단계 상위로 이동.
          const result = handleParentSelectionRequest();
          sendResponse(result);
          return;
        }
        case 'ELEMENT_SELECTION_CANCEL': {
          cancelSelection();
          // 패널 측에도 선택이 취소되었음을 알려준다.
          cancelSelection();
          chrome.runtime.sendMessage({ type: 'ELEMENT_SELECTION_CANCELLED' });
          sendResponse({ ok: true });
          return;
        }
        case 'ELEMENT_SELECTION_EXECUTE': {
          // 선택 워크플로우에서 요청한 클릭/추출 등의 동작을 즉시 실행.
          const { path = [], action = '' } = message;
          const result = executeSelectionAction(action, path);
          sendResponse(result);
          return;
        }
        case 'REPLAY_EXECUTE_STEP': {
          // 녹화된 이벤트 한 스텝을 실행. 비동기로 처리 후 결과를 응답.
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
          // overlay 토글이 녹화 상태를 변경하려 할 때 호출.
          ensureRecordingState(!!message.recording);
          sendResponse({ ok: true });
          return;
        }
        case 'OVERLAY_VISIBILITY_SET': {
          // overlay 표시/숨김.
          setOverlayVisibility(!!message.visible, { notify: message.notify !== false });
          sendResponse({ ok: true, visible: isOverlayVisible() });
          return;
        }
        case 'OVERLAY_VISIBILITY_GET': {
          // overlay 현재 상태를 조회.
          sendResponse({ ok: true, visible: isOverlayVisible() });
          return;
        }
        case 'EVALUATE_SELECTORS': {
          const selectors = Array.isArray(message.selectors) ? message.selectors : [];
          const results = selectors.map((entry) => {
            const info = entry && typeof entry === 'object' ? entry : { selector: entry };
            const selector = typeof info.selector === 'string' ? info.selector.trim() : '';
            const type = typeof info.type === 'string' ? info.type : undefined;
            const matchMode = typeof info.matchMode === 'string' ? info.matchMode : undefined;
            if (!selector) {
              // 셀렉터가 비어 있다면 즉시 실패 정보 반환.
              return { selector: '', matchCount: 0, unique: false, error: 'invalid_selector' };
            }
            try {
              // 파싱한 셀렉터를 문서에 적용해 매칭 개수를 계산한다.
              const parsed = parseSelectorForMatching(selector, type);
              const count = countMatchesForSelector(parsed, document, { matchMode });
              return {
                selector,
                type: parsed.type || type || null,
                matchCount: count,
                unique: count === 1
              };
            } catch (err) {
              // 파싱/평가 중 오류가 발생하면 에러 메시지 포함.
              return {
                selector,
                type: type || null,
                matchCount: 0,
                unique: false,
                error: err && err.message ? err.message : 'evaluation_failed'
              };
            }
          });
          sendResponse({ ok: true, results });
          return;
        }
        default: {
          // 정의되지 않은 type은 에러 응답.
          sendResponse({ ok: false, reason: 'unknown_message_type' });
        }
      }
    })();
    return true;
  });
}

