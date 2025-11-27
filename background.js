/**
 * 확장 프로그램의 백그라운드 서비스 워커.
 * - DevTools 패널과 콘텐츠 스크립트 간 메시지 라우팅
 * - AI 셀렉터/코드리뷰 API 호출 및 응답 정규화
 * - 탭 상태 관리 및 콘텐츠 스크립트 주입
 */
const injectedTabs = new Set();
const manifest = chrome.runtime.getManifest ? chrome.runtime.getManifest() : null;
const EXTENSION_VERSION = manifest && manifest.version ? manifest.version : '0.0.0';
const AI_REQUEST_TIMEOUT_MS = 25000;

/**
 * chrome.storage.local에 저장된 사용자 AI 설정을 읽어온다.
 * @returns {Promise<{ endpoint: string, apiKey: string, model: string }>}
 */
function getAiSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ aiSettings: { endpoint: '', apiKey: '', model: '' } }, (res) => {
      const settings = res && res.aiSettings ? res.aiSettings : {};
      resolve({
        endpoint: typeof settings.endpoint === 'string' ? settings.endpoint.trim() : '',
        apiKey: typeof settings.apiKey === 'string' ? settings.apiKey.trim() : '',
        model: typeof settings.model === 'string' ? settings.model.trim() : ''
      });
    });
  });
}

/**
 * 순환 참조나 함수가 포함된 객체를 보낼 수 있도록 JSON-safe 복사본을 만든다.
 * @param {*} data
 * @returns {*}
 */
function sanitizeForTransport(data) {
  try {
    return JSON.parse(JSON.stringify(data, (key, value) => {
      if (typeof value === 'function' || value === undefined) {
        return undefined;
      }
      return value;
    }));
  } catch (err) {
    return null;
  }
}

/**
 * API 요청 추적을 위한 고유 요청 ID를 생성한다.
 * @returns {string}
 */
function generateRequestId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * AI 응답과 같은 텍스트에서 JSON을 추출/파싱한다.
 * 마크다운 fenced code 혹은 JSON 유사 문자열을 모두 시도한다.
 * @param {string} text
 * @returns {*|null}
 */
function parseJsonFromText(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  const tryParse = (candidate) => {
    if (!candidate) return null;
    try {
      return JSON.parse(candidate);
    } catch (err) {
      return null;
    }
  };
  const direct = tryParse(trimmed);
  if (direct) return direct;
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch && fencedMatch[1]) {
    const fencedParsed = tryParse(fencedMatch[1].trim());
    if (fencedParsed) return fencedParsed;
  }
  const jsonLikeMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonLikeMatch) {
    const guess = tryParse(jsonLikeMatch[0]);
    if (guess) return guess;
  }
  return null;
}

/**
 * DevTools 패널에서 전달받은 이벤트/컨텍스트를 기반으로 AI 추천 요청 페이로드를 조립한다.
 * @param {object} eventPayload
 * @param {object} contextPayload
 * @param {{endpoint: string, apiKey: string, model: string}} settings
 * @returns {object}
 */
function buildAiRequestBody(eventPayload, contextPayload, settings) {
  const sanitizedEvent = sanitizeForTransport(eventPayload) || {};
  const context = contextPayload && typeof contextPayload === 'object' ? contextPayload : {};
  const {
    tabId,
    aiModel,
    testCase = '',
    testUrl = '',
    framework = '',
    language = ''
  } = context;
  const resolvedModel = typeof aiModel === 'string' && aiModel.trim()
    ? aiModel.trim()
    : (settings && settings.model ? settings.model : '');
  const selectorCandidates = Array.isArray(sanitizedEvent.selectorCandidates)
    ? sanitizedEvent.selectorCandidates
    : [];
  return {
    requestId: generateRequestId(),
    testCase: typeof testCase === 'string' ? testCase : '',
    testUrl: typeof testUrl === 'string' ? testUrl : '',
    framework: typeof framework === 'string' ? framework : '',
    language: typeof language === 'string' ? language : '',
    model: resolvedModel || '',
    event: sanitizedEvent,
    selectorCandidates,
    guidance: [
      '의미 있는 속성(id, data-*, aria- 등)을 우선 사용하고 동적 클래스 의존을 줄입니다.',
      'nth-child, 인덱스 기반 경로는 불가피할 때만 사용합니다.',
      '텍스트 기반 셀렉터는 컨텐츠 변경 가능성을 고려해 신중히 사용합니다.',
      '가능한 한 유일하게 매칭되는 셀렉터를 제안합니다.',
      'iframe 및 부모·자식 문맥 정보를 고려합니다.'
    ],
    metadata: {
      extension: 'ai_test_recorder',
      version: EXTENSION_VERSION,
      requestedAt: new Date().toISOString()
    },
    _tabId: typeof tabId === 'number' ? tabId : null
  };
}

