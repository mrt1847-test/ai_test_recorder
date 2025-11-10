/**
 * DOM 요소에서 다양한 유형의 셀렉터 후보를 추출하고 정렬한다.
 * CSS/XPath/텍스트 기반 후보를 생성하고 유일성 검사를 수행한다.
 */
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
  parseSelectorForMatching,
  escapeXPathLiteral
} from '../utils/dom.js';

const DEFAULT_TEXT_SCORE = 65;
const DEFAULT_TAG_SCORE = 20;
const UNIQUE_MATCH_BONUS = 6;
const DUPLICATE_PENALTY_STEP = 6;
const CLASS_COMBINATION_LIMIT = 3;
const MAX_CLASS_COMBINATIONS = 24;
const TEXT_PARENT_MAX_DEPTH = 4;
const TEXT_PARENT_CLASS_LIMIT = 4;
const TEXT_PARENT_COMBINATION_LIMIT = 3;
const TEXT_PARENT_MAX_COMBINATIONS = 12;

const CSS_PARENT_MAX_DEPTH = 3;
const CSS_PARENT_CLASS_LIMIT = 4;
const CSS_PARENT_COMBINATION_LIMIT = 3;
const CSS_PARENT_MAX_COMBINATIONS = 20;
const CSS_SIMPLE_PARENT_MAX_DEPTH = 4;

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

/**
 * 단일 요소에서 속성 기반 셀렉터 후보를 생성한다.
 * 우선순위를 정의한 ATTRIBUTE_PRIORITY에 따라 처리한다.
 */
