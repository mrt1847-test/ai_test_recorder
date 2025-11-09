/**
 * 콘텐츠 스크립트 진입점.
 * 문서 준비 상태에 따라 초기화 함수를 한 번만 실행한다.
 */
import { initializeContentScript } from './init.js';

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeContentScript, { once: true });
} else {
  initializeContentScript();
}

