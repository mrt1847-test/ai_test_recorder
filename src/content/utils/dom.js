/**
 * 셀렉터 생성/검증에 필요한 DOM 관련 유틸리티 모음.
 * CSS/XPath 문자열 처리, 텍스트 정규화, 매칭 카운팅 등을 제공한다.
 */
/**
 * 속성 값에서 따옴표/제어문자를 이스케이프해 안전한 문자열을 만든다.
 */
export function escapeAttributeValue(value) {
  return (value || '').replace(/"/g, '\\"').replace(/\u0008/g, '').replace(/\u000c/g, '').trim();
}

/**
 * CSS selector에서 사용할 식별자를 이스케이프한다.
 */
export function cssEscapeIdent(value) {
  if (typeof value !== 'string') return '';
  if (window.CSS && typeof window.CSS.escape === 'function') {
    return window.CSS.escape(value);
  }
  return value.replace(/([!"#$%&'()*+,./:;<=>?@\[\]^`{|}~])/g, '\\$1');
}

/**
 * 문서 루트 기준으로 요소에 대한 Full XPath를 생성한다.
 */
export function buildFullXPath(el) {
  if (!el || el.nodeType !== 1) return null;
  if (el.id) {
    const cleanedId = escapeAttributeValue(el.id);
    if (cleanedId) {
      return `//*[@id="${cleanedId}"]`;
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
    parts.unshift(`${tagName}[${index}]`);
    current = current.parentNode;
  }
  if (parts.length === 0) return null;
  return `//${parts.join('/')}`;
}

export function buildCssSegment(el) {
  if (!el || el.nodeType !== 1) return '';
  const tag = el.tagName.toLowerCase();
  let index = 1;
  let sibling = el.previousElementSibling;
  // 이전 형제 중 같은 태그가 몇 번째인지 계산한다.
  while (sibling) {
    if (sibling.nodeType === 1 && sibling.tagName === el.tagName) {
      index += 1;
    }
    sibling = sibling.previousElementSibling;
  }
  if (el.id) {
    return `${tag}#${cssEscapeIdent(el.id)}`;
  }
  const rawClassList = Array.from(el.classList || []).filter(Boolean);
  const classList = rawClassList.slice(0, 2).map(cssEscapeIdent).filter(Boolean);
  if (classList.length) {
    const classSelector = `${tag}.${classList.join('.')}`;
    const parent = el.parentElement;
    if (parent) {
      const requiredClasses = rawClassList.slice(0, classList.length);
      // 동일한 클래스 조합을 가진 형제 요소가 몇 개인지 확인한다.
      const matchingSiblings = Array.from(parent.children || []).filter((child) => {
        if (!child || child.nodeType !== 1) return false;
        if (child.tagName !== el.tagName) return false;
        const childClasses = child.classList || [];
        return requiredClasses.every((cls) => childClasses.contains ? childClasses.contains(cls) : childClasses.includes(cls));
      }).length;
      if (matchingSiblings > 1) {
        return `${classSelector}:nth-of-type(${index})`;
      }
    }
    return classSelector;
  }
  return `${tag}:nth-of-type(${index})`;
}

export function buildRelativeCssSelector(parent, child) {
  if (!parent || !child || !parent.contains(child) || parent === child) return null;
  const segments = [];
  let current = child;
  while (current && current !== parent) {
    // 텍스트 노드 등은 건너뛴다.
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
  return `:scope ${segments.join(' > ')}`;
}

export function buildUniqueCssPath(element, contextElement) {
  if (!element || element.nodeType !== 1) return null;
  const segments = [];
  let current = element;
  while (current && current.nodeType === 1 && current !== contextElement) {
    const segment = buildCssSegment(current);
    if (!segment) return null;
    segments.unshift(segment);
    const cssPath = segments.join(' > ');
    const selectorString = contextElement ? `:scope ${cssPath}` : cssPath;
    const parsed = parseSelectorForMatching(`css=${selectorString}`, 'css');
    const targetScope = contextElement || document;
    const matchCount = countMatchesForSelector(parsed, targetScope);
    // 현재까지 조합한 경로가 유일해졌으면 반환한다.
    if (matchCount === 1) {
      if (!contextElement && cssPath.startsWith('html:nth-of-type(1) > ')) {
        return cssPath.replace(/^html:nth-of-type\(1\)\s*>\s*/, '');
      }
      return contextElement ? `:scope ${cssPath}` : cssPath;
    }
    current = current.parentElement;
    if (!current) break;
    if (!contextElement && current === document.documentElement) {
      break;
    }
  }
  if (contextElement) {
    const relativePath = segments.join(' > ');
    return relativePath ? `:scope ${relativePath}` : null;
  }
  let finalPath = segments.join(' > ');
  if (finalPath.startsWith('html:nth-of-type(1) > ')) {
    finalPath = finalPath.replace(/^html:nth-of-type\(1\)\s*>\s*/, '');
  }
  return finalPath;
}

export function escapeXPathLiteral(value) {
  if (value.includes('"') && value.includes("'")) {
    const parts = value.split('"').map((part) => `"${part}"`).join(', "\"", ');
    return `concat(${parts})`;
  }
  if (value.includes('"')) {
    return `'${value}'`;
  }
  return `"${value}"`;
}

export function buildXPathSegment(el) {
  if (!el || el.nodeType !== 1) return '';
  const tag = el.tagName.toLowerCase();
  if (el.id) {
    return `${tag}[@id=${escapeXPathLiteral(el.id)}]`;
  }
  const classList = Array.from(el.classList || []).filter(Boolean);
  if (classList.length) {
    const cls = classList[0];
    const containsExpr = `contains(concat(' ', normalize-space(@class), ' '), ${escapeXPathLiteral(' ' + cls + ' ')})`;
    return `${tag}[${containsExpr}]`;
  }
  const attrPriority = ['data-testid', 'data-test', 'data-qa', 'data-cy', 'data-id', 'aria-label', 'role', 'name', 'type'];
  // 우선순위 속성들 중 하나라도 있으면 바로 사용한다.
  for (const attr of attrPriority) {
    const val = el.getAttribute && el.getAttribute(attr);
    if (val) {
      return `${tag}[@${attr}=${escapeXPathLiteral(val)}]`;
    }
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

export function buildRelativeXPathSelector(parent, child) {
  if (!parent || !child || !parent.contains(child) || parent === child) return null;
  const segments = [];
  let current = child;
  while (current && current !== parent) {
    // 요소 노드가 아니면 상위로 이동한다.
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
  return `.//${segments.join('/')}`;
}

export function buildRobustXPathSegment(el) {
  if (!el || el.nodeType !== 1) return null;
  const tag = el.tagName.toLowerCase();
  if (el.id) {
    // id가 있으면 더 이상 상위 요소를 탐색할 필요 없으니 stop 플래그를 준다.
    return { segment: `//*[@id=${escapeXPathLiteral(el.id)}]`, stop: true };
  }
  const attrPriority = ['data-testid', 'data-test', 'data-qa', 'data-cy', 'data-id', 'aria-label', 'role', 'name', 'type'];
  for (const attr of attrPriority) {
    const val = el.getAttribute && el.getAttribute(attr);
    if (val) {
      return { segment: `${tag}[@${attr}=${escapeXPathLiteral(val)}]`, stop: false };
    }
  }
  const classList = Array.from(el.classList || []).filter(Boolean);
  if (classList.length) {
    const cls = classList[0];
    const containsExpr = `contains(concat(' ', normalize-space(@class), ' '), ${escapeXPathLiteral(' ' + cls + ' ')})`;
    return { segment: `${tag}[${containsExpr}]`, stop: false };
  }
  let index = 1;
  let sibling = el.previousElementSibling;
  while (sibling) {
    if (sibling.tagName === el.tagName) {
      index += 1;
    }
    sibling = sibling.previousElementSibling;
  }
  return { segment: `${tag}[${index}]`, stop: false };
}

export function buildRobustXPath(el) {
  if (!el || el.nodeType !== 1) return null;
  const segments = [];
  let current = el;
  while (current && current.nodeType === 1) {
    // 각 단계별로 속성 기반 XPath 조각을 생성한다.
    const info = buildRobustXPathSegment(current);
    if (!info || !info.segment) return null;
    segments.unshift(info.segment);
    // stop 플래그가 true인 경우 루프를 종료한다.
    if (info.stop) break;
    current = current.parentElement;
  }
  if (segments.length === 0) return null;
  let xpath = segments[0];
  if (xpath.startsWith('//*[@')) {
    if (segments.length > 1) {
      xpath += `/${segments.slice(1).join('/')}`;
    }
  } else {
    xpath = `//${segments.join('/')}`;
  }
  return xpath;
}

export function normalizeText(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

export function inferSelectorType(selector) {
  if (!selector || typeof selector !== 'string') return null;
  const trimmed = selector.trim();
  if (trimmed.startsWith('xpath=')) return 'xpath';
  if (trimmed.startsWith('//') || trimmed.startsWith('(')) return 'xpath';
  if (trimmed.startsWith('text=')) return 'text';
  if (trimmed.startsWith('#') || trimmed.startsWith('.') || trimmed.startsWith('[')) return 'css';
  return 'css';
}

export function parseSelectorForMatching(selector, explicitType) {
  if (!selector) return { type: explicitType || null, value: '' };
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
  return { type, value };
}

export function iterateElements(scope, callback) {
  if (!scope || typeof callback !== 'function') return;
  if (scope === document) {
    // 전체 문서일 때는 querySelectorAll('*')로 순회.
    document.querySelectorAll('*').forEach(callback);
    return;
  }
  if (scope.nodeType === 1) {
    // 단일 요소 범위는 자신과 자손을 순회.
    callback(scope);
    scope.querySelectorAll('*').forEach(callback);
  }
}

function isElementVisibleForMatching(element) {
  if (!element || element.nodeType !== 1) return false;
  if (element.hidden) return false;
  const doc = element.ownerDocument || document;
  const view = (doc && doc.defaultView) || window;
  let computedStyle = null;
  try {
    computedStyle = view.getComputedStyle(element);
  } catch (err) {
    computedStyle = null;
  }
  if (computedStyle) {
    const opacity = parseFloat(computedStyle.opacity);
    if (!Number.isNaN(opacity) && opacity === 0) return false;
  }
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    return false;
  }
  return true;
}

function isNodeVisibleForMatching(node) {
  if (!node) return false;
  if (node.nodeType === 1) {
    return isElementVisibleForMatching(node);
  }
  if (node.nodeType === 3 && node.parentElement) {
    return isElementVisibleForMatching(node.parentElement);
  }
  return false;
}

export function buildTextXPathExpression(text, matchMode, scopeIsDocument) {
  const literal = escapeXPathLiteral(text);
  const base = scopeIsDocument ? '//' : './/';
  if (matchMode === 'exact') {
    return `${base}*[normalize-space(.) = ${literal}]`;
  }
  return `${base}*[contains(normalize-space(.), ${literal})]`;
}

function dedupeTextMatchNodes(nodes) {
  if (!Array.isArray(nodes) || nodes.length <= 1) return nodes || [];
  const nodeSet = new Set(nodes);
  const result = [];
  nodes.forEach((node) => {
    if (!node) return;
    const text = normalizeText(node.textContent || '');
    if (!text) return;
    let ancestor = node.parentElement;
    while (ancestor) {
      if (nodeSet.has(ancestor)) {
        const ancestorText = normalizeText(ancestor.textContent || '');
        if (ancestorText === text) {
          return;
        }
      }
      ancestor = ancestor.parentElement;
    }
    result.push(node);
  });
  return result;
}

export function countMatchesForSelector(parsed, root, options = {}) {
  if (!parsed || !parsed.value) return 0;
  const scope = root || document;
  const maxCount = typeof options.maxCount === 'number' && options.maxCount > 0 ? options.maxCount : Infinity;
  const shouldClamp = Number.isFinite(maxCount);
  try {
    if (parsed.type === 'xpath') {
      const doc = scope.ownerDocument || document;
      const contextNode = scope.nodeType ? scope : doc;
      const iterator = doc.evaluate(parsed.value, contextNode, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
      let count = 0;
      let node = iterator.iterateNext();
      // XPath 결과를 하나씩 순회하면서 개수를 센다.
      while (node) {
        if (isNodeVisibleForMatching(node)) {
          count += 1;
          if (shouldClamp && count >= maxCount) {
            return maxCount;
          }
        }
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
      const matches = [];
      let node = iterator.iterateNext();
      // 텍스트 기반 XPath도 동일하게 반복하며 개수를 계산.
      while (node) {
        if (isNodeVisibleForMatching(node)) {
          matches.push(node);
        }
        node = iterator.iterateNext();
      }
      const deduped = dedupeTextMatchNodes(matches);
      if (!shouldClamp) return deduped.length;
      return Math.min(deduped.length, maxCount);
    }
    const result = scope.querySelectorAll(parsed.value);
    const filtered = Array.from(result).filter((node) => isNodeVisibleForMatching(node));
    if (!shouldClamp) {
      if (scope === document) {
        return filtered.length;
      }
      let count = filtered.length;
      // 스코프 자체도 셀렉터와 일치하면 추가로 카운트.
      if (scope.matches && scope.matches(parsed.value) && isNodeVisibleForMatching(scope)) {
        count += 1;
      }
      return count;
    }
    let count = 0;
    for (let i = 0; i < filtered.length; i += 1) {
      count += 1;
      if (count >= maxCount) {
        return maxCount;
      }
    }
    if (scope !== document && scope.matches && scope.matches(parsed.value) && isNodeVisibleForMatching(scope)) {
      count += 1;
      if (count >= maxCount) {
        return maxCount;
      }
    }
    return count;
  } catch (err) {
    return 0;
  }
}

const CONTEXT_ATTRIBUTE_KEYS = [
  'data-testid',
  'data-test',
  'data-qa',
  'data-cy',
  'data-id',
  'aria-label',
  'role',
  'name',
  'type',
  'alt',
  'title'
];

function pickContextAttributes(element) {
  const attrs = {};
  CONTEXT_ATTRIBUTE_KEYS.forEach((key) => {
    const value = element.getAttribute && element.getAttribute(key);
    if (value) {
      attrs[key] = value;
    }
  });
  return attrs;
}

export function getElementPositionInfo(element) {
  const parent = element.parentElement;
  let index = 0;
  let nthOfType = 0;
  let total = 1;
  if (parent) {
    const children = Array.from(parent.children || []);
    total = children.length;
    index = children.indexOf(element);
    nthOfType = children
      // 현재 요소와 같은 태그를 가진 형제만 세어 nth-of-type 정보를 만든다.
      .slice(0, index + 1)
      .filter((el) => el.tagName === element.tagName).length;
  } else {
    nthOfType = 1;
  }
  return {
    index,
    total,
    nthOfType
  };
}

function summarizeElementForContext(element) {
  if (!element || element.nodeType !== 1) return null;
  if (!isElementVisibleForMatching(element)) return null;
  const summary = {
    tag: element.tagName ? element.tagName.toLowerCase() : ''
  };
  if (element.id) {
    summary.id = element.id;
  }
  const classes = Array.from(element.classList || []).slice(0, 5);
  if (classes.length) {
    summary.classes = classes;
  }
  const attrs = pickContextAttributes(element);
  if (Object.keys(attrs).length > 0) {
    summary.attributes = attrs;
  }
  const rawText = normalizeText((element.innerText || element.textContent || '').trim());
  if (rawText) {
    summary.text = rawText.length > 80 ? `${rawText.slice(0, 77)}…` : rawText;
  }
  if (typeof element.value === 'string' && element.value.trim()) {
    summary.value = element.value.trim();
  } else if (element.hasAttribute && element.hasAttribute('value')) {
    const attrValue = element.getAttribute('value');
    if (attrValue) {
      summary.value = attrValue;
    }
  }
  summary.childCount = element.children ? element.children.length : 0;
  summary.position = getElementPositionInfo(element);
  if (summary.position && typeof summary.position.total === 'number') {
    summary.repeats = summary.position.total > 1;
  }
  return summary;
}

export function buildDomContextSnapshot(element, options = {}) {
  if (!element || element.nodeType !== 1) {
    return {
      self: null,
      ancestors: [],
      siblings: [],
      children: [],
      root: null
    };
  }
  const {
    maxParents = 3,
    maxSiblings = 5,
    minSiblings = 2,
    maxChildren = 5,
    includeSelf = true,
    includeRoot = true
  } = options;

  const ancestorSummaries = [];
  let current = element.parentElement;
  while (current) {
    const summary = summarizeElementForContext(current);
    if (summary) {
      ancestorSummaries.push(summary);
    }
    current = current.parentElement;
  }

  const parentSummaries = ancestorSummaries.slice(0, maxParents);
  const rootSummary = includeRoot && ancestorSummaries.length > maxParents
    ? ancestorSummaries[ancestorSummaries.length - 1]
    : null;

  const siblings = [];
  const parentElement = element.parentElement;
  if (parentElement) {
    const siblingElements = Array.from(parentElement.children || [])
      .filter((child) => child !== element);
    const decorated = siblingElements
      .map((sibling, idx) => ({
        element: sibling,
        index: idx,
        summary: summarizeElementForContext(sibling)
      }))
      .filter((item) => item.summary);

    const targetIndex = parentElement ? Array.from(parentElement.children || []).indexOf(element) : -1;
    const desiredCount = Math.max(maxSiblings, minSiblings);

    decorated.sort((a, b) => {
      const distanceA = targetIndex >= 0 ? Math.abs((a.index ?? 0) - targetIndex) : a.index ?? 0;
      const distanceB = targetIndex >= 0 ? Math.abs((b.index ?? 0) - targetIndex) : b.index ?? 0;
      if (distanceA !== distanceB) return distanceA - distanceB;
      return (a.index ?? 0) - (b.index ?? 0);
    });

    const selected = decorated.slice(0, desiredCount);
    selected.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    selected.forEach((item) => {
      siblings.push(item.summary);
    });
  }

  const children = [];
  const childElements = Array.from(element.children || []);
  for (const child of childElements) {
    if (children.length >= maxChildren) break;
    const summary = summarizeElementForContext(child);
    if (summary) children.push(summary);
  }

  return {
    self: includeSelf ? summarizeElementForContext(element) : undefined,
    ancestors: parentSummaries,
    siblings,
    children,
    root: rootSummary
  };
}

