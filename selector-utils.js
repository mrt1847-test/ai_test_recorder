// selector-utils.js - helper functions for candidate generation (reserved for future use)
export function getSelectorCandidates(el) {
  const candidates = [];
  if (!el) return candidates;
  if (el.dataset && el.dataset.testid) candidates.push({type:'data-testid', selector:`[data-testid="${el.dataset.testid}"]`});
  if (el.id) candidates.push({type:'id', selector:`#${el.id}`});
  if (el.getAttribute && el.getAttribute('name')) candidates.push({type:'name', selector:`[name="${el.getAttribute('name')}"]`});
  if (el.classList && el.classList.length) candidates.push({type:'class', selector:'.' + Array.from(el.classList).slice(0,2).join('.')});
  const txt = (el.innerText || el.textContent || '').trim().split('\n')[0].trim();
  if (txt) candidates.push({type:'text', selector:`text="${txt.slice(0,30)}"`});
  // parent-child composed selector
  if (el.parentElement) {
    const p = el.parentElement;
    if (p.id) candidates.push({type:'parent-id-child', selector:`#${p.id} ${el.tagName.toLowerCase()}`});
  }
  return candidates;
}
