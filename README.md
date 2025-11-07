# AI Test Recorder

## Overview
AI Test Recorder는 DevTools 패널과 콘텐츠 스크립트를 결합해 웹 페이지 상호작용을 기록하고 Playwright/Selenium 코드로 변환·리플레이할 수 있는 크롬 확장 프로그램입니다. 요소 선택 워크플로, iframe 전환 처리, XPath/CSS 추천, 코드 편집 등 다양한 기능을 제공해 안정적인 테스트 자동화 스크립트를 빠르게 생성할 수 있습니다.

### 주요 기능
- **녹화 & 리플레이**: 클릭/입력 이벤트 자동 기록, iframe 전환 지원, 재생 로그 제공
- **요소 선택 워크플로**: 수동으로 요소를 지정해 클릭·텍스트 추출·속성 추출 등의 액션을 코드에 삽입
- **셀렉터 추천**: ID·data-*·class·텍스트·XPath 등 다중 후보를 점수와 사유와 함께 제시, 자동 인덱싱 지원
- **코드 생성**: Playwright/Selenium · Python/JS/TS 코드 스니펫 생성 및 편집 가능
- **오버레이 컨트롤**: 페이지 위에 이동 가능한 녹화/정지/요소 선택 버튼 제공
- **모듈형 아키텍처**: `src/content`로 분리된 콘텐츠 스크립트, esbuild를 통한 단일 번들 생성

## Quick Start
1. Chrome 확장에서 `개발자 모드`를 활성화하고, `압축해제된 확장 프로그램 로드`를 눌러 `dist/` 폴더를 선택합니다.
2. DevTools(또는 오버레이 버튼)를 통해 녹화를 시작하고 페이지 상호작용을 수행합니다.
3. DevTools 패널에서 생성된 코드와 로그를 확인하고 필요 시 수동 요소 선택으로 액션을 추가합니다.

## Folder Structure
```
ai_test_recorder/
├─ dist/                # 빌드 산출물 (크롬 로드/스토어 제출용)
├─ scripts/             # 빌드 스크립트 및 보조 툴 (esbuild 등)
├─ docs/                # 설계 문서 및 가이드
├─ src/
│  └─ content/
│     ├─ init.js        # 콘텐츠 스크립트 초기화 및 재실행 방지
│     ├─ index.js       # 엔트리 포인트 (DOMContentLoaded 감지 후 초기화)
│     ├─ state.js       # 녹화/선택 상태, 오버레이 상태 등 전역 스토어
│     ├─ messaging/     # DevTools ↔ 콘텐츠 스크립트 메시지 브리지
│     ├─ recorder/      # DOM 이벤트 수집, 저장, 브로드캐스트 로직
│     ├─ replay/        # 리플레이 실행, 단계별 처리, 텍스트/속성 추출
│     ├─ selection/     # 수동 요소 선택 워크플로 & 부모/자식 탐색
│     ├─ selectors/     # 셀렉터 후보 생성, 점수/유일성 판단, 인덱싱
│     ├─ overlay/       # 페이지 오버레이 UI(녹화/정지/선택 버튼, 하이라이트)
│     ├─ utils/         # DOM 유틸리티, XPath/CSS 생성, 매칭 계산
│     └─ dom/           # 페이지 상에서 locator/매칭 도우미
├─ panel.html / panel.js / style.css   # DevTools 패널 UI 및 로직
├─ background.js        # 이벤트 저장 및 메시징 처리
├─ manifest.json        # 크롬 확장 설정
└─ README.md
```

## Development & Testing
### 의존성 설치
```bash
npm install
```
(이미 `node_modules/`가 있다면 생략 가능)

### 개발 사이클
1. 소스를 수정합니다 (`src/` 또는 `panel.js`, `style.css` 등).
2. 아래 명령으로 번들을 재생성합니다.
   ```bash
   npm run build
   ```
3. `chrome://extensions`에서 확장을 `새로고침`하여 최신 스크립트를 반영하고 테스트합니다.

## Deployment
1. `npm run build`로 최신 산출물을 만듭니다.
2. `dist/` 폴더가 완전한 실행 패키지이므로 전체를 ZIP으로 압축합니다.
3. 크롬 웹스토어 심사에 ZIP 파일을 제출하거나, 로컬 테스트 시 `dist/`를 그대로 로드합니다.

## Additional Info
- 이벤트 스키마, 모듈화 전략 등 세부 설계는 `docs/content-modularization.md`를 참고하세요.
- Playwright/Selenium 코드 커스터마이징, AI 연동 등은 `background.js` 또는 별도 백엔드와 연계해 확장할 수 있습니다.

## License
현재 별도의 라이선스 파일이 지정되어 있지 않습니다. 필요에 따라 프로젝트 정책에 맞는 라이선스를 추가하세요.
