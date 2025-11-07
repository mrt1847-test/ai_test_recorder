const startBtn = document.getElementById('start-record');
const stopBtn = document.getElementById('stop-record');
const timeline = document.getElementById('timeline');
const selectorList = document.getElementById('selector-list');
const iframeBanner = document.getElementById('iframe-banner');
const codeOutput = document.getElementById('code-output');
const logEntries = document.getElementById('log-entries');
const resetBtn = document.getElementById('reset-btn');
const elementSelectBtn = document.getElementById('element-select-btn');
const elementPanel = document.getElementById('element-panel');
const elementStatusEl = document.getElementById('element-status');
const elementPathContainer = document.getElementById('element-path');
const elementPathItems = document.getElementById('element-path-items');
const elementCandidatesContainer = document.getElementById('element-candidates');
const elementActionsContainer = document.getElementById('element-actions');
const elementAttrPanel = document.getElementById('element-attribute-panel');
const elementAttrNameInput = document.getElementById('element-attr-name');
const elementAttrApplyBtn = document.getElementById('element-attr-apply');
const elementCodePreview = document.getElementById('element-code-preview');
const elementCodeEl = document.getElementById('element-code');
const elementCancelBtn = document.getElementById('element-cancel-btn');
let recording = false;
let selectedFramework = 'playwright';
let selectedLanguage = 'python';
let currentEventIndex = -1; // 현재 선택된 이벤트 인덱스
let allEvents = []; // 모든 이벤트 저장
let runtimeListenerRegistered = false;
let replayState = {
  running: false,
  events: [],
  index: 0,
  tabId: null,
  pending: false,
  awaitingNavigation: false,
  awaitingContent: false,
  navigationGuard: null,
  scheduledTimer: null
};
let replayTabListenerRegistered = false;

const STEP_DELAY_MS = 150;
const NAVIGATION_RECOVERY_DELAY_MS = 800;
const DOM_COMPLETE_DELAY_MS = 250;
const MAX_NAVIGATION_WAIT_MS = 15000;
const EVENT_SCHEMA_VERSION = 2;

function normalizeEventRecord(event) {
  if (!event || typeof event !== 'object') return event;
  if (!event.version) {
    event.version = 1;
  }
  if (!event.metadata) {
    event.metadata = { schemaVersion: event.version };
  } else if (event.metadata.schemaVersion === undefined) {
    event.metadata.schemaVersion = event.version;
  }
  if (event.page === undefined) {
    event.page = null;
  }
  if (event.frame === undefined && event.iframeContext) {
    event.frame = { iframeContext: event.iframeContext };
  }
  if (event.manual === true) {
    event.manual = {
      id: event.manualActionId || null,
      type: event.manualActionType || null,
      resultName: event.manualResultName || null,
      attributeName: event.manualAttribute || null
    };
  }
  return event;
}

function normalizeRequestedUrl(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (/^\/\//.test(trimmed)) {
    return 'https:' + trimmed;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return trimmed;
  }
  return 'https://' + trimmed;
}

const selectionState = {
  active: false,
  stage: 'idle', // idle | await-root | await-candidate | await-action | await-child
  stack: [],
  pendingAction: null,
  pendingAttribute: '',
  codePreview: ''
};
let manualActions = [];
let manualActionSerial = 1;

function withActiveTab(callback) {
  chrome.tabs.query({active:true, currentWindow:true}, (tabs) => {
    if (tabs && tabs[0]) {
      callback(tabs[0]);
    } else {
      callback(null);
    }
  });
}

function triggerStartRecording(options = {}, callback) {
  const source = options.source || 'panel';
  if (recording) {
    if (typeof callback === 'function') callback({ok: false, reason: 'already_recording'});
    return;
  }
  const urlInput = document.getElementById('test-url');
  const rawUrl = options.url !== undefined ? options.url : (urlInput ? urlInput.value : '');
  const requestedUrl = normalizeRequestedUrl(rawUrl);
  if (urlInput && requestedUrl && urlInput.value !== requestedUrl) {
    urlInput.value = requestedUrl;
  }

  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    if (!tabs || !tabs[0]) {
      if (typeof callback === 'function') callback({ok: false, reason: 'no_active_tab'});
      if (source === 'panel') {
      alert('활성 탭을 찾을 수 없습니다.');
      }
      return;
    }
    const currentTab = tabs[0];
    
    const beginRecording = () => {
    recording = true;
      if (startBtn) startBtn.disabled = true;
      if (stopBtn) stopBtn.disabled = false;
      chrome.storage.local.set({events: [], recording: true});
    allEvents = [];
    timeline.innerHTML = '';
    selectorList.innerHTML = '';
    if (codeOutput) codeOutput.value = '';
      logEntries.innerHTML = '';
    currentEventIndex = -1;
    listenEvents();
    
      chrome.tabs.sendMessage(currentTab.id, {type: 'RECORDING_START'}, () => {
          if (chrome.runtime.lastError) {
          const tabId = currentTab.id;
          const onUpdated = (updatedTabId, changeInfo) => {
              if (updatedTabId === tabId && changeInfo.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(onUpdated);
                chrome.tabs.sendMessage(tabId, {type: 'RECORDING_START'});
              }
            };
            chrome.tabs.onUpdated.addListener(onUpdated);
          }
        });

      if (typeof callback === 'function') callback({ok: true});
    };

    if (requestedUrl) {
      chrome.tabs.update(currentTab.id, {url: requestedUrl}, () => {
        setTimeout(beginRecording, 1000);
      });
    } else {
      beginRecording();
    }
  });
}

function triggerStopRecording(options = {}, callback) {
  if (!recording) {
    if (typeof callback === 'function') callback({ok: false, reason: 'not_recording'});
    return;
  }
  recording = false;
  if (startBtn) startBtn.disabled = false;
  if (stopBtn) stopBtn.disabled = true;
  chrome.storage.local.remove(['recording']);
  
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, {type: 'RECORDING_STOP'}, () => {});
    });
  });

  loadTimeline();
  if (typeof callback === 'function') callback({ok: true});
}

function handleOverlayCommand(msg, sendResponse) {
  const command = msg && msg.command;
  if (command === 'start_record') {
    triggerStartRecording({source: 'overlay'}, (result) => {
      sendResponse(result || {ok: true});
    });
    return true;
  }
  if (command === 'stop_record') {
    triggerStopRecording({source: 'overlay'}, (result) => {
      sendResponse(result || {ok: true});
    });
    return true;
  }
  if (command === 'element_select') {
    if (selectionState.active) {
      sendResponse({ok: false, reason: 'selection_in_progress'});
    } else {
      startSelectionWorkflow();
      sendResponse({ok: true});
    }
    return false;
  }
  sendResponse({ok: false, reason: 'unknown_command'});
  return false;
}

// 프레임워크와 언어 선택 드롭다운
const frameworkSelect = document.getElementById('framework-select');
const languageSelect = document.getElementById('language-select');

// 프레임워크 변경 이벤트
frameworkSelect.addEventListener('change', (e) => {
  selectedFramework = e.target.value;
  updateCode(); // 실시간 코드 업데이트
  updateSelectionCodePreview();
});

// 언어 변경 이벤트
languageSelect.addEventListener('change', (e) => {
  selectedLanguage = e.target.value;
  updateCode(); // 실시간 코드 업데이트
  updateSelectionCodePreview();
});

startBtn.addEventListener('click', ()=>{
  triggerStartRecording({source: 'panel'}, (result) => {
    if (!result || result.ok) return;
    if (result.reason === 'no_active_tab') {
      alert('활성 탭을 찾을 수 없습니다.');
    }
  });
});

stopBtn.addEventListener('click', ()=>{
  triggerStopRecording({source: 'panel'});
});

resetBtn.addEventListener('click', () => {
  // 전체 삭제
  chrome.storage.local.clear(() => {
    recording = false;
    allEvents = [];
    timeline.innerHTML = '';
    selectorList.innerHTML = '';
    if (codeOutput) codeOutput.value = '';
    logEntries.innerHTML = '';
    currentEventIndex = -1;
    // 모든 탭에 녹화 중지 메시지 전송
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {type: 'RECORDING_STOP'}, () => {});
      });
    });
    manualActions = [];
    manualActionSerial = 1;
    persistManualActions(manualActions, () => {
      updateCode();
    });
    cancelSelectionWorkflow('요소 선택 흐름이 초기화되었습니다.', 'info');
  });
});

listenEvents();
updateCode();
loadTimeline();

if (elementSelectBtn) {
  elementSelectBtn.addEventListener('click', () => {
    if (selectionState.active) {
      cancelSelectionWorkflow('요소 선택을 취소했습니다.');
    } else {
      startSelectionWorkflow();
    }
  });
}

if (elementCancelBtn) {
  elementCancelBtn.addEventListener('click', () => {
    cancelSelectionWorkflow('사용자 요청으로 취소되었습니다.');
  });
}

if (elementActionsContainer) {
  elementActionsContainer.addEventListener('click', (event) => {
    const button = event.target && event.target.closest('button[data-action]');
    if (!button) return;
    const action = button.getAttribute('data-action');
    handleElementAction(action);
  });
}

if (elementAttrApplyBtn) {
  elementAttrApplyBtn.addEventListener('click', () => {
    const attrName = elementAttrNameInput ? elementAttrNameInput.value.trim() : '';
    selectionState.pendingAttribute = attrName;
    applySelectionAction('get_attribute', {attributeName: attrName});
  });
}

if (elementAttrNameInput) {
  elementAttrNameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (elementAttrApplyBtn) {
        elementAttrApplyBtn.click();
      }
    }
  });
}

function loadTimeline() {
  chrome.runtime.sendMessage({type:'GET_EVENTS'}, (res) => {
    allEvents = (res && res.events || []).map((ev) => normalizeEventRecord(ev));
    timeline.innerHTML = '';
    allEvents.forEach((ev, index) => {
      appendTimelineItem(ev, index);
    });
    // 마지막 이벤트 자동 선택
    if (allEvents.length > 0) {
      currentEventIndex = allEvents.length - 1;
      const lastItem = document.querySelector(`[data-event-index="${currentEventIndex}"]`);
      if (lastItem) {
        lastItem.classList.add('selected');
        showSelectors(allEvents[currentEventIndex].selectorCandidates || [], allEvents[currentEventIndex], currentEventIndex);
        showIframe(allEvents[currentEventIndex].iframeContext);
      }
    }
    updateCode();
  });
}

