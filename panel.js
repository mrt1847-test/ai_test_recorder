const startBtn = document.getElementById('start-record');
const stopBtn = document.getElementById('stop-record');
const timeline = document.getElementById('timeline');
const selectorList = document.getElementById('selector-list');
const iframeBanner = document.getElementById('iframe-banner');
const codeOutput = document.getElementById('code-output');
const logEntries = document.getElementById('log-entries');
let recording = false;
let selectedFramework = 'playwright';
let selectedLanguage = 'python';
let currentEventIndex = -1; // 현재 선택된 이벤트 인덱스
let allEvents = []; // 모든 이벤트 저장

// 프레임워크와 언어 선택 드롭다운
const frameworkSelect = document.getElementById('framework-select');
const languageSelect = document.getElementById('language-select');

// 프레임워크 변경 이벤트
frameworkSelect.addEventListener('change', (e) => {
  selectedFramework = e.target.value;
  updateCode(); // 실시간 코드 업데이트
});

// 언어 변경 이벤트
languageSelect.addEventListener('change', (e) => {
  selectedLanguage = e.target.value;
  updateCode(); // 실시간 코드 업데이트
});

startBtn.addEventListener('click', ()=>{
  const url = document.getElementById('test-url').value.trim();
  
  // 현재 활성 탭 가져오기
  chrome.tabs.query({active:true, currentWindow:true}, (tabs) => {
    if (!tabs[0]) {
      alert('활성 탭을 찾을 수 없습니다.');
      return;
    }
    
    const currentTab = tabs[0];
    
    // URL이 입력된 경우 해당 URL로 이동
    if (url) {
      chrome.tabs.update(currentTab.id, {url: url}, () => {
        // URL 업데이트 후 약간의 지연을 두고 녹화 시작
        // (페이지 로드가 완료될 시간을 줌)
        setTimeout(() => {
          startRecording();
        }, 1000);
      });
    } else {
      // URL이 없으면 현재 탭에서 바로 시작
      startRecording();
    }
  });
  
  function startRecording() {
    recording = true;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    chrome.storage.local.set({events:[]});
    allEvents = [];
    timeline.innerHTML = '';
    selectorList.innerHTML = '';
    codeOutput.textContent = '';
    logEntries.innerHTML = ''; // 리플레이 로그 초기화
    currentEventIndex = -1;
    listenEvents();
    
    // 현재 활성 탭에 녹화 시작 메시지 전송
    chrome.tabs.query({active:true, currentWindow:true}, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {type: 'RECORDING_START'});
      }
    });
  }
});

stopBtn.addEventListener('click', ()=>{
  recording = false;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  
  // 현재 활성 탭에 녹화 중지 메시지 전송
  chrome.tabs.query({active:true, currentWindow:true}, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, {type: 'RECORDING_STOP'});
    }
  });
  
  loadTimeline();
});