/**
 * 코드 리뷰 요청 메시지를 AI 서버에 전송할 수 있는 형태로 구성한다.
 * @param {object} message
 * @param {{endpoint: string, apiKey: string, model: string}} settings
 * @returns {object}
 */
function buildAiCodeReviewRequestBody(message, settings) {
  const resolvedModel = (settings && settings.model) || '';
  const {
    testCase = '',
    code = '',
    framework = '',
    language = '',
    events = [],
    manualActions = [],
    aiModel = ''
  } = message || {};

  const sanitizedEvents = Array.isArray(events) ? sanitizeForTransport(events) : [];
  const sanitizedManual = Array.isArray(manualActions) ? sanitizeForTransport(manualActions) : [];
  const selectedModel = typeof aiModel === 'string' && aiModel.trim() ? aiModel.trim() : resolvedModel;

  return {
    requestId: generateRequestId(),
    type: 'code_review',
    model: selectedModel || '',
    testCase: typeof testCase === 'string' ? testCase : '',
    framework: typeof framework === 'string' ? framework : '',
    language: typeof language === 'string' ? language : '',
    code: typeof code === 'string' ? code : '',
    events: sanitizedEvents || [],
    manualActions: sanitizedManual || [],
    instructions: 'You are an expert test automation reviewer. Review the provided test case description and Playwright/Selenium code. Return pure JSON with keys "updatedCode", "summary", and "suggestions". updatedCode must contain the complete revised code. suggestions should be an array of short improvement notes. Do not wrap the response in markdown fences.',
    guidance: [
      'Ensure selectors remain stable and robust against UI changes.',
      'Optimize waits and synchronization for reliability.',
      'Keep the code idiomatic for the specified framework/language.',
      'Explain the most important improvements succinctly.'
    ],
    metadata: {
      extension: 'ai_test_recorder',
      version: EXTENSION_VERSION,
      requestedAt: new Date().toISOString()
    }
  };
}

/**
 * 다양한 포맷의 후보 셀렉터 정보를 내부 표준 포맷으로 변환한다.
 * @param {*} entry
 * @returns {object|null}
 */