function listenEvents() {
  if (runtimeListenerRegistered) return;
  chrome.runtime.onMessage.addListener(function handler(msg, sender, sendResponse) {
    if (msg.type === 'OVERLAY_COMMAND') {
      const handledAsync = handleOverlayCommand(msg, sendResponse);
      return handledAsync;
    }
    if (msg.type === 'EVENT_RECORDED') {
      const normalizedEvent = normalizeEventRecord(msg.event);
      allEvents.push(normalizedEvent);
      const index = allEvents.length - 1;
      appendTimelineItem(normalizedEvent, index);
      // 자동으로 마지막 이벤트 선택
      currentEventIndex = index;
      document.querySelectorAll('.timeline-item').forEach(item => item.classList.remove('selected'));
      const lastItem = document.querySelector(`[data-event-index="${index}"]`);
      if (lastItem) {
        lastItem.classList.add('selected');
      }
      showSelectors(normalizedEvent.selectorCandidates || [], normalizedEvent, index);
      showIframe(normalizedEvent.iframeContext);
      // 실시간 코드 업데이트
      updateCode();
    }
    if (msg.type === 'ELEMENT_HOVERED') {
      // 마우스 오버 시 DevTools에 셀렉터 정보 표시
      if (msg.selectors && msg.selectors.length > 0) {
        showSelectors(msg.selectors, null, -1);
      }
    }
    if (msg.type === 'ELEMENT_SELECTION_PICKED') {
      handleElementSelectionPicked(msg);
    }
    if (msg.type === 'ELEMENT_SELECTION_ERROR') {
      handleElementSelectionError(msg);
    }
    if (msg.type === 'ELEMENT_SELECTION_CANCELLED') {
      handleElementSelectionCancelled(msg);
    }
    if (msg.type === 'REPLAY_STEP_RESULT') {
      const div = document.createElement('div');
      div.style.padding = '4px 8px';
      div.style.margin = '2px 0';
      div.style.borderRadius = '4px';
      const indexLabel = (msg.stepIndex !== undefined ? msg.stepIndex + 1 : msg.step || '?');
      const totalLabel = msg.total || '?';
      if (msg.ok) {
        div.style.background = '#e8f5e9';
        div.style.color = '#2e7d32';
        const detailParts = [];
        if (msg.used) {
          detailParts.push(msg.used);
        }
        if (msg.selector) {
          detailParts.push(`(${msg.selector})`);
        }
        if (msg.manualActionType === 'extract_text' && msg.value !== undefined && msg.value !== null) {
          detailParts.push(`text="${msg.value}"`);
        }
        if (msg.manualActionType === 'get_attribute') {
          const attrLabel = msg.attributeName || 'attr';
          detailParts.push(`${attrLabel}="${msg.value ?? ''}"`);
        }
        const detailText = detailParts.length ? ` - ${detailParts.join(' ')}` : '';
        div.textContent = `[${indexLabel}/${totalLabel}] ✓ OK${detailText}`;
      } else {
        div.style.background = '#ffebee';
        div.style.color = '#c62828';
        const detailParts = [];
        if (msg.manualActionType === 'get_attribute' && msg.attributeName) {
          detailParts.push(`attr=${msg.attributeName}`);
        }
        if (msg.selector) {
          detailParts.push(`selector=${msg.selector}`);
        }
        const detailText = detailParts.length ? ` (${detailParts.join(', ')})` : '';
        div.textContent = `[${indexLabel}/${totalLabel}] ✗ FAIL - ${msg.reason || 'unknown error'}${detailText}`;
      }
      logEntries.appendChild(div);
      // 자동 스크롤
      logEntries.scrollTop = logEntries.scrollHeight;
      handleReplayStepResult(msg);
    }
    if (msg.type === 'REPLAY_FINISHED') {
      const d = document.createElement('div');
      d.textContent = '✓ 리플레이 완료';
      d.style.color = '#2196f3';
      d.style.fontWeight = 'bold';
      d.style.padding = '8px';
      d.style.marginTop = '8px';
      d.style.borderTop = '1px solid #ddd';
      logEntries.appendChild(d);
      logEntries.scrollTop = logEntries.scrollHeight;
    }
  });
  runtimeListenerRegistered = true;
}

function appendTimelineItem(ev, index) {
  const div = document.createElement('div');
  div.className = 'timeline-item';
  div.dataset.eventIndex = index;
  const usedSelector = ev.primarySelector || (ev.selectorCandidates && ev.selectorCandidates[0] && ev.selectorCandidates[0].selector) || ev.tag;
  div.textContent = new Date(ev.timestamp).toLocaleTimeString() + ' - ' + ev.action + ' - ' + usedSelector;
  div.style.cursor = 'pointer';
  div.addEventListener('click', () => {
    // 이전 선택 해제
    document.querySelectorAll('.timeline-item').forEach(item => item.classList.remove('selected'));
    // 현재 선택
    div.classList.add('selected');
    currentEventIndex = index;
      // 해당 이벤트의 셀렉터 표시
      showSelectors(ev.selectorCandidates || [], ev, index);
      showIframe(ev.iframeContext);
  });
  timeline.appendChild(div);
}

function showSelectors(list, event, eventIndex) {
  selectorList.innerHTML = '';
  if (!list || list.length === 0) {
    selectorList.innerHTML = '<div style="padding: 10px; color: #666;">셀렉터 후보가 없습니다.</div>';
    return;
  }
  const idx = eventIndex !== undefined ? eventIndex : (event ? allEvents.indexOf(event) : currentEventIndex);
  list.forEach((s, listIndex) => {
    const item = document.createElement('div');
    item.className = 'selector-item';
    const selectorType = s.type || inferSelectorType(s.selector);
    const candidateMatchMode = s.matchMode || (selectorType === 'text' ? 'exact' : null);
    const primaryMatchMode = event && event.primarySelectorMatchMode ? event.primarySelectorMatchMode : (selectorType === 'text' ? 'exact' : null);
    const isApplied = event && event.primarySelector === s.selector && (event.primarySelectorType ? event.primarySelectorType === selectorType : true) && (selectorType !== 'text' || candidateMatchMode === primaryMatchMode);
    const scoreLabel = typeof s.score === 'number' ? `${s.score}%` : '';
    const typeLabel = (selectorType || 'css').toUpperCase();
    item.innerHTML = `
      <div class="selector-main">
        <span class="type">${typeLabel}</span>
        <span class="sel">${s.selector}</span>
        <span class="score">${scoreLabel}</span>
      </div>
      <div class="selector-actions">
        <button class="apply-btn" ${isApplied ? 'style="background: #4CAF50; color: white;"' : ''}>${isApplied ? '✓ 적용됨' : 'Apply'}</button>
        <button class="highlight-btn">Highlight</button>
      </div>
      <div class="reason">${s.reason}</div>`;
    const applyBtn = item.querySelector('.apply-btn');
    const highlightBtn = item.querySelector('.highlight-btn');
    applyBtn.addEventListener('click', ()=> { applySelector(s, idx); });
    highlightBtn.addEventListener('click', ()=> { highlightSelector(s); });

    if (selectorType === 'text') {
      const matchMode = s.matchMode || 'exact';
      const toggle = document.createElement('div');
      toggle.className = 'match-toggle';
      const exactBtn = document.createElement('button');
      exactBtn.className = 'match-btn';
      exactBtn.textContent = '정확히';
      const containsBtn = document.createElement('button');
      containsBtn.className = 'match-btn';
      containsBtn.textContent = '포함';

      const updateButtons = () => {
        const currentMode = s.matchMode || 'exact';
        exactBtn.classList.toggle('active', currentMode === 'exact');
        containsBtn.classList.toggle('active', currentMode === 'contains');
      };

      const setMode = (mode) => {
        if (mode === (s.matchMode || 'exact')) return;
        s.matchMode = mode;
        list[listIndex].matchMode = mode;
        if (event && event.selectorCandidates && event.selectorCandidates[listIndex]) {
          event.selectorCandidates[listIndex].matchMode = mode;
        }
        if (event && event.primarySelector === s.selector && (event.primarySelectorType ? event.primarySelectorType === selectorType : true)) {
          event.primarySelectorMatchMode = mode;
          applySelector({...s, matchMode: mode}, idx);
        }
        updateButtons();
      };

      exactBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setMode('exact');
      });
      containsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setMode('contains');
      });

      toggle.appendChild(exactBtn);
      toggle.appendChild(containsBtn);
      item.appendChild(toggle);
      updateButtons();
    }

    selectorList.appendChild(item);
  });
}

function showIframe(ctx) {
  if (ctx) iframeBanner.classList.remove('hidden'); else iframeBanner.classList.add('hidden');
}

function applySelector(s, eventIndex) {
  const targetIndex = eventIndex !== undefined ? eventIndex : currentEventIndex;
  if (targetIndex < 0) {
    alert('먼저 타임라인에서 이벤트를 선택하세요.');
    return;
  }
  chrome.storage.local.get({events:[]}, res => {
    const evs = res.events || [];
    if (targetIndex >= 0 && targetIndex < evs.length) {
      evs[targetIndex].primarySelector = s.selector;
      evs[targetIndex].primarySelectorType = s.type || inferSelectorType(s.selector);
      if (evs[targetIndex].primarySelectorType === 'text') {
        evs[targetIndex].primarySelectorMatchMode = s.matchMode || 'exact';
      } else {
        delete evs[targetIndex].primarySelectorMatchMode;
      }
      if (s.type === 'text' && s.textValue) {
        evs[targetIndex].primarySelectorText = s.textValue;
      } else {
        delete evs[targetIndex].primarySelectorText;
      }
      if (s.type === 'xpath' && s.xpathValue) {
        evs[targetIndex].primarySelectorXPath = s.xpathValue;
      } else if (evs[targetIndex].primarySelectorType !== 'xpath') {
        delete evs[targetIndex].primarySelectorXPath;
      }
      chrome.storage.local.set({events: evs}, () => {
        // UI 업데이트
        if (allEvents[targetIndex]) {
          allEvents[targetIndex].primarySelector = s.selector;
          allEvents[targetIndex].primarySelectorType = evs[targetIndex].primarySelectorType;
          if (evs[targetIndex].primarySelectorType === 'text') {
            allEvents[targetIndex].primarySelectorMatchMode = evs[targetIndex].primarySelectorMatchMode;
          } else {
            delete allEvents[targetIndex].primarySelectorMatchMode;
          }
          if (s.type === 'text' && s.textValue) {
            allEvents[targetIndex].primarySelectorText = s.textValue;
          } else {
            delete allEvents[targetIndex].primarySelectorText;
          }
          if (s.type === 'xpath' && s.xpathValue) {
            allEvents[targetIndex].primarySelectorXPath = s.xpathValue;
          } else if (allEvents[targetIndex].primarySelectorType !== 'xpath') {
            delete allEvents[targetIndex].primarySelectorXPath;
          }
        }
        // 타임라인 아이템 업데이트
        const timelineItem = document.querySelector(`[data-event-index="${targetIndex}"]`);
        if (timelineItem) {
          const usedSelector = s.selector;
          timelineItem.textContent = new Date(evs[targetIndex].timestamp).toLocaleTimeString() + ' - ' + evs[targetIndex].action + ' - ' + usedSelector;
        }
        // 셀렉터 목록 다시 표시
        if (currentEventIndex === targetIndex && allEvents[targetIndex]) {
          showSelectors(evs[targetIndex].selectorCandidates || [], evs[targetIndex], targetIndex);
        }
        // 코드 자동 업데이트
        updateCode();
      });
    }
  });
}