function loadTimeline() {
  chrome.runtime.sendMessage({type:'GET_EVENTS'}, (res) => {
    allEvents = res && res.events || [];
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
  chrome.runtime.onMessage.addListener(function handler(msg, sender) {
    if (msg.type === 'EVENT_RECORDED') {
      allEvents.push(msg.event);
      const index = allEvents.length - 1;
      appendTimelineItem(msg.event, index);
      // 자동으로 마지막 이벤트 선택
      currentEventIndex = index;
      document.querySelectorAll('.timeline-item').forEach(item => item.classList.remove('selected'));
      const lastItem = document.querySelector(`[data-event-index="${index}"]`);
      if (lastItem) {
        lastItem.classList.add('selected');
      }
      showSelectors(msg.event.selectorCandidates || [], msg.event, index);
      showIframe(msg.event.iframeContext);
      // 실시간 코드 업데이트
      updateCode();
    }
    if (msg.type === 'ELEMENT_HOVERED') {
      // 마우스 오버 시 DevTools에 셀렉터 정보 표시
      if (msg.selectors && msg.selectors.length > 0) {
        showSelectors(msg.selectors, null, -1);
      }
    }
    if (msg.type === 'REPLAY_STEP_RESULT') {
      const div = document.createElement('div');
      div.style.padding = '4px 8px';
      div.style.margin = '2px 0';
      div.style.borderRadius = '4px';
      if (msg.ok) {
        div.style.background = '#e8f5e9';
        div.style.color = '#2e7d32';
        div.textContent = `[${msg.step || '?'}/${msg.total || '?'}] ✓ OK - ${msg.used || ''} (${msg.selector || 'N/A'})`;
      } else {
        div.style.background = '#ffebee';
        div.style.color = '#c62828';
        div.textContent = `[${msg.step || '?'}/${msg.total || '?'}] ✗ FAIL - ${msg.reason || 'unknown error'}`;
      }
      logEntries.appendChild(div);
      // 자동 스크롤
      logEntries.scrollTop = logEntries.scrollHeight;
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
  list.forEach(s => {
    const item = document.createElement('div');
    item.className = 'selector-item';
    const isApplied = event && event.primarySelector === s.selector;
    item.innerHTML = `<span class="sel">${s.selector}</span><span class="score">${s.score}%</span><button ${isApplied ? 'style="background: #4CAF50; color: white;"' : ''}>${isApplied ? '✓ 적용됨' : 'Apply'}</button><button>Highlight</button><div class="reason">${s.reason}</div>`;
    item.querySelector('button').addEventListener('click', ()=> { applySelector(s, idx); });
    item.querySelectorAll('button')[1].addEventListener('click', ()=> { highlightSelector(s.selector); });
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
      chrome.storage.local.set({events: evs}, () => {
        // UI 업데이트
        if (allEvents[targetIndex]) {
          allEvents[targetIndex].primarySelector = s.selector;
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

function highlightSelector(sel) {
  chrome.tabs.query({active:true,currentWindow:true}, tabs => {
    if (!tabs[0]) return;
    chrome.scripting.executeScript({target:{tabId:tabs[0].id}, func: (selector)=>{
      try {
        const el = document.querySelector(selector);
        if (!el) return;
        const prev = el.style.outline;
        el.style.outline = '3px solid rgba(0,150,136,0.8)';
        setTimeout(()=> el.style.outline = prev, 1500);
      } catch(e){}
    }, args:[sel]});
  });
}

document.getElementById('view-code').addEventListener('click', async ()=>{
  updateCode();
});

document.getElementById('replay-btn').addEventListener('click', async ()=>{
  startReplay();
});

function startReplay() {
  chrome.runtime.sendMessage({type:'GET_EVENTS'}, (res) => {
    const events = res && res.events || [];
    if (events.length === 0) {
      alert('재생할 이벤트가 없습니다.');
      return;
    }
    
    // 로그 초기화
    logEntries.innerHTML = '';
    const startMsg = document.createElement('div');
    startMsg.textContent = `리플레이 시작: ${events.length}개 이벤트`;
    startMsg.style.color = '#2196f3';
    startMsg.style.fontWeight = 'bold';
    logEntries.appendChild(startMsg);
    
    // 현재 활성 탭 찾기
    chrome.tabs.query({active:true, currentWindow:true}, (tabs) => {
      if (!tabs[0]) {
        alert('활성 탭을 찾을 수 없습니다.');
        return;
      }
      
      // content script에 리플레이 시작 메시지 전송
      chrome.tabs.sendMessage(tabs[0].id, {
        type: 'REPLAY_START',
        events: events
      }, (response) => {
        if (chrome.runtime.lastError) {
          alert('리플레이를 시작할 수 없습니다. 페이지를 새로고침한 후 다시 시도하세요.');
          console.error(chrome.runtime.lastError);
        }
      });
    });
  });
}

function updateCode() {
  chrome.runtime.sendMessage({type:'GET_EVENTS'}, (res) => {
    const events = res && res.events || [];
    allEvents = events;
    const code = generateCode(events, selectedFramework, selectedLanguage);
    codeOutput.textContent = code;
  });
}

function generateCode(events, framework, language) {
  let lines = [];
  const frameworkLower = framework.toLowerCase();
  const languageLower = language.toLowerCase();
  
  if (frameworkLower === 'playwright') {
    if (languageLower === 'python') {
      lines.push("from playwright.sync_api import sync_playwright");
      lines.push("");
      lines.push("with sync_playwright() as p:");
      lines.push("  browser = p.chromium.launch(headless=False)");
      lines.push("  page = browser.new_page()");
      for (const ev of events) {
        const sel = ev.primarySelector || (ev.selectorCandidates && ev.selectorCandidates[0] && ev.selectorCandidates[0].selector) || ev.tag;
        if (ev.action === 'click') lines.push(`  page.click("${sel}")`);
        if (ev.action === 'input') lines.push(`  page.fill("${sel}", "${ev.value || ''}")`);
      }
      lines.push("  browser.close()");
    } else if (languageLower === 'javascript') {
      lines.push("const { chromium } = require('playwright');");
      lines.push("");
      lines.push("(async () => {");
      lines.push("  const browser = await chromium.launch({ headless: false });");
      lines.push("  const page = await browser.newPage();");
      for (const ev of events) {
        const sel = ev.primarySelector || (ev.selectorCandidates && ev.selectorCandidates[0] && ev.selectorCandidates[0].selector) || ev.tag;
        if (ev.action === 'click') lines.push(`  await page.click("${sel}");`);
        if (ev.action === 'input') lines.push(`  await page.fill("${sel}", "${ev.value || ''}");`);
      }
      lines.push("  await browser.close();");
      lines.push("})();");
    } else if (languageLower === 'typescript') {
      lines.push("import { chromium } from 'playwright';");
      lines.push("");
      lines.push("(async () => {");
      lines.push("  const browser = await chromium.launch({ headless: false });");
      lines.push("  const page = await browser.newPage();");
      for (const ev of events) {
        const sel = ev.primarySelector || (ev.selectorCandidates && ev.selectorCandidates[0] && ev.selectorCandidates[0].selector) || ev.tag;
        if (ev.action === 'click') lines.push(`  await page.click("${sel}");`);
        if (ev.action === 'input') lines.push(`  await page.fill("${sel}", "${ev.value || ''}");`);
      }
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
      for (const ev of events) {
        const sel = ev.primarySelector || (ev.selectorCandidates && ev.selectorCandidates[0] && ev.selectorCandidates[0].selector) || ev.tag;
        if (ev.action === 'click') {
          lines.push(`driver.find_element(By.CSS_SELECTOR, "${sel}").click()`);
        }
        if (ev.action === 'input') {
          lines.push(`driver.find_element(By.CSS_SELECTOR, "${sel}").send_keys("${ev.value || ''}")`);
        }
      }
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
      for (const ev of events) {
        const sel = ev.primarySelector || (ev.selectorCandidates && ev.selectorCandidates[0] && ev.selectorCandidates[0].selector) || ev.tag;
        if (ev.action === 'click') {
          lines.push(`  await driver.findElement(By.css("${sel}")).click();`);
        }
        if (ev.action === 'input') {
          lines.push(`  await driver.findElement(By.css("${sel}")).sendKeys("${ev.value || ''}");`);
        }
      }
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
      for (const ev of events) {
        const sel = ev.primarySelector || (ev.selectorCandidates && ev.selectorCandidates[0] && ev.selectorCandidates[0].selector) || ev.tag;
        if (ev.action === 'click') {
          lines.push(`  await driver.findElement(By.css("${sel}")).click();`);
        }
        if (ev.action === 'input') {
          lines.push(`  await driver.findElement(By.css("${sel}")).sendKeys("${ev.value || ''}");`);
        }
      }
      lines.push("  await driver.quit();");
      lines.push("})();");
    }
  }
  return lines.join('\n');
}