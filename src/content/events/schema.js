/**
 * 녹화 이벤트 레코드의 공통 스키마를 정의한다.
 * DOM 컨텍스트와 기본 셀렉터 정보를 함께 캡처한다.
 */
import { inferSelectorType } from '../utils/dom.js';

export const EVENT_SCHEMA_VERSION = 2;

/**
 * 셀렉터 후보 배열에서 대표(primary) 셀렉터 정보를 추출한다.
 * 후보가 비어 있으면 빈 객체를 반환한다.
 * @param {Array<object>} selectors
 * @returns {object}
 */
function buildPrimarySelectorData(selectors) {
  if (!Array.isArray(selectors) || selectors.length === 0) return {};
  const primary = selectors[0];
  if (!primary || !primary.selector) return {};
  const type = primary.type || inferSelectorType(primary.selector);
  return {
    primarySelector: primary.selector,
    primarySelectorType: type,
    primarySelectorText: primary.textValue || null,
    primarySelectorXPath: primary.xpathValue || null,
    primarySelectorMatchMode: primary.matchMode || null
  };
}

export function createEventRecord({
  action,
  value = null,
  selectors = [],
  target = null,
  domContext = null,
  iframeContext = null,
  clientRect = null,
  metadata = {},
  manual
}) {
  // 각 이벤트는 생성 시점의 타임스탬프를 기록한다.
  const timestamp = Date.now();
  const targetTag = target && target.tagName ? target.tagName : null;
  const selectorCandidates = Array.isArray(selectors) ? selectors : [];
  // 첫 번째 후보를 기반으로 primary selector 세부 정보를 준비.
  const primaryData = buildPrimarySelectorData(selectorCandidates);

  return {
    version: EVENT_SCHEMA_VERSION,
    timestamp,
    action,
    value,
    tag: targetTag,
    selectorCandidates,
    iframeContext,
    page: {
      // 이벤트가 발생한 페이지의 URL/타이틀을 저장해 재현에 도움을 준다.
      url: window.location.href,
      title: document.title
    },
    frame: {
      iframeContext
    },
    target: target
      ? {
          tag: targetTag,
          id: target.id || null,
          classes: target.classList ? Array.from(target.classList) : [],
          text: (target.innerText || target.textContent || '').trim().slice(0, 200),
          domContext: domContext
        }
      : null,
    clientRect,
    metadata: {
      schemaVersion: EVENT_SCHEMA_VERSION,
      userAgent: navigator.userAgent,
      ...metadata
    },
    manual: manual || null,
    // primary selector 관련 필드들을 최상위에 병합한다.
    ...primaryData
  };
}

