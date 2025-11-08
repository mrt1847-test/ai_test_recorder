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

