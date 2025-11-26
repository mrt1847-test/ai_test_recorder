(() => {
  // src/content/utils/dom.js
  function escapeAttributeValue(value) {
    return (value || "").replace(/"/g, '\\"').replace(/\u0008/g, "").replace(/\u000c/g, "").trim();
  }
  function cssEscapeIdent(value) {
    if (typeof value !== "string") return "";
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return value.replace(/([!"#$%&'()*+,./:;<=>?@\[\]^`{|}~])/g, "\\$1");
  }
  function buildFullXPath(el) {
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
    return `//${parts.join("/")}`;
  }
  function buildCssSegment(el) {
    if (!el || el.nodeType !== 1) return "";
    const tag = el.tagName.toLowerCase();
    let index = 1;
    let sibling = el.previousElementSibling;
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
      const classSelector = `${tag}.${classList.join(".")}`;
      const parent = el.parentElement;
      if (parent) {
        const requiredClasses = rawClassList.slice(0, classList.length);
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
    return `:scope ${segments.join(" > ")}`;
  }
  function buildUniqueCssPath(element, contextElement) {
    if (!element || element.nodeType !== 1) return null;
    const segments = [];
    let current = element;
    while (current && current.nodeType === 1 && current !== contextElement) {
      const segment = buildCssSegment(current);
      if (!segment) return null;
      segments.unshift(segment);
      const cssPath = segments.join(" > ");
      const selectorString = contextElement ? `:scope ${cssPath}` : cssPath;
      const parsed = parseSelectorForMatching(`css=${selectorString}`, "css");
      const targetScope = contextElement || document;
      const matchCount = countMatchesForSelector(parsed, targetScope);
      if (matchCount === 1) {
        if (!contextElement && cssPath.startsWith("html:nth-of-type(1) > ")) {
          return cssPath.replace(/^html:nth-of-type\(1\)\s*>\s*/, "");
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
      const relativePath = segments.join(" > ");
      return relativePath ? `:scope ${relativePath}` : null;
    }
    let finalPath = segments.join(" > ");
    if (finalPath.startsWith("html:nth-of-type(1) > ")) {
      finalPath = finalPath.replace(/^html:nth-of-type\(1\)\s*>\s*/, "");
    }
    return finalPath;
  }
  function escapeXPathLiteral(value) {
    if (value.includes('"') && value.includes("'")) {
      const parts = value.split('"').map((part) => `"${part}"`).join(', """, ');
      return `concat(${parts})`;
    }
    if (value.includes('"')) {
      return `'${value}'`;
    }
    return `"${value}"`;
  }
  function buildXPathSegment(el) {
    if (!el || el.nodeType !== 1) return "";
    const tag = el.tagName.toLowerCase();
    if (el.id) {
      return `${tag}[@id=${escapeXPathLiteral(el.id)}]`;
    }
    const classList = Array.from(el.classList || []).filter(Boolean);
    if (classList.length) {
      const cls = classList[0];
      const containsExpr = `contains(concat(' ', normalize-space(@class), ' '), ${escapeXPathLiteral(" " + cls + " ")})`;
      return `${tag}[${containsExpr}]`;
    }
    const attrPriority = ["data-testid", "data-test", "data-qa", "data-cy", "data-id", "aria-label", "role", "name", "type"];
    for (const attr of attrPriority) {
      const val = el.getAttribute && el.getAttribute(attr);
      if (val) {
        return `${tag}[@${attr}=${escapeXPathLiteral(val)}]`;
      }
    }
    const nameAttr = el.getAttribute && el.getAttribute("name");
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
    return `.//${segments.join("/")}`;
  }
  function buildRobustXPathSegment(el) {
    if (!el || el.nodeType !== 1) return null;
    const tag = el.tagName.toLowerCase();
    if (el.id) {
      return { segment: `//*[@id=${escapeXPathLiteral(el.id)}]`, stop: true };
    }
    const attrPriority = ["data-testid", "data-test", "data-qa", "data-cy", "data-id", "aria-label", "role", "name", "type"];
    for (const attr of attrPriority) {
      const val = el.getAttribute && el.getAttribute(attr);
      if (val) {
        return { segment: `${tag}[@${attr}=${escapeXPathLiteral(val)}]`, stop: false };
      }
    }
    const classList = Array.from(el.classList || []).filter(Boolean);
    if (classList.length) {
      const cls = classList[0];
      const containsExpr = `contains(concat(' ', normalize-space(@class), ' '), ${escapeXPathLiteral(" " + cls + " ")})`;
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
    if (xpath.startsWith("//*[@")) {
      if (segments.length > 1) {
        xpath += `/${segments.slice(1).join("/")}`;
      }
    } else {
      xpath = `//${segments.join("/")}`;
    }
    return xpath;
  }
  function normalizeText(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }
  function inferSelectorType(selector) {
    if (!selector || typeof selector !== "string") return null;
    const trimmed = selector.trim();
    if (trimmed.startsWith("xpath=")) return "xpath";
    if (trimmed.startsWith("//") || trimmed.startsWith("(")) return "xpath";
    if (trimmed.startsWith("text=")) return "text";
    if (trimmed.startsWith("#") || trimmed.startsWith(".") || trimmed.startsWith("[")) return "css";
    return "css";
  }
  function parseSelectorForMatching(selector, explicitType) {
    if (!selector) return { type: explicitType || null, value: "" };
    let type = explicitType || inferSelectorType(selector);
    let value = selector;
    if (selector.startsWith("css=")) {
      type = "css";
      value = selector.slice(4);
    } else if (selector.startsWith("xpath=")) {
      type = "xpath";
      value = selector.slice(6);
    } else if (selector.startsWith("text=")) {
      type = "text";
      value = selector.slice(5);
    }
    if (type === "text") {
      value = value.replace(/^['"]|['"]$/g, "");
      value = value.replace(/\\"/g, '"').replace(/\\'/g, "'");
    }
    return { type, value };
  }
  function isElementVisibleForMatching(element) {
    if (!element || element.nodeType !== 1) return false;
    if (element.hidden) return false;
    const doc = element.ownerDocument || document;
    const view = doc && doc.defaultView || window;
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
  function buildTextXPathExpression(text, matchMode, scopeIsDocument) {
    const literal = escapeXPathLiteral(text);
    const base = scopeIsDocument ? "//" : ".//";
    if (matchMode === "exact") {
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
      const text = normalizeText(node.textContent || "");
      if (!text) return;
      let ancestor = node.parentElement;
      while (ancestor) {
        if (nodeSet.has(ancestor)) {
          const ancestorText = normalizeText(ancestor.textContent || "");
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
  function countMatchesForSelector(parsed, root, options = {}) {
    if (!parsed || !parsed.value) return 0;
    const scope = root || document;
    const maxCount = typeof options.maxCount === "number" && options.maxCount > 0 ? options.maxCount : Infinity;
    const shouldClamp = Number.isFinite(maxCount);
    try {
      if (parsed.type === "xpath") {
        const doc = scope.ownerDocument || document;
        const contextNode = scope.nodeType ? scope : doc;
        const iterator = doc.evaluate(parsed.value, contextNode, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
        let count2 = 0;
        let node = iterator.iterateNext();
        while (node) {
          if (isNodeVisibleForMatching(node)) {
            count2 += 1;
            if (shouldClamp && count2 >= maxCount) {
              return maxCount;
            }
          }
          node = iterator.iterateNext();
        }
        return count2;
      }
      if (parsed.type === "text") {
        const targetText = normalizeText(parsed.value);
        if (!targetText) return 0;
        const doc = scope.ownerDocument || document;
        const contextNode = scope.nodeType ? scope : doc;
        const isDocumentScope = !scope || scope === document || scope.nodeType === 9;
        const matchMode = options.matchMode === "contains" ? "contains" : "exact";
        const expression = buildTextXPathExpression(targetText, matchMode, isDocumentScope);
        const iterator = doc.evaluate(expression, contextNode, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
        const matches = [];
        let node = iterator.iterateNext();
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
        let count2 = filtered.length;
        if (scope.matches && scope.matches(parsed.value) && isNodeVisibleForMatching(scope)) {
          count2 += 1;
        }
        return count2;
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
  var CONTEXT_ATTRIBUTE_KEYS = [
    "data-testid",
    "data-test",
    "data-qa",
    "data-cy",
    "data-id",
    "aria-label",
    "role",
    "name",
    "type",
    "alt",
    "title"
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
  function getElementPositionInfo(element) {
    const parent = element.parentElement;
    let index = 0;
    let nthOfType = 0;
    let total = 1;
    if (parent) {
      const children = Array.from(parent.children || []);
      total = children.length;
      index = children.indexOf(element);
      nthOfType = children.slice(0, index + 1).filter((el) => el.tagName === element.tagName).length;
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
      tag: element.tagName ? element.tagName.toLowerCase() : ""
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
    const rawText = normalizeText((element.innerText || element.textContent || "").trim());
    if (rawText) {
      summary.text = rawText.length > 80 ? `${rawText.slice(0, 77)}\u2026` : rawText;
    }
    if (typeof element.value === "string" && element.value.trim()) {
      summary.value = element.value.trim();
    } else if (element.hasAttribute && element.hasAttribute("value")) {
      const attrValue = element.getAttribute("value");
      if (attrValue) {
        summary.value = attrValue;
      }
    }
    summary.childCount = element.children ? element.children.length : 0;
    summary.position = getElementPositionInfo(element);
    if (summary.position && typeof summary.position.total === "number") {
      summary.repeats = summary.position.total > 1;
    }
    return summary;
  }
  function buildDomContextSnapshot(element, options = {}) {
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
    const rootSummary = includeRoot && ancestorSummaries.length > maxParents ? ancestorSummaries[ancestorSummaries.length - 1] : null;
    const siblings = [];
    const parentElement = element.parentElement;
    if (parentElement) {
      const siblingElements = Array.from(parentElement.children || []).filter((child) => child !== element);
      const decorated = siblingElements.map((sibling, idx) => ({
        element: sibling,
        index: idx,
        summary: summarizeElementForContext(sibling)
      })).filter((item) => item.summary);
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
      self: includeSelf ? summarizeElementForContext(element) : void 0,
      ancestors: parentSummaries,
      siblings,
      children,
      root: rootSummary
    };
  }

  // src/content/selectors/index.js
  var DEFAULT_TEXT_SCORE = 65;
  var DEFAULT_TAG_SCORE = 20;
  var UNIQUE_MATCH_BONUS = 6;
  var DUPLICATE_PENALTY_STEP = 6;
  var CLASS_COMBINATION_LIMIT = 3;
  var MAX_CLASS_COMBINATIONS = 24;
  var TEXT_PARENT_MAX_DEPTH = 4;
  var TEXT_PARENT_CLASS_LIMIT = 4;
  var TEXT_PARENT_COMBINATION_LIMIT = 3;
  var TEXT_PARENT_MAX_COMBINATIONS = 12;
  var CSS_PARENT_MAX_DEPTH = 3;
  var CSS_PARENT_CLASS_LIMIT = 4;
  var CSS_PARENT_COMBINATION_LIMIT = 3;
  var CSS_PARENT_MAX_COMBINATIONS = 20;
  var CSS_SIMPLE_PARENT_MAX_DEPTH = 4;
  var SELECTOR_TYPE_PRIORITY = {
    id: 100,
    "data-testid": 96,
    "data-test": 95,
    "data-qa": 94,
    "data-cy": 94,
    "data-id": 92,
    "aria-label": 90,
    name: 88,
    role: 85,
    title: 82,
    text: 78,
    css: 70,
    "class-tag": 66,
    class: 62,
    tag: 40,
    xpath: 30,
    "xpath-full": 5
  };
  var ATTRIBUTE_PRIORITY = [
    { attr: "id", type: "id", score: 90, reason: "id \uC18D\uC131", allowPartial: false },
    { attr: "data-testid", type: "data-testid", score: 88, reason: "data-testid \uC18D\uC131", allowPartial: true },
    { attr: "data-test", type: "data-test", score: 86, reason: "data-test \uC18D\uC131", allowPartial: true },
    { attr: "data-qa", type: "data-qa", score: 84, reason: "data-qa \uC18D\uC131", allowPartial: true },
    { attr: "data-cy", type: "data-cy", score: 84, reason: "data-cy \uC18D\uC131", allowPartial: true },
    { attr: "data-id", type: "data-id", score: 82, reason: "data-id \uC18D\uC131", allowPartial: true },
    { attr: "aria-label", type: "aria-label", score: 80, reason: "aria-label \uC18D\uC131", allowPartial: true },
    { attr: "role", type: "role", score: 78, reason: "role \uC18D\uC131", allowPartial: false },
    { attr: "name", type: "name", score: 78, reason: "name \uC18D\uC131", allowPartial: false },
    { attr: "title", type: "title", score: 72, reason: "title \uC18D\uC131", allowPartial: true },
    { attr: "type", type: "type", score: 68, reason: "type \uC18D\uC131", allowPartial: false }
  ];
  function buildAttributeSelectors(element) {
    const results = [];
    for (const meta of ATTRIBUTE_PRIORITY) {
      const rawValue = element.getAttribute && element.getAttribute(meta.attr);
      if (!rawValue) continue;
      if (meta.attr === "id") {
        results.push({
          type: "id",
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
            reason: `${meta.reason} \uBD80\uBD84 \uC77C\uCE58`,
            matchMode: "contains"
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
    const combinations = /* @__PURE__ */ new Set();
    function backtrack(start, depth, current) {
      if (current.length > 0 && current.length <= CLASS_COMBINATION_LIMIT) {
        const key = current.join(".");
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
      const lenDiff = a.split(".").length - b.split(".").length;
      if (lenDiff !== 0) return lenDiff;
      return a.localeCompare(b);
    });
    ordered.slice(0, MAX_CLASS_COMBINATIONS).forEach((key) => {
      const classSelector = `.${key}`;
      results.push({
        type: "class",
        selector: classSelector,
        score: 62 - Math.min(10, key.split(".").length * 2),
        reason: "class \uC870\uD569"
      });
      results.push({
        type: "class-tag",
        selector: `${element.tagName.toLowerCase()}${classSelector}`,
        score: 68 - Math.min(10, key.split(".").length),
        reason: "\uD0DC\uADF8 + class \uC870\uD569"
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
    if (type.startsWith("data-")) return 90;
    if (type.includes("partial")) return 75;
    return 50;
  }
  function sortCandidates(candidates) {
    return candidates.slice().sort((a, b) => {
      const uniqueA = a.unique ? 1 : 0;
      const uniqueB = b.unique ? 1 : 0;
      if (uniqueA !== uniqueB) return uniqueB - uniqueA;
      const relationA = a.relation === "relative" ? 1 : 0;
      const relationB = b.relation === "relative" ? 1 : 0;
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
  function tryBuildAncestorTextXPath(element, textValue, matchMode) {
    if (!element || !textValue) return null;
    const normalized = normalizeText(textValue);
    if (!normalized) return null;
    const literal = escapeXPathLiteral(normalized);
    const textExpr = matchMode === "contains" ? `contains(normalize-space(.), ${literal})` : `normalize-space(.) = ${literal}`;
    const elementClassList = Array.from(element.classList || []).filter(Boolean);
    if (elementClassList.length) {
      for (const cls of elementClassList.slice(0, TEXT_PARENT_CLASS_LIMIT)) {
        const literalClass = escapeXPathLiteral(cls);
        const tagName = element.tagName ? element.tagName.toLowerCase() : "*";
        const candidates = [
          `//*[@class=${literalClass} and normalize-space(.) = ${literal}]`,
          `//*[@class=${literalClass} and contains(normalize-space(.), ${literal})]`,
          `//${tagName}[@class=${literalClass} and normalize-space(.) = ${literal}]`,
          `//${tagName}[@class=${literalClass} and contains(normalize-space(.), ${literal})]`
        ];
        for (const xpathExpr of candidates) {
          const selector = `xpath=${xpathExpr}`;
          const parsed = parseSelectorForMatching(selector, "xpath");
          const count = countMatchesForSelector(parsed, document, { matchMode });
          if (count === 1) {
            const isTagVariant = xpathExpr.startsWith(`//${tagName}`);
            return {
              selector,
              count,
              reason: isTagVariant ? "\uD0DC\uADF8+\uD074\uB798\uC2A4 + \uD14D\uC2A4\uD2B8 \uC870\uD569" : "\uD074\uB798\uC2A4 + \uD14D\uC2A4\uD2B8 \uC870\uD569"
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
        current = current.parentElement;
        continue;
      }
      const classList = Array.from(current.classList || []).filter(Boolean);
      const tagName = current.tagName ? current.tagName.toLowerCase() : "*";
      if (classList.length > 0) {
        for (const cls of classList.slice(0, TEXT_PARENT_CLASS_LIMIT)) {
          const classLiteral = escapeXPathLiteral(cls);
          const classXPath = `//*[@class=${classLiteral}]//*[${textExpr}]`;
          const classSelector = `xpath=${classXPath}`;
          const classParsed = parseSelectorForMatching(classSelector, "xpath");
          const classCount = countMatchesForSelector(classParsed, document, { matchMode });
          if (classCount === 1) {
            return {
              selector: classSelector,
              count: classCount,
              reason: "\uC0C1\uC704 \uD074\uB798\uC2A4 + \uD14D\uC2A4\uD2B8 \uC870\uD569"
            };
          }
          const tagClassXPath = `//${tagName}[@class=${classLiteral}]//*[${textExpr}]`;
          const tagClassSelector = `xpath=${tagClassXPath}`;
          const tagClassParsed = parseSelectorForMatching(tagClassSelector, "xpath");
          const tagClassCount = countMatchesForSelector(tagClassParsed, document, { matchMode });
          if (tagClassCount === 1) {
            return {
              selector: tagClassSelector,
              count: tagClassCount,
              reason: "\uC0C1\uC704 \uD0DC\uADF8+\uD074\uB798\uC2A4 + \uD14D\uC2A4\uD2B8 \uC870\uD569"
            };
          }
        }
      } else if (tagName && tagName !== "*") {
        const tagOnlyXPath = `//${tagName}[${textExpr}]`;
        const tagOnlySelector = `xpath=${tagOnlyXPath}`;
        const tagOnlyParsed = parseSelectorForMatching(tagOnlySelector, "xpath");
        const tagOnlyCount = countMatchesForSelector(tagOnlyParsed, document, { matchMode });
        if (tagOnlyCount === 1) {
          return {
            selector: tagOnlySelector,
            count: tagOnlyCount,
            reason: "\uC0C1\uC704 \uD0DC\uADF8 + \uD14D\uC2A4\uD2B8 \uC870\uD569"
          };
        }
      }
      current = current.parentElement;
    }
    return null;
  }
  function extractCssSelector(candidate) {
    if (!candidate) return null;
    const selector = candidate.selector || "";
    const type = candidate.type || inferSelectorType(selector);
    if (type === "css") {
      return selector.startsWith("css=") ? selector.slice(4) : selector;
    }
    if (type === "class" || type === "class-tag" || type === "id" || type === "tag") {
      return selector;
    }
    if (type === "text") return null;
    return null;
  }
  function tryBuildAncestorCssSelector(element, baseSelector, contextElement) {
    if (!element || !baseSelector) return null;
    const base = baseSelector.startsWith("css=") ? baseSelector.slice(4).trim() : baseSelector.trim();
    if (!base) return null;
    const tested = /* @__PURE__ */ new Set();
    const scopedPrefix = contextElement ? ":scope " : "";
    let current = element.parentElement;
    let depth = 0;
    let paths = [base];
    while (current && depth < CSS_PARENT_MAX_DEPTH && paths.length) {
      depth += 1;
      if (current.nodeType !== 1) {
        current = current.parentElement;
        continue;
      }
      const ancestorSelectors = [];
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
            ancestorSelectors.push(`.${escaped.join(".")}`);
            const tag = current.tagName ? current.tagName.toLowerCase() : "*";
            ancestorSelectors.push(`${tag}.${escaped.join(".")}`);
          }
        });
      }
      const tagName = current.tagName ? current.tagName.toLowerCase() : "*";
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
            const parsed = parseSelectorForMatching(`css=${fullSelector}`, "css");
            const targetScope = contextElement || document;
            const count = countMatchesForSelector(parsed, targetScope);
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
  function tryBuildSimpleAncestorCss(element, baseSelector, contextElement) {
    if (!element || !baseSelector) return null;
    const base = baseSelector.startsWith("css=") ? baseSelector.slice(4).trim() : baseSelector.trim();
    if (!base) return null;
    const scopedPrefix = contextElement ? ":scope " : "";
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
      const parsed = parseSelectorForMatching(fullSelector, "css");
      const count = countMatchesForSelector(parsed, targetScope);
      if (count === 1) {
        return { selector: fullSelector, count };
      }
      const parent = current.parentElement;
      if (!parent) break;
      const parentSelector = buildParentSelector(parent);
      if (!parentSelector) break;
      selector = `${parentSelector} > ${selector}`;
      current = parent;
      depth += 1;
    }
    const finalSelector = contextElement ? `css=${scopedPrefix}${selector}` : `css=${selector}`;
    const finalParsed = parseSelectorForMatching(finalSelector, "css");
    const finalCount = countMatchesForSelector(finalParsed, targetScope);
    if (finalCount === 1) {
      return { selector: finalSelector, count: finalCount };
    }
    return null;
  }
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
    const selector = `${tagName}.${escapedClasses.join(".")}:nth-of-type(1)`;
    const scopedResult = tryBuildSimpleAncestorCss(element, selector, null);
    if (scopedResult && scopedResult.count === 1) {
      return {
        type: "css",
        selector: scopedResult.selector,
        score: 88,
        reason: "\uCCAB \uBC88\uC9F8 \uD56D\uBAA9 (nth-of-type)"
      };
    }
    const parsed = parseSelectorForMatching(`css=${selector}`, "css");
    const count = countMatchesForSelector(parsed, document);
    if (count === 1) {
      return {
        type: "css",
        selector: `css=${selector}`,
        score: 84,
        reason: "\uCCAB \uBC88\uC9F8 \uD56D\uBAA9 (nth-of-type)"
      };
    }
    return null;
  }
  function getIframeContext(target) {
    try {
      const win = target && target.ownerDocument && target.ownerDocument.defaultView;
      if (!win) return null;
      const frameEl = win.frameElement || null;
      if (!frameEl) return null;
      return {
        id: frameEl.id || null,
        name: frameEl.name || null,
        src: frameEl.src || frameEl.getAttribute && frameEl.getAttribute("src") || null
      };
    } catch (e) {
      return null;
    }
  }
  function ensureRawMetadata(candidate, baseCandidate, originalType) {
    if (candidate.rawSelector === void 0) {
      candidate.rawSelector = baseCandidate.rawSelector || baseCandidate.selector;
    }
    if (candidate.rawType === void 0) {
      candidate.rawType = baseCandidate.rawType || originalType;
    }
    if (candidate.rawReason === void 0 && baseCandidate.reason) {
      candidate.rawReason = baseCandidate.rawReason || baseCandidate.reason;
    }
  }
  function createReasonContext(candidate) {
    return {
      reasonParts: candidate.reason ? [candidate.reason] : []
    };
  }
  function applyGlobalMatchCheck(candidate, parsed, options, ctx) {
    if (options.skipGlobalCheck) return true;
    const matchOptions = {
      matchMode: candidate.matchMode,
      maxCount: typeof options.maxMatchSample === "number" && options.maxMatchSample > 0 ? options.maxMatchSample : 4
    };
    const globalCount = countMatchesForSelector(parsed, document, matchOptions);
    candidate.matchCount = globalCount;
    candidate.unique = globalCount === 1;
    if (candidate.rawMatchCount === void 0) {
      candidate.rawMatchCount = globalCount;
      candidate.rawUnique = globalCount === 1;
    }
    if (globalCount === 0 && options.allowZero !== true) {
      return false;
    }
    ctx.reasonParts = ctx.reasonParts.filter((part) => !/유일 일치|개 요소와 일치/.test(part));
    if (globalCount === 1) {
      ctx.reasonParts.push("\uC720\uC77C \uC77C\uCE58");
    } else if (globalCount > 1) {
      ctx.reasonParts.push(globalCount === 2 ? "2\uAC1C \uC694\uC18C\uC640 \uC77C\uCE58 (\uCD94\uAC00 \uC870\uD569)" : `${globalCount}\uAC1C \uC694\uC18C\uC640 \uC77C\uCE58`);
    }
    return true;
  }
  function applyContextMatchCheck(candidate, parsed, options, ctx) {
    if (!options.contextElement) return true;
    const contextCount = countMatchesForSelector(parsed, options.contextElement, { matchMode: candidate.matchMode });
    candidate.contextMatchCount = contextCount;
    candidate.uniqueInContext = contextCount === 1;
    if (options.contextLabel) {
      if (contextCount === 1) {
        ctx.reasonParts.push(`${options.contextLabel} \uB0B4 \uC720\uC77C`);
      } else if (contextCount > 1) {
        ctx.reasonParts.push(`${options.contextLabel} \uB0B4 ${contextCount}\uAC1C \uC77C\uCE58`);
      } else {
        ctx.reasonParts.push(`${options.contextLabel} \uB0B4 \uC77C\uCE58 \uC5C6\uC74C`);
      }
    }
    if (options.requireContextUnique && !candidate.uniqueInContext) {
      return false;
    }
    if (options.skipGlobalCheck) {
      candidate.matchCount = contextCount;
      candidate.unique = candidate.uniqueInContext;
    }
    return true;
  }
  function clampDuplicateScore(candidate, options) {
    if (typeof candidate.score !== "number") return;
    candidate.score = Math.min(candidate.score, options.duplicateScore ?? 55);
    candidate.score = Math.min(candidate.score, options.duplicateScore ?? 60);
  }
  function maybeDeriveTextSelector(candidate, originalType, options, parsed, ctx) {
    if (candidate.unique) return;
    if (originalType !== "text") return;
    if (!options.element) return;
    const textValue = candidate.textValue || parsed.value;
    if (!textValue) return;
    const ancestorResult = tryBuildAncestorTextXPath(
      options.element,
      textValue,
      candidate.matchMode || "exact"
    );
    if (!ancestorResult) return;
    candidate.selector = ancestorResult.selector;
    candidate.type = "xpath";
    candidate.relation = candidate.relation || "global";
    if (ancestorResult.reason) {
      ctx.reasonParts.push(ancestorResult.reason);
    } else {
      ctx.reasonParts.push("\uD14D\uC2A4\uD2B8 \uC870\uD569");
    }
  }
  function maybeDeriveCssSelector(candidate, options, ctx) {
    if (candidate.unique) return;
    if (!options.element) return;
    const baseCssSelector = extractCssSelector(candidate);
    if (!baseCssSelector) return;
    const simpleDerived = tryBuildSimpleAncestorCss(options.element, baseCssSelector, options.contextElement);
    if (simpleDerived) {
      candidate.selector = simpleDerived.selector;
      candidate.type = "css";
      candidate.relation = options.contextElement ? "relative" : candidate.relation || "global";
      ctx.reasonParts.push("\uBD80\uBAA8 \uD0DC\uADF8 \uACBD\uB85C \uC870\uD569");
      return;
    }
    const derived = tryBuildAncestorCssSelector(options.element, baseCssSelector, options.contextElement);
    if (derived) {
      candidate.selector = derived.selector;
      candidate.type = "css";
      candidate.relation = options.contextElement ? "relative" : candidate.relation || "global";
      ctx.reasonParts.push("\uC0C1\uC704 class \uACBD\uB85C \uC870\uD569");
    }
  }
  function maybeApplyIndexing(candidate, originalType, options, ctx) {
    if (candidate.unique) return;
    if (originalType === "text" || originalType === "xpath") return;
    if (!options.element) return;
    if (options.enableIndexing === false) return;
    const contextEl = options.contextElement && candidate.relation === "relative" ? options.contextElement : null;
    const uniqueSelector = buildUniqueCssPath(options.element, contextEl);
    if (!uniqueSelector || uniqueSelector === candidate.selector) return;
    const uniqueParsed = parseSelectorForMatching(uniqueSelector, "css");
    const count = countMatchesForSelector(uniqueParsed, contextEl || document, {
      matchMode: candidate.matchMode,
      maxCount: 2
    });
    if (count !== 1) return;
    candidate.selector = uniqueSelector;
    candidate.type = "css";
    candidate.relation = contextEl ? "relative" : candidate.relation;
    ctx.reasonParts.push("\uACBD\uB85C \uC778\uB371\uC2F1 \uC801\uC6A9");
  }
  function finalizeUniqueness(candidate, options, ctx) {
    if (candidate.unique) return;
    const verificationParsed = parseSelectorForMatching(
      candidate.selector,
      candidate.type || inferSelectorType(candidate.selector)
    );
    const verificationCount = countMatchesForSelector(
      verificationParsed,
      options.contextElement || document,
      { matchMode: candidate.matchMode, maxCount: 4 }
    );
    candidate.matchCount = verificationCount;
    candidate.unique = verificationCount === 1;
    candidate.uniqueInContext = verificationCount === 1;
    ctx.reasonParts = ctx.reasonParts.filter((part) => !/유일 일치|개 요소와 일치/.test(part));
    if (verificationCount === 1) {
      ctx.reasonParts.push("\uC720\uC77C \uC77C\uCE58");
    } else if (verificationCount === 2) {
      ctx.reasonParts.push("2\uAC1C \uC694\uC18C\uC640 \uC77C\uCE58 (\uCD94\uAC00 \uC870\uD569)");
    } else if (verificationCount > 2) {
      ctx.reasonParts.push(`${verificationCount}\uAC1C \uC694\uC18C\uC640 \uC77C\uCE58`);
    }
  }
  function enrichCandidateWithUniqueness(baseCandidate, options = {}) {
    if (!baseCandidate || !baseCandidate.selector) return null;
    const candidate = { ...baseCandidate };
    const originalType = candidate.type || inferSelectorType(candidate.selector);
    const resolvedType = candidate.type || originalType;
    ensureRawMetadata(candidate, baseCandidate, originalType);
    const parsed = parseSelectorForMatching(candidate.selector, resolvedType);
    const ctx = createReasonContext(candidate);
    if (!applyGlobalMatchCheck(candidate, parsed, options, ctx)) {
      return null;
    }
    if (!applyContextMatchCheck(candidate, parsed, options, ctx)) {
      return null;
    }
    if (!options.skipGlobalCheck && options.requireUnique && candidate.unique === false) {
      return null;
    }
    if (!options.skipGlobalCheck && candidate.unique === false) {
      clampDuplicateScore(candidate, options);
    }
    maybeDeriveTextSelector(candidate, originalType, options, parsed, ctx);
    maybeDeriveCssSelector(candidate, options, ctx);
    maybeApplyIndexing(candidate, originalType, options, ctx);
    finalizeUniqueness(candidate, options, ctx);
    candidate.reason = ctx.reasonParts.join(" \u2022 ");
    if (typeof candidate.score === "number") {
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
  function collectTextCandidates(element, registry) {
    const rawText = (element.innerText || element.textContent || "").trim().split("\n").map((t) => t.trim()).filter(Boolean)[0];
    if (!rawText) return;
    const truncatedText = rawText.slice(0, 60);
    const escapedText = escapeAttributeValue(truncatedText);
    const textSelector = `text="${escapedText}"`;
    let textMatchCount = null;
    try {
      const parsed = parseSelectorForMatching(textSelector, "text");
      textMatchCount = countMatchesForSelector(parsed, document, { matchMode: "exact", maxCount: 6 });
    } catch (e) {
      textMatchCount = null;
    }
    const reasonParts = ["\uD14D\uC2A4\uD2B8 \uC77C\uCE58"];
    if (typeof textMatchCount === "number") {
      if (textMatchCount === 1) {
        reasonParts.push("1\uAC1C \uC694\uC18C\uC640 \uC77C\uCE58");
      } else if (textMatchCount > 1) {
        reasonParts.push(`${textMatchCount}\uAC1C \uC694\uC18C\uC640 \uC77C\uCE58`);
      } else if (textMatchCount === 0) {
        reasonParts.push("\uC77C\uCE58 \uC5C6\uC74C");
      }
    } else {
      reasonParts.push("\uC77C\uCE58 \uAC1C\uC218 \uACC4\uC0B0 \uBD88\uAC00");
    }
    registry.add({
      type: "text",
      selector: textSelector,
      score: DEFAULT_TEXT_SCORE,
      reason: reasonParts.filter(Boolean).join(" \u2022 "),
      textValue: truncatedText,
      matchMode: "exact",
      unique: textMatchCount === 1,
      matchCount: textMatchCount,
      rawSelector: textSelector,
      rawType: "text",
      rawMatchCount: textMatchCount,
      rawUnique: textMatchCount === 1
    });
    const textCandidate = enrichCandidateWithUniqueness(
      {
        type: "text",
        selector: `text="${escapedText}"`,
        score: DEFAULT_TEXT_SCORE - 3,
        reason: "\uD14D\uC2A4\uD2B8 \uC870\uD569",
        textValue: truncatedText
      },
      { duplicateScore: 55, element }
    );
    if (textCandidate) {
      textCandidate.matchMode = textCandidate.matchMode || "exact";
      registry.add(textCandidate);
    }
  }
  function createCandidateRegistry() {
    const results = [];
    const seen = /* @__PURE__ */ new Set();
    return {
      add(candidate) {
        if (!candidate || !candidate.selector) return;
        const type = candidate.type || inferSelectorType(candidate.selector);
        const key = `${type || ""}::${candidate.selector}`;
        if (seen.has(key)) return;
        seen.add(key);
        if (candidate.rawSelector === void 0) {
          candidate.rawSelector = candidate.selector;
        }
        if (candidate.rawType === void 0) {
          candidate.rawType = type;
        }
        if (candidate.rawMatchCount === void 0 && typeof candidate.matchCount === "number") {
          candidate.rawMatchCount = candidate.matchCount;
        }
        if (candidate.rawUnique === void 0 && typeof candidate.unique === "boolean") {
          candidate.rawUnique = candidate.unique;
        }
        if (candidate.rawReason === void 0 && candidate.reason) {
          candidate.rawReason = candidate.reason;
        }
        results.push(candidate);
      },
      list() {
        return results;
      }
    };
  }
  function applyFragilityAdjustments(candidate) {
    if (!candidate || typeof candidate.score !== "number") {
      return candidate;
    }
    const selector = candidate.selector || "";
    const inferredType = candidate.type || inferSelectorType(selector);
    let penalty = 0;
    const flags = [];
    if (inferredType === "xpath-full" || /xpath=\/html/i.test(selector)) {
      penalty += 18;
      flags.push("\uC808\uB300 XPath");
    } else if ((inferredType === "xpath" || inferredType === "xpath-full") && /\/\d+\]/.test(selector) && !/@/.test(selector)) {
      penalty += 8;
      flags.push("\uAD6C\uC870 \uC758\uC874 XPath");
    }
    if ((inferredType === "css" || inferredType === "class" || inferredType === "class-tag" || inferredType === "id") && /:nth-(child|of-type)\(/i.test(selector)) {
      const match = selector.match(/:nth-(?:child|of-type)\((\d+)\)/i);
      const nthValue = match ? parseInt(match[1], 10) : null;
      penalty += nthValue === 1 ? 2 : 6;
      flags.push("nth-of-type \uC0AC\uC6A9");
    }
    if (inferredType === "class" || inferredType === "class-tag") {
      const classCount = (selector.match(/\./g) || []).length;
      if (classCount > 2) {
        penalty += (classCount - 2) * 4;
        flags.push("\uACFC\uB3C4\uD55C class \uC870\uD569");
      }
    }
    if (penalty > 0) {
      candidate.score = Math.max(5, candidate.score - penalty);
      if (flags.length) {
        const fragility = `\uCDE8\uC57D \uC694\uC18C (${flags.join(", ")})`;
        candidate.reason = candidate.reason ? `${candidate.reason} \u2022 ${fragility}` : fragility;
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
  function getSelectorCandidates(element) {
    if (!element) return [];
    const registry = createCandidateRegistry();
    try {
      buildAttributeSelectors(element).forEach((cand) => {
        addCandidate(registry, cand, { duplicateScore: 62, element, maxMatchSample: 5 });
      });
    } catch (e) {
    }
    generateClassSelectors(element).forEach((cand) => {
      addCandidate(registry, cand, { duplicateScore: 58, element, maxMatchSample: 5 });
    });
    collectTextCandidates(element, registry);
    const robustXPath = buildRobustXPath(element);
    if (robustXPath) {
      addCandidate(
        registry,
        { type: "xpath", selector: `xpath=${robustXPath}`, score: 58, reason: "\uC18D\uC131 \uAE30\uBC18 XPath", xpathValue: robustXPath },
        { duplicateScore: 52, element, maxMatchSample: 5 }
      );
    }
    const fullXPath = buildFullXPath(element);
    if (fullXPath) {
      addCandidate(
        registry,
        { type: "xpath-full", selector: `xpath=${fullXPath}`, score: 42, reason: "Full XPath (\uC808\uB300 \uACBD\uB85C)", xpathValue: fullXPath },
        { duplicateScore: 36, element, enableIndexing: false, maxMatchSample: 5 }
      );
    }
    addCandidate(
      registry,
      { type: "tag", selector: element.tagName.toLowerCase(), score: DEFAULT_TAG_SCORE, reason: "\uD0DC\uADF8 \uC774\uB984" },
      { duplicateScore: 28, allowZero: true, element, maxMatchSample: 5 }
    );
    const firstNthCandidate = buildFirstNthOfTypeSelector(element);
    if (firstNthCandidate) {
      addCandidate(registry, firstNthCandidate, { duplicateScore: 66, element });
    }
    return sortCandidates(registry.list());
  }
  function getChildSelectorCandidates(parent, child) {
    if (!parent || !child) return [];
    const registry = createCandidateRegistry();
    const relativeCss = buildRelativeCssSelector(parent, child);
    if (relativeCss) {
      addCandidate(
        registry,
        { type: "css", selector: `css=${relativeCss}`, score: 90, reason: "\uBD80\uBAA8 \uAE30\uC900 CSS \uACBD\uB85C", relation: "relative" },
        { skipGlobalCheck: true, contextElement: parent, contextLabel: "\uBD80\uBAA8", duplicateScore: 68, element: child }
      );
    }
    const relativeXPath = buildRelativeXPathSelector(parent, child);
    if (relativeXPath) {
      addCandidate(
        registry,
        { type: "xpath", selector: `xpath=${relativeXPath}`, score: 86, reason: "\uBD80\uBAA8 \uAE30\uC900 XPath \uACBD\uB85C", relation: "relative", xpathValue: relativeXPath },
        { skipGlobalCheck: true, contextElement: parent, contextLabel: "\uBD80\uBAA8", duplicateScore: 66, element: child }
      );
    }
    (getSelectorCandidates(child) || []).forEach((cand) => {
      registry.add({ ...cand, relation: cand.relation || "global" });
    });
    return sortCandidates(registry.list());
  }
  function getParentSelectorCandidates(child, parent) {
    if (!child || !parent) return [];
    const registry = createCandidateRegistry();
    let current = parent;
    let depth = 1;
    while (current && current.nodeType === 1) {
      const steps = Array(depth).fill("..").join("/");
      addCandidate(
        registry,
        {
          type: "xpath",
          selector: `xpath=${steps}`,
          score: Math.max(72, 86 - (depth - 1) * 5),
          reason: depth === 1 ? "\uC9C1\uC811 \uC0C1\uC704 \uC694\uC18C" : `${depth}\uB2E8\uACC4 \uC0C1\uC704 \uC694\uC18C`,
          relation: "relative",
          xpathValue: steps
        },
        { skipGlobalCheck: true, contextElement: child, contextLabel: "\uD604\uC7AC \uC694\uC18C", duplicateScore: Math.max(58, 68 - (depth - 1) * 5), element: current }
      );
      if (!current.parentElement || current === document.documentElement) {
        break;
      }
      current = current.parentElement;
      depth += 1;
    }
    (getSelectorCandidates(parent) || []).forEach((cand) => {
      registry.add({ ...cand, relation: cand.relation || "global" });
    });
    return sortCandidates(registry.list());
  }
  function collectSelectorInfos(eventRecord) {
    const infos = [];
    const seen = /* @__PURE__ */ new Set();
    function pushInfo(selector, type, extra = {}) {
      if (!selector) return;
      const key = `${selector}::${type || ""}`;
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
      [...eventRecord.selectorCandidates].sort((a, b) => (b.score || 0) - (a.score || 0)).forEach((candidate) => {
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
      pushInfo(eventRecord.tag.toLowerCase(), "tag", { score: 1 });
    }
    return infos;
  }

  // src/content/dom/locator.js
  function findElementBySelector(selector) {
    if (!selector) return null;
    try {
      if (selector.startsWith("xpath=")) {
        const expression = selector.slice(6);
        return document.evaluate(expression, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue || null;
      }
      if (selector.startsWith("//") || selector.startsWith("(")) {
        return document.evaluate(selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue || null;
      }
      if (selector.startsWith('text="') || selector.startsWith("text='")) {
        const textLiteral = selector.replace(/^text=/, "");
        const trimmed = textLiteral.replace(/^['"]|['"]$/g, "");
        const decoded = trimmed.replace(/\\"/g, '"');
        return Array.from(document.querySelectorAll("*")).find((el) => (el.innerText || "").trim().includes(decoded));
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
    const isRelative = info.relation === "relative";
    const currentScope = scope && scope.nodeType === 1 ? scope : document;
    const runGlobal = () => findElementBySelector(selector);
    try {
      if (isRelative && currentScope !== document) {
        if (type === "xpath" || selector.startsWith("xpath=")) {
          const expression = selector.startsWith("xpath=") ? selector.slice(6) : selector;
          const doc = currentScope.ownerDocument || document;
          const res = doc.evaluate(expression, currentScope, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          return res.singleNodeValue || null;
        }
        if (type === "text" || selector.startsWith("text=")) {
          const raw = selector.replace(/^text=/, "");
          const trimmed = raw.replace(/^['"]|['"]$/g, "");
          const targetText = normalizeText(trimmed);
          const matchMode = info.matchMode || "contains";
          if (!targetText) return null;
          const elements = currentScope.querySelectorAll("*");
          for (const el of elements) {
            const txt = normalizeText(el.innerText || el.textContent || "");
            if (!txt) continue;
            if (matchMode === "exact" ? txt === targetText : txt.includes(targetText)) {
              return el;
            }
          }
          return null;
        }
        let css = selector;
        if (css.startsWith("css=")) {
          css = css.slice(4);
        }
        return currentScope.querySelector(css);
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
      const scope = entry.relation === "relative" ? currentElement || currentScope : document;
      const el = findElementInScope(entry, scope);
      if (!el) return null;
      currentElement = el;
      currentScope = el;
    }
    return currentElement;
  }
  function findElementWithInfo(info) {
    if (!info || !info.selector) return null;
    const type = info.type || parseSelectorForMatching(info.selector).type;
    if (type === "text") {
      const targetText = normalizeText(info.textValue) || null;
      if (targetText) {
        const matchMode = info.matchMode || "contains";
        const match = Array.from(document.querySelectorAll("*")).find((el) => {
          const elText = normalizeText(el.innerText || el.textContent || "");
          if (!elText) return false;
          return matchMode === "exact" ? elText === targetText : elText.includes(targetText);
        });
        if (match) return match;
      }
    }
    if (type === "xpath") {
      const expression = info.xpathValue || info.selector.replace(/^xpath=/, "");
      if (expression) {
        try {
          const res = document.evaluate(expression, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          if (res.singleNodeValue) return res.singleNodeValue;
        } catch (err) {
        }
      }
    }
    return findElementBySelector(info.selector);
  }
  async function locateElementForEvent(eventRecord, timeoutMs = 5e3) {
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

  // src/content/replay/index.js
  async function executeReplayStep({ event, index = 0, total = 0, timeoutMs = 6e3 }) {
    const { element, info } = await locateElementForEvent(event, timeoutMs);
    if (!element) {
      const payload2 = {
        type: "REPLAY_STEP_RESULT",
        ok: false,
        reason: "not_found",
        stepIndex: index,
        total,
        selector: info && info.selector ? info.selector : event && event.primarySelector || null,
        ev: event
      };
      chrome.runtime.sendMessage(payload2);
      return { ok: false, reason: "not_found" };
    }
    let navigationTriggered = false;
    const beforeUnloadHandler = () => {
      navigationTriggered = true;
    };
    window.addEventListener("beforeunload", beforeUnloadHandler);
    const originalOutline = element.style.outline;
    const originalOutlineOffset = element.style.outlineOffset;
    let success = false;
    let failureReason = "";
    let extractedValue;
    let manualActionType = event && event.manualActionType ? event.manualActionType : null;
    let manualAttributeName = event && event.manualAttribute ? event.manualAttribute : null;
    try {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      await new Promise((resolve) => setTimeout(resolve, 200));
      try {
        element.focus({ preventScroll: true });
      } catch (focusErr) {
        try {
          element.focus();
        } catch (focusErr2) {
        }
      }
      element.style.outline = "3px solid rgba(0,150,136,0.6)";
      element.style.outlineOffset = "2px";
      if (event.action === "click") {
        const style = window.getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
          throw new Error("element not visible");
        }
        if (element.disabled) {
          throw new Error("element disabled");
        }
        element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      } else if (event.action === "input") {
        const valueToSet = event.value || "";
        if ("value" in element) {
          element.value = valueToSet;
        } else if (element.isContentEditable) {
          element.textContent = valueToSet;
        }
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (event.action === "manual_extract_text") {
        extractedValue = element.innerText || element.textContent || "";
        manualActionType = "extract_text";
      } else if (event.action === "manual_get_attribute") {
        const attrName = manualAttributeName || event.manualAttribute || event.attributeName || "";
        manualAttributeName = attrName;
        extractedValue = attrName ? element.getAttribute(attrName) : null;
        manualActionType = "get_attribute";
      } else {
        throw new Error("unsupported action");
      }
      success = true;
    } catch (err) {
      failureReason = err && err.message ? err.message : "unknown error";
    } finally {
      window.removeEventListener("beforeunload", beforeUnloadHandler);
      try {
        element.style.outline = originalOutline;
        element.style.outlineOffset = originalOutlineOffset;
      } catch (cleanupErr) {
      }
    }
    const usedSelector = info && info.selector ? info.selector : event && event.primarySelector || (event && event.tag ? event.tag.toLowerCase() : null);
    const payload = {
      type: "REPLAY_STEP_RESULT",
      ok: success,
      reason: success ? void 0 : failureReason,
      used: element && element.tagName,
      selector: usedSelector,
      stepIndex: index,
      total,
      navigation: navigationTriggered,
      ev: event,
      manualActionType: manualActionType || void 0,
      manualActionId: event && event.manualActionId ? event.manualActionId : void 0,
      value: extractedValue,
      attributeName: manualAttributeName || void 0,
      resultName: event && event.manualResultName ? event.manualResultName : void 0
    };
    chrome.runtime.sendMessage(payload);
    if (success) {
      return { ok: true, navigation: navigationTriggered, value: extractedValue };
    }
    return { ok: false, reason: failureReason };
  }
  function executeSelectionAction(action, path) {
    const target = findElementByPath(path);
    if (!target) {
      return { ok: false, reason: "not_found" };
    }
    if (action === "click") {
      try {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => {
          try {
            target.focus({ preventScroll: true });
          } catch (focusErr) {
            try {
              target.focus();
            } catch (focusErr2) {
            }
          }
          const style = window.getComputedStyle(target);
          if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
            return;
          }
          if (target.disabled) {
            return;
          }
          target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
          target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
          target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
          target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        }, 120);
        return { ok: true };
      } catch (err) {
        return { ok: false, reason: err.message || "click_failed" };
      }
    }
    return { ok: false, reason: "unsupported_action" };
  }

  // src/content/state.js
  var recorderState = {
    isRecording: false,
    currentHighlightedElement: null,
    overlayElement: null,
    hoverTimeout: null,
    mouseoutTimeout: null,
    scrollTimeout: null
  };
  var elementSelectionState = {
    active: false,
    mode: null,
    currentElement: null,
    parentElement: null,
    highlightInfo: null,
    childFlashTimeout: null,
    stack: []
  };
  var overlayControlsState = {
    container: null,
    handle: null,
    buttons: {},
    status: null,
    closeButton: null,
    visible: false,
    dragging: false,
    dragOffsetX: 0,
    dragOffsetY: 0
  };
  var inputTimers = /* @__PURE__ */ new WeakMap();

  // src/content/overlay/index.js
  function saveOverlayPosition(left, top) {
    chrome.storage.local.set({ overlayPosition: { left, top } });
  }
  function setOverlayStatus(message, tone = "info") {
    if (!overlayControlsState.status) return;
    overlayControlsState.status.textContent = message || "";
    overlayControlsState.status.setAttribute("data-tone", tone || "info");
    overlayControlsState.status.style.display = message ? "block" : "none";
  }
  function updateOverlayControlsState() {
    if (!overlayControlsState.buttons.start || !overlayControlsState.container) return;
    overlayControlsState.buttons.start.disabled = !!recorderState.isRecording;
    overlayControlsState.buttons.stop.disabled = !recorderState.isRecording;
    overlayControlsState.container.toggleAttribute("data-selecting", !!elementSelectionState.mode);
  }
  function onOverlayDragMove(event) {
    if (!overlayControlsState.dragging || !overlayControlsState.container) return;
    const container = overlayControlsState.container;
    const width = container.offsetWidth;
    const height = container.offsetHeight;
    let newLeft = event.clientX - overlayControlsState.dragOffsetX;
    let newTop = event.clientY - overlayControlsState.dragOffsetY;
    const margin = 8;
    newLeft = Math.max(margin, Math.min(newLeft, window.innerWidth - width - margin));
    newTop = Math.max(margin, Math.min(newTop, window.innerHeight - height - margin));
    container.style.left = `${newLeft}px`;
    container.style.top = `${newTop}px`;
    container.style.right = "";
    container.style.bottom = "";
  }
  function stopOverlayDrag() {
    if (!overlayControlsState.dragging || !overlayControlsState.container) return;
    overlayControlsState.dragging = false;
    document.removeEventListener("mousemove", onOverlayDragMove, true);
    document.removeEventListener("mouseup", stopOverlayDrag, true);
    const rect = overlayControlsState.container.getBoundingClientRect();
    saveOverlayPosition(rect.left, rect.top);
  }
  function startOverlayDrag(event) {
    if (!overlayControlsState.container) return;
    const rect = overlayControlsState.container.getBoundingClientRect();
    overlayControlsState.dragging = true;
    overlayControlsState.dragOffsetX = event.clientX - rect.left;
    overlayControlsState.dragOffsetY = event.clientY - rect.top;
    overlayControlsState.container.style.left = `${rect.left}px`;
    overlayControlsState.container.style.top = `${rect.top}px`;
    overlayControlsState.container.style.right = "";
    overlayControlsState.container.style.bottom = "";
    document.addEventListener("mousemove", onOverlayDragMove, true);
    document.addEventListener("mouseup", stopOverlayDrag, true);
    event.preventDefault();
  }
  function handleOverlayCommandResponse(command, response) {
    if (!response || response.ok) {
      if (command === "start_record") {
        setOverlayStatus("\uB179\uD654\uB97C \uC2DC\uC791\uD588\uC2B5\uB2C8\uB2E4.", "success");
      } else if (command === "stop_record") {
        setOverlayStatus("\uB179\uD654\uB97C \uC911\uC9C0\uD588\uC2B5\uB2C8\uB2E4.", "success");
      } else if (command === "element_select") {
        setOverlayStatus("\uC694\uC18C \uC120\uD0DD \uBAA8\uB4DC\uB97C \uC2DC\uC791\uD569\uB2C8\uB2E4. \uD398\uC774\uC9C0\uC5D0\uC11C \uC694\uC18C\uB97C \uD074\uB9AD\uD558\uC138\uC694.", "info");
      }
      return;
    }
    const reason = response.reason || "unknown";
    let message = "\uC694\uCCAD\uC744 \uCC98\uB9AC\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.";
    if (reason === "already_recording") {
      message = "\uC774\uBBF8 \uB179\uD654 \uC911\uC785\uB2C8\uB2E4.";
    } else if (reason === "no_active_tab") {
      message = "\uD65C\uC131 \uD0ED\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.";
    } else if (reason === "not_recording") {
      message = "\uD604\uC7AC \uB179\uD654 \uC911\uC774 \uC544\uB2D9\uB2C8\uB2E4.";
    } else if (reason === "selection_in_progress") {
      message = "\uC774\uBBF8 \uC694\uC18C \uC120\uD0DD\uC774 \uC9C4\uD589 \uC911\uC785\uB2C8\uB2E4.";
    } else if (reason === "parent_not_selected") {
      message = "\uBA3C\uC800 \uBD80\uBAA8 \uC694\uC18C\uB97C \uC120\uD0DD\uD558\uC138\uC694.";
    } else if (reason === "unsupported_action") {
      message = "\uC9C0\uC6D0\uD558\uC9C0 \uC54A\uB294 \uB3D9\uC791\uC785\uB2C8\uB2E4.";
    }
    setOverlayStatus(message, "error");
  }
  function sendOverlayCommand(command, options = {}) {
    chrome.runtime.sendMessage({ type: "OVERLAY_COMMAND", command, options }, (response) => {
      if (chrome.runtime.lastError) {
        setOverlayStatus("DevTools \uD328\uB110\uACFC \uD1B5\uC2E0\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uD328\uB110\uC774 \uC5F4\uB824 \uC788\uB294\uC9C0 \uD655\uC778\uD558\uC138\uC694.", "error");
        return;
      }
      handleOverlayCommandResponse(command, response);
    });
  }
  function restoreOverlayPosition(container) {
    chrome.storage.local.get({ overlayPosition: null }, (data) => {
      const pos = data.overlayPosition;
      if (pos && typeof pos.left === "number" && typeof pos.top === "number") {
        container.style.left = `${pos.left}px`;
        container.style.top = `${pos.top}px`;
        container.style.right = "";
        container.style.bottom = "";
      }
    });
  }
  function createOverlayControls() {
    if (overlayControlsState.container) return;
    if (window !== window.top) return;
    const container = document.createElement("div");
    container.id = "__ai_test_overlay__";
    container.style.position = "fixed";
    container.style.right = "24px";
    container.style.bottom = "24px";
    container.style.background = "rgba(15, 23, 42, 0.65)";
    container.style.backdropFilter = "blur(12px)";
    container.style.border = "1px solid rgba(255,255,255,0.18)";
    container.style.borderRadius = "12px";
    container.style.padding = "12px";
    container.style.color = "#fff";
    container.style.fontFamily = "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    container.style.fontSize = "12px";
    container.style.boxShadow = "0 12px 24px rgba(11, 15, 25, 0.35)";
    container.style.zIndex = "2147483646";
    container.style.minWidth = "200px";
    container.style.userSelect = "none";
    const handle = document.createElement("div");
    handle.style.display = "flex";
    handle.style.alignItems = "center";
    handle.style.justifyContent = "space-between";
    handle.style.fontWeight = "600";
    handle.style.fontSize = "11px";
    handle.style.textTransform = "uppercase";
    handle.style.letterSpacing = "0.08em";
    handle.style.marginBottom = "10px";
    handle.style.cursor = "move";
    const handleTitle = document.createElement("span");
    handleTitle.textContent = "Recorder Controls";
    handleTitle.style.flex = "1 1 auto";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "x";
    closeBtn.setAttribute("aria-label", "\uC624\uBC84\uB808\uC774 \uB2EB\uAE30");
    closeBtn.style.cssText = "margin-left:8px;flex:0 0 auto;width:20px;height:20px;border:none;border-radius:4px;background:transparent;color:rgba(255,255,255,0.7);font-size:12px;line-height:1;cursor:pointer;padding:0;";
    closeBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      event.preventDefault();
      setOverlayVisibility(false);
    });
    closeBtn.addEventListener("mousedown", (event) => {
      event.stopPropagation();
    });
    closeBtn.addEventListener("mouseenter", () => {
      closeBtn.style.background = "rgba(255,255,255,0.15)";
    });
    closeBtn.addEventListener("mouseleave", () => {
      closeBtn.style.background = "transparent";
    });
    handle.appendChild(handleTitle);
    handle.appendChild(closeBtn);
    const buttonsRow = document.createElement("div");
    buttonsRow.style.display = "flex";
    buttonsRow.style.gap = "8px";
    buttonsRow.style.flexWrap = "nowrap";
    const buttonStyle = "flex:1 1 auto;padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.14);color:#fff;font-size:12px;font-weight:600;cursor:pointer;transition:all 0.2s ease;text-align:center;";
    const startBtn = document.createElement("button");
    startBtn.textContent = "Start";
    startBtn.style.cssText = buttonStyle;
    startBtn.addEventListener("click", () => {
      setOverlayStatus("\uB179\uD654\uB97C \uC2DC\uC791\uD558\uB294 \uC911...", "info");
      sendOverlayCommand("start_record");
    });
    const stopBtn = document.createElement("button");
    stopBtn.textContent = "Stop";
    stopBtn.style.cssText = buttonStyle;
    stopBtn.addEventListener("click", () => {
      setOverlayStatus("\uB179\uD654\uB97C \uC911\uC9C0\uD558\uB294 \uC911...", "info");
      sendOverlayCommand("stop_record");
    });
    const selectBtn = document.createElement("button");
    selectBtn.textContent = "Select";
    selectBtn.style.cssText = buttonStyle;
    selectBtn.addEventListener("click", () => {
      setOverlayStatus("\uC694\uC18C \uC120\uD0DD \uBAA8\uB4DC\uB97C \uC900\uBE44\uD558\uB294 \uC911...", "info");
      sendOverlayCommand("element_select");
    });
    buttonsRow.appendChild(startBtn);
    buttonsRow.appendChild(stopBtn);
    buttonsRow.appendChild(selectBtn);
    const status = document.createElement("div");
    status.style.marginTop = "10px";
    status.style.fontSize = "11px";
    status.style.padding = "6px 8px";
    status.style.borderRadius = "8px";
    status.style.background = "rgba(255,255,255,0.12)";
    status.style.display = "none";
    container.appendChild(handle);
    container.appendChild(buttonsRow);
    container.appendChild(status);
    handle.addEventListener("mousedown", startOverlayDrag, true);
    const observer = new MutationObserver(() => {
      updateOverlayControlsState();
    });
    observer.observe(container, { attributes: true });
    overlayControlsState.container = container;
    overlayControlsState.handle = handle;
    overlayControlsState.buttons = { start: startBtn, stop: stopBtn, select: selectBtn };
    overlayControlsState.status = status;
    overlayControlsState.closeButton = closeBtn;
    overlayControlsState.visible = false;
    container.style.display = "none";
    document.body.appendChild(container);
    restoreOverlayPosition(container);
    updateOverlayControlsState();
    setOverlayStatus("", "info");
  }
  function isOverlayVisible() {
    return !!overlayControlsState.visible;
  }
  function setOverlayVisibility(visible, options = {}) {
    if (window !== window.top) return false;
    if (!overlayControlsState.container) {
      createOverlayControls();
    }
    const container = overlayControlsState.container;
    if (!container) return false;
    const target = !!visible;
    const changed = overlayControlsState.visible !== target;
    overlayControlsState.visible = target;
    if (target) {
      container.style.display = "block";
      updateOverlayControlsState();
    } else {
      stopOverlayDrag();
      container.style.display = "none";
      setOverlayStatus("", "info");
    }
    if (changed) {
      chrome.storage.local.set({ overlayVisible: target });
    }
    if (changed && options.notify !== false) {
      chrome.runtime.sendMessage({ type: "OVERLAY_VISIBILITY_CHANGED", visible: target });
    }
    return changed;
  }
  function buildOverlayHtml(topSelector, selectors) {
    if (!topSelector) {
      return '<div style="color: #ff9800;">No selector found</div>';
    }
    const more = selectors.length > 1 ? `<div style="font-size: 10px; color: #888; margin-top: 4px;">+${selectors.length - 1} more</div>` : "";
    return `
    <div style="font-weight: bold; margin-bottom: 4px; color: #4CAF50;">${topSelector.selector}</div>
    <div style="font-size: 10px; color: #aaa;">Score: ${topSelector.score}% \u2022 ${topSelector.reason}</div>
    ${more}
  `;
  }
  function updateOverlayPosition(rect) {
    const { overlayElement } = recorderState;
    if (!overlayElement) return;
    const overlayHeight = overlayElement.offsetHeight;
    const overlayWidth = overlayElement.offsetWidth;
    const overlayTop = rect.top - overlayHeight - 10;
    const overlayBottom = rect.bottom + 10;
    if (overlayTop >= 0) {
      overlayElement.style.top = `${overlayTop}px`;
      overlayElement.style.left = `${rect.left}px`;
    } else {
      overlayElement.style.top = `${overlayBottom}px`;
      overlayElement.style.left = `${rect.left}px`;
    }
    const maxLeft = window.innerWidth - overlayWidth - 10;
    const currentLeft = parseInt(overlayElement.style.left, 10) || 0;
    if (currentLeft > maxLeft) {
      overlayElement.style.left = `${Math.max(10, maxLeft)}px`;
    }
    if (currentLeft < 10) {
      overlayElement.style.left = "10px";
    }
  }
  function createSelectorOverlay(rect, selectors) {
    if (recorderState.overlayElement) {
      recorderState.overlayElement.remove();
      recorderState.overlayElement = null;
    }
    const overlay = document.createElement("div");
    overlay.id = "__ai_test_recorder_overlay__";
    overlay.style.cssText = `
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
    overlay.innerHTML = buildOverlayHtml(selectors[0], selectors);
    document.body.appendChild(overlay);
    recorderState.overlayElement = overlay;
    updateOverlayPosition(rect);
  }
  function removeHighlight() {
    if (recorderState.currentHighlightedElement) {
      recorderState.currentHighlightedElement.style.outline = "";
      recorderState.currentHighlightedElement.style.outlineOffset = "";
      recorderState.currentHighlightedElement = null;
    }
    if (recorderState.overlayElement) {
      recorderState.overlayElement.remove();
      recorderState.overlayElement = null;
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
      element.style.outline = "2px dashed rgba(255,152,0,0.95)";
      element.style.outlineOffset = "2px";
    }
  }
  function clearSelectionParentHighlight() {
    if (elementSelectionState.highlightInfo && elementSelectionState.highlightInfo.element) {
      const { element, outline, outlineOffset } = elementSelectionState.highlightInfo;
      try {
        element.style.outline = outline || "";
        element.style.outlineOffset = outlineOffset || "";
      } catch (e) {
      }
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
    element.style.outline = "2px solid rgba(33,150,243,0.9)";
    element.style.outlineOffset = "2px";
    elementSelectionState.childFlashTimeout = setTimeout(() => {
      try {
        element.style.outline = prev.outline || "";
        element.style.outlineOffset = prev.outlineOffset || "";
      } catch (e) {
      }
      elementSelectionState.childFlashTimeout = null;
    }, duration);
  }
  function highlightElement(element) {
    if (!element) return;
    const isSameElement = element === recorderState.currentHighlightedElement;
    if (recorderState.currentHighlightedElement && !isSameElement) {
      recorderState.currentHighlightedElement.style.outline = "";
      recorderState.currentHighlightedElement.style.outlineOffset = "";
    }
    recorderState.currentHighlightedElement = element;
    element.style.outline = "3px solid #2196F3";
    element.style.outlineOffset = "2px";
    element.style.transition = "outline 0.1s ease";
    const selectors = getSelectorCandidates(element);
    const rect = element.getBoundingClientRect();
    createSelectorOverlay(rect, selectors);
    if (!isSameElement) {
      chrome.runtime.sendMessage({
        type: "ELEMENT_HOVERED",
        selectors,
        element: {
          tag: element.tagName,
          id: element.id || null,
          classes: Array.from(element.classList || []),
          domContext: buildDomContextSnapshot(element)
        }
      });
    }
  }
  function handleMouseOver(event) {
    if (!recorderState.isRecording) return;
    if (recorderState.mouseoutTimeout) {
      clearTimeout(recorderState.mouseoutTimeout);
      recorderState.mouseoutTimeout = null;
    }
    const target = event.target;
    if (!target || target === document.body || target === document.documentElement) {
      removeHighlight();
      return;
    }
    if (target.id === "__ai_test_recorder_overlay__" || target.closest("#__ai_test_recorder_overlay__")) {
      return;
    }
    if (target !== recorderState.currentHighlightedElement) {
      if (recorderState.hoverTimeout) {
        clearTimeout(recorderState.hoverTimeout);
      }
      recorderState.hoverTimeout = setTimeout(() => highlightElement(target), 30);
    } else if (recorderState.overlayElement) {
      updateOverlayPosition(target.getBoundingClientRect());
    }
  }
  function handleMouseOut(event) {
    if (!recorderState.isRecording) return;
    const relatedTarget = event.relatedTarget;
    if (relatedTarget && (relatedTarget.id === "__ai_test_recorder_overlay__" || relatedTarget.closest("#__ai_test_recorder_overlay__"))) {
      return;
    }
    if (recorderState.hoverTimeout) {
      clearTimeout(recorderState.hoverTimeout);
      recorderState.hoverTimeout = null;
    }
    if (recorderState.mouseoutTimeout) {
      clearTimeout(recorderState.mouseoutTimeout);
    }
    recorderState.mouseoutTimeout = setTimeout(() => {
      const activeElement = document.elementFromPoint(event.clientX, event.clientY);
      if (!activeElement || activeElement === document.body || activeElement === document.documentElement || activeElement.id !== "__ai_test_recorder_overlay__" && !activeElement.closest("#__ai_test_recorder_overlay__")) {
        if (activeElement !== recorderState.currentHighlightedElement && activeElement !== document.body && activeElement !== document.documentElement) {
          removeHighlight();
        }
      }
      recorderState.mouseoutTimeout = null;
    }, 200);
  }
  function handleScroll() {
    if (!recorderState.isRecording || !recorderState.currentHighlightedElement || !recorderState.overlayElement) return;
    if (recorderState.scrollTimeout) {
      clearTimeout(recorderState.scrollTimeout);
    }
    recorderState.scrollTimeout = setTimeout(() => {
      const rect = recorderState.currentHighlightedElement.getBoundingClientRect();
      updateOverlayPosition(rect);
    }, 50);
  }
  function initOverlaySystem() {
    createOverlayControls();
    chrome.storage.local.get({ overlayVisible: false }, (data) => {
      const storedVisible = !!data.overlayVisible;
      setOverlayVisibility(storedVisible, { notify: false });
    });
    document.addEventListener("mouseover", handleMouseOver, true);
    document.addEventListener("mouseout", handleMouseOut, true);
    window.addEventListener("scroll", handleScroll, true);
  }
  function ensureRecordingState(isRecording) {
    recorderState.isRecording = isRecording;
    updateOverlayControlsState();
  }

  // src/content/selection/index.js
  function resetSelectionHighlight() {
    clearSelectionParentHighlight();
    if (elementSelectionState.childFlashTimeout) {
      clearTimeout(elementSelectionState.childFlashTimeout);
      elementSelectionState.childFlashTimeout = null;
    }
  }
  function beginRootSelection() {
    elementSelectionState.active = true;
    elementSelectionState.mode = "root";
    elementSelectionState.parentElement = null;
    elementSelectionState.currentElement = null;
    elementSelectionState.stack = [];
    resetSelectionHighlight();
    updateOverlayControlsState();
  }
  function beginChildSelection() {
    if (!elementSelectionState.active || !elementSelectionState.currentElement) {
      return { ok: false, reason: "parent_not_selected" };
    }
    elementSelectionState.mode = "child";
    elementSelectionState.parentElement = elementSelectionState.currentElement;
    applySelectionParentHighlight(elementSelectionState.parentElement);
    updateOverlayControlsState();
    return { ok: true };
  }
  function cancelSelection() {
    elementSelectionState.mode = null;
    elementSelectionState.active = false;
    elementSelectionState.parentElement = null;
    elementSelectionState.currentElement = null;
    elementSelectionState.stack = [];
    resetSelectionHighlight();
    updateOverlayControlsState();
  }
  function buildElementPayload(element) {
    return {
      tag: element.tagName,
      text: (element.innerText || element.textContent || "").trim().slice(0, 80),
      id: element.id || null,
      classList: Array.from(element.classList || []),
      iframeContext: getIframeContext(element),
      domContext: buildDomContextSnapshot(element)
    };
  }
  function handleRootSelection(target) {
    elementSelectionState.active = true;
    elementSelectionState.currentElement = target;
    elementSelectionState.parentElement = target;
    elementSelectionState.mode = null;
    elementSelectionState.stack = [{ element: target }];
    applySelectionParentHighlight(target);
    highlightElement(target);
    const selectors = (getSelectorCandidates(target) || []).map((candidate) => ({
      ...candidate,
      relation: candidate.relation || "global"
    }));
    chrome.runtime.sendMessage({
      type: "ELEMENT_SELECTION_PICKED",
      stage: "root",
      selectors,
      element: buildElementPayload(target)
    });
    updateOverlayControlsState();
  }
  function handleChildSelection(target) {
    if (!elementSelectionState.parentElement || !elementSelectionState.parentElement.contains(target) || target === elementSelectionState.parentElement) {
      chrome.runtime.sendMessage({
        type: "ELEMENT_SELECTION_ERROR",
        stage: "child",
        reason: "\uC120\uD0DD\uD55C \uC694\uC18C\uAC00 \uBD80\uBAA8 \uC694\uC18C \uB0B4\uBD80\uC5D0 \uC788\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4."
      });
      return;
    }
    elementSelectionState.currentElement = target;
    elementSelectionState.stack.push({ element: target });
    const selectors = getChildSelectorCandidates(elementSelectionState.parentElement, target);
    flashSelectionElement(target);
    chrome.runtime.sendMessage({
      type: "ELEMENT_SELECTION_PICKED",
      stage: "child",
      selectors,
      element: buildElementPayload(target)
    });
    elementSelectionState.parentElement = target;
    elementSelectionState.mode = null;
    updateOverlayControlsState();
  }
  function handleParentSelection() {
    if (!elementSelectionState.active || !elementSelectionState.currentElement) {
      return { ok: false, reason: "current_not_selected" };
    }
    let current = elementSelectionState.currentElement;
    let parent = current ? current.parentElement : null;
    while (parent && parent.nodeType !== 1) {
      parent = parent.parentElement;
    }
    if (!parent) {
      return { ok: false, reason: "no_parent" };
    }
    elementSelectionState.currentElement = parent;
    elementSelectionState.parentElement = parent;
    elementSelectionState.mode = null;
    applySelectionParentHighlight(parent);
    flashSelectionElement(parent);
    const selectors = getParentSelectorCandidates(current, parent);
    chrome.runtime.sendMessage({
      type: "ELEMENT_SELECTION_PICKED",
      stage: "parent",
      selectors,
      element: buildElementPayload(parent)
    });
    updateOverlayControlsState();
    return { ok: true };
  }
  function handleSelectionClick(event) {
    if (!elementSelectionState.mode) return false;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const target = event.target;
    if (!target || target === document.body || target === document.documentElement || target.id === "__ai_test_recorder_overlay__" || target.closest && target.closest("#__ai_test_recorder_overlay__")) {
      chrome.runtime.sendMessage({
        type: "ELEMENT_SELECTION_ERROR",
        stage: elementSelectionState.mode === "child" ? "child" : "root",
        reason: "\uC120\uD0DD\uD560 \uC218 \uC5C6\uB294 \uC601\uC5ED\uC785\uB2C8\uB2E4. \uB2E4\uB978 \uC694\uC18C\uB97C \uC120\uD0DD\uD558\uC138\uC694."
      });
      return true;
    }
    if (elementSelectionState.mode === "root") {
      handleRootSelection(target);
      return true;
    }
    if (elementSelectionState.mode === "child") {
      handleChildSelection(target);
      return true;
    }
    return false;
  }
  function interceptPointerEvent(event) {
    if (!elementSelectionState.mode) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }
  function initSelectionInterceptors() {
    document.addEventListener("click", (event) => {
      if (handleSelectionClick(event)) {
        setOverlayStatus("\uC694\uC18C \uC815\uBCF4\uB97C \uD328\uB110\uC5D0\uC11C \uD655\uC778\uD558\uC138\uC694.", "info");
      }
    }, true);
    ["mousedown", "mouseup", "pointerdown", "pointerup"].forEach((type) => {
      document.addEventListener(type, interceptPointerEvent, true);
    });
  }
  function handleParentSelectionRequest() {
    return handleParentSelection();
  }

  // src/content/events/schema.js
  var EVENT_SCHEMA_VERSION = 2;
  function buildPrimarySelectorData(selectors) {
    if (!Array.isArray(selectors) || selectors.length === 0) return {};
    const primary = selectors[0];
    if (!primary || !primary.selector) return {};
    const type = primary.type || inferSelectorType(primary.selector);
    return {
      primarySelector: primary.selector,
      primarySelectorType: type,
      primarySelectorText: primary.textValue || null,
      primarySelectorXPath: primary.xpathValue || null,
      primarySelectorMatchMode: primary.matchMode || null
    };
  }
  function createEventRecord({
    action,
    value = null,
    selectors = [],
    target = null,
    domContext = null,
    iframeContext = null,
    clientRect = null,
    metadata = {},
    manual
  }) {
    const timestamp = Date.now();
    const targetTag = target && target.tagName ? target.tagName : null;
    const selectorCandidates = Array.isArray(selectors) ? selectors : [];
    const primaryData = buildPrimarySelectorData(selectorCandidates);
    const positionInfo = target ? getElementPositionInfo(target) : null;
    return {
      version: EVENT_SCHEMA_VERSION,
      timestamp,
      action,
      value,
      tag: targetTag,
      selectorCandidates,
      iframeContext,
      page: {
        // 이벤트가 발생한 페이지의 URL/타이틀을 저장해 재현에 도움을 준다.
        url: window.location.href,
        title: document.title
      },
      frame: {
        iframeContext
      },
      target: target ? {
        tag: targetTag,
        id: target.id || null,
        classes: target.classList ? Array.from(target.classList) : [],
        text: (target.innerText || target.textContent || "").trim().slice(0, 200),
        childCount: target.children ? target.children.length : 0,
        position: positionInfo,
        repeats: positionInfo ? positionInfo.total > 1 : false,
        domContext
      } : null,
      clientRect,
      metadata: {
        schemaVersion: EVENT_SCHEMA_VERSION,
        userAgent: navigator.userAgent,
        ...metadata
      },
      manual: manual || null,
      // primary selector 관련 필드들을 최상위에 병합한다.
      ...primaryData
    };
  }

  // src/content/recorder/index.js
  var INPUT_DEBOUNCE_DELAY = 800;
  function persistEvent(eventRecord) {
    chrome.runtime.sendMessage({ type: "SAVE_EVENT", event: eventRecord }, () => {
    });
  }
  function broadcastRecordedEvent(eventRecord) {
    chrome.runtime.sendMessage({ type: "EVENT_RECORDED", event: eventRecord }, () => {
    });
  }
  function buildClientRect(target) {
    if (!target || typeof target.getBoundingClientRect !== "function") {
      return { x: 0, y: 0, w: 0, h: 0 };
    }
    const rect = target.getBoundingClientRect();
    return {
      x: Math.round(rect.x || 0),
      y: Math.round(rect.y || 0),
      w: Math.round(rect.width || 0),
      h: Math.round(rect.height || 0)
    };
  }
  function buildEventForTarget({ action, target, value = null }) {
    const selectors = getSelectorCandidates(target) || [];
    const iframeContext = getIframeContext(target);
    const clientRect = buildClientRect(target);
    const metadata = { domEvent: action };
    const domContext = buildDomContextSnapshot(target, { includeSelf: true });
    const eventRecord = createEventRecord({
      action,
      value,
      selectors,
      target,
      iframeContext,
      clientRect,
      metadata,
      domContext
    });
    return {
      ...eventRecord,
      selectorCandidates: selectors,
      iframeContext,
      domContext,
      tag: target && target.tagName ? target.tagName : null
    };
  }
  function recordDomEvent({ action, target, value }) {
    if (!target) return;
    const eventRecord = buildEventForTarget({ action, target, value });
    persistEvent(eventRecord);
    broadcastRecordedEvent(eventRecord);
  }
  function handleClick(event) {
    if (!recorderState.isRecording) return;
    if (elementSelectionState.mode) return;
    const target = event.target;
    if (!target || target === document.body || target === document.documentElement) return;
    if (target.id === "__ai_test_recorder_overlay__" || target.closest && target.closest("#__ai_test_recorder_overlay__")) {
      return;
    }
    if (event.button === 2) {
      recordDomEvent({ action: "rightClick", target });
      return;
    }
    recordDomEvent({ action: "click", target });
  }
  function handleInput(event) {
    if (!recorderState.isRecording) return;
    const target = event.target;
    if (!target || target.tagName !== "INPUT" && target.tagName !== "TEXTAREA" && !target.isContentEditable) {
      return;
    }
    const existingTimer = inputTimers.get(target);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    const timer = setTimeout(() => {
      const currentValue = target.value || target.textContent || "";
      if (currentValue === "") {
        recordDomEvent({ action: "clear", target });
      } else {
        recordDomEvent({ action: "input", target, value: currentValue });
      }
      inputTimers.delete(target);
    }, INPUT_DEBOUNCE_DELAY);
    inputTimers.set(target, timer);
  }
  function handleBlur(event) {
    if (!recorderState.isRecording) return;
    const target = event.target;
    if (!target || target.tagName !== "INPUT" && target.tagName !== "TEXTAREA" && !target.isContentEditable) {
      return;
    }
    const existingTimer = inputTimers.get(target);
    if (existingTimer) {
      clearTimeout(existingTimer);
      inputTimers.delete(target);
      const currentValue = target.value || target.textContent || "";
      if (currentValue === "") {
        recordDomEvent({ action: "clear", target });
      } else {
        recordDomEvent({ action: "input", target, value: currentValue });
      }
    }
  }
  function handleDoubleClick(event) {
    if (!recorderState.isRecording) return;
    if (elementSelectionState.mode) return;
    const target = event.target;
    if (!target || target === document.body || target === document.documentElement) return;
    if (target.id === "__ai_test_recorder_overlay__" || target.closest && target.closest("#__ai_test_recorder_overlay__")) {
      return;
    }
    recordDomEvent({ action: "doubleClick", target });
  }
  function handleRightClick(event) {
    if (!recorderState.isRecording) return;
    if (elementSelectionState.mode) return;
    const target = event.target;
    if (!target || target === document.body || target === document.documentElement) return;
    if (target.id === "__ai_test_recorder_overlay__" || target.closest && target.closest("#__ai_test_recorder_overlay__")) {
      return;
    }
    recordDomEvent({ action: "rightClick", target });
  }
  function handleHover(event) {
    if (!recorderState.isRecording) return;
    if (elementSelectionState.mode) return;
    const target = event.target;
    if (!target || target === document.body || target === document.documentElement) return;
    if (target.id === "__ai_test_recorder_overlay__" || target.closest && target.closest("#__ai_test_recorder_overlay__")) {
      return;
    }
    const existingTimer = inputTimers.get(target);
    if (existingTimer) {
      return;
    }
    const timer = setTimeout(() => {
      recordDomEvent({ action: "hover", target });
      inputTimers.delete(target);
    }, 300);
    inputTimers.set(target, timer);
  }
  function handleSelect(event) {
    if (!recorderState.isRecording) return;
    if (elementSelectionState.mode) return;
    const target = event.target;
    if (!target || target.tagName !== "SELECT") return;
    if (target.id === "__ai_test_recorder_overlay__" || target.closest && target.closest("#__ai_test_recorder_overlay__")) {
      return;
    }
    const selectedOption = target.options[target.selectedIndex];
    const value = selectedOption ? selectedOption.text || selectedOption.value || "" : "";
    recordDomEvent({ action: "select", target, value });
  }
  var lastUrl = window.location.href;
  var lastTitle = document.title;
  function checkUrlChange() {
    if (!recorderState.isRecording) return;
    const currentUrl = window.location.href;
    const currentTitle = document.title;
    if (currentUrl !== lastUrl || currentTitle !== lastTitle) {
      const eventRecord = createEventRecord({
        action: "goto",
        value: currentUrl,
        selectors: [],
        target: null,
        iframeContext: null,
        clientRect: null,
        metadata: { domEvent: "navigation" },
        domContext: null
      });
      eventRecord.page = {
        url: currentUrl,
        title: currentTitle
      };
      eventRecord.primarySelector = currentUrl;
      persistEvent(eventRecord);
      broadcastRecordedEvent(eventRecord);
      lastUrl = currentUrl;
      lastTitle = currentTitle;
    }
  }
  var urlCheckInterval = null;
  function startRecording(options = {}) {
    const { resetEvents = true } = options;
    if (recorderState.isRecording) {
      ensureRecordingState(true);
      if (resetEvents) {
        chrome.storage.local.set({ events: [], recording: true });
      } else {
        chrome.storage.local.set({ recording: true });
      }
      return;
    }
    recorderState.isRecording = true;
    ensureRecordingState(true);
    if (resetEvents) {
      chrome.storage.local.set({ events: [], recording: true });
    } else {
      chrome.storage.local.set({ recording: true });
    }
    removeHighlight();
    lastUrl = window.location.href;
    lastTitle = document.title;
  }
  function stopRecording() {
    recorderState.isRecording = false;
    ensureRecordingState(false);
    chrome.storage.local.remove(["recording"]);
    removeHighlight();
    if (urlCheckInterval) {
      clearInterval(urlCheckInterval);
      urlCheckInterval = null;
    }
  }
  function initRecorderListeners() {
    document.addEventListener("click", (event) => {
      try {
        handleClick(event);
      } catch (err) {
        console.error("[AI Test Recorder] Failed to handle click event:", err);
      }
    }, true);
    document.addEventListener("input", (event) => {
      try {
        handleInput(event);
      } catch (err) {
        console.error("[AI Test Recorder] Failed to handle input event:", err);
      }
    }, true);
    document.addEventListener("blur", (event) => {
      try {
        handleBlur(event);
      } catch (err) {
        console.error("[AI Test Recorder] Failed to handle blur event:", err);
      }
    }, true);
    document.addEventListener("change", (event) => {
      try {
        handleSelect(event);
      } catch (err) {
        console.error("[AI Test Recorder] Failed to handle select event:", err);
      }
    }, true);
    document.addEventListener("dblclick", (event) => {
      try {
        handleDoubleClick(event);
      } catch (err) {
        console.error("[AI Test Recorder] Failed to handle double click event:", err);
      }
    }, true);
    document.addEventListener("contextmenu", (event) => {
      try {
        handleRightClick(event);
      } catch (err) {
        console.error("[AI Test Recorder] Failed to handle right click event:", err);
      }
    }, true);
    document.addEventListener("mouseenter", (event) => {
      try {
        handleHover(event);
      } catch (err) {
        console.error("[AI Test Recorder] Failed to handle hover event:", err);
      }
    }, true);
    window.addEventListener("popstate", () => {
      try {
        setTimeout(checkUrlChange, 100);
      } catch (err) {
        console.error("[AI Test Recorder] Failed to handle popstate:", err);
      }
    });
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    history.pushState = function(...args) {
      originalPushState.apply(history, args);
      setTimeout(checkUrlChange, 100);
    };
    history.replaceState = function(...args) {
      originalReplaceState.apply(history, args);
      setTimeout(checkUrlChange, 100);
    };
    urlCheckInterval = setInterval(() => {
      try {
        checkUrlChange();
      } catch (err) {
        console.error("[AI Test Recorder] Failed to check URL change:", err);
      }
    }, 1e3);
  }
  function getRecordingState() {
    return recorderState.isRecording;
  }

  // src/content/messaging/index.js
  function initMessageBridge() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      (async () => {
        if (!message || typeof message !== "object") {
          sendResponse({ ok: false, reason: "invalid_message" });
          return;
        }
        switch (message.type) {
          case "CHECK_RECORDING_STATUS": {
            sendResponse({ recording: getRecordingState() });
            return;
          }
          case "RECORDING_START": {
            startRecording({ resetEvents: true });
            sendResponse({ ok: true });
            return;
          }
          case "RECORDING_STOP": {
            stopRecording();
            sendResponse({ ok: true });
            return;
          }
          case "ELEMENT_SELECTION_START": {
            beginRootSelection();
            sendResponse({ ok: true });
            return;
          }
          case "ELEMENT_SELECTION_PICK_CHILD": {
            const result = beginChildSelection();
            sendResponse(result);
            return;
          }
          case "ELEMENT_SELECTION_PICK_PARENT": {
            const result = handleParentSelectionRequest();
            sendResponse(result);
            return;
          }
          case "ELEMENT_SELECTION_CANCEL": {
            cancelSelection();
            cancelSelection();
            chrome.runtime.sendMessage({ type: "ELEMENT_SELECTION_CANCELLED" });
            sendResponse({ ok: true });
            return;
          }
          case "ELEMENT_SELECTION_EXECUTE": {
            const { path = [], action = "" } = message;
            const result = executeSelectionAction(action, path);
            sendResponse(result);
            return;
          }
          case "REPLAY_EXECUTE_STEP": {
            const payload = await executeReplayStep({
              event: message.event,
              index: message.index,
              total: message.total,
              timeoutMs: message.timeoutMs || 6e3
            });
            sendResponse(payload);
            return;
          }
          case "OVERLAY_SET_RECORDING": {
            ensureRecordingState(!!message.recording);
            sendResponse({ ok: true });
            return;
          }
          case "OVERLAY_VISIBILITY_SET": {
            setOverlayVisibility(!!message.visible, { notify: message.notify !== false });
            sendResponse({ ok: true, visible: isOverlayVisible() });
            return;
          }
          case "OVERLAY_VISIBILITY_GET": {
            sendResponse({ ok: true, visible: isOverlayVisible() });
            return;
          }
          case "EVALUATE_SELECTORS": {
            const selectors = Array.isArray(message.selectors) ? message.selectors : [];
            const results = selectors.map((entry) => {
              const info = entry && typeof entry === "object" ? entry : { selector: entry };
              const selector = typeof info.selector === "string" ? info.selector.trim() : "";
              const type = typeof info.type === "string" ? info.type : void 0;
              const matchMode = typeof info.matchMode === "string" ? info.matchMode : void 0;
              if (!selector) {
                return { selector: "", matchCount: 0, unique: false, error: "invalid_selector" };
              }
              try {
                const parsed = parseSelectorForMatching(selector, type);
                const count = countMatchesForSelector(parsed, document, { matchMode });
                return {
                  selector,
                  type: parsed.type || type || null,
                  matchCount: count,
                  unique: count === 1
                };
              } catch (err) {
                return {
                  selector,
                  type: type || null,
                  matchCount: 0,
                  unique: false,
                  error: err && err.message ? err.message : "evaluation_failed"
                };
              }
            });
            sendResponse({ ok: true, results });
            return;
          }
          default: {
            sendResponse({ ok: false, reason: "unknown_message_type" });
          }
        }
      })();
      return true;
    });
  }

  // src/content/init.js
  var GLOBAL_FLAG = "__ai_test_recorder_loaded";
  function restoreRecordingState() {
    chrome.storage.local.get(["recording"], (result) => {
      if (result.recording) {
        if (!recorderState.isRecording) {
          recorderState.isRecording = true;
          ensureRecordingState(true);
        }
        startRecording({ resetEvents: false });
      } else {
        ensureRecordingState(false);
        removeHighlight();
      }
    });
  }
  function initializeContentScript() {
    if (window[GLOBAL_FLAG]) return;
    window[GLOBAL_FLAG] = true;
    initOverlaySystem();
    initRecorderListeners();
    initSelectionInterceptors();
    initMessageBridge();
    restoreRecordingState();
  }

  // src/content/index.js
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeContentScript, { once: true });
  } else {
    initializeContentScript();
  }
})();
//# sourceMappingURL=content.js.map