function highlightSelector(candidate) {
  chrome.tabs.query({active:true,currentWindow:true}, tabs => {
    if (!tabs[0]) return;
    chrome.scripting.executeScript({
      target:{tabId:tabs[0].id},
      func: (selCandidate)=>{
        function findByCandidate(cand) {
          if (!cand) return null;
          const selector = cand.selector || '';
          const type = cand.type || null;
          try {
            if (type === 'xpath' || selector.startsWith('xpath=')) {
              const expression = selector.startsWith('xpath=') ? selector.slice(6) : selector;
              const res = document.evaluate(expression, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
              return res.singleNodeValue || null;
            }
            if (type === 'text' || selector.startsWith('text=')) {
              const raw = selector.replace(/^text=/, '');
              const trimmed = raw.replace(/^['"]|['"]$/g, '');
              const decoded = trimmed.replace(/\\"/g, '"').replace(/\\'/g, "'");
              return Array.from(document.querySelectorAll('*')).find(x => (x.innerText||'').trim().includes(decoded));
            }
            return document.querySelector(selector);
          } catch(err) {
            return null;
          }
        }

        try {
          const el = findByCandidate(selCandidate);
        if (!el) return;
          const prev = {
            outline: el.style.outline,
            outlineOffset: el.style.outlineOffset
          };
        el.style.outline = '3px solid rgba(0,150,136,0.8)';
          el.style.outlineOffset = '2px';
          setTimeout(()=> {
            el.style.outline = prev.outline;
            el.style.outlineOffset = prev.outlineOffset;
          }, 1500);
      } catch(e){}
      },
      args:[candidate]
    });
  });
}

function setElementStatus(message, tone = 'info') {
  if (!elementStatusEl) return;
  elementStatusEl.textContent = message || '';
  elementStatusEl.setAttribute('data-tone', tone || 'info');
  elementStatusEl.style.display = message ? 'block' : 'none';
}

function updateElementButtonState() {
  if (!elementSelectBtn) return;
  if (selectionState.active) {
    elementSelectBtn.classList.add('active');
    elementSelectBtn.textContent = '선택 중단';
  } else {
    elementSelectBtn.classList.remove('active');
    elementSelectBtn.textContent = '요소 선택';
  }
}

function ensureElementPanelVisibility() {
  if (!elementPanel) return;
  if (selectionState.active || selectionState.stack.length > 0) {
    elementPanel.classList.remove('hidden');
  } else {
    elementPanel.classList.add('hidden');
  }
}

function resetSelectionUI() {
  if (elementPathItems) elementPathItems.innerHTML = '';
  if (elementPathContainer) elementPathContainer.classList.add('hidden');
  if (elementCandidatesContainer) elementCandidatesContainer.innerHTML = '';
  if (elementActionsContainer) elementActionsContainer.classList.add('hidden');
  if (elementAttrPanel) elementAttrPanel.classList.add('hidden');
  if (elementAttrNameInput) elementAttrNameInput.value = '';
  if (elementCodePreview) elementCodePreview.classList.add('hidden');
  if (elementCodeEl) elementCodeEl.textContent = '';
}

function resetSelectionState(options = {}) {
  selectionState.active = false;
  selectionState.stage = 'idle';
  selectionState.stack = [];
  selectionState.pendingAction = null;
  selectionState.pendingAttribute = '';
  selectionState.codePreview = '';
  if (!options.keepStatus) {
    setElementStatus('');
  }
  resetSelectionUI();
  updateElementButtonState();
  ensureElementPanelVisibility();
}

function getCurrentSelectionNode() {
  if (!selectionState.stack.length) return null;
  return selectionState.stack[selectionState.stack.length - 1];
}

function renderSelectionPath() {
  if (!elementPathItems || !elementPathContainer) return;
  elementPathItems.innerHTML = '';
  if (selectionState.stack.length === 0) {
    elementPathContainer.classList.add('hidden');
    return;
  }
  elementPathContainer.classList.remove('hidden');
  selectionState.stack.forEach((node, index) => {
    const item = document.createElement('div');
    item.className = 'element-path-item';
    const label = index === 0 ? 'ROOT' : `CHILD ${index}`;
    const selected = node.selectedCandidate ? node.selectedCandidate.selector : '(미선택)';
    item.innerHTML = `<span class="label">${label}</span><span class="value">${selected}</span>`;
    elementPathItems.appendChild(item);
  });
}

function createSelectionCandidateItem(node, candidate) {
  const item = document.createElement('div');
  item.className = 'selector-item';
  const selectorType = candidate.type || inferSelectorType(candidate.selector);
  const relationLabel = candidate.relation === 'relative' ? ' (REL)' : '';
  const scoreLabel = typeof candidate.score === 'number' ? `${candidate.score}%` : '';
  const badges = [];
  if (candidate.unique === true) badges.push('유일');
  if (typeof candidate.matchCount === 'number' && candidate.matchCount > 1) {
    badges.push(`${candidate.matchCount}개 일치`);
  }
  if (candidate.relation === 'relative' && typeof candidate.contextMatchCount === 'number') {
    badges.push(`부모 내 ${candidate.contextMatchCount}개`);
  }
  const badgeLine = badges.filter(Boolean).join(' • ');
  const isSelected = node.selectedCandidate && node.selectedCandidate.selector === candidate.selector && (node.selectedCandidate.type || inferSelectorType(node.selectedCandidate.selector)) === (candidate.type || inferSelectorType(candidate.selector));
  item.innerHTML = `
    <div class="selector-main">
      <span class="type">${(selectorType || 'css').toUpperCase()}${relationLabel}</span>
      <span class="sel">${candidate.selector}</span>
      <span class="score">${scoreLabel}</span>
    </div>
    <div class="selector-actions">
      <button class="apply-btn" ${isSelected ? 'style="background: #4CAF50; color: white;"' : ''}>${isSelected ? '✓ 선택됨' : '선택'}</button>
    </div>
    <div class="reason">${[candidate.reason || '', badgeLine].filter(Boolean).join(' • ')}</div>`;
  const applyBtn = item.querySelector('.apply-btn');
  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      applyCandidateToNode(node, candidate);
    });
  }
  if (selectorType === 'text') {
    if (!candidate.matchMode) candidate.matchMode = 'exact';
    const toggle = document.createElement('div');
    toggle.className = 'match-toggle';
    const exactBtn = document.createElement('button');
    exactBtn.className = 'match-btn';
    exactBtn.textContent = '정확히';
    const containsBtn = document.createElement('button');
    containsBtn.className = 'match-btn';
    containsBtn.textContent = '포함';

    const refresh = () => {
      const mode = candidate.matchMode || 'exact';
      exactBtn.classList.toggle('active', mode === 'exact');
      containsBtn.classList.toggle('active', mode === 'contains');
      if (node.selectedCandidate && node.selectedCandidate.selector === candidate.selector) {
        node.selectedCandidate.matchMode = mode;
        updateSelectionCodePreview();
      }
    };

    const setMode = (mode) => {
      if (candidate.matchMode === mode) return;
      candidate.matchMode = mode;
      if (node && node.candidates) {
        const index = node.candidates.indexOf(candidate);
        if (index >= 0) {
          node.candidates[index].matchMode = mode;
        }
      }
      refresh();
    };

    exactBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setMode('exact');
    });
    containsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setMode('contains');
    });

    toggle.appendChild(exactBtn);
    toggle.appendChild(containsBtn);
    item.appendChild(toggle);
    refresh();
  }
  return item;
}

function renderSelectionCandidates(node) {
  if (!elementCandidatesContainer || !node) return;
  elementCandidatesContainer.innerHTML = '';
  const candidates = node.candidates || [];
  if (!candidates.length) {
    const empty = document.createElement('div');
    empty.style.padding = '8px';
    empty.style.color = '#777';
    empty.textContent = '후보가 없습니다.';
    elementCandidatesContainer.appendChild(empty);
    return;
  }
  candidates.forEach((candidate) => {
    elementCandidatesContainer.appendChild(createSelectionCandidateItem(node, candidate));
  });
}

function updateSelectionActionsVisibility() {
  if (!elementActionsContainer) return;
  const currentNode = getCurrentSelectionNode();
  if (currentNode && currentNode.selectedCandidate) {
    elementActionsContainer.classList.remove('hidden');
  } else {
    elementActionsContainer.classList.add('hidden');
  }
  if (elementAttrPanel) elementAttrPanel.classList.add('hidden');
  if (elementAttrNameInput) elementAttrNameInput.value = '';
}

function buildSelectionPathArray() {
  return selectionState.stack
    .map((node) => {
      if (!node.selectedCandidate) return null;
      const candidate = node.selectedCandidate;
      return {
        selector: candidate.selector,
        type: candidate.type || inferSelectorType(candidate.selector),
        textValue: candidate.textValue || null,
        xpathValue: candidate.xpathValue || null,
        relation: candidate.relation || null,
        reason: candidate.reason || '',
        matchMode: candidate.matchMode || null,
        iframeContext: (node.element && node.element.iframeContext) || null
      };
    })
    .filter(Boolean);
}

