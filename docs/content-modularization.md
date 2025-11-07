# Content Script Modularization Plan

## Goals
- **가독성 향상**: 기능별 파일 분리로 코드 이해도 제고
- **유지보수 용이성**: 책임 구분을 명확히 하여 수정 범위 최소화
- **빌드 기반 마련**: ESBuild 기반 번들링을 염두에 둔 구조 설계
- **스키마 일관성**: 이벤트 저장 포맷에 버전과 메타데이터를 명시

## 디렉터리 구조 제안
```
src/content/
├── index.js             # 엔트리 포인트 (번들링 대상)
├── init.js              # 초기화 및 라이프사이클 관리
├── utils/
│   └── dom.js           # DOM 관련 유틸리티 (escape, xpath, css segment 등)
├── selectors/
│   └── index.js         # 셀렉터 후보 생성/평가 로직
├── schema/
│   └── events.js        # 이벤트 스키마 정의 및 생성 헬퍼
├── state.js             # 전역 상태(녹화/선택/오버레이) 보관
├── overlay/
│   └── index.js         # 오버레이 UI 및 하이라이트 관리
├── recorder/
│   └── index.js         # 이벤트 캡처/저장 로직
├── selection/
│   └── index.js         # 요소 선택 워크플로우
├── replay/
│   └── index.js         # 리플레이 실행 및 수동 동작 처리
├── messaging/
│   └── index.js         # runtime.onMessage 브리지
└── dom/
    └── locator.js       # 요소 탐색/경로 추적 로직
```

> 기존 `content.js`는 최종 번들 산출물로 유지하고, 개발용 코드는 `src/content/` 하위에 위치시킵니다.

## 모듈별 책임 정의
| 모듈 | 주요 책임 |
| --- | --- |
| `utils/dom.js` | XPath/CSS 경로 생성, 텍스트 정규화 등 DOM 유틸 | 
| `selectors/index.js` | 셀렉터 후보 집계, 점수 계산, iframe 컨텍스트 파악 | 
| `schema/events.js` | 이벤트 스키마/버전 필드 정의 및 레코드 생성 | 
| `state.js` | 녹화/선택/오버레이 상태 객체 및 공유 맵 | 
| `overlay/index.js` | 오버레이 컨트롤 UI, 상태 표시, 하이라이트 처리 | 
| `recorder/index.js` | DOM 이벤트 캡처, 디바운스, 저장 브로드캐스트 | 
| `selection/index.js` | 요소 선택 진입/취소/부모·자식 선택 로직 | 
| `replay/index.js` | 리플레이 단계 실행, 수동 동작(텍스트/속성) 처리 | 
| `dom/locator.js` | 셀렉터 정보를 이용한 요소 탐색, 경로 추적 | 
| `messaging/index.js` | 콘텐츠 ↔ 패널 runtime 메시지 처리 | 
| `init.js` | 초기화 루틴 (오버레이/녹화/선택/메시징 등록) | 
| `index.js` | DOMContentLoaded 시점에서 `init.js` 실행 | 

## 이벤트 스키마(초안)
```json
{
  "version": 2,
  "timestamp": 1730978400000,
  "action": "click",
  "value": null,
  "selectorCandidates": [ ... ],
  "primarySelector": "css=button#submit",
  "primarySelectorType": "css",
  "primarySelectorText": null,
  "primarySelectorXPath": null,
  "primarySelectorMatchMode": null,
  "iframeContext": { "id": null, "name": null, "src": null },
  "page": { "url": "https://...", "title": "" },
  "frame": { "iframeContext": { ... } },
  "target": { "tag": "BUTTON", "id": "submit", "classes": ["primary"], "text": "제출" },
  "clientRect": { "x": 100, "y": 200, "w": 120, "h": 40 },
  "metadata": { "schemaVersion": 2, "userAgent": "..." },
  "manual": null
}
```
- **버전 필드**: 향후 포맷 변경 시 하위 호환 처리를 위한 필수 항목
- **page/frame/target**: AI 분석/리플레이 안정성 확보를 위한 컨텍스트 정보
- **manual**: 요소 선택을 통한 수동 액션(텍스트/속성 추출 등) 정보를 저장

## 번들링 파이프라인
1. `src/content/index.js`를 엔트리로 설정
2. ESBuild(또는 Rollup)으로 번들 → `content.js` 출력
3. 운영 시에는 번들 결과만 `manifest`에 등록
4. 개발 편의를 위해 `npm run build` 스크립트 제공 (watch 모드는 추후 옵션)

## TODO 흐름
- [x] 모듈 구조 설계 문서화 (본 문서)
- [ ] 이벤트 스키마 구현 및 레코더/리플레이 적용
- [ ] ESBuild 기반 번들 설정 추가 및 manifest 갱신

이 구조를 기준으로 다음 단계(스키마 반영, 빌드 파이프라인 구성)를 진행하면 됩니다.
