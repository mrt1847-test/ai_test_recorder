(function(){
  if (window.__ai_test_recorder_loaded) return;
  window.__ai_test_recorder_loaded = true;

  function escapeAttributeValue(value) {
    return (value || '').replace(/"/g, '\\"').replace(/\u0008/g, '').replace(/\u000c/g, '').trim();
  }

  function buildFullXPath(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el.id) {
      const cleanedId = escapeAttributeValue(el.id);
      if (cleanedId) {
        return '//*[@id="' + cleanedId + '"]';
      }
    }
    const parts = [];
    let current = el;
    while (current && current.nodeType === 1 && current !== document.documentElement) {
      const tagName = current.tagName.toLowerCase();
      let index = 1;
      let sibling = current.previousSibling;
      while (sibling) {
        if (sibling.nodeType === 1 && sibling.tagName === current.tagName) {
          index += 1;
        }
        sibling = sibling.previousSibling;
      }
      parts.unshift(tagName + '[' + index + ']');
      current = current.parentNode;
    }
    if (parts.length === 0) return null;
    return '//' + parts.join('/');
  }

  function cssEscapeIdent(value) {
    if (typeof value !== 'string') return '';
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }
    return value.replace(/([!"#$%&'()*+,./:;<=>?@\[\]^`{|}~])/g, '\\$1');
  }

  function buildCssSegment(el) {
    if (!el || el.nodeType !== 1) return '';
    const tag = el.tagName.toLowerCase();
    if (el.id) {
      return `${tag}#${cssEscapeIdent(el.id)}`;
    }
    const classList = Array.from(el.classList || []).slice(0, 2).map(cssEscapeIdent).filter(Boolean);
    if (classList.length) {
      return `${tag}.${classList.join('.')}`;
    }
    let index = 1;
    let sibling = el.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === el.tagName) {
        index += 1;
      }
      sibling = sibling.previousElementSibling;
    }
    return `${tag}:nth-of-type(${index})`;
  }

  function buildRelativeCssSelector(parent, child) {
    if (!parent || !child || !parent.contains(child) || parent === child) return null;
    const segments = [];
    let current = child;
    while (current && current !== parent) {
      if (current.nodeType !== 1) {
        current = current.parentElement;
        continue;
      }
      const segment = buildCssSegment(current);
      if (!segment) return null;
      segments.unshift(segment);
      current = current.parentElement;
    }
    if (current !== parent) return null;
    return ':scope ' + segments.join(' > ');
  }

  function buildUniqueCssPath(element, contextElement) {
    if (!element || element.nodeType !== 1) return null;
    const segments = [];
    let current = element;
    while (current && current.nodeType === 1 && current !== contextElement) {
      const segment = buildCssSegment(current);
      if (!segment) return null;
      segments.unshift(segment);
      const cssPath = segments.join(' > ');
      const selectorString = contextElement ? ':scope ' + cssPath : cssPath;
      const parsed = parseSelectorForMatching('css=' + selectorString, 'css');
      const targetScope = contextElement || document;
      if (countMatchesForSelector(parsed, targetScope) === 1) {
        if (!contextElement && cssPath.startsWith('html:nth-of-type(1) > ')) {
          return cssPath.replace(/^html:nth-of-type\(1\)\s*>\s*/, '');
        }
        return contextElement ? ':scope ' + cssPath : cssPath;
      }
      current = current.parentElement;
      if (!current) break;
      if (!contextElement && current === document.documentElement) {
        break;
      }
    }
    if (contextElement) {
      const relativePath = segments.join(' > ');
      return relativePath ? ':scope ' + relativePath : null;
    }
    let finalPath = segments.join(' > ');
    if (finalPath.startsWith('html:nth-of-type(1) > ')) {
      finalPath = finalPath.replace(/^html:nth-of-type\(1\)\s*>\s*/, '');
    }
    return finalPath;
  }

  function escapeXPathLiteral(value) {
    if (value.includes('"') && value.includes("'")) {
      const parts = value.split('"').map(part => '"' + part + '"').join(', "\"", ');
      return 'concat(' + parts + ')';
    }
    if (value.includes('"')) {
      return "'" + value + "'";
    }
    return '"' + value + '"';
  }

  function buildXPathSegment(el) {
    if (!el || el.nodeType !== 1) return '';
    const tag = el.tagName.toLowerCase();
    if (el.id) {
      return `${tag}[@id=${escapeXPathLiteral(el.id)}]`;
    }
    const nameAttr = el.getAttribute && el.getAttribute('name');
    if (nameAttr) {
      return `${tag}[@name=${escapeXPathLiteral(nameAttr)}]`;
    }
    let index = 1;
    let sibling = el.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === el.tagName) {
        index += 1;
      }
      sibling = sibling.previousElementSibling;
    }
    return `${tag}[${index}]`;
  }

  function buildRelativeXPathSelector(parent, child) {
    if (!parent || !child || !parent.contains(child) || parent === child) return null;
    const segments = [];
    let current = child;
    while (current && current !== parent) {
      if (current.nodeType !== 1) {
        current = current.parentElement;
        continue;
      }
      const segment = buildXPathSegment(current);
      if (!segment) return null;
      segments.unshift(segment);
      current = current.parentElement;
    }
    if (current !== parent) return null;
    return './/' + segments.join('/');
  }

  function buildRobustXPathSegment(el) {
    if (!el || el.nodeType !== 1) return null;
    const tag = el.tagName.toLowerCase();
    if (el.id) {
      return {segment: `//*[@id=${escapeXPathLiteral(el.id)}]`, stop: true};
    }
    const attrPriority = ['data-testid','data-test','data-qa','data-cy','data-id','aria-label','role','name','type'];
    for (const attr of attrPriority) {
      const val = el.getAttribute && el.getAttribute(attr);
      if (val) {
        return {segment: `${tag}[@${attr}=${escapeXPathLiteral(val)}]`, stop: false};
      }
    }
    const classList = Array.from(el.classList || []).filter(Boolean);
    if (classList.length) {
      const cls = classList[0];
      const containsExpr = `contains(concat(' ', normalize-space(@class), ' '), ${escapeXPathLiteral(' ' + cls + ' ')})`;
      return {segment: `${tag}[${containsExpr}]`, stop: false};
    }
    let index = 1;
    let sibling = el.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === el.tagName) {
        index += 1;
      }
      sibling = sibling.previousElementSibling;
    }
    return {segment: `${tag}[${index}]`, stop: false};
  }

  function buildRobustXPath(el) {
    if (!el || el.nodeType !== 1) return null;
    const segments = [];
    let current = el;
    while (current && current.nodeType === 1) {
      const info = buildRobustXPathSegment(current);
      if (!info || !info.segment) return null;
      segments.unshift(info.segment);
      if (info.stop) break;
      current = current.parentElement;
    }
    if (segments.length === 0) return null;
    let xpath = segments[0];
    if (xpath.startsWith('//*[@')) {
      if (segments.length > 1) {
        xpath += '/' + segments.slice(1).join('/');
      }
    } else {
      xpath = '//' + segments.join('/');
    }
    return xpath;
  }

  function parseSelectorForMatching(selector, explicitType) {
    if (!selector) return {type: explicitType || null, value: ''};
    let type = explicitType || inferSelectorType(selector);
    let value = selector;
    if (selector.startsWith('css=')) {
      type = 'css';
      value = selector.slice(4);
    } else if (selector.startsWith('xpath=')) {
      type = 'xpath';
      value = selector.slice(6);
    } else if (selector.startsWith('text=')) {
      type = 'text';
      value = selector.slice(5);
    }
    if (type === 'text') {
      value = value.replace(/^['"]|['"]$/g, '');
      value = value.replace(/\\"/g, '"').replace(/\\'/g, "'");
    }
    return {type, value};
  }

  function iterateElements(scope, callback) {
    if (!scope || typeof callback !== 'function') return;
    if (scope === document) {
      document.querySelectorAll('*').forEach(callback);
      return;
    }
    if (scope.nodeType === 1) {
      callback(scope);
      scope.querySelectorAll('*').forEach(callback);
    }
  }

  function buildTextXPathExpression(text, matchMode, scopeIsDocument) {
    const literal = escapeXPathLiteral(text);
    const base = scopeIsDocument ? '//' : './/';
    if (matchMode === 'exact') {
      return `${base}*[normalize-space(.) = ${literal}]`;
    }
    return `${base}*[contains(normalize-space(.), ${literal})]`;
  }

  function countMatchesForSelector(parsed, root, options = {}) {
    if (!parsed || !parsed.value) return 0;
    const scope = root || document;
    try {
      if (parsed.type === 'xpath') {
        const doc = scope.ownerDocument || document;
        const contextNode = scope.nodeType ? scope : doc;
        const iterator = doc.evaluate(parsed.value, contextNode, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
        let count = 0;
        let node = iterator.iterateNext();
        while (node) {
          count += 1;
          node = iterator.iterateNext();
        }
        return count;
      }
      if (parsed.type === 'text') {
        const targetText = normalizeText(parsed.value);
        if (!targetText) return 0;
        const doc = scope.ownerDocument || document;
        const contextNode = scope.nodeType ? scope : doc;
        const isDocumentScope = !scope || scope === document || scope.nodeType === 9;
        const matchMode = options.matchMode === 'contains' ? 'contains' : 'exact';
        const expression = buildTextXPathExpression(targetText, matchMode, isDocumentScope);
        const iterator = doc.evaluate(expression, contextNode, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
        let count = 0;
        let node = iterator.iterateNext();
        while (node) {
          count += 1;
          node = iterator.iterateNext();
        }
        return count;
      }
      // CSS 계열
      if (scope === document) {
        return document.querySelectorAll(parsed.value).length;
      }
      let count = scope.querySelectorAll(parsed.value).length;
      if (scope.matches && scope.matches(parsed.value)) {
        count += 1;
      }
      return count;
    } catch (err) {
      return 0;
    }
  }

  function enrichCandidateWithUniqueness(baseCandidate, options = {}) {
    if (!baseCandidate || !baseCandidate.selector) return null;
    const candidate = {...baseCandidate};
    const originalType = candidate.type || inferSelectorType(candidate.selector);
    const parsed = parseSelectorForMatching(candidate.selector, candidate.type);
    const reasonParts = candidate.reason ? [candidate.reason] : [];

    if (!options.skipGlobalCheck) {
      const globalCount = countMatchesForSelector(parsed, document, {matchMode: candidate.matchMode});
      candidate.matchCount = globalCount;
      candidate.unique = globalCount === 1;
      if (globalCount === 0 && options.allowZero !== true) {
        return null;
      }
      if (globalCount === 1) {
        reasonParts.push('유일 일치');
      } else if (globalCount > 1) {
        reasonParts.push(`${globalCount}개 요소와 일치`);
      }
    }

    if (options.contextElement) {
      const contextCount = countMatchesForSelector(parsed, options.contextElement, {matchMode: candidate.matchMode});
      candidate.contextMatchCount = contextCount;
      candidate.uniqueInContext = contextCount === 1;
      if (options.contextLabel) {
        if (contextCount === 1) {
          reasonParts.push(`${options.contextLabel} 내 유일`);
        } else if (contextCount > 1) {
          reasonParts.push(`${options.contextLabel} 내 ${contextCount}개 일치`);
        } else {
          reasonParts.push(`${options.contextLabel} 내 일치 없음`);
        }
      }
      if (options.requireContextUnique && !candidate.uniqueInContext) {
        return null;
      }
      if (options.skipGlobalCheck) {
        candidate.matchCount = contextCount;
        candidate.unique = candidate.uniqueInContext;
      }
    }

    if (!options.skipGlobalCheck && options.requireUnique && candidate.unique === false) {
      return null;
    }

    if (!options.skipGlobalCheck && candidate.unique === false && typeof candidate.score === 'number') {
      candidate.score = Math.min(candidate.score, options.duplicateScore ?? 55);
    }

    if (options.skipGlobalCheck && candidate.unique === false && typeof candidate.score === 'number') {
      candidate.score = Math.min(candidate.score, options.duplicateScore ?? 60);
    }

    if (originalType !== 'text' && originalType !== 'xpath' && !candidate.unique && options.element && options.enableIndexing !== false) {
      const contextEl = options.contextElement && candidate.relation === 'relative' ? options.contextElement : null;
      const uniqueSelector = buildUniqueCssPath(options.element, contextEl);
      if (uniqueSelector && uniqueSelector !== candidate.selector) {
        const uniqueParsed = parseSelectorForMatching(uniqueSelector, 'css');
        const count = countMatchesForSelector(uniqueParsed, contextEl || document, {matchMode: candidate.matchMode});
        if (count === 1) {
          candidate.selector = uniqueSelector;
          candidate.type = 'css';
          candidate.matchCount = count;
          candidate.unique = true;
          candidate.uniqueInContext = true;
          candidate.relation = contextEl ? 'relative' : candidate.relation;
          reasonParts.push('경로 인덱싱 적용');
        }
      }
    }

    candidate.reason = reasonParts.join(' • ');
    return candidate;
  }

  function getSelectorCandidates(el) {
    if (!el) return [];
    const results = [];
    const seen = new Set();

    function pushCandidate(candidate) {
      if (!candidate || !candidate.selector) return;
      const type = candidate.type || inferSelectorType(candidate.selector);
      const key = `${type || ''}::${candidate.selector}`;
      if (seen.has(key)) return;
      seen.add(key);
      results.push(candidate);
    }

    try {
      if (el.id) {
        const idCandidate = enrichCandidateWithUniqueness({type:'id', selector:'#'+el.id, score:90, reason:'id 속성'}, {duplicateScore:60, element: el});
        pushCandidate(idCandidate);
      }
      if (el.dataset && el.dataset.testid) {
        const testIdCandidate = enrichCandidateWithUniqueness({type:'data-testid', selector:'[data-testid="'+el.dataset.testid+'"]', score:85, reason:'data-testid 속성'}, {duplicateScore:70, element: el});
        pushCandidate(testIdCandidate);
      }
      const name = el.getAttribute && el.getAttribute('name');
      if (name) {
        const nameCandidate = enrichCandidateWithUniqueness({type:'name', selector:'[name="'+name+'"]', score:80, reason:'name 속성'}, {duplicateScore:65, element: el});
        pushCandidate(nameCandidate);
      }
    } catch(e){}
    if (el.classList && el.classList.length) {
      const cls = Array.from(el.classList).slice(0,3).join('.');
      const classCandidate = enrichCandidateWithUniqueness({type:'class', selector:'.'+cls, score:60, reason:'class 조합'}, {duplicateScore:55, element: el});
      pushCandidate(classCandidate);
    }
    const rawText = (el.innerText||el.textContent||'').trim().split('\n').map(t => t.trim()).filter(Boolean)[0];
    if (rawText) {
      const truncatedText = rawText.slice(0, 60);
      const textCandidate = enrichCandidateWithUniqueness({type:'text', selector:'text="'+escapeAttributeValue(truncatedText)+'"', score:65, reason:'텍스트 일치', textValue: truncatedText}, {duplicateScore:55, element: el});
      if (textCandidate) {
        textCandidate.matchMode = textCandidate.matchMode || 'exact';
        pushCandidate(textCandidate);
      }
    }
    const robustXPath = buildRobustXPath(el);
    if (robustXPath) {
      const robustCandidate = enrichCandidateWithUniqueness({type:'xpath', selector:'xpath='+robustXPath, score:60, reason:'속성 기반 XPath', xpathValue: robustXPath}, {duplicateScore:55, element: el});
      pushCandidate(robustCandidate);
    }
    const fullXPath = buildFullXPath(el);
    if (fullXPath) {
      const fullCandidate = enrichCandidateWithUniqueness({type:'xpath', selector:'xpath='+fullXPath, score:45, reason:'Full XPath (절대 경로)', xpathValue: fullXPath}, {duplicateScore:40, element: el, enableIndexing: false});
      pushCandidate(fullCandidate);
    }
    const tagCandidate = enrichCandidateWithUniqueness({type:'tag', selector:el.tagName.toLowerCase(), score:20, reason:'태그 이름'}, {duplicateScore:30, allowZero:true, element: el});
    pushCandidate(tagCandidate);
    return results;
  }

  function getIframeContext(target) {
    try {
      const win = target && target.ownerDocument && target.ownerDocument.defaultView;
      if (!win) return null;
      const frameEl = win.frameElement || null;
      if (!frameEl) return null;
      return {id: frameEl.id || null, name: frameEl.name || null, src: frameEl.src || (frameEl.getAttribute && frameEl.getAttribute('src')) || null};
    } catch(e){ return null; }
  }

  function serializeEvent(e) {
    const t = e.target;
    const rect = (t && t.getBoundingClientRect)? t.getBoundingClientRect() : {};
    return {
      action: e.type,
      tag: t && t.tagName,
      value: t && (t.value || null),
      selectorCandidates: getSelectorCandidates(t),
      iframeContext: getIframeContext(t),
      timestamp: Date.now(),
      clientRect: {x: Math.round(rect.x||0), y: Math.round(rect.y||0), w: Math.round(rect.width||0), h: Math.round(rect.height||0)}
    };
  }

  function persist(ev) {
    chrome.runtime.sendMessage({type:'SAVE_EVENT', event: ev}, function(resp){});
  }

  // 입력 필드별 디바운스 타이머 저장
  const inputTimers = new WeakMap();
  const INPUT_DEBOUNCE_DELAY = 800; // 800ms 동안 입력이 없으면 기록

  // 녹화 상태 및 하이라이트 관련 변수
  let isRecording = false;
  let currentHighlightedElement = null;
  let overlayElement = null;
  let hoverTimeout = null;
  const elementSelectionState = {
    active: false,
    mode: null, // null | 'root' | 'child'
    currentElement: null,
    parentElement: null,
    highlightInfo: null,
    childFlashTimeout: null
  };

  const overlayControls = {
    container: null,
    handle: null,
    buttons: {},
    status: null,
    dragging: false,
    dragOffsetX: 0,
    dragOffsetY: 0
  };

  function setOverlayStatus(message, tone = 'info') {
    if (!overlayControls.status) return;
    overlayControls.status.textContent = message || '';
    overlayControls.status.setAttribute('data-tone', tone || 'info');
    overlayControls.status.style.display = message ? 'block' : 'none';
  }

  function updateOverlayControlsState() {
    if (!overlayControls.buttons.start || !overlayControls.container) return;
    overlayControls.buttons.start.disabled = !!isRecording;
    overlayControls.buttons.stop.disabled = !isRecording;
    overlayControls.container.toggleAttribute('data-selecting', !!elementSelectionState.mode);
  }

  function saveOverlayPosition(left, top) {
    chrome.storage.local.set({overlayPosition: {left, top}});
  }

  function onOverlayDragMove(event) {
    if (!overlayControls.dragging || !overlayControls.container) return;
    const container = overlayControls.container;
    const width = container.offsetWidth;
    const height = container.offsetHeight;
    let newLeft = event.clientX - overlayControls.dragOffsetX;
    let newTop = event.clientY - overlayControls.dragOffsetY;
    const margin = 8;
    newLeft = Math.max(margin, Math.min(newLeft, window.innerWidth - width - margin));
    newTop = Math.max(margin, Math.min(newTop, window.innerHeight - height - margin));
    container.style.left = `${newLeft}px`;
    container.style.top = `${newTop}px`;
    container.style.right = '';
    container.style.bottom = '';
  }

  function stopOverlayDrag() {
    if (!overlayControls.dragging || !overlayControls.container) return;
    overlayControls.dragging = false;
    document.removeEventListener('mousemove', onOverlayDragMove, true);
    document.removeEventListener('mouseup', stopOverlayDrag, true);
    const rect = overlayControls.container.getBoundingClientRect();
    saveOverlayPosition(rect.left, rect.top);
  }

  function startOverlayDrag(event) {
    if (!overlayControls.container) return;
    const rect = overlayControls.container.getBoundingClientRect();
    overlayControls.dragging = true;
    overlayControls.dragOffsetX = event.clientX - rect.left;
    overlayControls.dragOffsetY = event.clientY - rect.top;
    overlayControls.container.style.left = `${rect.left}px`;
    overlayControls.container.style.top = `${rect.top}px`;
    overlayControls.container.style.right = '';
    overlayControls.container.style.bottom = '';
    document.addEventListener('mousemove', onOverlayDragMove, true);
    document.addEventListener('mouseup', stopOverlayDrag, true);
    event.preventDefault();
  }

  function handleOverlayCommandResponse(command, response) {
    if (!response || response.ok) {
      if (command === 'start_record') {
        setOverlayStatus('녹화를 시작했습니다.', 'success');
      } else if (command === 'stop_record') {
        setOverlayStatus('녹화를 중지했습니다.', 'success');
      } else if (command === 'element_select') {
        setOverlayStatus('요소 선택 모드를 시작합니다. 페이지에서 요소를 클릭하세요.', 'info');
      }
      return;
    }
    const reason = response.reason || 'unknown';
    let message = '요청을 처리할 수 없습니다.';
    if (reason === 'already_recording') {
      message = '이미 녹화 중입니다.';
    } else if (reason === 'no_active_tab') {
      message = '활성 탭을 찾을 수 없습니다.';
    } else if (reason === 'not_recording') {
      message = '현재 녹화 중이 아닙니다.';
    } else if (reason === 'selection_in_progress') {
      message = '이미 요소 선택이 진행 중입니다.';
    } else if (reason === 'parent_not_selected') {
      message = '먼저 부모 요소를 선택하세요.';
    } else if (reason === 'unsupported_action') {
      message = '지원하지 않는 동작입니다.';
    }
    setOverlayStatus(message, 'error');
  }

  function sendOverlayCommand(command, options = {}) {
    chrome.runtime.sendMessage({type: 'OVERLAY_COMMAND', command, options}, (response) => {
      if (chrome.runtime.lastError) {
        setOverlayStatus('DevTools 패널과 통신할 수 없습니다. 패널이 열려 있는지 확인하세요.', 'error');
        return;
      }
      handleOverlayCommandResponse(command, response);
    });
  }

  function createOverlayControls() {
    if (overlayControls.container) return;
    if (window !== window.top) return;
    const container = document.createElement('div');
    container.id = '__ai_test_overlay__';
    container.style.position = 'fixed';
    container.style.right = '24px';
    container.style.bottom = '24px';
    container.style.background = 'rgba(15, 23, 42, 0.65)';
    container.style.backdropFilter = 'blur(12px)';
    container.style.border = '1px solid rgba(255,255,255,0.18)';
    container.style.borderRadius = '12px';
    container.style.padding = '12px';
    container.style.color = '#fff';
    container.style.fontFamily = 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
    container.style.fontSize = '12px';
    container.style.boxShadow = '0 12px 24px rgba(11, 15, 25, 0.35)';
    container.style.zIndex = '2147483646';
    container.style.minWidth = '200px';
    container.style.userSelect = 'none';

    const handle = document.createElement('div');
    handle.textContent = 'Recorder Controls';
    handle.style.display = 'flex';
    handle.style.alignItems = 'center';
    handle.style.justifyContent = 'space-between';
    handle.style.fontWeight = '600';
    handle.style.fontSize = '11px';
    handle.style.textTransform = 'uppercase';
    handle.style.letterSpacing = '0.08em';
    handle.style.marginBottom = '10px';
    handle.style.cursor = 'move';

    const buttonsRow = document.createElement('div');
    buttonsRow.style.display = 'flex';
    buttonsRow.style.gap = '8px';
    buttonsRow.style.flexWrap = 'nowrap';

    const buttonStyle = 'flex:1 1 auto;padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.14);color:#fff;font-size:12px;font-weight:600;cursor:pointer;transition:all 0.2s ease;text-align:center;';

    const startBtn = document.createElement('button');
    startBtn.textContent = 'Start';
    startBtn.style.cssText = buttonStyle;
    startBtn.addEventListener('click', () => {
      setOverlayStatus('녹화를 시작하는 중...', 'info');
      sendOverlayCommand('start_record');
    });

    const stopBtn = document.createElement('button');
    stopBtn.textContent = 'Stop';
    stopBtn.style.cssText = buttonStyle;
    stopBtn.addEventListener('click', () => {
      setOverlayStatus('녹화를 중지하는 중...', 'info');
      sendOverlayCommand('stop_record');
    });

    const selectBtn = document.createElement('button');
    selectBtn.textContent = 'Select';
    selectBtn.style.cssText = buttonStyle;
    selectBtn.addEventListener('click', () => {
      setOverlayStatus('요소 선택 모드를 준비하는 중...', 'info');
      sendOverlayCommand('element_select');
    });

    buttonsRow.appendChild(startBtn);
    buttonsRow.appendChild(stopBtn);
    buttonsRow.appendChild(selectBtn);

    const status = document.createElement('div');
    status.style.marginTop = '10px';
    status.style.fontSize = '11px';
    status.style.padding = '6px 8px';
    status.style.borderRadius = '8px';
    status.style.background = 'rgba(255,255,255,0.12)';
    status.style.display = 'none';

    container.appendChild(handle);
    container.appendChild(buttonsRow);
    container.appendChild(status);

    handle.addEventListener('mousedown', startOverlayDrag, true);

    const observer = new MutationObserver(() => {
      updateOverlayControlsState();
    });
    observer.observe(container, {attributes: true});

    overlayControls.container = container;
    overlayControls.handle = handle;
    overlayControls.buttons = {start: startBtn, stop: stopBtn, select: selectBtn};
    overlayControls.status = status;

    document.body.appendChild(container);

    chrome.storage.local.get({overlayPosition: null}, (data) => {
      const pos = data.overlayPosition;
      if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
        container.style.left = `${pos.left}px`;
        container.style.top = `${pos.top}px`;
        container.style.right = '';
        container.style.bottom = '';
      }
    });

    updateOverlayControlsState();
    setOverlayStatus('', 'info');
  }

  function initOverlayControls() {
    createOverlayControls();
  }

  // 페이지 로드 시 녹화 상태 복원
  chrome.storage.local.get(['recording'], (result) => {
    if (result.recording) {
      isRecording = true;
    }
  });

  // 오버레이 생성
  function createOverlay(rect, selectors) {
    // 기존 오버레이 제거
    if (overlayElement) {
      overlayElement.remove();
    }

    overlayElement = document.createElement('div');
    overlayElement.id = '__ai_test_recorder_overlay__';
    overlayElement.style.cssText = `
      position: fixed;
      z-index: 999999;
      background: rgba(0, 0, 0, 0.85);
      color: white;
      padding: 8px 12px;
      border-radius: 6px;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      pointer-events: none;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      max-width: 300px;
      word-break: break-all;
      line-height: 1.4;
    `;

    // 최상위 셀렉터 표시
    const topSelector = selectors && selectors.length > 0 ? selectors[0] : null;
    if (topSelector) {
      overlayElement.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 4px; color: #4CAF50;">${topSelector.selector}</div>
        <div style="font-size: 10px; color: #aaa;">Score: ${topSelector.score}% • ${topSelector.reason}</div>
        ${selectors.length > 1 ? `<div style="font-size: 10px; color: #888; margin-top: 4px;">+${selectors.length - 1} more</div>` : ''}
      `;
    } else {
      overlayElement.innerHTML = '<div style="color: #ff9800;">No selector found</div>';
    }

    document.body.appendChild(overlayElement);
    
    // 오버레이 위치 계산 (요소 위쪽 또는 아래쪽)
    const overlayHeight = overlayElement.offsetHeight;
    const overlayWidth = overlayElement.offsetWidth;
    const overlayTop = rect.top - overlayHeight - 10;
    const overlayBottom = rect.bottom + 10;
    
    if (overlayTop >= 0) {
      overlayElement.style.top = overlayTop + 'px';
      overlayElement.style.left = rect.left + 'px';
    } else {
      overlayElement.style.top = overlayBottom + 'px';
      overlayElement.style.left = rect.left + 'px';
    }

    // 화면 밖으로 나가지 않도록 조정
    const maxLeft = window.innerWidth - overlayWidth - 10;
    const currentLeft = parseInt(overlayElement.style.left) || 0;
    if (currentLeft > maxLeft) {
      overlayElement.style.left = Math.max(10, maxLeft) + 'px';
    }
    if (currentLeft < 10) {
      overlayElement.style.left = '10px';
    }
  }

  // 요소 하이라이트
  function highlightElement(element) {
    if (!element) return;
    
    // 같은 요소인 경우에도 오버레이 위치 업데이트
    const isSameElement = element === currentHighlightedElement;
    
    // 이전 하이라이트 제거
    if (currentHighlightedElement && !isSameElement) {
      currentHighlightedElement.style.outline = '';
      currentHighlightedElement.style.outlineOffset = '';
    }

    currentHighlightedElement = element;
    element.style.outline = '3px solid #2196F3';
    element.style.outlineOffset = '2px';
    element.style.transition = 'outline 0.1s ease';

    // 셀렉터 추천 가져오기
    const selectors = getSelectorCandidates(element);
    const rect = element.getBoundingClientRect();
    
    // 오버레이 표시 (항상 업데이트)
    createOverlay(rect, selectors);

    // DevTools에 정보 전송 (같은 요소가 아닐 때만)
    if (!isSameElement) {
      chrome.runtime.sendMessage({
        type: 'ELEMENT_HOVERED',
        selectors: selectors,
        element: {
          tag: element.tagName,
          id: element.id || null,
          classes: Array.from(element.classList || [])
        }
      });
    }
  }

  // 하이라이트 제거
  function removeHighlight() {
    if (currentHighlightedElement) {
      currentHighlightedElement.style.outline = '';
      currentHighlightedElement.style.outlineOffset = '';
      currentHighlightedElement = null;
    }
    if (overlayElement) {
      overlayElement.remove();
      overlayElement = null;
    }
  }

  function applySelectionParentHighlight(element) {
    if (!element || element.nodeType !== 1) return;
    if (elementSelectionState.highlightInfo && elementSelectionState.highlightInfo.element !== element) {
      clearSelectionParentHighlight();
    }
    if (!elementSelectionState.highlightInfo) {
      elementSelectionState.highlightInfo = {
        element,
        outline: element.style.outline,
        outlineOffset: element.style.outlineOffset
      };
      element.style.outline = '2px dashed rgba(255,152,0,0.95)';
      element.style.outlineOffset = '2px';
    }
  }

  function clearSelectionParentHighlight() {
    if (elementSelectionState.highlightInfo && elementSelectionState.highlightInfo.element) {
      const {element, outline, outlineOffset} = elementSelectionState.highlightInfo;
      try {
        element.style.outline = outline || '';
        element.style.outlineOffset = outlineOffset || '';
      } catch (e) {}
    }
    elementSelectionState.highlightInfo = null;
  }

  function flashSelectionElement(element, duration = 1500) {
    if (!element || element.nodeType !== 1) return;
    if (elementSelectionState.childFlashTimeout) {
      clearTimeout(elementSelectionState.childFlashTimeout);
      elementSelectionState.childFlashTimeout = null;
    }
    const prev = {
      outline: element.style.outline,
      outlineOffset: element.style.outlineOffset
    };
    element.style.outline = '2px solid rgba(33,150,243,0.9)';
    element.style.outlineOffset = '2px';
    elementSelectionState.childFlashTimeout = setTimeout(() => {
      try {
        element.style.outline = prev.outline || '';
        element.style.outlineOffset = prev.outlineOffset || '';
      } catch (e) {}
      elementSelectionState.childFlashTimeout = null;
    }, duration);
  }

  // 마우스 오버 이벤트 (녹화 중일 때만)
  document.addEventListener('mouseover', function(e) {
    if (!isRecording) return;
    
    // 마우스 아웃 타이머 취소 (다음 요소로 이동하는 경우)
    if (mouseoutTimeout) {
      clearTimeout(mouseoutTimeout);
      mouseoutTimeout = null;
    }
    
    const target = e.target;
    if (!target || target === document.body || target === document.documentElement) {
      removeHighlight();
      return;
    }

    // 오버레이 자체는 무시
    if (target.id === '__ai_test_recorder_overlay__' || target.closest('#__ai_test_recorder_overlay__')) {
      return;
    }

    // 디바운스 적용 (같은 요소가 아닐 때만)
    if (target !== currentHighlightedElement) {
      if (hoverTimeout) {
        clearTimeout(hoverTimeout);
      }

      hoverTimeout = setTimeout(() => {
        highlightElement(target);
      }, 30); // 더 빠른 반응
    } else {
      // 같은 요소인 경우 즉시 위치 업데이트 (스크롤 등으로 위치가 변경될 수 있음)
      const rect = target.getBoundingClientRect();
      if (overlayElement) {
        updateOverlayPosition(rect);
      }
    }
  }, true);

  // 오버레이 위치만 업데이트 (내용은 변경하지 않음)
  function updateOverlayPosition(rect) {
    if (!overlayElement) return;
    
    const overlayHeight = overlayElement.offsetHeight;
    const overlayWidth = overlayElement.offsetWidth;
    const overlayTop = rect.top - overlayHeight - 10;
    const overlayBottom = rect.bottom + 10;
    
    if (overlayTop >= 0) {
      overlayElement.style.top = overlayTop + 'px';
      overlayElement.style.left = rect.left + 'px';
    } else {
      overlayElement.style.top = overlayBottom + 'px';
      overlayElement.style.left = rect.left + 'px';
    }

    // 화면 밖으로 나가지 않도록 조정
    const maxLeft = window.innerWidth - overlayWidth - 10;
    const currentLeft = parseInt(overlayElement.style.left) || 0;
    if (currentLeft > maxLeft) {
      overlayElement.style.left = Math.max(10, maxLeft) + 'px';
    }
    if (currentLeft < 10) {
      overlayElement.style.left = '10px';
    }
  }

  // 마우스 아웃 이벤트
  let mouseoutTimeout = null;
  document.addEventListener('mouseout', function(e) {
    if (!isRecording) return;
    
    if (hoverTimeout) {
      clearTimeout(hoverTimeout);
      hoverTimeout = null;
    }
    
    // 마우스가 오버레이로 이동한 경우는 하이라이트 유지
    const relatedTarget = e.relatedTarget;
    if (relatedTarget && (relatedTarget.id === '__ai_test_recorder_overlay__' || relatedTarget.closest('#__ai_test_recorder_overlay__'))) {
      return;
    }
    
    // 다른 요소로 이동하는 경우 (relatedTarget이 있고 body/documentElement가 아닌 경우)
    if (relatedTarget && relatedTarget !== document.body && relatedTarget !== document.documentElement) {
      // 다음 요소로 이동하는 것이므로 하이라이트 제거하지 않음
      // 마우스 오버 이벤트에서 처리됨
      return;
    }
    
    // 기존 타이머 취소
    if (mouseoutTimeout) {
      clearTimeout(mouseoutTimeout);
    }
    
    // body나 documentElement로 이동하는 경우에만 하이라이트 제거
    // 약간의 지연 후 하이라이트 제거 (오버레이로 이동할 시간을 줌)
    mouseoutTimeout = setTimeout(() => {
      const activeElement = document.elementFromPoint(e.clientX, e.clientY);
      if (!activeElement || 
          activeElement === document.body || 
          activeElement === document.documentElement ||
          (activeElement.id !== '__ai_test_recorder_overlay__' && !activeElement.closest('#__ai_test_recorder_overlay__'))) {
        // 다른 요소로 이동하지 않은 경우에만 하이라이트 제거
        if (activeElement !== currentHighlightedElement && 
            activeElement !== document.body && 
            activeElement !== document.documentElement) {
          removeHighlight();
        }
      }
      mouseoutTimeout = null;
    }, 200);
  }, true);

  // 스크롤 시 오버레이 위치 업데이트
  let scrollTimeout = null;
  window.addEventListener('scroll', function() {
    if (!isRecording || !currentHighlightedElement || !overlayElement) return;
    
    if (scrollTimeout) {
      clearTimeout(scrollTimeout);
    }
    
    scrollTimeout = setTimeout(() => {
      const rect = currentHighlightedElement.getBoundingClientRect();
      updateOverlayPosition(rect);
    }, 50);
  }, true);

  function recordInputEvent(e) {
    try {
      const ev = serializeEvent(e);
      ev.action = 'input';
      persist(ev);
      chrome.runtime.sendMessage({type:'EVENT_RECORDED', event:ev});
    } catch(err){ console.error(err); }
  }

  document.addEventListener('click', function(e){
    if (elementSelectionState.mode) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      const target = e.target;
      if (!target || target === document.body || target === document.documentElement || target.id === '__ai_test_recorder_overlay__' || (target.closest && target.closest('#__ai_test_recorder_overlay__'))) {
        chrome.runtime.sendMessage({
          type: 'ELEMENT_SELECTION_ERROR',
          stage: elementSelectionState.mode === 'child' ? 'child' : 'root',
          reason: '선택할 수 없는 영역입니다. 다른 요소를 선택하세요.'
        });
        return;
      }

      if (elementSelectionState.mode === 'root') {
        elementSelectionState.active = true;
        elementSelectionState.currentElement = target;
        elementSelectionState.parentElement = target;
        applySelectionParentHighlight(target);
        const selectors = (getSelectorCandidates(target) || []).map(c => ({
          ...c,
          relation: c.relation || 'global'
        }));
        chrome.runtime.sendMessage({
          type: 'ELEMENT_SELECTION_PICKED',
          stage: 'root',
          selectors,
          element: {
            tag: target.tagName,
            text: (target.innerText || target.textContent || '').trim().slice(0, 80),
            id: target.id || null,
            classList: Array.from(target.classList || []),
            iframeContext: getIframeContext(target)
          }
        });
        elementSelectionState.mode = null;
        return;
      }

      if (elementSelectionState.mode === 'child') {
        if (!elementSelectionState.parentElement || !elementSelectionState.parentElement.contains(target) || target === elementSelectionState.parentElement) {
          chrome.runtime.sendMessage({
            type: 'ELEMENT_SELECTION_ERROR',
            stage: 'child',
            reason: '선택한 요소가 부모 요소 내부에 있지 않습니다.'
          });
          return;
        }
        elementSelectionState.currentElement = target;
        applySelectionParentHighlight(target);
        const selectors = getChildSelectorCandidates(elementSelectionState.parentElement, target);
        flashSelectionElement(target);
        chrome.runtime.sendMessage({
          type: 'ELEMENT_SELECTION_PICKED',
          stage: 'child',
          selectors,
          element: {
            tag: target.tagName,
            text: (target.innerText || target.textContent || '').trim().slice(0, 80),
            id: target.id || null,
            classList: Array.from(target.classList || []),
            iframeContext: getIframeContext(target)
          }
        });
        elementSelectionState.parentElement = target;
        elementSelectionState.mode = null;
        return;
      }
    }

    if (!isRecording || elementSelectionState.active) return; // 녹화 중이 아니거나 요소 선택 진행 중이면 무시
    try {
      const target = e.target;
      
      // 클릭된 요소를 하이라이트하고 오버레이 표시
      if (target && target !== document.body && target !== document.documentElement) {
        highlightElement(target);
      }
      
      const ev = serializeEvent(e);
      persist(ev);
      chrome.runtime.sendMessage({type:'EVENT_RECORDED', event:ev});
    } catch(err){ console.error(err); }
  }, true);

  ['mousedown','mouseup','pointerdown','pointerup'].forEach(evt => {
    document.addEventListener(evt, function(e) {
      if (!elementSelectionState.mode) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }, true);
  });

  // input 이벤트에 디바운스 적용
  document.addEventListener('input', function(e){
    if (!isRecording) return; // 녹화 중이 아니면 무시
    try {
      const target = e.target;
      // input, textarea 등 입력 가능한 요소만 처리
      if (!target || (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && !target.isContentEditable)) {
        return;
      }

      // 기존 타이머가 있으면 취소
      const existingTimer = inputTimers.get(target);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      // 새 타이머 설정
      const timer = setTimeout(() => {
        recordInputEvent(e);
        inputTimers.delete(target);
      }, INPUT_DEBOUNCE_DELAY);

      inputTimers.set(target, timer);
    } catch(err){ console.error(err); }
  }, true);

  // blur 이벤트: 포커스가 벗어날 때 즉시 기록
  document.addEventListener('blur', function(e){
    if (!isRecording) return; // 녹화 중이 아니면 무시
    try {
      const target = e.target;
      if (!target || (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && !target.isContentEditable)) {
        return;
      }

      const existingTimer = inputTimers.get(target);
      if (existingTimer) {
        clearTimeout(existingTimer);
        inputTimers.delete(target);
        // blur 시 즉시 기록
        recordInputEvent(e);
      }
    } catch(err){ console.error(err); }
  }, true);

  function findElementBySelector(selector) {
    try {
      if (!selector) return null;
      if (selector.startsWith('xpath=')) {
        const xpathExpression = selector.slice(6);
        const result = document.evaluate(xpathExpression, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        return result.singleNodeValue || null;
      }
      if (selector.startsWith('//') || selector.startsWith('(')) {
        const result = document.evaluate(selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        return result.singleNodeValue || null;
      }
      if (selector.startsWith('text="') || selector.startsWith("text='")) {
        const textLiteral = selector.replace(/^text=/, '');
        const trimmed = textLiteral.replace(/^['"]|['"]$/g, '');
        const decoded = trimmed.replace(/\\"/g, '"');
        return Array.from(document.querySelectorAll('*')).find(x => (x.innerText||'').trim().includes(decoded));
      } else if (selector.startsWith('#')) {
        return document.querySelector(selector);
      } else if (selector.startsWith('.')) {
        return document.querySelector(selector);
      } else if (selector.startsWith('[')) {
        return document.querySelector(selector);
      } else {
        // 태그명인 경우
        return document.querySelector(selector);
      }
    } catch(e) {
      return null;
    }
  }

  function inferSelectorType(selector) {
    if (!selector || typeof selector !== 'string') return null;
    const trimmed = selector.trim();
    if (trimmed.startsWith('xpath=')) return 'xpath';
    if (trimmed.startsWith('//') || trimmed.startsWith('(')) return 'xpath';
    if (trimmed.startsWith('text=')) return 'text';
    if (trimmed.startsWith('#') || trimmed.startsWith('.') || trimmed.startsWith('[')) return 'css';
    return 'css';
  }

  function normalizeText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function getChildSelectorCandidates(parent, child) {
    if (!parent || !child) return [];
    const results = [];
    const seen = new Set();

    function pushCandidate(candidate) {
      if (!candidate || !candidate.selector) return;
      const key = (candidate.type || inferSelectorType(candidate.selector)) + '::' + candidate.selector;
      if (seen.has(key)) return;
      seen.add(key);
      results.push(candidate);
    }

    const relativeCss = buildRelativeCssSelector(parent, child);
    if (relativeCss) {
      const cssCandidate = enrichCandidateWithUniqueness({
        type: 'css',
        selector: 'css=' + relativeCss,
        score: 88,
        reason: '부모 요소 기준 CSS 경로',
        relation: 'relative'
      }, {
        skipGlobalCheck: true,
        contextElement: parent,
        contextLabel: '부모',
        duplicateScore: 70,
        element: child
      });
      if (cssCandidate) pushCandidate(cssCandidate);
    }

    const relativeXPath = buildRelativeXPathSelector(parent, child);
    if (relativeXPath) {
      const xpathCandidate = enrichCandidateWithUniqueness({
        type: 'xpath',
        selector: 'xpath=' + relativeXPath,
        score: 85,
        reason: '부모 요소 기준 XPath 경로',
        relation: 'relative',
        xpathValue: relativeXPath
      }, {
        skipGlobalCheck: true,
        contextElement: parent,
        contextLabel: '부모',
        duplicateScore: 68,
        element: child
      });
      if (xpathCandidate) pushCandidate(xpathCandidate);
    }

    const baseCandidates = getSelectorCandidates(child) || [];
    baseCandidates.forEach((cand) => {
      pushCandidate({
        ...cand,
        relation: cand.relation || 'global'
      });
    });

    return results;
  }

  function getParentSelectorCandidates(child, parent) {
    if (!child || !parent) return [];
    const results = [];
    const seen = new Set();

    function pushCandidate(candidate) {
      if (!candidate || !candidate.selector) return;
      const key = (candidate.type || inferSelectorType(candidate.selector)) + '::' + candidate.selector;
      if (seen.has(key)) return;
      seen.add(key);
      results.push(candidate);
    }

    let current = parent;
    let depth = 1;
    while (current && current.nodeType === 1) {
      const steps = Array(depth).fill('..').join('/');
      const candidate = enrichCandidateWithUniqueness({
        type: 'xpath',
        selector: 'xpath=' + steps,
        score: Math.max(70, 82 - (depth - 1) * 5),
        reason: depth === 1 ? '직접 상위 요소' : `${depth}단계 상위 요소`,
        relation: 'relative',
        xpathValue: steps
      }, {
        skipGlobalCheck: true,
        contextElement: child,
        contextLabel: '현재 요소',
        duplicateScore: Math.max(60, 70 - (depth - 1) * 5),
        element: current
      });
      if (candidate) pushCandidate(candidate);
      if (!current.parentElement || current === document.documentElement) {
        break;
      }
      current = current.parentElement;
      depth += 1;
    }

    const parentCandidates = getSelectorCandidates(parent) || [];
    parentCandidates.forEach((cand) => {
      pushCandidate({
        ...cand,
        relation: cand.relation || 'global'
      });
    });

    return results;
  }

  function collectSelectorInfos(ev) {
    const infos = [];
    const seen = new Set();

    function pushInfo(selector, type, extra = {}) {
      if (!selector) return;
      const key = selector + '::' + (type || '');
      if (seen.has(key)) return;
      seen.add(key);
      infos.push({
        selector,
        type: type || inferSelectorType(selector),
        score: extra.score || 0,
        textValue: extra.textValue || null,
        xpathValue: extra.xpathValue || null,
        matchMode: extra.matchMode || null
      });
    }

    if (ev && ev.primarySelector) {
      pushInfo(ev.primarySelector, ev.primarySelectorType || inferSelectorType(ev.primarySelector), {
        score: 100,
        textValue: ev.primarySelectorText || null,
        xpathValue: ev.primarySelectorXPath || null,
        matchMode: ev.primarySelectorMatchMode || null
      });
    }

    if (ev && Array.isArray(ev.selectorCandidates)) {
      const sortedCandidates = [...ev.selectorCandidates].sort((a, b) => (b.score || 0) - (a.score || 0));
      for (const cand of sortedCandidates) {
        if (!cand || !cand.selector) continue;
        pushInfo(cand.selector, cand.type || inferSelectorType(cand.selector), {
          score: cand.score || 0,
          textValue: cand.textValue || null,
          xpathValue: cand.xpathValue || null,
          matchMode: cand.matchMode || null
        });
      }
    }

    if (ev && ev.tag) {
      pushInfo(ev.tag.toLowerCase(), 'tag', {score: 1});
    }

    return infos;
  }

  function findElementWithInfo(info) {
    if (!info) return null;
    const type = info.type || inferSelectorType(info.selector || '');
    if (type === 'text') {
      const targetText = normalizeText(info.textValue) || null;
      if (targetText) {
        const matchMode = info.matchMode || 'contains';
        const match = Array.from(document.querySelectorAll('*')).find(el => {
          const elText = normalizeText(el.innerText || el.textContent || '');
          if (!elText) return false;
          return matchMode === 'exact' ? elText === targetText : elText.includes(targetText);
        });
        if (match) return match;
      }
    }
    if (type === 'xpath') {
      const expression = info.xpathValue || (info.selector || '').replace(/^xpath=/, '');
      if (expression) {
        try {
          const res = document.evaluate(expression, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          if (res.singleNodeValue) return res.singleNodeValue;
        } catch(err) {
          // ignore xpath errors
        }
      }
    }
    return findElementBySelector(info.selector);
  }

  async function locateElementForEvent(ev, timeoutMs = 5000) {
    const infos = collectSelectorInfos(ev);
    if (infos.length === 0) return {element: null, info: null};
    const start = performance.now();
    const retryInterval = 200;
    while (performance.now() - start < timeoutMs) {
      for (const info of infos) {
        const el = findElementWithInfo(info);
        if (el) {
          return {element: el, info};
        }
      }
      await new Promise(r => setTimeout(r, retryInterval));
    }
    // one final attempt before giving up
    for (const info of infos) {
      const el = findElementWithInfo(info);
      if (el) {
        return {element: el, info};
      }
    }
    return {element: null, info: null};
  }

  function findElementInScope(entry, scope) {
    if (!entry || !entry.selector) return null;
    const selector = entry.selector;
    const type = entry.type || inferSelectorType(selector);
    const isRelative = entry.relation === 'relative';
    const currentScope = scope && scope.nodeType === 1 ? scope : document;

    const runGlobal = () => findElementBySelector(selector);

    try {
      if (isRelative && currentScope !== document) {
        if (type === 'xpath' || selector.startsWith('xpath=')) {
          const expression = selector.startsWith('xpath=') ? selector.slice(6) : selector;
          const doc = currentScope.ownerDocument || document;
          const res = doc.evaluate(expression, currentScope, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          return res.singleNodeValue || null;
        }
        if (type === 'text' || selector.startsWith('text=')) {
          const raw = selector.replace(/^text=/, '');
          const trimmed = raw.replace(/^['"]|['"]$/g, '');
          const targetText = normalizeText(trimmed);
          const matchMode = entry.matchMode || 'contains';
          if (!targetText) return null;
          const elements = currentScope.querySelectorAll('*');
          for (const el of elements) {
            const txt = normalizeText(el.innerText || el.textContent || '');
            if (!txt) continue;
            if (matchMode === 'exact' ? txt === targetText : txt.includes(targetText)) {
              return el;
            }
          }
          return null;
        }
        let cssSelector = selector;
        if (cssSelector.startsWith('css=')) {
          cssSelector = cssSelector.slice(4);
        }
        return currentScope.querySelector(cssSelector);
      }
      return runGlobal();
    } catch (err) {
      return null;
    }
  }

  function findElementByPath(path) {
    if (!Array.isArray(path) || path.length === 0) return null;
    let currentElement = null;
    let currentScope = document;
    for (const entry of path) {
      const scope = entry.relation === 'relative' ? (currentElement || currentScope) : document;
      const el = findElementInScope(entry, scope);
      if (!el) return null;
      currentElement = el;
      currentScope = el;
    }
    return currentElement;
  }

  // 탭 업데이트 감지하여 녹화 상태 복원
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'CHECK_RECORDING_STATUS') {
      chrome.storage.local.get(['recording'], (result) => {
        if (result.recording && !isRecording) {
          isRecording = true;
        }
        sendResponse({recording: isRecording});
      });
      return true;
    }
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async ()=>{
      // 녹화 상태 업데이트
      if (msg.type === 'RECORDING_START') {
        isRecording = true;
        // 녹화 상태를 Storage에 저장
        chrome.storage.local.set({recording: true});
        elementSelectionState.mode = null;
        elementSelectionState.active = false;
        elementSelectionState.parentElement = null;
        elementSelectionState.currentElement = null;
        clearSelectionParentHighlight();
        if (elementSelectionState.childFlashTimeout) {
          clearTimeout(elementSelectionState.childFlashTimeout);
          elementSelectionState.childFlashTimeout = null;
        }
        sendResponse({ok: true});
        return;
      }
      if (msg.type === 'RECORDING_STOP') {
        isRecording = false;
        // 녹화 상태를 Storage에서 제거
        chrome.storage.local.remove(['recording']);
        removeHighlight();
        elementSelectionState.mode = null;
        elementSelectionState.active = false;
        elementSelectionState.parentElement = null;
        elementSelectionState.currentElement = null;
        clearSelectionParentHighlight();
        if (elementSelectionState.childFlashTimeout) {
          clearTimeout(elementSelectionState.childFlashTimeout);
          elementSelectionState.childFlashTimeout = null;
        }
        // 모든 대기 중인 타이머 취소
        inputTimers.forEach((timer, target) => {
          clearTimeout(timer);
          inputTimers.delete(target);
        });
        sendResponse({ok: true});
        return;
      }

      if (msg.type === 'ELEMENT_SELECTION_START') {
        elementSelectionState.active = true;
        elementSelectionState.mode = 'root';
        elementSelectionState.parentElement = null;
        elementSelectionState.currentElement = null;
        clearSelectionParentHighlight();
        if (elementSelectionState.childFlashTimeout) {
          clearTimeout(elementSelectionState.childFlashTimeout);
          elementSelectionState.childFlashTimeout = null;
        }
        sendResponse({ok: true});
        return;
      }

      if (msg.type === 'ELEMENT_SELECTION_PICK_CHILD') {
        if (!elementSelectionState.active || !elementSelectionState.currentElement) {
          sendResponse({ok: false, reason: 'parent_not_selected'});
          return;
        }
        elementSelectionState.mode = 'child';
        elementSelectionState.parentElement = elementSelectionState.currentElement;
        applySelectionParentHighlight(elementSelectionState.parentElement);
        sendResponse({ok: true});
        return;
      }

      if (msg.type === 'ELEMENT_SELECTION_PICK_PARENT') {
        if (!elementSelectionState.active || !elementSelectionState.currentElement) {
          sendResponse({ok: false, reason: 'current_not_selected'});
          return;
        }
        let current = elementSelectionState.currentElement;
        let parent = current ? current.parentElement : null;
        while (parent && parent.nodeType !== 1) {
          parent = parent.parentElement;
        }
        if (!parent) {
          sendResponse({ok: false, reason: 'no_parent'});
          return;
        }
        elementSelectionState.currentElement = parent;
        elementSelectionState.parentElement = parent;
        elementSelectionState.mode = null;
        applySelectionParentHighlight(parent);
        flashSelectionElement(parent);
        const selectors = getParentSelectorCandidates(current, parent);
        chrome.runtime.sendMessage({
          type: 'ELEMENT_SELECTION_PICKED',
          stage: 'parent',
          selectors,
          element: {
            tag: parent.tagName,
            text: (parent.innerText || parent.textContent || '').trim().slice(0, 80),
            id: parent.id || null,
            classList: Array.from(parent.classList || []),
            iframeContext: getIframeContext(parent)
          }
        });
        sendResponse({ok: true});
        return;
      }

      if (msg.type === 'ELEMENT_SELECTION_CANCEL') {
        elementSelectionState.mode = null;
        elementSelectionState.active = false;
        elementSelectionState.parentElement = null;
        elementSelectionState.currentElement = null;
        clearSelectionParentHighlight();
        if (elementSelectionState.childFlashTimeout) {
          clearTimeout(elementSelectionState.childFlashTimeout);
          elementSelectionState.childFlashTimeout = null;
        }
        sendResponse({ok: true});
        chrome.runtime.sendMessage({type: 'ELEMENT_SELECTION_CANCELLED'});
        return;
      }

      if (msg.type === 'ELEMENT_SELECTION_EXECUTE') {
        const path = msg.path || [];
        const action = msg.action || '';
        const target = findElementByPath(path);
        if (!target) {
          sendResponse({ok: false, reason: 'not_found'});
          return;
        }
        if (action === 'click') {
          try {
            target.scrollIntoView({behavior: 'smooth', block: 'center'});
            setTimeout(() => {
              try {
                target.focus({preventScroll: true});
              } catch (focusErr) {
                try { target.focus(); } catch (focusErr2) {}
              }
              const style = window.getComputedStyle(target);
              if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                sendResponse({ok: false, reason: 'element_not_visible'});
                return;
              }
              if (target.disabled) {
                sendResponse({ok: false, reason: 'element_disabled'});
                return;
              }
              try {
                target.dispatchEvent(new MouseEvent('mouseover', {bubbles: true}));
                target.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
                target.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
                target.dispatchEvent(new MouseEvent('click', {bubbles: true}));
              } catch (dispatchErr) {
                sendResponse({ok: false, reason: dispatchErr.message || 'click_dispatch_failed'});
                return;
              }
              sendResponse({ok: true});
            }, 120);
          } catch (err) {
            sendResponse({ok: false, reason: err.message || 'click_failed'});
          }
        } else {
          sendResponse({ok: false, reason: 'unsupported_action'});
        }
        return true;
      }

      if (msg.type === 'REPLAY_EXECUTE_STEP') {
        const { event: ev, index = 0, total = 0 } = msg;
        (async () => {
          const {element, info} = await locateElementForEvent(ev, msg.timeoutMs || 6000);
          if (!element) {
            chrome.runtime.sendMessage({
              type: 'REPLAY_STEP_RESULT',
              ok: false,
              reason: 'not_found',
              stepIndex: index,
              total,
              selector: info && info.selector ? info.selector : (ev && ev.primarySelector) || null,
              ev
            });
            sendResponse({ok:false, reason:'not_found'});
            return;
          }

          let navigationTriggered = false;
          const beforeUnloadHandler = () => {
            navigationTriggered = true;
          };
          window.addEventListener('beforeunload', beforeUnloadHandler);

          const originalOutline = element.style.outline;
          const originalOutlineOffset = element.style.outlineOffset;
          let success = false;
          let failureReason = '';
          let extractedValue;
          let manualActionType = ev && ev.manualActionType ? ev.manualActionType : null;
          let manualAttributeName = ev && ev.manualAttribute ? ev.manualAttribute : null;

          try {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await new Promise(r => setTimeout(r, 200));
            try {
              element.focus({ preventScroll: true });
            } catch (focusErr) {
              try {
                element.focus();
              } catch (focusErr2) {
                // ignore
              }
            }
            element.style.outline = '3px solid rgba(0,150,136,0.6)';
            element.style.outlineOffset = '2px';

            if (ev.action === 'click') {
              const style = window.getComputedStyle(element);
              if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                throw new Error('element not visible');
              }
              if (element.disabled) {
                throw new Error('element disabled');
              }
              element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
              element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
              element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
              element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            } else if (ev.action === 'input') {
              const valueToSet = ev.value || '';
              if ('value' in element) {
                element.value = valueToSet;
              } else if (element.isContentEditable) {
                element.textContent = valueToSet;
              }
              element.dispatchEvent(new Event('input', { bubbles: true }));
              element.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (ev.action === 'manual_extract_text') {
              extractedValue = element.innerText || element.textContent || '';
              manualActionType = 'extract_text';
            } else if (ev.action === 'manual_get_attribute') {
              const attrName = manualAttributeName || ev.manualAttribute || ev.attributeName || '';
              manualAttributeName = attrName;
              extractedValue = attrName ? element.getAttribute(attrName) : null;
              manualActionType = 'get_attribute';
            } else {
              throw new Error('unsupported action');
            }

            success = true;
          } catch (err) {
            failureReason = err && err.message ? err.message : 'unknown error';
          } finally {
            window.removeEventListener('beforeunload', beforeUnloadHandler);
            try {
              element.style.outline = originalOutline;
              element.style.outlineOffset = originalOutlineOffset;
            } catch (e) {
              // ignore style cleanup errors (element might be detached)
            }
          }

          const usedSelector = info && info.selector ? info.selector : (ev && ev.primarySelector) || (ev && ev.tag ? ev.tag.toLowerCase() : null);
          const payload = {
            type: 'REPLAY_STEP_RESULT',
            ok: success,
            reason: success ? undefined : failureReason,
            used: element && element.tagName,
            selector: usedSelector,
            stepIndex: index,
            total,
            navigation: navigationTriggered,
            ev,
            manualActionType: manualActionType || undefined,
            manualActionId: ev && ev.manualActionId ? ev.manualActionId : undefined,
            value: extractedValue,
            attributeName: manualAttributeName || undefined,
            resultName: ev && ev.manualResultName ? ev.manualResultName : undefined
          };
          chrome.runtime.sendMessage(payload);

          if (success) {
            sendResponse({ok:true, navigation: navigationTriggered, value: extractedValue});
          } else {
            sendResponse({ok:false, reason: failureReason});
          }
        })();
        return true;
      }
    })();
    return true;
  });
})();