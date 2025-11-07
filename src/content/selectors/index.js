import {
  buildFullXPath,
  buildRelativeCssSelector,
  buildRelativeXPathSelector,
  buildRobustXPath,
  buildUniqueCssPath,
  countMatchesForSelector,
  escapeAttributeValue,
  inferSelectorType,
  normalizeText,
  parseSelectorForMatching
} from '../utils/dom.js';

const DEFAULT_TEXT_SCORE = 65;
const DEFAULT_TAG_SCORE = 20;

export function getIframeContext(target) {
  try {
    const win = target && target.ownerDocument && target.ownerDocument.defaultView;
    if (!win) return null;
    const frameEl = win.frameElement || null;
    if (!frameEl) return null;
    return {
      id: frameEl.id || null,
      name: frameEl.name || null,
      src: frameEl.src || (frameEl.getAttribute && frameEl.getAttribute('src')) || null
    };
  } catch (e) {
    return null;
  }
}

function enrichCandidateWithUniqueness(baseCandidate, options = {}) {
  if (!baseCandidate || !baseCandidate.selector) return null;
  const candidate = { ...baseCandidate };
  const originalType = candidate.type || inferSelectorType(candidate.selector);
  const parsed = parseSelectorForMatching(candidate.selector, candidate.type);
  const reasonParts = candidate.reason ? [candidate.reason] : [];

  if (!options.skipGlobalCheck) {
    const globalCount = countMatchesForSelector(parsed, document, { matchMode: candidate.matchMode });
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
    const contextCount = countMatchesForSelector(parsed, options.contextElement, { matchMode: candidate.matchMode });
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
      const count = countMatchesForSelector(uniqueParsed, contextEl || document, { matchMode: candidate.matchMode });
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

function createCandidateRegistry() {
  const results = [];
  const seen = new Set();
  return {
    add(candidate) {
      if (!candidate || !candidate.selector) return;
      const type = candidate.type || inferSelectorType(candidate.selector);
      const key = `${type || ''}::${candidate.selector}`;
      if (seen.has(key)) return;
      seen.add(key);
      results.push(candidate);
    },
    list() {
      return results;
    }
  };
}

export function getSelectorCandidates(element) {
  if (!element) return [];
  const registry = createCandidateRegistry();

  try {
    if (element.id) {
      registry.add(
        enrichCandidateWithUniqueness(
          { type: 'id', selector: `#${element.id}`, score: 90, reason: 'id 속성' },
          { duplicateScore: 60, element }
        )
      );
    }
    if (element.dataset && element.dataset.testid) {
      registry.add(
        enrichCandidateWithUniqueness(
          { type: 'data-testid', selector: `[data-testid="${element.dataset.testid}"]`, score: 85, reason: 'data-testid 속성' },
          { duplicateScore: 70, element }
        )
      );
    }
    const nameAttr = element.getAttribute && element.getAttribute('name');
    if (nameAttr) {
      registry.add(
        enrichCandidateWithUniqueness(
          { type: 'name', selector: `[name="${nameAttr}"]`, score: 80, reason: 'name 속성' },
          { duplicateScore: 65, element }
        )
      );
    }
  } catch (e) {
    // ignore attribute access errors
  }

  if (element.classList && element.classList.length) {
    const cls = Array.from(element.classList).slice(0, 3).join('.');
    registry.add(
      enrichCandidateWithUniqueness(
        { type: 'class', selector: `.${cls}`, score: 60, reason: 'class 조합' },
        { duplicateScore: 55, element }
      )
    );
  }

  const rawText = (element.innerText || element.textContent || '').trim().split('\n').map((t) => t.trim()).filter(Boolean)[0];
  if (rawText) {
    const truncatedText = rawText.slice(0, 60);
    const textCandidate = enrichCandidateWithUniqueness(
      { type: 'text', selector: `text="${escapeAttributeValue(truncatedText)}"`, score: DEFAULT_TEXT_SCORE, reason: '텍스트 일치', textValue: truncatedText },
      { duplicateScore: 55, element }
    );
    if (textCandidate) {
      textCandidate.matchMode = textCandidate.matchMode || 'exact';
      registry.add(textCandidate);
    }
  }

  const robustXPath = buildRobustXPath(element);
  if (robustXPath) {
    registry.add(
      enrichCandidateWithUniqueness(
        { type: 'xpath', selector: `xpath=${robustXPath}`, score: 60, reason: '속성 기반 XPath', xpathValue: robustXPath },
        { duplicateScore: 55, element }
      )
    );
  }

  const fullXPath = buildFullXPath(element);
  if (fullXPath) {
    registry.add(
      enrichCandidateWithUniqueness(
        { type: 'xpath', selector: `xpath=${fullXPath}`, score: 45, reason: 'Full XPath (절대 경로)', xpathValue: fullXPath },
        { duplicateScore: 40, element, enableIndexing: false }
      )
    );
  }

  registry.add(
    enrichCandidateWithUniqueness(
      { type: 'tag', selector: element.tagName.toLowerCase(), score: DEFAULT_TAG_SCORE, reason: '태그 이름' },
      { duplicateScore: 30, allowZero: true, element }
    )
  );

  return registry.list();
}

export function getChildSelectorCandidates(parent, child) {
  if (!parent || !child) return [];
  const registry = createCandidateRegistry();

  const relativeCss = buildRelativeCssSelector(parent, child);
  if (relativeCss) {
    registry.add(
      enrichCandidateWithUniqueness(
        { type: 'css', selector: `css=${relativeCss}`, score: 88, reason: '부모 요소 기준 CSS 경로', relation: 'relative' },
        { skipGlobalCheck: true, contextElement: parent, contextLabel: '부모', duplicateScore: 70, element: child }
      )
    );
  }

  const relativeXPath = buildRelativeXPathSelector(parent, child);
  if (relativeXPath) {
    registry.add(
      enrichCandidateWithUniqueness(
        { type: 'xpath', selector: `xpath=${relativeXPath}`, score: 85, reason: '부모 요소 기준 XPath 경로', relation: 'relative', xpathValue: relativeXPath },
        { skipGlobalCheck: true, contextElement: parent, contextLabel: '부모', duplicateScore: 68, element: child }
      )
    );
  }

  (getSelectorCandidates(child) || []).forEach((cand) => {
    registry.add({ ...cand, relation: cand.relation || 'global' });
  });

  return registry.list();
}

export function getParentSelectorCandidates(child, parent) {
  if (!child || !parent) return [];
  const registry = createCandidateRegistry();

  let current = parent;
  let depth = 1;
  while (current && current.nodeType === 1) {
    const steps = Array(depth).fill('..').join('/');
    registry.add(
      enrichCandidateWithUniqueness(
        { type: 'xpath', selector: `xpath=${steps}`, score: Math.max(70, 82 - (depth - 1) * 5), reason: depth === 1 ? '직접 상위 요소' : `${depth}단계 상위 요소`, relation: 'relative', xpathValue: steps },
        { skipGlobalCheck: true, contextElement: child, contextLabel: '현재 요소', duplicateScore: Math.max(60, 70 - (depth - 1) * 5), element: current }
      )
    );
    if (!current.parentElement || current === document.documentElement) {
      break;
    }
    current = current.parentElement;
    depth += 1;
  }

  (getSelectorCandidates(parent) || []).forEach((cand) => {
    registry.add({ ...cand, relation: cand.relation || 'global' });
  });

  return registry.list();
}

export function collectSelectorInfos(eventRecord) {
  const infos = [];
  const seen = new Set();

  function pushInfo(selector, type, extra = {}) {
    if (!selector) return;
    const key = `${selector}::${type || ''}`;
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

  if (eventRecord && eventRecord.primarySelector) {
    pushInfo(eventRecord.primarySelector, eventRecord.primarySelectorType || inferSelectorType(eventRecord.primarySelector), {
      score: 100,
      textValue: eventRecord.primarySelectorText || null,
      xpathValue: eventRecord.primarySelectorXPath || null,
      matchMode: eventRecord.primarySelectorMatchMode || null
    });
  }

  if (eventRecord && Array.isArray(eventRecord.selectorCandidates)) {
    [...eventRecord.selectorCandidates]
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .forEach((candidate) => {
        if (!candidate || !candidate.selector) return;
        pushInfo(candidate.selector, candidate.type || inferSelectorType(candidate.selector), {
          score: candidate.score || 0,
          textValue: candidate.textValue || null,
          xpathValue: candidate.xpathValue || null,
          matchMode: candidate.matchMode || null
        });
      });
  }

  if (eventRecord && eventRecord.tag) {
    pushInfo(eventRecord.tag.toLowerCase(), 'tag', { score: 1 });
  }

  return infos;
}