function updateSelectionCodePreview() {
  if (!elementCodePreview || !elementCodeEl) return;
  const path = buildSelectionPathArray();
  if (!path.length) {
    elementCodePreview.classList.add('hidden');
    elementCodeEl.textContent = '';
    return;
  }
  const previewLines = buildSelectionPreviewLines(path, selectedFramework, selectedLanguage);
  elementCodeEl.textContent = previewLines.join('\n');
  elementCodePreview.classList.remove('hidden');
}

function applyCandidateToNode(node, candidate) {
  if (!node) return;
  node.selectedCandidate = {
    ...candidate,
    type: candidate.type || inferSelectorType(candidate.selector)
  };
  renderSelectionCandidates(node);
  renderSelectionPath();
  selectionState.stage = 'await-action';
  setElementStatus('동작을 선택하세요.', 'info');
  updateSelectionActionsVisibility();
  updateSelectionCodePreview();
}

function startSelectionWorkflow() {
  resetSelectionState({keepStatus: true});
  selectionState.active = true;
  selectionState.stage = 'await-root';
  setElementStatus('페이지에서 요소를 클릭하세요.', 'info');
  ensureElementPanelVisibility();
  updateElementButtonState();
  requestElementPick('root');
}

function cancelSelectionWorkflow(message = '', tone = 'info') {
  if (selectionState.active || selectionState.stage !== 'idle') {
    sendSelectionMessage({type: 'ELEMENT_SELECTION_CANCEL'}, () => {});
  }
  resetSelectionState({keepStatus: true});
  if (message) {
    setElementStatus(message, tone);
  } else {
    setElementStatus('');
  }
}

function sendSelectionMessage(payload, callback) {
  withActiveTab((tab) => {
    if (!tab) {
      if (callback) callback({ok: false, reason: 'no_active_tab'});
      return;
    }
    chrome.tabs.sendMessage(tab.id, payload, (response) => {
      if (chrome.runtime.lastError) {
        if (callback) callback({ok: false, reason: chrome.runtime.lastError.message});
        return;
      }
      if (callback) callback(response || {ok: true});
    });
  });
}

function requestElementPick(mode) {
  const message = mode === 'child' ? {type: 'ELEMENT_SELECTION_PICK_CHILD'} : {type: 'ELEMENT_SELECTION_START'};
  sendSelectionMessage(message, (resp) => {
    if (resp && resp.ok === false && resp.reason) {
      setElementStatus(`요소 선택을 시작할 수 없습니다: ${resp.reason}`, 'error');
      if (mode === 'root') {
        cancelSelectionWorkflow('', 'info');
      }
    }
  });
}

function handleElementSelectionPicked(msg) {
  if (!selectionState.active) {
    selectionState.active = true;
    updateElementButtonState();
  }
  const candidates = (msg.selectors || []).map((cand) => ({
    ...cand,
    type: cand.type || inferSelectorType(cand.selector)
  }));
  const node = {
    element: msg.element || {},
    candidates,
    selectedCandidate: null,
    stage: msg.stage || (selectionState.stack.length === 0 ? 'root' : 'child')
  };
  selectionState.stack.push(node);
  selectionState.stage = 'await-candidate';
  renderSelectionPath();
  renderSelectionCandidates(node);
  updateSelectionActionsVisibility();
  updateSelectionCodePreview();
  ensureElementPanelVisibility();
  setElementStatus('후보 중 하나를 선택하세요.', 'info');
}

function handleElementSelectionError(msg) {
  const reason = msg && msg.reason ? msg.reason : '요소를 선택할 수 없습니다.';
  setElementStatus(reason, 'error');
  const stage = msg && msg.stage ? msg.stage : 'root';
  if (selectionState.active) {
    requestElementPick(stage === 'child' ? 'child' : 'root');
  }
}

function handleElementSelectionCancelled() {
  if (!selectionState.active && selectionState.stack.length === 0) return;
  cancelSelectionWorkflow('페이지에서 요소 선택이 취소되었습니다.', 'info');
}

function handleElementAction(action) {
  if (!action) return;
  const currentNode = getCurrentSelectionNode();
  if (!currentNode || !currentNode.selectedCandidate) {
    setElementStatus('먼저 후보를 선택하세요.', 'error');
    return;
  }
  switch (action) {
    case 'click':
      applySelectionAction('click');
      break;
    case 'text':
      applySelectionAction('extract_text');
      break;
    case 'value':
      applySelectionAction('get_attribute', {attributeName: 'value'});
      break;
    case 'attribute':
      if (elementAttrPanel) {
        elementAttrPanel.classList.remove('hidden');
      }
      if (elementAttrNameInput) {
        elementAttrNameInput.value = '';
        elementAttrNameInput.focus();
      }
      selectionState.pendingAction = 'attribute';
      setElementStatus('추출할 속성명을 입력하고 적용을 누르세요.', 'info');
      break;
    case 'child':
      startChildSelection();
      break;
    case 'parent':
      startParentSelection();
      break;
    case 'commit':
      applySelectionAction('commit');
      break;
    case 'finish':
      cancelSelectionWorkflow('요소 선택을 종료했습니다.');
      break;
    default:
      break;
  }
}

function startChildSelection() {
  const currentNode = getCurrentSelectionNode();
  if (!currentNode || !currentNode.selectedCandidate) {
    setElementStatus('먼저 후보를 선택하세요.', 'error');
    return;
  }
  selectionState.stage = 'await-child';
  updateSelectionActionsVisibility();
  setElementStatus('부모 요소 내부에서 자식 요소를 클릭하세요.', 'info');
  requestElementPick('child');
}

function startParentSelection() {
  const currentNode = getCurrentSelectionNode();
  if (!currentNode || !currentNode.selectedCandidate) {
    setElementStatus('먼저 후보를 선택하세요.', 'error');
    return;
  }
  selectionState.stage = 'await-parent';
  updateSelectionActionsVisibility();
  setElementStatus('상위 요소 정보를 가져오는 중입니다...', 'info');
  sendSelectionMessage({type: 'ELEMENT_SELECTION_PICK_PARENT'}, (resp) => {
    if (resp && resp.ok === false) {
      selectionState.stage = 'await-action';
      updateSelectionActionsVisibility();
      let message = '상위 요소를 찾을 수 없습니다.';
      if (resp.reason === 'no_parent') {
        message = '더 이상 상위 요소가 없습니다.';
      } else if (resp.reason === 'current_not_selected') {
        message = '먼저 요소를 선택하세요.';
      }
      setElementStatus(message, 'error');
    }
  });
}

function buildManualActionEntry(actionType, path, options = {}) {
  if (!path || !path.length) return null;
  const serial = manualActionSerial++;
  const entry = {
    id: `manual-${Date.now()}-${serial}`,
    serial,
    actionType,
    path,
    createdAt: Date.now(),
    iframeContext: path[path.length - 1] && path[path.length - 1].iframeContext ? path[path.length - 1].iframeContext : null
  };
  if (actionType === 'extract_text') {
    entry.resultName = options.resultName || `text_result_${serial}`;
  }
  if (actionType === 'get_attribute') {
    const attrName = (options.attributeName || selectionState.pendingAttribute || '').trim();
    if (!attrName) return null;
    entry.attributeName = attrName;
    entry.resultName = options.resultName || `${attrName}_value_${serial}`;
  }
  return entry;
}

function persistManualActions(nextActions, callback) {
  manualActions = nextActions;
  chrome.storage.local.set({manualActions: nextActions}, () => {
    if (callback) callback();
  });
}

function addManualAction(entry, callback) {
  const next = [...manualActions, entry];
  persistManualActions(next, callback);
}

function loadManualActions(callback) {
  chrome.storage.local.get({manualActions: []}, (data) => {
    manualActions = Array.isArray(data.manualActions) ? data.manualActions : [];
    const maxSerial = manualActions.reduce((max, item) => Math.max(max, item && item.serial ? item.serial : 0), 0);
    manualActionSerial = Math.max(maxSerial + 1, manualActionSerial);
    if (callback) callback(manualActions);
  });
}

function emitManualActionLines(lines, action, frameworkLower, languageLower, indent) {
  if (!lines || !action) return;
  const actionLines = buildManualActionCode(action, frameworkLower, languageLower, indent);
  if (!Array.isArray(actionLines) || !actionLines.length) return;
  actionLines.forEach((line) => lines.push(line));
}

function buildActionTimeline(events, manualList) {
  const timeline = [];
  let sequence = 0;
  let maxEventTimestamp = 0;
  if (Array.isArray(events)) {
    events.forEach((event) => {
      const normalizedEvent = normalizeEventRecord(event);
      const timestamp = typeof normalizedEvent.timestamp === 'number' ? normalizedEvent.timestamp : 0;
      if (timestamp > maxEventTimestamp) {
        maxEventTimestamp = timestamp;
      }
      timeline.push({
        kind: 'event',
        time: timestamp,
        sequence: sequence++,
        event: normalizedEvent,
        selectorInfo: selectSelectorForEvent(normalizedEvent)
      });
    });
  }

  let manualFallbackOffset = 0;
  const manualListSafe = Array.isArray(manualList) ? manualList : [];
  manualListSafe.forEach((action) => {
    if (!action || !Array.isArray(action.path) || !action.path.length) return;
    const created = typeof action.createdAt === 'number'
      ? action.createdAt
      : (maxEventTimestamp || Date.now()) + manualFallbackOffset;
    manualFallbackOffset += 1;
    timeline.push({
      kind: 'manual',
      time: created,
      sequence: sequence++,
      action
    });
  });

  timeline.sort((a, b) => {
    if (a.time !== b.time) return a.time - b.time;
    return a.sequence - b.sequence;
  });
  return timeline;
}

function convertManualActionToEvent(action) {
  if (!action || !Array.isArray(action.path) || !action.path.length) return null;
  const path = action.path;
  const selectors = path.map((item, idx) => {
    if (!item || !item.selector) return null;
    const type = item.type || inferSelectorType(item.selector);
    const isTarget = idx === path.length - 1;
    return {
      selector: item.selector,
      type,
      textValue: item.textValue || null,
      xpathValue: item.xpathValue || null,
      matchMode: item.matchMode || null,
      relation: item.relation || null,
      score: isTarget ? 100 : Math.max(60, 85 - (path.length - 1 - idx) * 5),
      reason: item.reason || ''
    };
  }).filter(Boolean);

  if (!selectors.length) return null;

  let actionName = 'click';
  if (action.actionType === 'extract_text') {
    actionName = 'manual_extract_text';
  } else if (action.actionType === 'get_attribute') {
    actionName = 'manual_get_attribute';
  } else if (action.actionType !== 'click') {
    return null;
  }

  const manualEvent = createManualEventRecord(action, selectors, actionName);
  return manualEvent;
}

