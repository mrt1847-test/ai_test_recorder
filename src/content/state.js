/**
 * 콘텐츠 스크립트 전역 상태를 모아두는 단순 스토리지.
 * 다른 모듈에서 직접 import하여 참조한다.
 */
export const recorderState = {
  isRecording: false,
  currentHighlightedElement: null,
  overlayElement: null,
  hoverTimeout: null,
  mouseoutTimeout: null,
  scrollTimeout: null
};

export const elementSelectionState = {
  active: false,
  mode: null,
  currentElement: null,
  parentElement: null,
  highlightInfo: null,
  childFlashTimeout: null,
  stack: []
};

export const overlayControlsState = {
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

export const inputTimers = new WeakMap();

