const fs = require('fs');
const path = require('path');

// 현재 디렉토리에서 panel.js 찾기
const panelPath = path.join(__dirname, 'panel.js');
const popupPath = path.join(__dirname, 'popup.js');

// panel.js 읽기
const panelContent = fs.readFileSync(panelPath, 'utf8');

// popup.js용으로 수정
let popupContent = panelContent;

// 1. inspectedTabId를 null로 변경 (팝업에서는 devtools API 사용 불가)
popupContent = popupContent.replace(
  /const inspectedTabId = \(typeof chrome !== 'undefined' && chrome\.devtools && chrome\.devtools\.inspectedWindow\)\s*\? chrome\.devtools\.inspectedWindow\.tabId\s*: null;/,
  'const inspectedTabId = null; // 팝업에서는 devtools API를 사용할 수 없음'
);

// 2. withActiveTab 함수에서 inspectedTabId 체크 부분 제거
popupContent = popupContent.replace(
  /  if \(typeof inspectedTabId === 'number' && chrome\.tabs && typeof chrome\.tabs\.get === 'function'\) \{\s*chrome\.tabs\.get\(inspectedTabId, \(tab\) => \{\s*if \(chrome\.runtime\.lastError \|\| !tab\) \{\s*chrome\.tabs\.query\(\{ active: true, currentWindow: true \}, \(tabs\) => \{\s*const fallbackTab = tabs && tabs\[0\] \? tabs\[0\] : null;\s*deliverTab\(fallbackTab\);\s*\}\);\s*return;\s*\}\s*deliverTab\(tab\);\s*\}\);\s*return;\s*\}/,
  '  // 팝업에서는 항상 현재 활성 탭 사용'
);

// 3. tabId: inspectedTabId 부분을 null로 변경 (실제 탭 ID는 withActiveTab에서 처리)
popupContent = popupContent.replace(
  /tabId: inspectedTabId/g,
  'tabId: null // 팝업에서는 withActiveTab에서 처리'
);

// popup.js로 저장
fs.writeFileSync(popupPath, popupContent, 'utf8');
console.log('popup.js 파일이 생성되었습니다.');

