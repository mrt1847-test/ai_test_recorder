const injectedTabs = new Set();
const manifest = chrome.runtime.getManifest ? chrome.runtime.getManifest() : null;
const EXTENSION_VERSION = manifest && manifest.version ? manifest.version : '0.0.0';
const AI_REQUEST_TIMEOUT_MS = 25000;

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

function generateRequestId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

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

async function handleAiSelectorRequest(message, sendResponse) {
  try {
    const settings = await getAiSettings();
    if (!settings.endpoint) {
      sendResponse({ ok: false, reason: 'AI API 엔드포인트가 설정되지 않았습니다.' });
      return;
    }
    const eventPayload = message && typeof message === 'object' ? message.event : null;
    const contextPayload = message && typeof message === 'object' && message.context ? message.context : {};
    const requestBody = buildAiRequestBody(eventPayload, contextPayload, settings);
    if (!requestBody) {
      sendResponse({ ok: false, reason: 'AI 요청 페이로드를 준비할 수 없습니다.' });
      return;
    }
    const { _tabId: targetTabId, ...requestForApi } = requestBody;
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
    if (settings.apiKey) {
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
        body: JSON.stringify(requestForApi),
        signal: controller ? controller.signal : undefined
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!response.ok) {
      let errorMessage = `AI API 호출 실패 (HTTP ${response.status})`;
      try {
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
      try {
        parsed = JSON.parse(rawText);
      } catch (err) {
        parsed = rawText;
      }
    }
    const { candidates } = normalizeAiResponse(parsed);
    if (!candidates || candidates.length === 0) {
      sendResponse({ ok: false, reason: 'AI 응답에 셀렉터 후보가 없습니다.' });
      return;
    }
    let enrichedCandidates = candidates.map((candidate) => ({ ...candidate }));
    const evaluationResults = await evaluateCandidatesOnPage(targetTabId, enrichedCandidates);
    if (Array.isArray(evaluationResults)) {
      const map = new Map();
      evaluationResults.forEach((result) => {
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

async function handleAiCodeReviewRequest(message, sendResponse) {
  try {
    const settings = await getAiSettings();
    if (!settings.endpoint) {
      sendResponse({ ok: false, reason: 'AI API 엔드포인트가 설정되지 않았습니다.' });
      return;
    }
    if (!message || typeof message.code !== 'string' || !message.code.trim()) {
      sendResponse({ ok: false, reason: '검토할 코드가 제공되지 않았습니다.' });
      return;
    }
    const requestBody = buildAiCodeReviewRequestBody(message, settings);
    if (!requestBody.code) {
      sendResponse({ ok: false, reason: '검토할 코드가 비어 있습니다.' });
      return;
    }
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
    if (settings.apiKey) {
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

chrome.runtime.onInstalled.addListener(() => {
  console.log('AI Test Recorder installed');
});

chrome.tabs.onRemoved.addListener((tabId) => {
  injectedTabs.delete(tabId);
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  injectedTabs.delete(removedTabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!injectedTabs.has(tabId)) return;
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
          injectedTabs.delete(tabId);
        }
      }
    }
  );
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'GET_EVENTS') {
    chrome.storage.local.get({ events: [] }, (res) => sendResponse({ events: res.events || [] }));
    return true;
  }

  if (msg && msg.type === 'SAVE_EVENT') {
    chrome.storage.local.get({ events: [] }, (res) => {
      const events = res.events || [];
      events.push(msg.event);
      chrome.storage.local.set({ events }, () => sendResponse({ ok: true }));
    });
    return true;
  }

  if (msg && msg.type === 'ENSURE_CONTENT_SCRIPT') {
    const tabId = msg.tabId;
    if (typeof tabId !== 'number') {
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
          sendResponse({ ok: false, reason: chrome.runtime.lastError.message });
          return;
        }
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
