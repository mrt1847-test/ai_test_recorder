(function(){
  if (window.__ai_test_recorder_loaded) return;
  window.__ai_test_recorder_loaded = true;

  function getSelectorCandidates(el) {
    if (!el) return [];
    const c = [];
    try {
      if (el.id) c.push({type:'id', selector:'#'+el.id, score:90, reason:'id exists'});
      if (el.dataset && el.dataset.testid) c.push({type:'data-testid', selector:'[data-testid="'+el.dataset.testid+'"]', score:85, reason:'data-testid'});
      const name = el.getAttribute && el.getAttribute('name');
      if (name) c.push({type:'name', selector:'[name="'+name+'"]', score:80, reason:'name attr'});
    } catch(e){}
    if (el.classList && el.classList.length) {
      const cls = Array.from(el.classList).slice(0,3).join('.');
      c.push({type:'class', selector:'.'+cls, score:60, reason:'class combo'});
    }
    const txt = (el.innerText||el.textContent||'').trim().split('\n')[0].trim();
    if (txt) c.push({type:'text', selector:'text="'+txt.slice(0,60)+'"', score:50, reason:'visible text'});
    c.push({type:'tag', selector:el.tagName.toLowerCase(), score:20, reason:'tag name'});
    return c;
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
    if (!element || element === currentHighlightedElement) return;
    
    // 이전 하이라이트 제거
    if (currentHighlightedElement) {
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
    
    // 오버레이 표시
    createOverlay(rect, selectors);

    // DevTools에 정보 전송
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

  // 마우스 오버 이벤트 (녹화 중일 때만)
  document.addEventListener('mouseover', function(e) {
    if (!isRecording) return;
    
    const target = e.target;
    if (!target || target === document.body || target === document.documentElement) {
      removeHighlight();
      return;
    }

    // 오버레이 자체는 무시
    if (target.id === '__ai_test_recorder_overlay__' || target.closest('#__ai_test_recorder_overlay__')) {
      return;
    }

    // 디바운스 적용
    if (hoverTimeout) {
      clearTimeout(hoverTimeout);
    }

    hoverTimeout = setTimeout(() => {
      highlightElement(target);
    }, 100);
  }, true);

  // 마우스 아웃 이벤트
  document.addEventListener('mouseout', function(e) {
    if (!isRecording) return;
    
    if (hoverTimeout) {
      clearTimeout(hoverTimeout);
    }
    
    // 마우스가 오버레이로 이동한 경우는 하이라이트 유지
    const relatedTarget = e.relatedTarget;
    if (relatedTarget && (relatedTarget.id === '__ai_test_recorder_overlay__' || relatedTarget.closest('#__ai_test_recorder_overlay__'))) {
      return;
    }
    
    // 약간의 지연 후 하이라이트 제거 (오버레이로 이동할 시간을 줌)
    setTimeout(() => {
      const activeElement = document.elementFromPoint(e.clientX, e.clientY);
      if (!activeElement || (activeElement.id !== '__ai_test_recorder_overlay__' && !activeElement.closest('#__ai_test_recorder_overlay__'))) {
        removeHighlight();
      }
    }, 100);
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
    if (!isRecording) return; // 녹화 중이 아니면 무시
    try {
      const ev = serializeEvent(e);
      persist(ev);
      chrome.runtime.sendMessage({type:'EVENT_RECORDED', event:ev});
    } catch(err){ console.error(err); }
  }, true);

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
      if (selector.startsWith('text="')) {
        const txt = selector.slice(6, -1);
        return Array.from(document.querySelectorAll('*')).find(x => (x.innerText||'').trim().includes(txt));
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

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async ()=>{
      // 녹화 상태 업데이트
      if (msg.type === 'RECORDING_START') {
        isRecording = true;
        sendResponse({ok: true});
        return;
      }
      if (msg.type === 'RECORDING_STOP') {
        isRecording = false;
        removeHighlight();
        // 모든 대기 중인 타이머 취소
        inputTimers.forEach((timer, target) => {
          clearTimeout(timer);
          inputTimers.delete(target);
        });
        sendResponse({ok: true});
        return;
      }

      if (msg.type === 'REPLAY_START') {
        const events = msg.events || [];
        for (let i = 0; i < events.length; i++) {
          const ev = events[i];
          let found = null;
          let usedSelector = null;
          
          // 1. primarySelector를 우선적으로 사용
          if (ev.primarySelector) {
            found = findElementBySelector(ev.primarySelector);
            if (found) {
              usedSelector = ev.primarySelector;
            }
          }
          
          // 2. primarySelector가 없거나 찾지 못한 경우 selectorCandidates 시도
          if (!found && ev.selectorCandidates && ev.selectorCandidates.length > 0) {
            // 점수가 높은 순서대로 정렬
            const sortedCandidates = [...ev.selectorCandidates].sort((a, b) => (b.score || 0) - (a.score || 0));
            
            for (const c of sortedCandidates) {
              if (!c.selector) continue;
              found = findElementBySelector(c.selector);
              if (found) {
                usedSelector = c.selector;
                break;
              }
            }
          }
          
          // 3. 여전히 찾지 못한 경우 태그명으로 시도
          if (!found && ev.tag) {
            const tagElements = document.querySelectorAll(ev.tag.toLowerCase());
            if (tagElements.length > 0) {
              // 같은 위치에 있는 요소 찾기 (대략적인 위치 비교)
              if (ev.clientRect) {
                for (const el of tagElements) {
                  const rect = el.getBoundingClientRect();
                  const distance = Math.abs(rect.x - ev.clientRect.x) + Math.abs(rect.y - ev.clientRect.y);
                  if (distance < 100) { // 100px 이내
                    found = el;
                    usedSelector = ev.tag.toLowerCase();
                    break;
                  }
                }
              }
              // 위치로 찾지 못하면 첫 번째 요소 사용
              if (!found && tagElements.length === 1) {
                found = tagElements[0];
                usedSelector = ev.tag.toLowerCase();
              }
            }
          }
          
          if (!found) {
            chrome.runtime.sendMessage({
              type: 'REPLAY_STEP_RESULT',
              ok: false,
              reason: 'not_found',
              step: i + 1,
              total: events.length,
              ev
            });
            continue;
          }
          
          // 요소 강조 표시
          found.style.outline = '3px solid rgba(0,150,136,0.6)';
          found.style.outlineOffset = '2px';
          await new Promise(r=>setTimeout(r, 500));
          
          // 액션 실행
          try {
            if (ev.action === 'click') {
              found.scrollIntoView({ behavior: 'smooth', block: 'center' });
              await new Promise(r=>setTimeout(r, 300));
              found.click();
            } else if (ev.action === 'input') {
              found.scrollIntoView({ behavior: 'smooth', block: 'center' });
              await new Promise(r=>setTimeout(r, 300));
              found.focus();
              found.value = ev.value || '';
              // input 이벤트 발생
              found.dispatchEvent(new Event('input', {bubbles: true}));
              found.dispatchEvent(new Event('change', {bubbles: true}));
            }
          } catch(e) {
            console.error('Replay action error:', e);
            chrome.runtime.sendMessage({
              type: 'REPLAY_STEP_RESULT',
              ok: false,
              reason: 'action_failed: ' + e.message,
              step: i + 1,
              total: events.length,
              ev
            });
            found.style.outline = '';
            continue;
          }
          
          // 강조 표시 제거
          found.style.outline = '';
          await new Promise(r=>setTimeout(r, 300));
          
          chrome.runtime.sendMessage({
            type: 'REPLAY_STEP_RESULT',
            ok: true,
            used: found.tagName,
            selector: usedSelector,
            step: i + 1,
            total: events.length,
            ev
          });
        }
        chrome.runtime.sendMessage({type:'REPLAY_FINISHED'});
        sendResponse({ok:true});
      }
    })();
    return true;
  });
})();