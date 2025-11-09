/**
 * 다양한 셀렉터 정보를 바탕으로 실제 DOM 요소를 찾는 헬퍼.
 * 리플레이 및 요소 선택 워크플로우에서 재사용된다.
 */
import { collectSelectorInfos } from '../selectors/index.js';
import { normalizeText, parseSelectorForMatching } from '../utils/dom.js';

/**
 * 셀렉터 문자열 한 개를 받아 DOM 요소를 직접 찾는다.
 * XPath/text/CSS 포맷을 모두 지원한다.
 */
function findElementBySelector(selector) {
  if (!selector) return null;
  try {
    if (selector.startsWith('xpath=')) {
      // 확장자가 붙어 있으면 앞부분을 제거하고 XPath로 평가.
      const expression = selector.slice(6);
      return document.evaluate(expression, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue || null;
    }
    if (selector.startsWith('//') || selector.startsWith('(')) {
      // xpath= 접두사가 없어도 // 혹은 ( 으로 시작하면 XPath로 간주한다.
      return document.evaluate(selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue || null;
    }
    if (selector.startsWith('text="') || selector.startsWith("text='")) {
      // text= 접두사는 순수 문자열 비교이므로 모든 요소를 순회해 일치 여부를 확인.
      const textLiteral = selector.replace(/^text=/, '');
      const trimmed = textLiteral.replace(/^['"]|['"]$/g, '');
      const decoded = trimmed.replace(/\\"/g, '"');
      return Array.from(document.querySelectorAll('*')).find((el) => (el.innerText || '').trim().includes(decoded));
    }
    return document.querySelector(selector);
  } catch (err) {
    return null;
  }
}

/**
 * selector 정보 객체와 scope를 받아 상대/절대 여부에 따라 요소를 찾는다.
 * @param {{selector: string, type?: string, relation?: string, matchMode?: string}} info
 * @param {Element|Document} scope
 */
function findElementInScope(info, scope) {
  if (!info || !info.selector) return null;
  const selector = info.selector;
  const type = info.type || parseSelectorForMatching(selector).type;
  const isRelative = info.relation === 'relative';
  const currentScope = scope && scope.nodeType === 1 ? scope : document;

  const runGlobal = () => findElementBySelector(selector);

  try {
    if (isRelative && currentScope !== document) {
      if (type === 'xpath' || selector.startsWith('xpath=')) {
        // 상대 XPath: 현재 scope를 context node로 두고 평가한다.
        const expression = selector.startsWith('xpath=') ? selector.slice(6) : selector;
        const doc = currentScope.ownerDocument || document;
        const res = doc.evaluate(expression, currentScope, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        return res.singleNodeValue || null;
      }
      if (type === 'text' || selector.startsWith('text=')) {
        const raw = selector.replace(/^text=/, '');
        const trimmed = raw.replace(/^['"]|['"]$/g, '');
        const targetText = normalizeText(trimmed);
        const matchMode = info.matchMode || 'contains';
        if (!targetText) return null;
        const elements = currentScope.querySelectorAll('*');
        for (const el of elements) {
          // 모든 후보 요소의 정규화된 텍스트를 비교한다.
          const txt = normalizeText(el.innerText || el.textContent || '');
          if (!txt) continue;
          if (matchMode === 'exact' ? txt === targetText : txt.includes(targetText)) {
            return el;
          }
        }
        return null;
      }
      let css = selector;
      if (css.startsWith('css=')) {
        css = css.slice(4);
      }
      // 상대 CSS는 currentScope 내부에서 querySelector를 실행.
      return currentScope.querySelector(css);
    }
    // relative가 아니면 전역 DOM에서 찾는다.
    return runGlobal();
  } catch (err) {
    return null;
  }
}

export function findElementByPath(path) {
  if (!Array.isArray(path) || path.length === 0) return null;
  let currentElement = null;
  let currentScope = document;
  for (const entry of path) {
    // relative는 직전 요소를 scope로 삼고, 아니면 전역으로 리셋한다.
    const scope = entry.relation === 'relative' ? currentElement || currentScope : document;
    const el = findElementInScope(entry, scope);
    if (!el) return null;
    currentElement = el;
    currentScope = el;
  }
  return currentElement;
}

export function findElementWithInfo(info) {
  if (!info || !info.selector) return null;
  const type = info.type || parseSelectorForMatching(info.selector).type;
  if (type === 'text') {
    const targetText = normalizeText(info.textValue) || null;
    if (targetText) {
      const matchMode = info.matchMode || 'contains';
      // 텍스트 기반 후보는 전체 DOM을 순회하며 일치 텍스트를 찾는다.
      const match = Array.from(document.querySelectorAll('*')).find((el) => {
        const elText = normalizeText(el.innerText || el.textContent || '');
        if (!elText) return false;
        return matchMode === 'exact' ? elText === targetText : elText.includes(targetText);
      });
      if (match) return match;
    }
  }
  if (type === 'xpath') {
    const expression = info.xpathValue || info.selector.replace(/^xpath=/, '');
    if (expression) {
      try {
        // XPath는 실패해도 throw가 날 수 있으니 try/catch로 감싼다.
        const res = document.evaluate(expression, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        if (res.singleNodeValue) return res.singleNodeValue;
      } catch (err) {
        // ignore
      }
    }
  }
  return findElementBySelector(info.selector);
}

export async function locateElementForEvent(eventRecord, timeoutMs = 5000) {
  const infos = collectSelectorInfos(eventRecord);
  if (infos.length === 0) {
    return { element: null, info: null };
  }
  const start = performance.now();
  const retryInterval = 200;
  while (performance.now() - start < timeoutMs) {
    // 후보 셀렉터 리스트를 순서대로 시도한다.
    for (const info of infos) {
      const element = findElementWithInfo(info);
      if (element) {
        return { element, info };
      }
    }
    // 아직 못 찾았다면 잠깐 대기 후 다시 시도해 DOM 변화를 기다린다.
    await new Promise((resolve) => setTimeout(resolve, retryInterval));
  }
  for (const info of infos) {
    // 제한 시간을 넘겼다면 마지막으로 한 번 더 순회해보되 바로 반환한다.
    const element = findElementWithInfo(info);
    if (element) {
      return { element, info };
    }
  }
  return { element: null, info: null };
}

export function getSelectorCore(selector) {
  if (!selector) return '';
  if (selector.startsWith('css=')) return selector.slice(4);
  if (selector.startsWith('xpath=')) return selector.slice(6);
  if (selector.startsWith('text=')) return selector.slice(5);
  return selector;
}