function coerceAiCandidate(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') {
    const trimmed = entry.trim();
    if (!trimmed) return null;
    return { selector: trimmed, source: 'ai' };
  }
  if (typeof entry !== 'object') return null;

  const candidate = { source: 'ai' };

  if (typeof entry.selector === 'string' && entry.selector.trim()) {
    candidate.selector = entry.selector.trim();
  } else if (typeof entry.css === 'string' && entry.css.trim()) {
    candidate.selector = entry.css.trim();
    candidate.type = entry.type || 'css';
  } else if (typeof entry.xpath === 'string' && entry.xpath.trim()) {
    const trimmed = entry.xpath.trim();
    candidate.selector = trimmed.startsWith('xpath=') ? trimmed : `xpath=${trimmed}`;
    candidate.type = 'xpath';
  } else if (typeof entry.value === 'string' && entry.value.trim()) {
    candidate.selector = entry.value.trim();
  } else if (typeof entry.text === 'string' && entry.text.trim()) {
    const trimmed = entry.text.trim();
    candidate.selector = trimmed.startsWith('text=') ? trimmed : `text="${trimmed}"`;
    candidate.type = 'text';
    if (typeof entry.matchMode === 'string') {
      candidate.matchMode = entry.matchMode;
    } else if (typeof entry.mode === 'string') {
      candidate.matchMode = entry.mode;
    }
    candidate.textValue = trimmed
      .replace(/^text=["']?/, '')
      .replace(/["']$/, '');
  }

  if (!candidate.selector) {
    return null;
  }

  if (typeof entry.type === 'string' && !candidate.type) {
    candidate.type = entry.type;
  }
  if (candidate.type === 'text' && !candidate.matchMode) {
    if (typeof entry.matchMode === 'string') {
      candidate.matchMode = entry.matchMode;
    } else if (typeof entry.mode === 'string') {
      candidate.matchMode = entry.mode;
    }
  }
  if (typeof entry.reason === 'string') {
    candidate.reason = entry.reason;
  } else if (typeof entry.explanation === 'string') {
    candidate.reason = entry.explanation;
  }
  if (entry.score !== undefined && Number.isFinite(entry.score)) {
    candidate.score = Math.round(entry.score);
  } else if (typeof entry.confidence === 'number' && Number.isFinite(entry.confidence)) {
    const value = entry.confidence <= 1 ? entry.confidence * 100 : entry.confidence;
    candidate.score = Math.round(value);
  }
  if (typeof entry.unique === 'boolean') {
    candidate.unique = entry.unique;
  }
  if (typeof entry.matchCount === 'number') {
    candidate.matchCount = entry.matchCount;
  }
  if (typeof entry.textValue === 'string' && !candidate.textValue) {
    candidate.textValue = entry.textValue;
  }
  return candidate;
}

/**
 * AI 응답 객체에서 셀렉터 후보 목록을 재귀적으로 수집한다.
 * @param {*} source
 * @param {Array} target
 * @param {Set<object>} visited
 */
function collectCandidatesFromSource(source, target, visited = new Set()) {
  if (!source) return;
  if (typeof source === 'object' && source !== null) {
    if (visited.has(source)) return;
    visited.add(source);
  }
  if (Array.isArray(source)) {
    source.forEach((item) => collectCandidatesFromSource(item, target, visited));
    return;
  }
  if (typeof source === 'string') {
    source
      .split(/\r?\n+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((item) => {
        const candidate = coerceAiCandidate(item);
        if (candidate) {
          target.push(candidate);
        }
      });
    return;
  }
  if (typeof source !== 'object') {
    return;
  }
  const candidate = coerceAiCandidate(source);
  if (candidate) {
    target.push(candidate);
    return;
  }
  const nestedKeys = ['candidates', 'selectors', 'suggestions', 'results', 'items', 'data', 'options', 'alternatives'];
  nestedKeys.forEach((key) => {
    if (Array.isArray(source[key])) {
      collectCandidatesFromSource(source[key], target, visited);
    }
  });
  Object.keys(source).forEach((key) => {
    if (nestedKeys.includes(key)) return;
    const value = source[key];
    if (value && (Array.isArray(value) || (typeof value === 'object' && value !== null))) {
      collectCandidatesFromSource(value, target, visited);
    }
  });
}

/**
 * 중복 셀렉터 후보를 제거하고 공백을 정리한다.
 * @param {Array<object>} candidates
 * @returns {Array<object>}
 */
function dedupeCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (!candidate || typeof candidate.selector !== 'string') return false;
    const selector = candidate.selector.trim();
    if (!selector) return false;
    const key = `${selector}::${candidate.type || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    candidate.selector = selector;
    return true;
  });
}

/**
 * AI 셀렉터 응답을 내부 표준 형태로 정규화한다.
 * @param {*} raw
 * @returns {{candidates: Array<object>}}
 */
function normalizeAiResponse(raw) {
  const collected = [];
  collectCandidatesFromSource(raw, collected);
  const normalized = dedupeCandidates(
    collected
      .map((candidate) => {
        if (!candidate) return null;
        const enriched = { ...candidate };
        if (!enriched.reason) {
          enriched.reason = 'AI 추천';
        }
        return enriched;
      })
      .filter(Boolean)
  );
  return {
    candidates: normalized.slice(0, 12)
  };
}

/**
 * AI 코드 리뷰 응답 JSON을 DevTools 패널에서 사용하는 구조로 정리한다.
 * @param {*} raw
 * @param {string} fallbackCode
 * @returns {{ok: boolean, updatedCode: string, summary: string, suggestions: Array}}
 */
function normalizeAiCodeReviewResponse(raw, fallbackCode) {
  const base = raw && typeof raw === 'object' ? raw : {};
  const container = base.result && typeof base.result === 'object' ? base.result : base;
  const updatedCode =
    typeof container.updatedCode === 'string'
      ? container.updatedCode
      : (typeof container.code === 'string' ? container.code : fallbackCode);
  const summary = typeof container.summary === 'string'
    ? container.summary
    : (typeof container.overview === 'string' ? container.overview : '');
  let suggestions = [];
  if (Array.isArray(container.suggestions)) {
    suggestions = container.suggestions;
  } else if (Array.isArray(container.changes)) {
    suggestions = container.changes;
  } else if (Array.isArray(container.recommendations)) {
    suggestions = container.recommendations;
  }
  return {
    ok: true,
    updatedCode: typeof updatedCode === 'string' ? updatedCode : fallbackCode,
    summary,
    suggestions
  };
}

/**
 * 지정한 탭에서 후보 셀렉터를 검증하여 일치 개수를 확인한다.
 * @param {number|null} tabId
 * @param {Array<object>} candidates
 * @returns {Promise<Array|null>}
 */
function evaluateCandidatesOnPage(tabId, candidates) {
  return new Promise((resolve) => {
    if (typeof tabId !== 'number' || !Array.isArray(candidates) || candidates.length === 0) {
      resolve(null);
      return;
    }
    const payload = candidates.map((candidate) => ({
      selector: candidate.selector,
      type: candidate.type,
      matchMode: candidate.matchMode
    }));
    chrome.tabs.sendMessage(tabId, { type: 'EVALUATE_SELECTORS', selectors: payload }, (response) => {
      if (chrome.runtime.lastError || !response || !response.ok || !Array.isArray(response.results)) {
        resolve(null);
        return;
      }
      resolve(response.results);
    });
  });
}

/**
 * DevTools 패널에서 받은 셀렉터 추천 요청을 처리하고 AI 응답을 정규화한다.
 * @param {object} message
 * @param {Function} sendResponse
 */
async function handleAiSelectorRequest(message, sendResponse) {
  try {
    const settings = await getAiSettings();
    // AI 엔드포인트가 설정되지 않았다면 즉시 실패 응답을 돌려준다.
    if (!settings.endpoint) {
      // 엔드포인트가 없으면 호출할 수 없으니 즉시 실패를 반환.
      sendResponse({ ok: false, reason: 'AI API 엔드포인트가 설정되지 않았습니다.' });
      return;
    }
    const eventPayload = message && typeof message === 'object' ? message.event : null;
    const contextPayload = message && typeof message === 'object' && message.context ? message.context : {};
    const requestBody = buildAiRequestBody(eventPayload, contextPayload, settings);
    // 요청 바디 구성이 실패한 경우에도 오류를 반환한다.
    if (!requestBody) {
      sendResponse({ ok: false, reason: 'AI 요청 페이로드를 준비할 수 없습니다.' });
      return;
    }
    const { _tabId: targetTabId, ...requestForApi } = requestBody;
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
    // API 키가 존재한다면 Authorization 및 x-api-key 헤더를 모두 채운다.
    if (settings.apiKey) {
      headers.Authorization = `Bearer ${settings.apiKey}`;
      headers['x-api-key'] = settings.apiKey;
    }
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS) : null;
    let response;
    try {
      // 네트워크 요청을 시도하고 타임아웃 컨트롤러가 있다면 연결한다.
      response = await fetch(settings.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestForApi),
        signal: controller ? controller.signal : undefined
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
    // HTTP 에러 응답일 경우 body에서 추가 메시지를 추출한다.
    if (!response.ok) {
      let errorMessage = `AI API 호출 실패 (HTTP ${response.status})`;
      try {
        // 응답 본문이 JSON일 수도 있으니 가능한 한 상세한 오류 메시지를 만든다.
        const errorText = await response.text();
        if (errorText) {
          try {
            const parsedError = JSON.parse(errorText);
            if (typeof parsedError === 'string') {
              errorMessage = parsedError;
            } else if (parsedError && typeof parsedError.message === 'string') {
              errorMessage = parsedError.message;
            } else if (parsedError && typeof parsedError.error === 'string') {
              errorMessage = parsedError.error;
            }
          } catch (err) {
            const trimmed = errorText.trim();
            if (trimmed) {
              errorMessage = trimmed;
            }
          }
        }
      } catch (err) {
        // ignore
      }
      sendResponse({ ok: false, reason: errorMessage });
      return;
    }
    let rawText = '';
    try {
      rawText = await response.text();
    } catch (err) {
      sendResponse({ ok: false, reason: 'AI 응답을 읽는 중 오류가 발생했습니다.' });
      return;
    }
    let parsed = null;
    if (rawText) {
      // 순수 JSON이 아닐 수도 있으니 JSON.parse를 한 번 더 시도한다.
      try {
        parsed = JSON.parse(rawText);
      } catch (err) {
        parsed = rawText;
      }
    }
    const { candidates } = normalizeAiResponse(parsed);
    // 후보가 하나도 없다면 유저에게 의미 있는 메시지를 전달한다.
    if (!candidates || candidates.length === 0) {
      sendResponse({ ok: false, reason: 'AI 응답에 셀렉터 후보가 없습니다.' });
      return;
    }
    let enrichedCandidates = candidates.map((candidate) => ({ ...candidate }));
    const evaluationResults = await evaluateCandidatesOnPage(targetTabId, enrichedCandidates);
    if (Array.isArray(evaluationResults)) {
      // 후보별로 매칭 결과를 병합하기 쉽게 selector/type 키를 map에 저장한다.
      const map = new Map();
      evaluationResults.forEach((result) => {
        // selector::type을 키로 삼아 이후에 빠르게 lookup한다.
        if (!result || typeof result.selector !== 'string') return;
        const key = `${result.selector}::${result.type || ''}`;
        map.set(key, result);
        if (!map.has(`${result.selector}::`)) {
          map.set(`${result.selector}::`, result);
        }
      });
      enrichedCandidates = enrichedCandidates.map((candidate) => {
        const key = `${candidate.selector}::${candidate.type || ''}`;
        const fallbackKey = `${candidate.selector}::`;
        const evaluation = map.get(key) || map.get(fallbackKey);
        if (!evaluation) return candidate;
        const updated = { ...candidate };
        if (typeof evaluation.matchCount === 'number') {
          updated.matchCount = evaluation.matchCount;
          updated.unique = evaluation.matchCount === 1;
        } else if (evaluation.unique === true) {
          updated.unique = true;
        }
        if (evaluation.error) {
          const errMessage = typeof evaluation.error === 'string' ? evaluation.error : '검증 실패';
          updated.reason = updated.reason ? `${updated.reason} • ${errMessage}` : errMessage;
        } else if (typeof evaluation.matchCount === 'number') {
          const label = evaluation.matchCount === 1
            ? '페이지에서 유일 일치'
            : `페이지 내 ${evaluation.matchCount}개 일치`;
          updated.reason = updated.reason ? `${updated.reason} • ${label}` : label;
        }
        if (updated.score === undefined) {
          if (evaluation.matchCount === 1) {
            updated.score = 92;
          } else if (typeof evaluation.matchCount === 'number') {
            updated.score = Math.max(35, 75 - evaluation.matchCount * 8);
          }
        }
        return updated;
      });
    }
    sendResponse({
      ok: true,
      candidates: enrichedCandidates,
      meta: {
        model: requestForApi.model || null,
        validated: Array.isArray(evaluationResults)
      }
    });
  } catch (error) {
    const message = error && error.name === 'AbortError'
      ? 'AI API 요청 제한 시간 초과'
      : (error && error.message) || 'AI 추천 요청 처리 중 오류가 발생했습니다.';
    sendResponse({ ok: false, reason: message });
  }
}

/**
 * AI 코드 리뷰 API를 호출하고 DevTools 패널과 프로토콜을 맞춘다.
 * @param {object} message
 * @param {Function} sendResponse
 */
async function handleAiCodeReviewRequest(message, sendResponse) {
  try {
    const settings = await getAiSettings();
    if (!settings.endpoint) {
      sendResponse({ ok: false, reason: 'AI API 엔드포인트가 설정되지 않았습니다.' });
      return;
    }
    if (!message || typeof message.code !== 'string' || !message.code.trim()) {
      // 코드가 비어 있으면 리뷰 결과가 의미 없으므로 거부한다.
      sendResponse({ ok: false, reason: '검토할 코드가 제공되지 않았습니다.' });
      return;
    }
    const requestBody = buildAiCodeReviewRequestBody(message, settings);
    if (!requestBody.code) {
      // sanitize 과정에서 코드가 비어 버린 경우를 한 번 더 검증한다.
      sendResponse({ ok: false, reason: '검토할 코드가 비어 있습니다.' });
      return;
    }
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
    if (settings.apiKey) {
      // API 키가 설정된 경우 header 두 곳에 모두 반영한다.
      headers.Authorization = `Bearer ${settings.apiKey}`;
      headers['x-api-key'] = settings.apiKey;
    }
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS) : null;
    let response;
    try {
      response = await fetch(settings.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: controller ? controller.signal : undefined
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!response.ok) {
      // 실패 응답은 가능한 한 원인 메시지를 사용자에게 명확히 전달한다.
      let errorMessage = `AI API 호출 실패 (HTTP ${response.status})`;
      try {
        const errorText = await response.text();
        if (errorText) {
          const parsedError = parseJsonFromText(errorText);
          if (parsedError) {
            if (typeof parsedError === 'string') {
              errorMessage = parsedError;
            } else if (typeof parsedError.message === 'string') {
              errorMessage = parsedError.message;
            } else if (typeof parsedError.error === 'string') {
              errorMessage = parsedError.error;
            }
          } else {
            const trimmed = errorText.trim();
            if (trimmed) {
              errorMessage = trimmed;
            }
          }
        }
      } catch (err) {
        // ignore parse issues
      }
      sendResponse({ ok: false, reason: errorMessage });
      return;
    }
    let rawText = '';
    try {
      rawText = await response.text();
    } catch (err) {
      sendResponse({ ok: false, reason: 'AI 응답을 읽는 중 오류가 발생했습니다.' });
      return;
    }
    let parsed = parseJsonFromText(rawText);
    if (!parsed && rawText && rawText.trim()) {
      parsed = { updatedCode: rawText.trim() };
    }
    const normalized = normalizeAiCodeReviewResponse(parsed || {}, requestBody.code);
    sendResponse(normalized);
  } catch (error) {
    const message = error && error.name === 'AbortError'
      ? 'AI API 요청 제한 시간 초과'
      : (error && error.message) || 'AI 코드 검토 요청 처리 중 오류가 발생했습니다.';
    sendResponse({ ok: false, reason: message });
  }
}

// ==================== WebSocket 연결 관리 ====================

let wsConnection = null;
let wsReconnectAttempts = 0;
const WS_MAX_RECONNECT_ATTEMPTS = 5; // 최대 재연결 시도 횟수
const WS_RECONNECT_DELAY = 5000; // 5초 (연결 실패 시 재시도 간격 증가)
const WS_URL = 'ws://localhost:3000'; // Local API Server WebSocket 주소

/**
 * WebSocket 연결 초기화 및 재연결 로직
 * 연결 실패해도 확장 프로그램은 정상 작동 (선택사항)
 */
function initWebSocket() {
  // 이미 연결되어 있으면 중단
  if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
    console.log('[Background] WebSocket 이미 연결됨');
    return;
  }
  
  // 최대 재연결 시도 횟수 초과 시 재연결 중단
  if (wsReconnectAttempts >= WS_MAX_RECONNECT_ATTEMPTS) {
    console.warn('[Background] WebSocket 최대 재연결 시도 횟수 도달. 연결을 중단합니다.');
    return;
  }

  try {
    // 첫 번째 연결 시도일 때만 로그
    if (wsReconnectAttempts === 0) {
      console.log('[Background] WebSocket 연결 시도:', WS_URL);
    }
    wsConnection = new WebSocket(WS_URL);

    wsConnection.onopen = () => {
      console.log('[Background] ✅ WebSocket 연결 성공');
      wsReconnectAttempts = 0; // 재연결 성공 시 카운터 리셋
      // 연결 성공 시 Extension ID 전송 (선택적)
      sendWebSocketMessage({
        type: 'extension_connected',
        extensionId: chrome.runtime.id,
        version: EXTENSION_VERSION
      });
    };

    wsConnection.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('[Background] WebSocket 메시지 수신:', message);
        handleWebSocketMessage(message);
      } catch (error) {
        console.error('[Background] WebSocket 메시지 파싱 실패:', error, 'Raw data:', event.data);
      }
    };

    wsConnection.onerror = (error) => {
      // 에러는 onclose에서 처리되므로 여기서는 로그하지 않음
      // 브라우저 콘솔에 에러가 표시되지만, 이것은 정상적인 상황일 수 있음
    };

    wsConnection.onclose = (event) => {
      wsConnection = null;
      
      // 연결이 거부된 경우 (서버가 없음)
      if (event.code === 1006 || event.code === 1000) {
        if (wsReconnectAttempts === 0) {
          // 첫 번째 연결 실패 시에만 로그
          console.log('[Background] WebSocket 서버에 연결할 수 없습니다. (Local API Server가 실행되지 않았을 수 있습니다)');
          console.log('[Background] WebSocket이 없어도 다른 기능은 정상 작동합니다.');
        }
      }
      
      // 정상 종료(1000)가 아니고, 재연결 시도 횟수가 남아있을 때만 재연결
      if (event.code !== 1000 && wsReconnectAttempts < WS_MAX_RECONNECT_ATTEMPTS) {
        wsReconnectAttempts++;
        const delay = WS_RECONNECT_DELAY * wsReconnectAttempts;
        // 재연결 시도는 조용히 (로그 최소화)
        setTimeout(() => {
          initWebSocket();
        }, delay);
      } else if (wsReconnectAttempts >= WS_MAX_RECONNECT_ATTEMPTS) {
        // 최대 시도 횟수 도달 시 한 번만 로그
        console.log('[Background] WebSocket 재연결을 중단했습니다. Local API Server가 실행되면 자동으로 연결됩니다.');
      }
    };

  } catch (error) {
    // WebSocket 생성 실패는 드문 경우이므로 로그만 남김
    wsConnection = null;
    
    // 최대 시도 횟수 내에서만 재연결 (조용히)
    if (wsReconnectAttempts < WS_MAX_RECONNECT_ATTEMPTS) {
      wsReconnectAttempts++;
      const delay = WS_RECONNECT_DELAY * wsReconnectAttempts;
      setTimeout(() => {
        initWebSocket();
      }, delay);
    }
  }
}

/**
 * WebSocket을 통해 메시지 전송
 */
function sendWebSocketMessage(message) {
  if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
    try {
      wsConnection.send(JSON.stringify(message));
      console.log('[Background] WebSocket 메시지 전송:', message);
      return true;
    } catch (error) {
      console.error('[Background] WebSocket 메시지 전송 실패:', error);
      return false;
    }
  } else {
    console.warn('[Background] WebSocket이 연결되지 않아 메시지 전송 실패:', message);
    return false;
  }
}

/**
 * WebSocket으로 받은 메시지 처리
 */
function handleWebSocketMessage(message) {
  if (!message || !message.type) {
    console.warn('[Background] 잘못된 WebSocket 메시지:', message);
    return;
  }

  switch (message.type) {
    case 'OPEN_POPUP':
      // 팝업 열기
      chrome.windows.create({
        url: chrome.runtime.getURL('popup.html'),
        type: 'popup',
        width: 1220,
        height: 850,
        focused: true
      }, (window) => {
        if (chrome.runtime.lastError) {
          console.error('[Background] 창 열기 실패:', chrome.runtime.lastError);
          sendWebSocketMessage({
            type: 'OPEN_POPUP_RESPONSE',
            success: false,
            error: chrome.runtime.lastError.message
          });
        } else {
          console.log('[Background] 새 창이 열렸습니다. Window ID:', window.id);
          sendWebSocketMessage({
            type: 'OPEN_POPUP_RESPONSE',
            success: true,
            windowId: window.id
          });
        }
      });
      break;

    case 'START_RECORDING':
      // 녹화 시작 (필요한 경우)
      // 현재는 popup에서 처리하므로 여기서는 알림만
      sendWebSocketMessage({
        type: 'START_RECORDING_RESPONSE',
        message: '녹화는 팝업에서 시작해주세요'
      });
      break;

    case 'PING':
      // 연결 확인
      sendWebSocketMessage({
        type: 'PONG',
        timestamp: Date.now()
      });
      break;

    default:
      console.warn('[Background] 알 수 없는 WebSocket 메시지 타입:', message.type);
      sendWebSocketMessage({
        type: 'ERROR',
        message: `Unknown message type: ${message.type}`
      });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Background] AI Test Recorder 설치됨');
  initWebSocket();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[Background] Chrome 시작 시 WebSocket 연결');
  initWebSocket();
});

// Background Script가 활성화될 때 WebSocket 연결
initWebSocket();

// 확장 프로그램 아이콘 클릭 시 새 창 열기
chrome.action.onClicked.addListener(() => {
  chrome.windows.create({
    url: chrome.runtime.getURL('popup.html'),
    type: 'popup',
    width: 1220,
    height: 850,
    focused: true
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  injectedTabs.delete(tabId);
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  injectedTabs.delete(removedTabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // 우리 확장이 주입해 둔 탭만 다시 주입을 시도한다.
  if (!injectedTabs.has(tabId)) return;
  // 로딩 상태로 전환될 때만 content.js를 다시 넣는다.
  if (changeInfo.status !== 'loading') return;
  chrome.scripting.executeScript(
    {
      target: { tabId },
      files: ['content.js']
    },
    () => {
      if (chrome.runtime.lastError) {
        const message = chrome.runtime.lastError.message || '';
        if (message.includes('Cannot access contents of url')) {
          // 리디렉션 등으로 접근 불가하면 추적 목록에서 제거한다.
          injectedTabs.delete(tabId);
        }
      }
    }
  );
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'GET_EVENTS') {
    // 저장된 이벤트 목록을 그대로 반환.
    chrome.storage.local.get({ events: [] }, (res) => sendResponse({ events: res.events || [] }));
    return true;
  }

  if (msg && msg.type === 'SAVE_EVENT') {
    chrome.storage.local.get({ events: [] }, (res) => {
      const events = res.events || [];
      // 새 이벤트를 배열 끝에 추가하고 다시 저장.
      events.push(msg.event);
      chrome.storage.local.set({ events }, () => sendResponse({ ok: true }));
    });
    return true;
  }

  if (msg && msg.type === 'ENSURE_CONTENT_SCRIPT') {
    const tabId = msg.tabId;
    if (typeof tabId !== 'number') {
      // 숫자 탭 ID가 아니라면 잘못된 요청으로 처리.
      sendResponse({ ok: false, reason: 'invalid_tab' });
      return false;
    }
    chrome.scripting.executeScript(
      {
        target: { tabId },
        files: ['content.js']
      },
      () => {
        if (chrome.runtime.lastError) {
          // 주입 오류 메시지를 그대로 돌려준다.
          sendResponse({ ok: false, reason: chrome.runtime.lastError.message });
          return;
        }
        // 성공적으로 주입한 탭을 추적 목록에 추가.
        injectedTabs.add(tabId);
        sendResponse({ ok: true });
      }
    );
    return true;
  }

  if (msg && msg.type === 'REQUEST_AI_SELECTORS') {
    handleAiSelectorRequest(msg, sendResponse);
    return true;
  }

  if (msg && msg.type === 'REQUEST_AI_CODE_REVIEW') {
    handleAiCodeReviewRequest(msg, sendResponse);
    return true;
  }

  return false;
});

// 외부에서 오는 메시지 처리 (자동화 툴에서 호출)
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  console.log('[Background] 외부 메시지 수신:', msg, 'from:', sender?.url, 'origin:', sender?.origin);
  
  if (msg && msg.type === 'OPEN_POPUP') {
    // sendResponse는 리스너가 반환되기 전에 호출되어야 함
    // 비동기 작업은 별도로 처리하고 즉시 응답 반환
    const response = { ok: true, extensionId: chrome.runtime.id };
    console.log('[Background] OPEN_POPUP 요청 처리 시작, 즉시 응답:', response);
    
    // 즉시 응답 반환 (sendResponse는 리스너가 종료되기 전에 호출되어야 함)
    sendResponse(response);
    
    // chrome.tabs.create()는 popup.html을 직접 열 수 없으므로
    // chrome.windows.create()를 사용하여 새 창으로 열기
    chrome.windows.create({
      url: chrome.runtime.getURL('popup.html'),
      type: 'popup',
      width: 1220,
      height: 850,
      focused: true
    }, (window) => {
      if (chrome.runtime.lastError) {
        console.error('[Background] 창 열기 실패:', chrome.runtime.lastError);
        return;
      }
      
      console.log('[Background] 새 창이 열렸습니다. Window ID:', window.id);
      
      // content script 자동 주입 (활성 탭이 있는 경우)
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs.length > 0) {
          const activeTab = tabs[0];
          // chrome-extension:// 또는 chrome:// 페이지는 제외
          if (activeTab.url && 
              !activeTab.url.startsWith('chrome://') && 
              !activeTab.url.startsWith('chrome-extension://') &&
              !activeTab.url.startsWith('edge://')) {
            chrome.scripting.executeScript({
              target: { tabId: activeTab.id },
              files: ['content.js']
            }, () => {
              if (chrome.runtime.lastError) {
                console.warn('[Background] Content script 주입 실패:', chrome.runtime.lastError);
              } else {
                injectedTabs.add(activeTab.id);
                console.log('[Background] Content script 주입 성공:', activeTab.id);
              }
            });
          }
        }
      });
    });
    
    return true; // 비동기 응답을 위해 true 반환
  }
  
  if (msg && msg.type === 'GET_EXTENSION_ID') {
    const response = { extensionId: chrome.runtime.id };
    console.log('[Background] GET_EXTENSION_ID 요청, 응답:', response);
    sendResponse(response);
    return true;
  }
  
  console.warn('[Background] 알 수 없는 메시지 타입:', msg?.type);
  sendResponse({ ok: false, error: 'Unknown message type' });
  return false;
});