function createManualEventRecord(action, selectorsList, actionName) {
  if (!selectorsList.length) return null;
  const timestamp = action.createdAt || Date.now();
  const targetEntry = selectorsList[selectorsList.length - 1];
  const primaryType = targetEntry.type || inferSelectorType(targetEntry.selector);
  const frameContext = action.iframeContext || null;
  const manualPayload = {
    id: action.id || null,
    type: action.actionType || null,
    path: action.path || [],
    resultName: action.resultName || null,
    attributeName: action.attributeName || null,
    createdAt: timestamp
  };

  const eventRecord = {
    version: EVENT_SCHEMA_VERSION,
    timestamp,
    action: actionName,
    value: null,
    selectorCandidates: selectorsList,
    primarySelector: targetEntry.selector,
    primarySelectorType: primaryType,
    primarySelectorText: targetEntry.textValue || null,
    primarySelectorXPath: targetEntry.xpathValue || (primaryType === 'xpath' ? getSelectorCore(targetEntry.selector) : null),
    primarySelectorMatchMode: targetEntry.matchMode || null,
    iframeContext: frameContext,
    page: null,
    frame: frameContext ? { iframeContext: frameContext } : null,
    target: null,
    clientRect: null,
    metadata: {
      schemaVersion: EVENT_SCHEMA_VERSION,
      source: 'manual_action'
    },
    manual: manualPayload,
    manualActionType: action.actionType || null,
    manualActionId: action.id || null,
    manualResultName: action.resultName || null,
    manualAttribute: action.attributeName || null
  };

  return normalizeEventRecord(eventRecord);
}

function buildReplayQueue(events, manualList) {
  const timeline = buildActionTimeline(events, manualList);
  const queue = [];
  timeline.forEach((entry) => {
    if (entry.kind === 'event' && entry.event) {
      queue.push(entry.event);
    } else if (entry.kind === 'manual' && entry.action) {
      const manualEvent = convertManualActionToEvent(entry.action);
      if (manualEvent) {
        queue.push(manualEvent);
      }
    }
  });
  return queue;
}

function applySelectionAction(actionType, options = {}) {
  const path = buildSelectionPathArray();
  if (!path.length) {
    setElementStatus('먼저 요소를 선택하세요.', 'error');
    return;
  }
  if (actionType === 'commit') {
    const entry = buildManualActionEntry('chain', path, options);
    if (!entry) {
      setElementStatus('현재 선택을 코드에 반영할 수 없습니다.', 'error');
      return;
    }
    addManualAction(entry, () => {
      cancelSelectionWorkflow('현재 선택을 코드에 반영했습니다.', 'success');
      updateCode();
    });
    selectionState.pendingAction = null;
    selectionState.pendingAttribute = '';
    return;
  }
  if (actionType === 'get_attribute') {
    const attrName = (options.attributeName || selectionState.pendingAttribute || '').trim();
    if (!attrName) {
      setElementStatus('속성명을 입력하세요.', 'error');
      return;
    }
    options.attributeName = attrName;
  }
  const entry = buildManualActionEntry(actionType, path, options);
  if (!entry) {
    setElementStatus('동작을 처리할 수 없습니다.', 'error');
    return;
  }
  addManualAction(entry, () => {
    cancelSelectionWorkflow('', 'info');
    setElementStatus('코드에 동작을 추가했습니다.', 'success');
    updateCode();
    if (actionType === 'click') {
      executeSelectionAction('click', path, {}, (result) => {
        if (!result || !result.ok) {
          setElementStatus(`요소 클릭을 수행할 수 없습니다: ${(result && result.reason) || '알 수 없는 오류'}`, 'error');
        } else {
          setElementStatus('요소를 클릭했습니다.', 'success');
        }
      });
    }
  });
  selectionState.pendingAction = null;
  selectionState.pendingAttribute = '';
}

function executeSelectionAction(actionType, path, options = {}, callback) {
  withActiveTab((tab) => {
    if (!tab) {
      if (callback) callback({ok: false, reason: 'no_active_tab'});
      return;
    }
    chrome.tabs.sendMessage(tab.id, {
      type: 'ELEMENT_SELECTION_EXECUTE',
      action: actionType,
      path,
      options
    }, (resp) => {
      if (chrome.runtime.lastError) {
        if (callback) callback({ok: false, reason: chrome.runtime.lastError.message});
        return;
      }
      if (callback) callback(resp || {ok: true});
    });
  });
}

function sanitizeIdentifier(name, languageLower, fallback) {
  const defaultName = fallback || 'result';
  if (!name || typeof name !== 'string') return defaultName;
  let sanitized = name.replace(/[^a-zA-Z0-9_]/g, '_');
  if (!sanitized) return defaultName;
  if (/^[0-9]/.test(sanitized)) {
    sanitized = `_${sanitized}`;
  }
  return sanitized;
}

function buildPlaywrightLocatorChain(path, languageLower, indent, serial) {
  const lines = [];
  if (!Array.isArray(path) || path.length === 0) {
    return {lines, finalVar: null};
  }
  let baseExpr = 'page';
  let finalVar = null;
  const prefix = typeof serial !== 'undefined' ? serial : Date.now();
  path.forEach((entry, index) => {
    const isLast = index === path.length - 1;
    const varName = languageLower === 'python'
      ? `${isLast ? 'target' : 'node'}_${prefix}_${index + 1}`
      : `${isLast ? 'target' : 'node'}_${prefix}_${index + 1}`;
    const locatorExpr = buildPlaywrightLocatorExpression(baseExpr, entry, languageLower);
    if (languageLower === 'python') {
      lines.push(`${indent}${varName} = ${locatorExpr}`);
    } else {
      lines.push(`${indent}const ${varName} = ${locatorExpr};`);
    }
    baseExpr = varName;
    finalVar = varName;
  });
  return {lines, finalVar};
}

function buildSeleniumLocatorChainPython(path, indent, serial) {
  const lines = [];
  if (!Array.isArray(path) || path.length === 0) {
    return {lines, finalVar: null};
  }
  let baseExpr = 'driver';
  let finalVar = null;
  path.forEach((entry, index) => {
    const spec = buildSeleniumLocatorSpec(entry);
    const varName = `element_${serial}_${index + 1}`;
    const expr = `${baseExpr}.find_element(${spec.byPython}, "${escapeForPythonString(spec.value)}")`;
    lines.push(`${indent}${varName} = ${expr}`);
    baseExpr = varName;
    finalVar = varName;
  });
  return {lines, finalVar};
}

function buildSeleniumLocatorChainJS(path, indent, serial) {
  const lines = [];
  if (!Array.isArray(path) || path.length === 0) {
    return {lines, finalVar: null};
  }
  let baseExpr = 'driver';
  let finalVar = null;
  path.forEach((entry, index) => {
    const spec = buildSeleniumLocatorSpec(entry);
    const varName = `element_${serial}_${index + 1}`;
    const caller = baseExpr === 'driver' ? 'driver' : baseExpr;
    const expr = `${caller}.findElement(${spec.byJS}("${escapeForJSString(spec.value)}"))`;
    lines.push(`${indent}const ${varName} = await ${expr};`);
    baseExpr = varName;
    finalVar = varName;
  });
  return {lines, finalVar};
}

function buildSeleniumLocatorChain(path, languageLower, indent, serial) {
  if (languageLower === 'python') {
    return buildSeleniumLocatorChainPython(path, indent, serial);
  }
  return buildSeleniumLocatorChainJS(path, indent, serial);
}

function buildManualActionCode(action, frameworkLower, languageLower, indent) {
  if (!action || !Array.isArray(action.path) || action.path.length === 0) {
    return [];
  }
  const serial = action.serial || Date.now();
  const path = action.path;
  const lines = [];
  let chainResult = null;

  if (frameworkLower === 'playwright') {
    chainResult = buildPlaywrightLocatorChain(path, languageLower, indent, serial);
  } else if (frameworkLower === 'selenium') {
    chainResult = buildSeleniumLocatorChain(path, languageLower, indent, serial);
  }

  if (!chainResult || !chainResult.finalVar) {
    return lines;
  }

  lines.push(...chainResult.lines);
  const targetVar = chainResult.finalVar;

  if (frameworkLower === 'playwright') {
    if (action.actionType === 'click') {
      if (languageLower === 'python') {
        lines.push(`${indent}${targetVar}.click()`);
      } else {
        lines.push(`${indent}await ${targetVar}.click();`);
      }
    }
    if (action.actionType === 'extract_text') {
      const resultName = sanitizeIdentifier(action.resultName, languageLower, languageLower === 'python' ? 'text_result' : 'textResult');
      if (languageLower === 'python') {
        lines.push(`${indent}${resultName} = ${targetVar}.inner_text()`);
      } else {
        lines.push(`${indent}const ${resultName} = await ${targetVar}.innerText();`);
      }
    }
    if (action.actionType === 'get_attribute') {
      const attrName = action.attributeName || '';
      const resultName = sanitizeIdentifier(action.resultName, languageLower, languageLower === 'python' ? `${attrName || 'attr'}_value` : `${attrName || 'attr'}Value`);
      if (languageLower === 'python') {
        lines.push(`${indent}${resultName} = ${targetVar}.get_attribute("${escapeForPythonString(attrName)}")`);
      } else {
        lines.push(`${indent}const ${resultName} = await ${targetVar}.getAttribute("${escapeForJSString(attrName)}");`);
      }
    }
  } else if (frameworkLower === 'selenium') {
    if (action.actionType === 'click') {
      if (languageLower === 'python') {
        lines.push(`${indent}${targetVar}.click()`);
      } else {
        lines.push(`${indent}await ${targetVar}.click();`);
      }
    }
    if (action.actionType === 'extract_text') {
      const resultName = sanitizeIdentifier(action.resultName, languageLower, languageLower === 'python' ? 'text_result' : 'textResult');
      if (languageLower === 'python') {
        lines.push(`${indent}${resultName} = ${targetVar}.text`);
      } else {
        lines.push(`${indent}const ${resultName} = await ${targetVar}.getText();`);
      }
    }
    if (action.actionType === 'get_attribute') {
      const attrName = action.attributeName || '';
      const resultName = sanitizeIdentifier(action.resultName, languageLower, languageLower === 'python' ? `${attrName || 'attr'}_value` : `${attrName || 'attr'}Value`);
      if (languageLower === 'python') {
        lines.push(`${indent}${resultName} = ${targetVar}.get_attribute("${escapeForPythonString(attrName)}")`);
      } else {
        lines.push(`${indent}const ${resultName} = await ${targetVar}.getAttribute("${escapeForJSString(attrName)}");`);
      }
    }
  }

  return lines;
}

