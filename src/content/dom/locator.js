import { collectSelectorInfos } from '../selectors/index.js';
import { normalizeText, parseSelectorForMatching } from '../utils/dom.js';

function findElementBySelector(selector) {
  if (!selector) return null;
  try {
    if (selector.startsWith('xpath=')) {
      const expression = selector.slice(6);
      return document.evaluate(expression, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue || null;
    }
    if (selector.startsWith('//') || selector.startsWith('(')) {
      return document.evaluate(selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue || null;
    }
    if (selector.startsWith('text="') || selector.startsWith("text='")) {
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
      return currentScope.querySelector(css);
    }
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
    for (const info of infos) {
      const element = findElementWithInfo(info);
      if (element) {
        return { element, info };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, retryInterval));
  }
  for (const info of infos) {
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