function buildAttributeSelectors(element) {
  const results = [];
  // 미리 정의된 속성 목록을 순회하면서 후보를 만든다.
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
      // 공백/쉼표 등을 기준으로 부분 매칭 셀렉터를 추가한다.
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

/**
 * 요소의 classList를 활용해 class 조합 기반 셀렉터를 만든다.
 */
function generateClassSelectors(element) {
  const classList = Array.from(element.classList || []).filter(Boolean);
  if (classList.length === 0) return [];

  const escaped = classList.map((cls) => cssEscapeIdent(cls));
  const combinations = new Set();

  // class 조합을 백트래킹으로 생성한다.
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
  ordered.slice(0, MAX_CLASS_COMBINATIONS).forEach((key) => {
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

/**
 * 셀렉터 유형에 따라 우선순위 점수를 반환한다.
 */
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

/**
 * 후보 셀렉터 배열을 유일성/관계/타입 점수를 기준으로 정렬한다.
 * 유일 후보 > relative 후보 > 타입 우선순위 > 점수 순으로 정렬한다.
 */
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

function buildClassCombinationLists(classes, options = {}) {
  const {
    limit = TEXT_PARENT_COMBINATION_LIMIT,
    maxResults = TEXT_PARENT_MAX_COMBINATIONS,
    classLimit = TEXT_PARENT_CLASS_LIMIT
  } = options;
  const uniqueClasses = Array.from(new Set(classes)).filter(Boolean).slice(0, classLimit);
  const combos = [];
  // class 조합 수를 제한하면서 모든 조합을 생성한다.
  function backtrack(start, current) {
    if (current.length > 0 && combos.length < maxResults) {
      combos.push([...current]);
    }
    if (current.length === limit) return;
    for (let i = start; i < uniqueClasses.length && combos.length < maxResults; i += 1) {
      current.push(uniqueClasses[i]);
      backtrack(i + 1, current);
      current.pop();
    }
  }
  backtrack(0, []);
  return combos;
}

/**
 * 텍스트 기반 셀렉터가 유일하지 않을 때 상위 요소 정보를 결합한 XPath를 시도한다.
 */
function tryBuildAncestorTextXPath(element, textValue, matchMode) {
  if (!element || !textValue) return null;
  const normalized = normalizeText(textValue);
  // 텍스트가 비어 있으면 더 이상 진행할 수 없다.
  if (!normalized) return null;
  const literal = escapeXPathLiteral(normalized);
  const textExpr = matchMode === 'contains'
    ? `contains(normalize-space(.), ${literal})`
    : `normalize-space(.) = ${literal}`;
  const elementClassList = Array.from(element.classList || []).filter(Boolean);
  if (elementClassList.length) {
    // 원본 요소의 클래스 목록을 활용해 XPath 후보를 만든다.
    for (const cls of elementClassList.slice(0, TEXT_PARENT_CLASS_LIMIT)) {
      const literalClass = escapeXPathLiteral(cls);
      const tagName = element.tagName ? element.tagName.toLowerCase() : '*';
      // 클래스와 텍스트 조합으로 구성 가능한 XPath 후보를 나열한다.
      const candidates = [
        `//*[@class=${literalClass} and normalize-space(.) = ${literal}]`,
        `//*[@class=${literalClass} and contains(normalize-space(.), ${literal})]`,
        `//${tagName}[@class=${literalClass} and normalize-space(.) = ${literal}]`,
        `//${tagName}[@class=${literalClass} and contains(normalize-space(.), ${literal})]`
      ];
      for (const xpathExpr of candidates) {
        const selector = `xpath=${xpathExpr}`;
        const parsed = parseSelectorForMatching(selector, 'xpath');
        const count = countMatchesForSelector(parsed, document, { matchMode });
        // 한 번만 매칭되면 즉시 해당 셀렉터를 반환한다.
        if (count === 1) {
          const isTagVariant = xpathExpr.startsWith(`//${tagName}`);
          return {
            selector,
            count,
            reason: isTagVariant ? '태그+클래스 + 텍스트 조합' : '클래스 + 텍스트 조합'
          };
        }
      }
    }
  }

  let current = element.parentElement;
  let depth = 0;
  while (current && depth < TEXT_PARENT_MAX_DEPTH) {
    depth += 1;
    if (current.nodeType !== 1) {
      // 텍스트 노드 등은 건너뛴다.
      current = current.parentElement;
      continue;
    }
    const classList = Array.from(current.classList || []).filter(Boolean);
    const tagName = current.tagName ? current.tagName.toLowerCase() : '*';
    if (classList.length > 0) {
      for (const cls of classList.slice(0, TEXT_PARENT_CLASS_LIMIT)) {
        const classLiteral = escapeXPathLiteral(cls);
        const classXPath = `//*[@class=${classLiteral}]//*[${textExpr}]`;
        const classSelector = `xpath=${classXPath}`;
        const classParsed = parseSelectorForMatching(classSelector, 'xpath');
        const classCount = countMatchesForSelector(classParsed, document, { matchMode });
        // 클래스 조합으로 유일해지면 바로 반환.
        if (classCount === 1) {
          return {
            selector: classSelector,
            count: classCount,
            reason: '상위 클래스 + 텍스트 조합'
          };
        }
        const tagClassXPath = `//${tagName}[@class=${classLiteral}]//*[${textExpr}]`;
        const tagClassSelector = `xpath=${tagClassXPath}`;
        const tagClassParsed = parseSelectorForMatching(tagClassSelector, 'xpath');
        const tagClassCount = countMatchesForSelector(tagClassParsed, document, { matchMode });
        // 태그+클래스 조합도 유일해지면 반환.
        if (tagClassCount === 1) {
          return {
            selector: tagClassSelector,
            count: tagClassCount,
            reason: '상위 태그+클래스 + 텍스트 조합'
          };
        }
      }
    } else if (tagName && tagName !== '*') {
      const tagOnlyXPath = `//${tagName}[${textExpr}]`;
      const tagOnlySelector = `xpath=${tagOnlyXPath}`;
      const tagOnlyParsed = parseSelectorForMatching(tagOnlySelector, 'xpath');
      const tagOnlyCount = countMatchesForSelector(tagOnlyParsed, document, { matchMode });
      // 태그만으로 유일해지는 경우도 고려한다.
      if (tagOnlyCount === 1) {
        return {
          selector: tagOnlySelector,
          count: tagOnlyCount,
          reason: '상위 태그 + 텍스트 조합'
        };
      }
    }
    current = current.parentElement;
  }
  return null;
}

/**
 * 후보 객체에서 CSS 관련 셀렉터 문자열을 추출한다.
 */
function extractCssSelector(candidate) {
  if (!candidate) return null;
  const selector = candidate.selector || '';
  const type = candidate.type || inferSelectorType(selector);
  if (type === 'css') {
    // css= 접두사가 있으면 제거한다.
    return selector.startsWith('css=') ? selector.slice(4) : selector;
  }
  if (type === 'class' || type === 'class-tag' || type === 'id' || type === 'tag') {
    return selector;
  }
  if (type === 'text') return null;
  return null;
}

/**
 * CSS 셀렉터가 중복될 때 상위 요소 경로를 확장하여 유일한 셀렉터를 찾는다.
 */
function tryBuildAncestorCssSelector(element, baseSelector, contextElement) {
  if (!element || !baseSelector) return null;
  const base = baseSelector.startsWith('css=') ? baseSelector.slice(4).trim() : baseSelector.trim();
  if (!base) return null;
  const tested = new Set();
  const scopedPrefix = contextElement ? ':scope ' : '';
  let current = element.parentElement;
  let depth = 0;
  let paths = [base];
  while (current && depth < CSS_PARENT_MAX_DEPTH && paths.length) {
    depth += 1;
    if (current.nodeType !== 1) {
      // 요소 노드가 아니면 상위로 계속 올라간다.
      current = current.parentElement;
      continue;
    }
    const ancestorSelectors = [];
    if (current.id) {
      // 고유 id가 있으면 최우선으로 고려.
      ancestorSelectors.push(`#${cssEscapeIdent(current.id)}`);
    }
    const classList = Array.from(current.classList || []).filter(Boolean);
    if (classList.length) {
      const combos = buildClassCombinationLists(classList, {
        limit: CSS_PARENT_COMBINATION_LIMIT,
        maxResults: CSS_PARENT_MAX_COMBINATIONS,
        classLimit: CSS_PARENT_CLASS_LIMIT
      });
      combos.forEach((combo) => {
        const escaped = combo.map((cls) => cssEscapeIdent(cls));
        if (escaped.length) {
          ancestorSelectors.push(`.${escaped.join('.')}`);
          const tag = current.tagName ? current.tagName.toLowerCase() : '*';
          ancestorSelectors.push(`${tag}.${escaped.join('.')}`);
        }
      });
    }
    const tagName = current.tagName ? current.tagName.toLowerCase() : '*';
    // 태그 이름만으로도 후보를 추가한다.
    ancestorSelectors.push(tagName);

    const newPaths = [];
    for (const ancestorSelector of ancestorSelectors) {
      for (const path of paths) {
        const directSelector = `${ancestorSelector} > ${path}`;
        const descendantSelector = `${ancestorSelector} ${path}`;
        const candidates = [directSelector, descendantSelector];
        for (const candidatePath of candidates) {
          const normalized = candidatePath.trim();
          if (!normalized || tested.has(normalized)) continue;
          tested.add(normalized);
          const fullSelector = contextElement ? `:scope ${normalized}` : normalized;
          const parsed = parseSelectorForMatching(`css=${fullSelector}`, 'css');
          const targetScope = contextElement || document;
          const count = countMatchesForSelector(parsed, targetScope);
          // 유일하게 매칭되면 즉시 반환.
          if (count === 1) {
            return {
              selector: `css=${fullSelector}`,
              count
            };
          }
          newPaths.push(normalized);
        }
      }
    }
    paths = Array.from(new Set(newPaths)).slice(0, CSS_PARENT_MAX_COMBINATIONS);
    current = current.parentElement;
  }
  return null;
}

/**
 * 간단한 부모 체인만 따라가며 CSS 셀렉터에 부모 경로를 추가한다.
 */
function tryBuildSimpleAncestorCss(element, baseSelector, contextElement) {
  if (!element || !baseSelector) return null;
  const base = baseSelector.startsWith('css=') ? baseSelector.slice(4).trim() : baseSelector.trim();
  if (!base) return null;
  const scopedPrefix = contextElement ? ':scope ' : '';
  const targetScope = contextElement || document;
  let current = element;
  let selector = base;
  let depth = 0;

  const buildParentSelector = (node) => {
    if (!node || node.nodeType !== 1) return null;
    if (node.id) {
      return `#${cssEscapeIdent(node.id)}`;
    }
    const classList = Array.from(node.classList || []).filter(Boolean);
    if (classList.length) {
      return `.${cssEscapeIdent(classList[0])}`;
    }
    return node.tagName ? node.tagName.toLowerCase() : null;
  };

  while (current && depth < CSS_SIMPLE_PARENT_MAX_DEPTH) {
    const fullSelector = contextElement ? `css=${scopedPrefix}${selector}` : `css=${selector}`;
    const parsed = parseSelectorForMatching(fullSelector, 'css');
    const count = countMatchesForSelector(parsed, targetScope);
    // 현재까지의 조합이 유일해졌으면 즉시 반환.
    if (count === 1) {
      return { selector: fullSelector, count };
    }
    const parent = current.parentElement;
    // 부모 요소가 더 이상 없으면 종료.
    if (!parent) break;
    const parentSelector = buildParentSelector(parent);
    // 부모에 사용할 식별자가 없으면 더 이상 확장할 수 없다.
    if (!parentSelector) break;
    selector = `${parentSelector} > ${selector}`;
    current = parent;
    depth += 1;
  }

  const finalSelector = contextElement ? `css=${scopedPrefix}${selector}` : `css=${selector}`;
  const finalParsed = parseSelectorForMatching(finalSelector, 'css');
  const finalCount = countMatchesForSelector(finalParsed, targetScope);
  // 마지막 조합이 유일해졌는지 검사한다.
  if (finalCount === 1) {
    return { selector: finalSelector, count: finalCount };
  }
  return null;
}

/**
 * 첫 번째 nth-of-type 요소에 대한 CSS 셀렉터 후보를 생성한다.
 */
function buildFirstNthOfTypeSelector(element) {
  if (!element || element.nodeType !== 1) return null;
  const parent = element.parentElement;
  if (!parent) return null;
  const tagName = element.tagName ? element.tagName.toLowerCase() : null;
  if (!tagName) return null;
  const siblings = Array.from(parent.children || []);
  let nth = 0;
  for (const sibling of siblings) {
    if (!sibling || sibling.nodeType !== 1) continue;
    if (!sibling.tagName) continue;
    // 동일 태그인 형제 요소를 카운트해 첫 번째인지 확인.
    if (sibling.tagName.toLowerCase() === tagName) {
      nth += 1;
      if (sibling === element) break;
    }
  }
  if (nth !== 1) return null;
  const classList = Array.from(element.classList || []).filter(Boolean);
  if (!classList.length) return null;
  const escapedClasses = classList.slice(0, 2).map((cls) => cssEscapeIdent(cls)).filter(Boolean);
  if (!escapedClasses.length) return null;
  const selector = `${tagName}.${escapedClasses.join('.')}:nth-of-type(1)`;
  const scopedResult = tryBuildSimpleAncestorCss(element, selector, null);
  if (scopedResult && scopedResult.count === 1) {
    return {
      type: 'css',
      selector: scopedResult.selector,
      score: 88,
      reason: '첫 번째 항목 (nth-of-type)'
    };
  }
  const parsed = parseSelectorForMatching(`css=${selector}`, 'css');
  const count = countMatchesForSelector(parsed, document);
  if (count === 1) {
    return {
      type: 'css',
      selector: `css=${selector}`,
      score: 84,
      reason: '첫 번째 항목 (nth-of-type)'
    };
  }
  return null;
}

/**
 * 대상 요소가 iframe 내부에 있는 경우 iframe 정보를 반환한다.
 */
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

/**
 * 후보 셀렉터의 유일성 검사를 수행하고 필요한 경우 보정한다.
 */
function enrichCandidateWithUniqueness(baseCandidate, options = {}) {
  if (!baseCandidate || !baseCandidate.selector) return null;
  const candidate = { ...baseCandidate };
  const originalType = candidate.type || inferSelectorType(candidate.selector);
  const resolvedType = candidate.type || originalType;
  const parsed = parseSelectorForMatching(candidate.selector, resolvedType);
  let reasonParts = candidate.reason ? [candidate.reason] : [];

  if (!options.skipGlobalCheck) {
  const matchOptions = {
    matchMode: candidate.matchMode,
    maxCount: typeof options.maxMatchSample === 'number' && options.maxMatchSample > 0
      ? options.maxMatchSample
      : 4
  };
    // 문서 전체를 대상으로 매칭 횟수를 계산한다.
    const globalCount = countMatchesForSelector(parsed, document, matchOptions);
    candidate.matchCount = globalCount;
    candidate.unique = globalCount === 1;
    // 유일하지 않은데 허용되지 않으면 후보를 버린다.
    if (globalCount === 0 && options.allowZero !== true) {
      return null;
    }
    reasonParts = reasonParts.filter((part) => !/유일 일치|개 요소와 일치/.test(part));
    if (globalCount === 1) {
      reasonParts.push('유일 일치');
    } else if (globalCount > 1) {
      reasonParts.push(globalCount === 2 ? '2개 요소와 일치 (추가 조합)' : `${globalCount}개 요소와 일치`);
    }
  }

  if (options.contextElement) {
    // 특정 컨텍스트 내에서의 매칭 개수를 별도로 계산한다.
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
      // 전역 체크를 생략한 경우 컨텍스트 결과를 그대로 사용한다.
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

  if (!options.skipGlobalCheck && candidate.unique === false && typeof candidate.score === 'number') {
    candidate.score = Math.min(candidate.score, options.duplicateScore ?? 60);
  }

  if (!candidate.unique && originalType === 'text' && options.element && (candidate.textValue || parsed.value)) {
    const ancestorResult = tryBuildAncestorTextXPath(
      options.element,
      candidate.textValue || parsed.value,
      candidate.matchMode || 'exact'
    );
    if (ancestorResult) {
      candidate.selector = ancestorResult.selector;
      candidate.type = 'xpath';
      candidate.relation = candidate.relation || 'global';
      if (ancestorResult.reason) {
        reasonParts.push(ancestorResult.reason);
      } else {
        reasonParts.push('텍스트 조합');
      }
    }
  }

  if (!candidate.unique && options.element) {
    const baseCssSelector = extractCssSelector(candidate);
    if (baseCssSelector) {
      const simpleDerived = tryBuildSimpleAncestorCss(options.element, baseCssSelector, options.contextElement);
      if (simpleDerived) {
        candidate.selector = simpleDerived.selector;
        candidate.type = 'css';
        candidate.relation = options.contextElement ? 'relative' : candidate.relation || 'global';
        reasonParts.push('부모 태그 경로 조합');
      } else {
        const derived = tryBuildAncestorCssSelector(options.element, baseCssSelector, options.contextElement);
        if (derived) {
          candidate.selector = derived.selector;
          candidate.type = 'css';
          candidate.relation = options.contextElement ? 'relative' : candidate.relation || 'global';
          reasonParts.push('상위 class 경로 조합');
        }
      }
    }
  }

  if (originalType !== 'text' && originalType !== 'xpath' && !candidate.unique && options.element && options.enableIndexing !== false) {
    const contextEl = options.contextElement && candidate.relation === 'relative' ? options.contextElement : null;
    const uniqueSelector = buildUniqueCssPath(options.element, contextEl);
    if (uniqueSelector && uniqueSelector !== candidate.selector) {
      const uniqueParsed = parseSelectorForMatching(uniqueSelector, 'css');
      const count = countMatchesForSelector(uniqueParsed, contextEl || document, { matchMode: candidate.matchMode, maxCount: 2 });
      if (count === 1) {
        candidate.selector = uniqueSelector;
        candidate.type = 'css';
        candidate.relation = contextEl ? 'relative' : candidate.relation;
        reasonParts.push('경로 인덱싱 적용');
      }
    }
  }

  if (!candidate.unique) {
    const verificationParsed = parseSelectorForMatching(candidate.selector, candidate.type || inferSelectorType(candidate.selector));
    const verificationCount = countMatchesForSelector(
      verificationParsed,
      options.contextElement || document,
      { matchMode: candidate.matchMode, maxCount: 4 }
    );
    candidate.matchCount = verificationCount;
    candidate.unique = verificationCount === 1;
    candidate.uniqueInContext = verificationCount === 1;
    reasonParts = reasonParts.filter((part) => !/유일 일치|개 요소와 일치/.test(part));
    if (verificationCount === 1) {
      reasonParts.push('유일 일치');
    } else if (verificationCount === 2) {
      reasonParts.push('2개 요소와 일치 (추가 조합)');
    } else if (verificationCount > 2) {
      reasonParts.push(`${verificationCount}개 요소와 일치`);
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

/**
 * 중복 후보를 제거하면서 후보 목록을 축적하는 간단한 레지스트리를 만든다.
 */
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

/**
 * nth-of-type, 절대 XPath 등 취약 패턴을 감지해 점수를 페널티한다.
 */
function applyFragilityAdjustments(candidate) {
  if (!candidate || typeof candidate.score !== 'number') {
    return candidate;
  }
  const selector = candidate.selector || '';
  const inferredType = candidate.type || inferSelectorType(selector);
  let penalty = 0;
  const flags = [];

  if (inferredType === 'xpath-full' || /xpath=\/html/i.test(selector)) {
    // 절대 XPath는 쉽게 깨지므로 큰 페널티를 부여.
    penalty += 18;
    flags.push('절대 XPath');
  } else if ((inferredType === 'xpath' || inferredType === 'xpath-full') && /\/\d+\]/.test(selector) && !/@/.test(selector)) {
    // 구조 의존 XPath(인덱스 기반)는 중간 페널티.
    penalty += 8;
    flags.push('구조 의존 XPath');
  }

  if ((inferredType === 'css' || inferredType === 'class' || inferredType === 'class-tag' || inferredType === 'id') && /:nth-(child|of-type)\(/i.test(selector)) {
    const match = selector.match(/:nth-(?:child|of-type)\((\d+)\)/i);
    const nthValue = match ? parseInt(match[1], 10) : null;
    // nth-of-type 사용 시 위치 의존성이 있으므로 페널티.
    penalty += nthValue === 1 ? 2 : 6;
    flags.push('nth-of-type 사용');
  }

  if (inferredType === 'class' || inferredType === 'class-tag') {
    const classCount = (selector.match(/\./g) || []).length;
    if (classCount > 2) {
      // 클래스가 너무 많으면 유지보수가 어렵기에 페널티.
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

/**
 * 후보를 유일성 검증 후 레지스트리에 추가한다.
 */
function addCandidate(registry, candidate, options = {}) {
  const enriched = enrichCandidateWithUniqueness(candidate, options);
  if (enriched) {
    registry.add(enriched);
  }
}

/**
 * 단일 요소에서 사용할 만한 모든 셀렉터 후보를 수집한다.
 */
export function getSelectorCandidates(element) {
  if (!element) return [];
  const registry = createCandidateRegistry();

  try {
    // 우선 속성 기반 후보를 추가.
    buildAttributeSelectors(element).forEach((cand) => {
      addCandidate(registry, cand, { duplicateScore: 62, element, maxMatchSample: 5 });
    });
  } catch (e) {
    // ignore attribute access errors
  }

  // class 조합 기반 후보.
  generateClassSelectors(element).forEach((cand) => {
    addCandidate(registry, cand, { duplicateScore: 58, element, maxMatchSample: 5 });
  });

  const rawText = (element.innerText || element.textContent || '').trim().split('\n').map((t) => t.trim()).filter(Boolean)[0];
  if (rawText) {
    const truncatedText = rawText.slice(0, 60);
    const textSelector = `text="${escapeAttributeValue(truncatedText)}"`;
    let textMatchCount = null;
    try {
      const parsed = parseSelectorForMatching(textSelector, 'text');
      textMatchCount = countMatchesForSelector(parsed, document, { matchMode: 'exact', maxCount: 6 });
    } catch (e) {
      textMatchCount = null;
    }
    const reasonParts = ['텍스트 일치'];
    if (typeof textMatchCount === 'number') {
      if (textMatchCount === 1) {
        reasonParts.push('1개 요소와 일치');
      } else if (textMatchCount > 1) {
        reasonParts.push(`${textMatchCount}개 요소와 일치`);
      } else if (textMatchCount === 0) {
        reasonParts.push('일치 없음');
      }
    } else {
      reasonParts.push('일치 개수 계산 불가');
    }
    registry.add({
      type: 'text',
      selector: textSelector,
      score: DEFAULT_TEXT_SCORE,
      reason: reasonParts.filter(Boolean).join(' • '),
      textValue: truncatedText,
      matchMode: 'exact',
      unique: textMatchCount === 1,
      matchCount: textMatchCount
    });
    
    // 2. 기존 로직: 유일성 검증 + 조합 셀렉터 생성
    const textCandidate = enrichCandidateWithUniqueness(
      { type: 'text', selector: `text="${escapeAttributeValue(truncatedText)}"`, score: DEFAULT_TEXT_SCORE - 3, reason: '텍스트 조합', textValue: truncatedText },
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
      { duplicateScore: 52, element, maxMatchSample: 5 }
    );
  }

  const fullXPath = buildFullXPath(element);
  if (fullXPath) {
    addCandidate(
      registry,
      { type: 'xpath-full', selector: `xpath=${fullXPath}`, score: 42, reason: 'Full XPath (절대 경로)', xpathValue: fullXPath },
      { duplicateScore: 36, element, enableIndexing: false, maxMatchSample: 5 }
    );
  }

  addCandidate(
    registry,
    { type: 'tag', selector: element.tagName.toLowerCase(), score: DEFAULT_TAG_SCORE, reason: '태그 이름' },
    { duplicateScore: 28, allowZero: true, element, maxMatchSample: 5 }
  );

  const firstNthCandidate = buildFirstNthOfTypeSelector(element);
  if (firstNthCandidate) {
    addCandidate(registry, firstNthCandidate, { duplicateScore: 66, element });
  }

  return sortCandidates(registry.list());
}

/**
 * 부모/자식 관계를 고려한 상대 셀렉터 후보를 생성한다.
 */
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

  // 자식 요소 자체의 후보도 함께 포함해 비교할 수 있게 한다.
  (getSelectorCandidates(child) || []).forEach((cand) => {
    registry.add({ ...cand, relation: cand.relation || 'global' });
  });

  return sortCandidates(registry.list());
}

/**
 * 현재 요소에서 부모 요소를 가리킬 수 있는 상대 셀렉터 후보를 생성한다.
 */
export function getParentSelectorCandidates(child, parent) {
  if (!child || !parent) return [];
  const registry = createCandidateRegistry();

  let current = parent;
  let depth = 1;
  // 부모 체인을 따라 올라가면서 ../ 경로를 생성.
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
      // 더 이상 상위 요소가 없으면 반복을 종료.
      break;
    }
    current = current.parentElement;
    depth += 1;
  }

  // 부모 요소 자체의 전역 후보도 함께 추가한다.
  (getSelectorCandidates(parent) || []).forEach((cand) => {
    registry.add({ ...cand, relation: cand.relation || 'global' });
  });

  return sortCandidates(registry.list());
}

/**
 * 이벤트 레코드에서 셀렉터 정보를 추출해 배열 형태로 만든다.
 */
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
        // 후보 셀렉터는 점수 순으로 정렬해 우선순위를 유지한다.
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

