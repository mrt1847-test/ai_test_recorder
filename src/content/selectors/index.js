import {
  buildFullXPath,
  buildRelativeCssSelector,
  buildRelativeXPathSelector,
  buildRobustXPath,
  buildUniqueCssPath,
  countMatchesForSelector,
  escapeAttributeValue,
  cssEscapeIdent,
  inferSelectorType,
  normalizeText,
  parseSelectorForMatching
} from '../utils/dom.js';

const DEFAULT_TEXT_SCORE = 65;
const DEFAULT_TAG_SCORE = 20;
const UNIQUE_MATCH_BONUS = 6;
const DUPLICATE_PENALTY_STEP = 6;
const CLASS_COMBINATION_LIMIT = 2;

const SELECTOR_TYPE_PRIORITY = {
  id: 100,
  'data-testid': 96,
  'data-test': 95,
  'data-qa': 94,
  'data-cy': 94,
  'data-id': 92,
  'aria-label': 90,
  name: 88,
  role: 85,
  title: 82,
  text: 78,
  css: 70,
  'class-tag': 66,
  class: 62,
  tag: 40,
  xpath: 30,
  'xpath-full': 5
};

const ATTRIBUTE_PRIORITY = [
  { attr: 'id', type: 'id', score: 90, reason: 'id 속성', allowPartial: false },
  { attr: 'data-testid', type: 'data-testid', score: 88, reason: 'data-testid 속성', allowPartial: true },
  { attr: 'data-test', type: 'data-test', score: 86, reason: 'data-test 속성', allowPartial: true },
  { attr: 'data-qa', type: 'data-qa', score: 84, reason: 'data-qa 속성', allowPartial: true },
  { attr: 'data-cy', type: 'data-cy', score: 84, reason: 'data-cy 속성', allowPartial: true },
  { attr: 'data-id', type: 'data-id', score: 82, reason: 'data-id 속성', allowPartial: true },
  { attr: 'aria-label', type: 'aria-label', score: 80, reason: 'aria-label 속성', allowPartial: true },
  { attr: 'role', type: 'role', score: 78, reason: 'role 속성', allowPartial: false },
  { attr: 'name', type: 'name', score: 78, reason: 'name 속성', allowPartial: false },
  { attr: 'title', type: 'title', score: 72, reason: 'title 속성', allowPartial: true },
  { attr: 'type', type: 'type', score: 68, reason: 'type 속성', allowPartial: false }
];

function buildAttributeSelectors(element) {
  const results = [];
  for (const meta of ATTRIBUTE_PRIORITY) {
    const rawValue = element.getAttribute && element.getAttribute(meta.attr);
    if (!rawValue) continue;

    if (meta.attr === 'id') {
      results.push({
        type: 'id',
        selector: `#${cssEscapeIdent(rawValue)}`,
        score: meta.score,
        reason: meta.reason
      });
      continue;
    }

    const escaped = escapeAttributeValue(rawValue);
    results.push({
      type: meta.type,
      selector: `[${meta.attr}="${escaped}"]`,
      score: meta.score,
      reason: meta.reason
    });

    if (meta.allowPartial) {
      const tokens = rawValue.split(/[\s,;]+/).filter((token) => token.length > 2);
      tokens.slice(0, 2).forEach((token, index) => {
        const escapedToken = escapeAttributeValue(token);
        results.push({
          type: `${meta.type}-partial`,
          selector: `[${meta.attr}*="${escapedToken}"]`,
          score: Math.max(meta.score - 8 - index * 2, 60),
          reason: `${meta.reason} 부분 일치`,
          matchMode: 'contains'
        });
      });
    }
  }
  return results;
}

