# AI Test Recorder
AI Test Recorder는 DevTools 패널과 콘텐츠 스크립트를 결합해 웹 페이지 상호작용을 기록하고 Playwright/Selenium 코드로 변환·리플레이할 수 있는 크롬 확장 프로그램입니다. 현재 버전은 요소 선택 워크플로, 프레임 전환, XPath/CSS 추천, 코드 편집 등 다수의 개선 사항을 포함합니다.

## 주요 기능
- **녹화 & 리플레이**: 클릭/입력 이벤트 자동 기록, iframe 전환 처리, 재생 로그 제공
- **요소 선택 워크플로**: 수동으로 요소를 지정해 클릭/텍스트/속성 추출 등의 액션을 코드에 삽입
- **셀렉터 추천**: ID·data-*·class·텍스트·XPath 등 다중 후보를 점수와 사유와 함께 제시, 자동 인덱싱 지원
- **코드 생성**: Playwright/Selenium · Python/JS/TS 코드 스니펫 생성 및 편집 가능
- **오버레이 컨트롤**: 페이지 위에 이동 가능한 녹화/정지/요소 선택 버튼 제공
- **모듈화된 콘텐츠 스크립트**: `src/content` 구조로 기능별 분리, esbuild 번들링

## 폴더 구조
```
ai_test_recorder/
├─ dist/                # 빌드 산출물 (크롬 로드/스토어 제출용)
├─ src/                 # 콘텐츠 스크립트 모듈 소스
├─ panel.html/js/css    # DevTools 패널 UI 및 로직
├─ background.js        # 이벤트 저장 등 백그라운드 작업
├─ scripts/build.js     # esbuild 번들링 스크립트
├─ docs/                # 설계 문서
└─ README.md
```

## 개발 환경 설정
```bash
npm install
```
(이미 `node_modules/`가 있을 경우 생략 가능)

## 빌드 & 테스트
1. 소스 수정 후 아래 명령 실행
   ```bash
   npm run build
   ```
2. `dist/` 폴더에 `content.js`, `content.js.map`, `manifest.json`, `panel.*` 등 필수 파일이 재생성됩니다.
3. 크롬에서 테스트하려면 `chrome://extensions` → `개발자 모드` → `압축해제된 확장 프로그램 로드` → `dist/` 선택
4. 수정 후 다시 테스트할 때는 `npm run build`를 재실행하고, 크롬 확장 페이지에서 `새로고침` 버튼을 눌러 반영합니다.

## 스토어 제출 시
- `npm run build`로 최신 산출물을 만든 뒤 `dist/` 내용을 ZIP으로 압축해 제출합니다.
- 필요하다면 `dist/` 복사본을 별도 폴더에 만들고 거기에 README, 라이선스, 아이콘 등을 포함해도 됩니다.

## 추가 참고
- 이벤트 스키마, 모듈화 전략 등 상세 내용은 `docs/content-modularization.md`에서 확인할 수 있습니다.
- AI 기반 추천이나 추가 자동화를 붙이고 싶다면 백엔드 또는 `background.js`에 연동 로직을 확장하세요.