function buildSelectionPreviewLines(path, framework, language) {
  if (!Array.isArray(path) || !path.length) return [];
  const frameworkLower = (framework || '').toLowerCase();
  const languageLower = (language || '').toLowerCase();
  const indent = '';
  const serial = manualActionSerial;
  if (frameworkLower === 'playwright') {
    return buildPlaywrightLocatorChain(path, languageLower, indent, serial).lines;
  }
  if (frameworkLower === 'selenium') {
    return buildSeleniumLocatorChain(path, languageLower, indent, serial).lines;
  }
  return path.map((item) => item && item.selector ? item.selector : '');
}

//

//

//

//

//

//

function resetReplayState() {
  if (replayState.navigationGuard) {
    clearTimeout(replayState.navigationGuard);
  }
  if (replayState.scheduledTimer) {
    clearTimeout(replayState.scheduledTimer);
  }
  replayState = {
    running: false,
    events: [],
    index: 0,
    tabId: null,
    pending: false,
    awaitingNavigation: false,
    awaitingContent: false,
    navigationGuard: null,
    scheduledTimer: null
  };
}

function ensureReplayTabListener() {
  if (replayTabListenerRegistered) return;
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (!replayState.running || tabId !== replayState.tabId) return;
    if (changeInfo.status === 'loading') {
      replayState.awaitingContent = true;
    }
    if (changeInfo.status === 'complete') {
      replayState.awaitingContent = false;
      if (replayState.awaitingNavigation && !replayState.pending) {
        replayState.awaitingNavigation = false;
        scheduleNextStep(NAVIGATION_RECOVERY_DELAY_MS);
      } else if (!replayState.pending) {
        scheduleNextStep(DOM_COMPLETE_DELAY_MS);
      }
    }
  });
  replayTabListenerRegistered = true;
}

function scheduleNextStep(delayMs) {
  if (!replayState.running) return;
  if (replayState.scheduledTimer) {
    clearTimeout(replayState.scheduledTimer);
  }
  replayState.scheduledTimer = setTimeout(() => {
    replayState.scheduledTimer = null;
    sendReplayStep();
  }, Math.max(0, delayMs || 0));
}

function finishReplay() {
  const wasRunning = replayState.running;
  resetReplayState();
  if (wasRunning) {
    const doneMsg = document.createElement('div');
    doneMsg.textContent = '✓ 리플레이 완료';
    doneMsg.style.color = '#2196f3';
    doneMsg.style.fontWeight = 'bold';
    doneMsg.style.padding = '8px';
    doneMsg.style.marginTop = '8px';
    doneMsg.style.borderTop = '1px solid #ddd';
    logEntries.appendChild(doneMsg);
    logEntries.scrollTop = logEntries.scrollHeight;
  }
}

function abortReplay(reason) {
  const message = reason || '알 수 없는 오류로 리플레이가 중단되었습니다.';
  const div = document.createElement('div');
  div.style.padding = '6px 10px';
  div.style.marginTop = '8px';
  div.style.borderRadius = '4px';
  div.style.background = '#ffebee';
  div.style.color = '#c62828';
  div.style.fontWeight = 'bold';
  div.textContent = `✗ 리플레이 종료 - ${message}`;
  logEntries.appendChild(div);
  logEntries.scrollTop = logEntries.scrollHeight;
  resetReplayState();
}

function sendReplayStep() {
  if (!replayState.running) return;
  if (replayState.pending) return;
  if (replayState.index >= replayState.events.length) {
    finishReplay();
    return;
  }
  const currentEvent = replayState.events[replayState.index];
  if (!replayState.tabId) {
    abortReplay('대상 탭을 찾을 수 없습니다.');
    return;
  }
  replayState.pending = true;
  if (replayState.navigationGuard) {
    clearTimeout(replayState.navigationGuard);
    replayState.navigationGuard = null;
  }
  chrome.tabs.sendMessage(replayState.tabId, {
    type: 'REPLAY_EXECUTE_STEP',
    event: currentEvent,
    index: replayState.index,
    total: replayState.events.length,
    timeoutMs: 10000
  }, (response) => {
    if (chrome.runtime.lastError) {
      // 컨텐츠 스크립트가 아직 준비되지 않음 (탭 이동/새로고침 등)
      replayState.pending = false;
      replayState.awaitingContent = true;
      return;
    }
    if (!response) {
      // 응답이 없으면 결과 메시지를 기다림
      return;
    }
    if (response.ok === false && response.reason) {
      replayState.pending = false;
      abortReplay(response.reason);
    }
  });
}

function handleReplayStepResult(msg) {
  if (!replayState.running) return;
  const expectedIndex = replayState.index;
  const msgIndex = msg.stepIndex !== undefined ? msg.stepIndex : (msg.step !== undefined ? (msg.step - 1) : expectedIndex);

  if (msgIndex !== expectedIndex) {
    // 다른 스텝의 응답이면 무시
    return;
  }

  replayState.pending = false;

  if (!msg.ok) {
    abortReplay(msg.reason || 'step failed');
    return;
  }

  replayState.index = msgIndex + 1;

  if (replayState.index >= replayState.events.length) {
    finishReplay();
    return;
  }

  if (msg.navigation) {
    replayState.awaitingNavigation = true;
    replayState.awaitingContent = true;
    if (replayState.navigationGuard) {
      clearTimeout(replayState.navigationGuard);
    }
    replayState.navigationGuard = setTimeout(() => {
      replayState.navigationGuard = null;
      abortReplay('페이지 로딩이 너무 오래 걸립니다.');
    }, MAX_NAVIGATION_WAIT_MS);
    return;
  }

  scheduleNextStep(STEP_DELAY_MS);
}

document.getElementById('view-code').addEventListener('click', async ()=>{
  updateCode();
});

document.getElementById('replay-btn').addEventListener('click', async ()=>{
  startReplay();
});

function startReplay() {
  if (replayState.running) {
    alert('리플레이가 이미 진행 중입니다. 잠시 후 다시 시도하세요.');
    return;
  }
  chrome.runtime.sendMessage({type:'GET_EVENTS'}, (res) => {
    const events = res && res.events || [];
    chrome.storage.local.get({manualActions: []}, (data) => {
      const manualListRaw = Array.isArray(data.manualActions) ? data.manualActions : [];
      const manualList = manualListRaw.filter(Boolean);
      const replayQueue = buildReplayQueue(events, manualList);
      const normalizedQueue = replayQueue.map((item) => normalizeEventRecord(item));
      if (normalizedQueue.length === 0) {
        alert('재생할 이벤트가 없습니다.');
        return;
      }
      
      // 로그 초기화
      logEntries.innerHTML = '';
      const startMsg = document.createElement('div');
      startMsg.textContent = `리플레이 시작: ${normalizedQueue.length}개 스텝`;
      startMsg.style.color = '#2196f3';
      startMsg.style.fontWeight = 'bold';
      logEntries.appendChild(startMsg);
      
      // 현재 활성 탭 찾기
      chrome.tabs.query({active:true, currentWindow:true}, (tabs) => {
        if (!tabs[0]) {
          alert('활성 탭을 찾을 수 없습니다.');
          return;
        }

        ensureReplayTabListener();
        listenEvents();
        replayState.running = true;
        replayState.events = normalizedQueue;
        replayState.index = 0;
        replayState.tabId = tabs[0].id;
        replayState.pending = false;
        replayState.awaitingNavigation = false;
        replayState.awaitingContent = false;
        if (replayState.navigationGuard) {
          clearTimeout(replayState.navigationGuard);
          replayState.navigationGuard = null;
        }
        if (replayState.scheduledTimer) {
          clearTimeout(replayState.scheduledTimer);
          replayState.scheduledTimer = null;
        }
        sendReplayStep();
      });
    });
  });
}