function generateClassSelectors(element) {
  const classList = Array.from(element.classList || []).filter(Boolean);
  if (classList.length === 0) return [];

  const escaped = classList.map((cls) => cssEscapeIdent(cls));
  const combinations = new Set();

  function backtrack(start, depth, current) {
    if (current.length > 0 && current.length <= CLASS_COMBINATION_LIMIT) {
      const key = current.join('.');
      combinations.add(key);
    }
    if (current.length === CLASS_COMBINATION_LIMIT) return;
    for (let i = start; i < escaped.length; i += 1) {
      current.push(escaped[i]);
      backtrack(i + 1, depth + 1, current);
      current.pop();
    }
  }

  backtrack(0, 0, []);

  const results = [];
  const ordered = Array.from(combinations).sort((a, b) => {
    const lenDiff = a.split('.').length - b.split('.').length;
    if (lenDiff !== 0) return lenDiff;
    return a.localeCompare(b);
  });
  ordered.slice(0, 12).forEach((key) => {
    const classSelector = `.${key}`;
    results.push({
      type: 'class',
      selector: classSelector,
      score: 62 - Math.min(10, key.split('.').length * 2),
      reason: 'class 조합'
    });
    results.push({
      type: 'class-tag',
      selector: `${element.tagName.toLowerCase()}${classSelector}`,
      score: 68 - Math.min(10, key.split('.').length),
      reason: '태그 + class 조합'
    });
  });

  return results;
}

function getSelectorTypeRank(candidate) {
  if (!candidate) return 0;
  const type = candidate.type || inferSelectorType(candidate.selector);
  if (!type) return 0;
  if (Object.prototype.hasOwnProperty.call(SELECTOR_TYPE_PRIORITY, type)) {
    return SELECTOR_TYPE_PRIORITY[type];
  }
  if (type.startsWith('data-')) return 90;
  if (type.includes('partial')) return 75;
  return 50;
}

function sortCandidates(candidates) {
  return candidates
    .slice()
    .sort((a, b) => {
      const uniqueA = a.unique ? 1 : 0;
      const uniqueB = b.unique ? 1 : 0;
      if (uniqueA !== uniqueB) return uniqueB - uniqueA;
      const relationA = a.relation === 'relative' ? 1 : 0;
      const relationB = b.relation === 'relative' ? 1 : 0;
      if (relationA !== relationB) return relationB - relationA;
      const typeRankA = getSelectorTypeRank(a);
      const typeRankB = getSelectorTypeRank(b);
      if (typeRankA !== typeRankB) return typeRankB - typeRankA;
      return (b.score || 0) - (a.score || 0);
    });
}

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
  if (typeof candidate.score === 'number') {
    if (candidate.unique) {
      candidate.score = Math.min(100, Math.max(candidate.score + UNIQUE_MATCH_BONUS, 95));
    } else if (candidate.matchCount > 1) {
      candidate.score = Math.max(
        10,
        candidate.score - Math.min(24, (candidate.matchCount - 1) * DUPLICATE_PENALTY_STEP)
      );
    }
  }
  return applyFragilityAdjustments(candidate);
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

function applyFragilityAdjustments(candidate) {
  if (!candidate || typeof candidate.score !== 'number') {
    return candidate;
  }
  const selector = candidate.selector || '';
  const inferredType = candidate.type || inferSelectorType(selector);
  let penalty = 0;
  const flags = [];

  if (inferredType === 'xpath-full' || /xpath=\/html/i.test(selector)) {
    penalty += 18;
    flags.push('절대 XPath');
  } else if ((inferredType === 'xpath' || inferredType === 'xpath-full') && /\/\d+\]/.test(selector) && !/@/.test(selector)) {
    penalty += 8;
    flags.push('구조 의존 XPath');
  }

  if ((inferredType === 'css' || inferredType === 'class' || inferredType === 'class-tag' || inferredType === 'id') && /:nth-(child|of-type)\(/i.test(selector)) {
    penalty += 8;
    flags.push('nth-of-type 사용');
  }

  if (inferredType === 'class' || inferredType === 'class-tag') {
    const classCount = (selector.match(/\./g) || []).length;
    if (classCount > 2) {
      penalty += (classCount - 2) * 4;
      flags.push('과도한 class 조합');
    }
  }

  if (penalty > 0) {
    candidate.score = Math.max(5, candidate.score - penalty);
    if (flags.length) {
      const fragility = `취약 요소 (${flags.join(', ')})`;
      candidate.reason = candidate.reason ? `${candidate.reason} • ${fragility}` : fragility;
    }
  }
  return candidate;
}

