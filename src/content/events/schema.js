import { inferSelectorType } from '../utils/dom.js';

export const EVENT_SCHEMA_VERSION = 2;

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

export function createEventRecord({
  action,
  value = null,
  selectors = [],
  target = null,
  iframeContext = null,
  clientRect = null,
  metadata = {},
  manual
}) {
  const timestamp = Date.now();
  const targetTag = target && target.tagName ? target.tagName : null;
  const selectorCandidates = Array.isArray(selectors) ? selectors : [];
  const primaryData = buildPrimarySelectorData(selectorCandidates);

  return {
    version: EVENT_SCHEMA_VERSION,
    timestamp,
    action,
    value,
    tag: targetTag,
    selectorCandidates,
    iframeContext,
    page: {
      url: window.location.href,
      title: document.title
    },
    frame: {
      iframeContext
    },
    target: target
      ? {
          tag: targetTag,
          id: target.id || null,
          classes: target.classList ? Array.from(target.classList) : [],
          text: (target.innerText || target.textContent || '').trim().slice(0, 200)
        }
      : null,
    clientRect,
    metadata: {
      schemaVersion: EVENT_SCHEMA_VERSION,
      userAgent: navigator.userAgent,
      ...metadata
    },
    manual: manual || null,
    ...primaryData
  };
}