function updateCode() {
  chrome.runtime.sendMessage({type:'GET_EVENTS'}, (res) => {
    const events = (res && res.events || []).map((ev) => normalizeEventRecord(ev));
    allEvents = events;
    loadManualActions(() => {
      const code = generateCode(events, manualActions, selectedFramework, selectedLanguage);
      if (codeOutput) {
        codeOutput.value = code;
      }
      updateSelectionCodePreview();
    });
  });
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

function selectSelectorForEvent(ev) {
  if (!ev) return {selector:null, type:null, iframeContext:null};
  if (ev.primarySelector) {
    return {
      selector: ev.primarySelector,
      type: ev.primarySelectorType || inferSelectorType(ev.primarySelector),
      textValue: ev.primarySelectorText || null,
      xpathValue: ev.primarySelectorXPath || null,
      matchMode: ev.primarySelectorMatchMode || null,
      iframeContext: ev.iframeContext || null
    };
  }
  if (ev.selectorCandidates && ev.selectorCandidates.length > 0) {
    const sorted = [...ev.selectorCandidates].sort((a, b) => (b.score || 0) - (a.score || 0));
    const best = sorted[0];
    return {
      selector: best.selector,
      type: best.type || inferSelectorType(best.selector),
      textValue: best.textValue || null,
      xpathValue: best.xpathValue || null,
      matchMode: best.matchMode || null,
      iframeContext: ev.iframeContext || null
    };
  }
  if (ev.tag) {
    return {selector: ev.tag.toLowerCase(), type: 'tag', iframeContext: ev.iframeContext || null};
  }
  return {selector:null, type:null, iframeContext: ev.iframeContext || null};
}

function getTextValue(selectorInfo) {
  if (!selectorInfo) return '';
  if (selectorInfo.textValue) return selectorInfo.textValue;
  const selector = selectorInfo.selector || '';
  if (selector.startsWith('text=')) {
    let raw = selector.slice(5);
    raw = raw.replace(/^['"]|['"]$/g, '');
    return raw.replace(/\\"/g, '"').replace(/\\'/g, "'");
  }
  return '';
}

function getXPathValue(selectorInfo) {
  if (!selectorInfo) return '';
  if (selectorInfo.xpathValue) return selectorInfo.xpathValue;
  const selector = selectorInfo.selector || '';
  if (selector.startsWith('xpath=')) {
    return selector.slice(6);
  }
  return selector;
}

function ensureXPathSelector(selector) {
  if (!selector) return '';
  return selector.startsWith('xpath=') ? selector : 'xpath=' + selector;
}

function escapeForDoubleQuotes(str) {
  return (str || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeForPythonString(str) {
  return escapeForDoubleQuotes(str);
}

function escapeForJSString(str) {
  return escapeForDoubleQuotes(str);
}

function getSelectorCore(selector) {
  if (!selector) return '';
  if (selector.startsWith('css=')) return selector.slice(4);
  if (selector.startsWith('xpath=')) return selector.slice(6);
  return selector;
}

function framesEqual(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (a.id || null) === (b.id || null)
    && (a.name || null) === (b.name || null)
    && (a.src || null) === (b.src || null);
}

function buildIframeCssSelector(ctx) {
  if (!ctx) return 'iframe';
  if (ctx.id) return `iframe#${ctx.id}`;
  if (ctx.name) return `iframe[name="${ctx.name}"]`;
  if (ctx.src) return `iframe[src="${ctx.src}"]`;
  return 'iframe';
}

function buildPlaywrightFrameLocatorLines(ctx, languageLower, alias, indent) {
  const selector = buildIframeCssSelector(ctx);
  if (languageLower === 'python') {
    return [`${alias} = page.frame_locator("${escapeForDoubleQuotes(selector)}")`];
  }
  return [`const ${alias} = page.frameLocator('${selector}');`];
}

function buildSeleniumFrameSwitchPython(ctx) {
  if (!ctx) return null;
  if (ctx.name) return `driver.switch_to.frame("${ctx.name}")`;
  if (ctx.id) return `driver.switch_to.frame(driver.find_element(By.CSS_SELECTOR, "iframe#${ctx.id}"))`;
  if (ctx.src) return `driver.switch_to.frame(driver.find_element(By.CSS_SELECTOR, "iframe[src='${ctx.src}']"))`;
  return null;
}

function buildSeleniumFrameSwitchJS(ctx, indent) {
  if (!ctx) return null;
  if (ctx.name) return `${indent}await driver.switchTo().frame("${ctx.name}");`;
  if (ctx.id) return `${indent}await driver.switchTo().frame(await driver.findElement(By.css("iframe#${ctx.id}")));`;
  if (ctx.src) return `${indent}await driver.switchTo().frame(await driver.findElement(By.css("iframe[src='${ctx.src}']")));`;
  return null;
}

function buildSeleniumFrameSwitchTS(ctx) {
  return buildSeleniumFrameSwitchJS(ctx, '  ');
}

function buildPlaywrightLocatorExpression(base, selection, languageLower) {
  const selectorType = selection.type || inferSelectorType(selection.selector);
  if (languageLower === 'python') {
    if (selectorType === 'text') {
      const textVal = getTextValue(selection);
      if (textVal) {
        const matchMode = selection.matchMode || 'exact';
        if (matchMode === 'contains') {
          return `${base}.get_by_text("${escapeForPythonString(textVal)}", exact=False)`;
        }
        return `${base}.get_by_text("${escapeForPythonString(textVal)}", exact=True)`;
      }
    }
    if (selectorType === 'xpath') {
      const locator = ensureXPathSelector(selection.selector);
      return `${base}.locator("${escapeForPythonString(locator)}")`;
    }
    return `${base}.locator("${escapeForPythonString(selection.selector)}")`;
  }

  // JavaScript / TypeScript
  if (selectorType === 'text') {
    const textVal = getTextValue(selection);
    if (textVal) {
      const matchMode = selection.matchMode || 'exact';
      if (matchMode === 'contains') {
        return `${base}.getByText("${escapeForJSString(textVal)}")`;
      }
      return `${base}.getByText("${escapeForJSString(textVal)}", { exact: true })`;
    }
  }
  if (selectorType === 'xpath') {
    const locator = ensureXPathSelector(selection.selector);
    return `${base}.locator("${escapeForJSString(locator)}")`;
  }
  return `${base}.locator("${escapeForJSString(selection.selector)}")`;
}

function buildSeleniumLocatorSpec(selection) {
  const selectorType = selection.type || inferSelectorType(selection.selector);
  if (selectorType === 'xpath') {
    const value = getXPathValue(selection) || getSelectorCore(selection.selector);
    return {byPython: 'By.XPATH', byJS: 'By.xpath', value};
  }
  if (selectorType === 'text') {
    const textVal = getTextValue(selection);
    if (textVal) {
      const matchMode = selection.matchMode || 'exact';
      let expr;
      if (matchMode === 'exact') {
        expr = `//*[normalize-space(.) = "${textVal}"]`;
      } else {
        expr = `//*[contains(normalize-space(.), "${textVal}")]`;
      }
      return {byPython: 'By.XPATH', byJS: 'By.xpath', value: expr};
    }
  }
  const cssValue = getSelectorCore(selection.selector);
  return {byPython: 'By.CSS_SELECTOR', byJS: 'By.css', value: cssValue};
}

function buildPlaywrightPythonAction(ev, selectorInfo, base = 'page') {
  if (!ev || !selectorInfo || !selectorInfo.selector) return null;
  const selectorType = selectorInfo.type || inferSelectorType(selectorInfo.selector);
  const value = escapeForPythonString(ev.value || '');
  if (ev.action === 'click') {
    if (selectorType === 'text') {
      const textVal = getTextValue(selectorInfo);
      if (textVal) {
        const matchMode = selectorInfo.matchMode || 'exact';
        if (matchMode === 'contains') {
          return `${base}.get_by_text("${escapeForPythonString(textVal)}", exact=False).click()`;
        }
        return `${base}.get_by_text("${escapeForPythonString(textVal)}", exact=True).click()`;
      }
    }
    if (selectorType === 'xpath') {
      const locator = ensureXPathSelector(selectorInfo.selector);
      return `${base}.locator("${escapeForPythonString(locator)}").click()`;
    }
    return `${base}.click("${escapeForPythonString(selectorInfo.selector)}")`;
  }
  if (ev.action === 'input') {
    if (selectorType === 'text') {
      const textVal = getTextValue(selectorInfo);
      if (textVal) {
        const matchMode = selectorInfo.matchMode || 'exact';
        if (matchMode === 'contains') {
          return `${base}.get_by_text("${escapeForPythonString(textVal)}", exact=False).fill("${value}")`;
        }
        return `${base}.get_by_text("${escapeForPythonString(textVal)}", exact=True).fill("${value}")`;
      }
    }
    if (selectorType === 'xpath') {
      const locator = ensureXPathSelector(selectorInfo.selector);
      return `${base}.locator("${escapeForPythonString(locator)}").fill("${value}")`;
    }
    return `${base}.fill("${escapeForPythonString(selectorInfo.selector)}", "${value}")`;
  }
  return null;
}

function buildPlaywrightJSAction(ev, selectorInfo, base = 'page') {
  if (!ev || !selectorInfo || !selectorInfo.selector) return null;
  const selectorType = selectorInfo.type || inferSelectorType(selectorInfo.selector);
  const value = escapeForJSString(ev.value || '');
  if (ev.action === 'click') {
    if (selectorType === 'text') {
      const textVal = getTextValue(selectorInfo);
      if (textVal) {
        const matchMode = selectorInfo.matchMode || 'exact';
        if (matchMode === 'contains') {
          return `await ${base}.getByText("${escapeForJSString(textVal)}").click();`;
        }
        return `await ${base}.getByText("${escapeForJSString(textVal)}", { exact: true }).click();`;
      }
    }
    if (selectorType === 'xpath') {
      const locator = ensureXPathSelector(selectorInfo.selector);
      return `await ${base}.locator("${escapeForJSString(locator)}").click();`;
    }
    return `await ${base}.click("${escapeForJSString(selectorInfo.selector)}");`;
  }
  if (ev.action === 'input') {
    if (selectorType === 'text') {
      const textVal = getTextValue(selectorInfo);
      if (textVal) {
        const matchMode = selectorInfo.matchMode || 'exact';
        if (matchMode === 'contains') {
          return `await ${base}.getByText("${escapeForJSString(textVal)}").fill("${value}");`;
        }
        return `await ${base}.getByText("${escapeForJSString(textVal)}", { exact: true }).fill("${value}");`;
      }
    }
    if (selectorType === 'xpath') {
      const locator = ensureXPathSelector(selectorInfo.selector);
      return `await ${base}.locator("${escapeForJSString(locator)}").fill("${value}");`;
    }
    return `await ${base}.fill("${escapeForJSString(selectorInfo.selector)}", "${value}");`;
  }
  return null;
}

function buildSeleniumPythonAction(ev, selectorInfo) {
  if (!ev || !selectorInfo || !selectorInfo.selector) return null;
  const selectorType = selectorInfo.type || inferSelectorType(selectorInfo.selector);
  const value = escapeForPythonString(ev.value || '');
  if (selectorType === 'xpath') {
    const xpath = escapeForPythonString(getXPathValue(selectorInfo));
    if (ev.action === 'click') {
      return `driver.find_element(By.XPATH, "${xpath}").click()`;
    }
    if (ev.action === 'input') {
      return `driver.find_element(By.XPATH, "${xpath}").send_keys("${value}")`;
    }
  }
  if (selectorType === 'text') {
    const textVal = getTextValue(selectorInfo);
    if (textVal) {
      const matchMode = selectorInfo.matchMode || 'exact';
      const expr = matchMode === 'exact'
        ? `//*[normalize-space(.) = "${textVal}"]`
        : `//*[contains(normalize-space(.), "${textVal}")]`;
      const escapedExpr = escapeForPythonString(expr);
      if (ev.action === 'click') {
        return `driver.find_element(By.XPATH, "${escapedExpr}").click()`;
      }
      if (ev.action === 'input') {
        return `driver.find_element(By.XPATH, "${escapedExpr}").send_keys("${value}")`;
      }
    }
  }
  const cssSelector = escapeForPythonString(selectorInfo.selector);
  if (ev.action === 'click') {
    return `driver.find_element(By.CSS_SELECTOR, "${cssSelector}").click()`;
  }
  if (ev.action === 'input') {
    return `driver.find_element(By.CSS_SELECTOR, "${cssSelector}").send_keys("${value}")`;
  }
  return null;
}

function buildSeleniumJSAction(ev, selectorInfo) {
  if (!ev || !selectorInfo || !selectorInfo.selector) return null;
  const selectorType = selectorInfo.type || inferSelectorType(selectorInfo.selector);
  const value = escapeForJSString(ev.value || '');
  if (selectorType === 'xpath') {
    const xpath = escapeForJSString(getXPathValue(selectorInfo));
    if (ev.action === 'click') {
      return `  await driver.findElement(By.xpath("${xpath}")).click();`;
    }
    if (ev.action === 'input') {
      return `  await driver.findElement(By.xpath("${xpath}")).sendKeys("${value}");`;
    }
  }
  if (selectorType === 'text') {
    const textVal = getTextValue(selectorInfo);
    if (textVal) {
      const matchMode = selectorInfo.matchMode || 'exact';
      const expr = matchMode === 'exact'
        ? `//*[normalize-space(.) = "${textVal}"]`
        : `//*[contains(normalize-space(.), "${textVal}")]`;
      const escapedExpr = escapeForJSString(expr);
      if (ev.action === 'click') {
        return `  await driver.findElement(By.xpath("${escapedExpr}")).click();`;
      }
      if (ev.action === 'input') {
        return `  await driver.findElement(By.xpath("${escapedExpr}")).sendKeys("${value}");`;
      }
    }
  }
  const cssSelector = escapeForJSString(selectorInfo.selector);
  if (ev.action === 'click') {
    return `  await driver.findElement(By.css("${cssSelector}")).click();`;
  }
  if (ev.action === 'input') {
    return `  await driver.findElement(By.css("${cssSelector}")).sendKeys("${value}");`;
  }
  return null;
}

function generateCode(events, manualList, framework, language) {
  const lines = [];
  const frameworkLower = (framework || '').toLowerCase();
  const languageLower = (language || '').toLowerCase();
  const manualActionsList = Array.isArray(manualList) ? manualList.filter(Boolean) : [];
  const timeline = buildActionTimeline(events || [], manualActionsList);
  
  if (frameworkLower === 'playwright') {
    if (languageLower === 'python') {
      lines.push("from playwright.sync_api import sync_playwright");
      lines.push("");
      lines.push("with sync_playwright() as p:");
      lines.push("  browser = p.chromium.launch(headless=False)");
      lines.push("  page = browser.new_page()");
      let currentFrameContext = null;
      let frameLocatorIndex = 0;
      let currentBase = 'page';
      timeline.forEach((entry) => {
        if (entry.kind === 'event') {
          const {event, selectorInfo} = entry;
          const targetFrame = selectorInfo && selectorInfo.iframeContext ? selectorInfo.iframeContext : null;
          if (!framesEqual(targetFrame, currentFrameContext)) {
            if (targetFrame) {
              frameLocatorIndex += 1;
              const alias = `frame_locator_${frameLocatorIndex}`;
              const setupLines = buildPlaywrightFrameLocatorLines(targetFrame, languageLower, alias, '  ');
              setupLines.forEach(line => lines.push(`  ${line}`));
              currentBase = alias;
              currentFrameContext = targetFrame;
            } else {
              currentBase = 'page';
              currentFrameContext = null;
            }
          }
          const actionLine = buildPlaywrightPythonAction(event, selectorInfo, currentBase);
          if (actionLine) {
            lines.push(`  ${actionLine}`);
          }
        } else if (entry.kind === 'manual') {
          emitManualActionLines(lines, entry.action, frameworkLower, languageLower, '  ');
        }
      });
      lines.push("  browser.close()");
    } else if (languageLower === 'javascript') {
      lines.push("const { chromium } = require('playwright');");
      lines.push("");
      lines.push("(async () => {");
      lines.push("  const browser = await chromium.launch({ headless: false });");
      lines.push("  const page = await browser.newPage();");
      let currentFrameContext = null;
      let frameLocatorIndex = 0;
      let currentBase = 'page';
      timeline.forEach((entry) => {
        if (entry.kind === 'event') {
          const {event, selectorInfo} = entry;
          const targetFrame = selectorInfo && selectorInfo.iframeContext ? selectorInfo.iframeContext : null;
          if (!framesEqual(targetFrame, currentFrameContext)) {
            if (targetFrame) {
              frameLocatorIndex += 1;
              const alias = `frameLocator${frameLocatorIndex}`;
              const setupLines = buildPlaywrightFrameLocatorLines(targetFrame, languageLower, alias, '  ');
              setupLines.forEach(line => lines.push(`  ${line}`));
              currentBase = alias;
              currentFrameContext = targetFrame;
            } else {
              currentBase = 'page';
              currentFrameContext = null;
            }
          }
          const actionLine = buildPlaywrightJSAction(event, selectorInfo, currentBase);
          if (actionLine) {
            lines.push(`  ${actionLine}`);
          }
        } else if (entry.kind === 'manual') {
          emitManualActionLines(lines, entry.action, frameworkLower, languageLower, '  ');
        }
      });
      lines.push("  await browser.close();");
      lines.push("})();");
    } else if (languageLower === 'typescript') {
      lines.push("import { chromium } from 'playwright';");
      lines.push("");
      lines.push("(async () => {");
      lines.push("  const browser = await chromium.launch({ headless: false });");
      lines.push("  const page = await browser.newPage();");
      let currentFrameContext = null;
      let frameLocatorIndex = 0;
      let currentBase = 'page';
      timeline.forEach((entry) => {
        if (entry.kind === 'event') {
          const {event, selectorInfo} = entry;
          const targetFrame = selectorInfo && selectorInfo.iframeContext ? selectorInfo.iframeContext : null;
          if (!framesEqual(targetFrame, currentFrameContext)) {
            if (targetFrame) {
              frameLocatorIndex += 1;
              const alias = `frameLocator${frameLocatorIndex}`;
              const setupLines = buildPlaywrightFrameLocatorLines(targetFrame, languageLower, alias, '  ');
              setupLines.forEach(line => lines.push(`  ${line}`));
              currentBase = alias;
              currentFrameContext = targetFrame;
            } else {
              currentBase = 'page';
              currentFrameContext = null;
            }
          }
          const actionLine = buildPlaywrightJSAction(event, selectorInfo, currentBase);
          if (actionLine) {
            lines.push(`  ${actionLine}`);
          }
        } else if (entry.kind === 'manual') {
          emitManualActionLines(lines, entry.action, frameworkLower, languageLower, '  ');
        }
      });
      lines.push("  await browser.close();");
      lines.push("})();");
    }
  } else if (frameworkLower === 'selenium') {
    if (languageLower === 'python') {
      lines.push("from selenium import webdriver");
      lines.push("from selenium.webdriver.common.by import By");
      lines.push("");
      lines.push("driver = webdriver.Chrome()");
      lines.push("driver.get('REPLACE_URL')");
      let currentFrame = null;
      timeline.forEach((entry) => {
        if (entry.kind === 'event') {
          const {event, selectorInfo} = entry;
          const targetFrame = selectorInfo && selectorInfo.iframeContext ? selectorInfo.iframeContext : null;
          if (targetFrame) {
            const switchLine = buildSeleniumFrameSwitchPython(targetFrame);
            if (switchLine) {
              lines.push(switchLine);
              currentFrame = targetFrame;
            }
          } else if (currentFrame) {
            lines.push('driver.switch_to.default_content()');
            currentFrame = null;
          }
          const actionLine = buildSeleniumPythonAction(event, selectorInfo);
          if (actionLine) {
            lines.push(actionLine);
          }
        } else if (entry.kind === 'manual') {
          emitManualActionLines(lines, entry.action, frameworkLower, languageLower, '');
        }
      });
      lines.push("driver.quit()");
    } else if (languageLower === 'javascript') {
      lines.push("const { Builder, By } = require('selenium-webdriver');");
      lines.push("const chrome = require('selenium-webdriver/chrome');");
      lines.push("");
      lines.push("(async () => {");
      lines.push("  const driver = await new Builder()");
      lines.push("    .forBrowser('chrome')");
      lines.push("    .setChromeOptions(new chrome.Options().addArguments('--headless=new'))");
      lines.push("    .build();");
      lines.push("  await driver.get('REPLACE_URL');");
      let currentFrame = null;
      timeline.forEach((entry) => {
        if (entry.kind === 'event') {
          const {event, selectorInfo} = entry;
          const targetFrame = selectorInfo && selectorInfo.iframeContext ? selectorInfo.iframeContext : null;
          if (targetFrame) {
            const switchLine = buildSeleniumFrameSwitchJS(targetFrame, '  ');
            if (switchLine) {
              lines.push(switchLine);
              currentFrame = targetFrame;
            }
          } else if (currentFrame) {
            lines.push('  await driver.switchTo().defaultContent();');
            currentFrame = null;
          }
          const actionLine = buildSeleniumJSAction(event, selectorInfo);
          if (actionLine) {
            lines.push(actionLine);
          }
        } else if (entry.kind === 'manual') {
          emitManualActionLines(lines, entry.action, frameworkLower, languageLower, '  ');
        }
      });
      lines.push("  await driver.quit();");
      lines.push("})();");
    } else if (languageLower === 'typescript') {
      lines.push("import { Builder, By } from 'selenium-webdriver';");
      lines.push("import * as chrome from 'selenium-webdriver/chrome';");
      lines.push("");
      lines.push("(async () => {");
      lines.push("  const driver = await new Builder()");
      lines.push("    .forBrowser('chrome')");
      lines.push("    .setChromeOptions(new chrome.Options().addArguments('--headless=new'))");
      lines.push("    .build();");
      lines.push("  await driver.get('REPLACE_URL');");
      let currentFrame = null;
      timeline.forEach((entry) => {
        if (entry.kind === 'event') {
          const {event, selectorInfo} = entry;
          const targetFrame = selectorInfo && selectorInfo.iframeContext ? selectorInfo.iframeContext : null;
          if (targetFrame) {
            const switchLine = buildSeleniumFrameSwitchTS(targetFrame);
            if (switchLine) {
              lines.push(switchLine);
              currentFrame = targetFrame;
            }
          } else if (currentFrame) {
            lines.push('  await driver.switchTo().defaultContent();');
            currentFrame = null;
          }
          const actionLine = buildSeleniumJSAction(event, selectorInfo);
          if (actionLine) {
            lines.push(actionLine);
          }
        } else if (entry.kind === 'manual') {
          emitManualActionLines(lines, entry.action, frameworkLower, languageLower, '  ');
        }
      });
      lines.push("  await driver.quit();");
      lines.push("})();");
    }
  }
  return lines.join('\n');
}