function addCandidate(registry, candidate, options = {}) {
  const enriched = enrichCandidateWithUniqueness(candidate, options);
  if (enriched) {
    registry.add(enriched);
  }
}

export function getSelectorCandidates(element) {
  if (!element) return [];
  const registry = createCandidateRegistry();

  try {
    buildAttributeSelectors(element).forEach((cand) => {
      addCandidate(registry, cand, { duplicateScore: 62, element });
    });
  } catch (e) {
    // ignore attribute access errors
  }

  generateClassSelectors(element).forEach((cand) => {
    addCandidate(registry, cand, { duplicateScore: 58, element });
  });

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
    addCandidate(
      registry,
      { type: 'xpath', selector: `xpath=${robustXPath}`, score: 58, reason: '속성 기반 XPath', xpathValue: robustXPath },
      { duplicateScore: 52, element }
    );
  }

  const fullXPath = buildFullXPath(element);
  if (fullXPath) {
    addCandidate(
      registry,
      { type: 'xpath-full', selector: `xpath=${fullXPath}`, score: 42, reason: 'Full XPath (절대 경로)', xpathValue: fullXPath },
      { duplicateScore: 36, element, enableIndexing: false }
    );
  }

  addCandidate(
    registry,
    { type: 'tag', selector: element.tagName.toLowerCase(), score: DEFAULT_TAG_SCORE, reason: '태그 이름' },
    { duplicateScore: 28, allowZero: true, element }
  );

  return sortCandidates(registry.list());
}

export function getChildSelectorCandidates(parent, child) {
  if (!parent || !child) return [];
  const registry = createCandidateRegistry();

  const relativeCss = buildRelativeCssSelector(parent, child);
  if (relativeCss) {
    addCandidate(
      registry,
      { type: 'css', selector: `css=${relativeCss}`, score: 90, reason: '부모 기준 CSS 경로', relation: 'relative' },
      { skipGlobalCheck: true, contextElement: parent, contextLabel: '부모', duplicateScore: 68, element: child }
    );
  }

  const relativeXPath = buildRelativeXPathSelector(parent, child);
  if (relativeXPath) {
    addCandidate(
      registry,
      { type: 'xpath', selector: `xpath=${relativeXPath}`, score: 86, reason: '부모 기준 XPath 경로', relation: 'relative', xpathValue: relativeXPath },
      { skipGlobalCheck: true, contextElement: parent, contextLabel: '부모', duplicateScore: 66, element: child }
    );
  }

  (getSelectorCandidates(child) || []).forEach((cand) => {
    registry.add({ ...cand, relation: cand.relation || 'global' });
  });

  return sortCandidates(registry.list());
}

export function getParentSelectorCandidates(child, parent) {
  if (!child || !parent) return [];
  const registry = createCandidateRegistry();

  let current = parent;
  let depth = 1;
  while (current && current.nodeType === 1) {
    const steps = Array(depth).fill('..').join('/');
    addCandidate(
      registry,
      {
        type: 'xpath',
        selector: `xpath=${steps}`,
        score: Math.max(72, 86 - (depth - 1) * 5),
        reason: depth === 1 ? '직접 상위 요소' : `${depth}단계 상위 요소`,
        relation: 'relative',
        xpathValue: steps
      },
      { skipGlobalCheck: true, contextElement: child, contextLabel: '현재 요소', duplicateScore: Math.max(58, 68 - (depth - 1) * 5), element: current }
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

  return sortCandidates(registry.list());
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

