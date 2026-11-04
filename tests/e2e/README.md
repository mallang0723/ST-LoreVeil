# LoreVeil — 실제 SillyTavern E2E 하네스

LoreVeil 확장을 **실제 SillyTavern(ST)** 에 설치하고, Playwright(Chromium)로 실제 UI를 조작하며,
ST가 모의 OpenAI 서버로 보낸 **프롬프트 본문**을 검사한다. `node --test tests/*.test.mjs` 글롭에는 포함되지 않는다(`run-e2e.mjs`, `mock-openai.mjs`는 `tests/e2e/` 하위).

## 선행 조건
- Node 20+, ST 체크아웃과 `node_modules` (검증 커밋 `06bde93`; 다른 버전은 호출 순서 재확인 필요):
  ```
  git clone https://github.com/SillyTavern/SillyTavern.git <ST_DIR> && git -C <ST_DIR> checkout 06bde93
  (cd <ST_DIR> && npm ci --omit=dev)
  ```
- `playwright` 모듈과 Chromium이 이미 설치되어 있을 것(`playwright install`은 하지 않는다).
  `require('playwright')` 또는 `/opt/node-tools/node_modules/playwright`를 찾고, 다른 위치면 `PLAYWRIGHT_MODULE=/경로/node_modules/playwright`.

## 실행 (정확한 재실행 명령)
```
# 저장소 루트에서
ST_DIR=/path/to/SillyTavern node tests/e2e/run-e2e.mjs
```
선택 환경변수: `EXT_NAME`(설치 폴더명, 기본 `lv-e2e-ext` — `loreveil`이 아님을 일부러 유지), `KEEP_WORKDIR=1`, `RESULTS_OUT=결과.json`, `PLAYWRIGHT_MODULE`.
종료 코드 0 = 전부 통과, 1 = 실패 있음, 2 = 선행 조건 부족.

## 하는 일
임시 폴더에 `--dataRoot`/`--configPath`를 만들어 ST 폴더를 건드리지 않는다. 빈 포트에서 `127.0.0.1`로만 ST를 띄우고,
저장소 루트의 `manifest.json`, `index.js`, `style.css`, `lib/`만 `data/default-user/extensions/<EXT_NAME>/`에 복사한다(tests·README·.git 제외).
설정(Chat Completion → Custom → 모의 서버, 스트리밍 끔), 월드인포 책(`Mira` → `MIRA_LORE_MARKER`, 전역 활성),
`extensionSettings.loreVeil.debug=true`를 미리 심는다. 케이스마다 `/newchat`으로 새 채팅을 연다.

| ID | 내용 |
|---|---|
| pre | `script.js`의 `chatForWI` 줄에 `world_info_include_names`가 있음 |
| load | 확장 파일 200 응답, `loreVeilInterceptor`와 `.loreveil_settings` 패널 존재 |
| a | `Mira enters.` → 마커 있음(대조군) |
| b / b2 | `<st-loreveil>Mira</st-loreveil>` 제외, 원문 그대로, 저장된 `mes` 불변, `[LoreVeil]` 디버그 로그 |
| c / d | `!--ST_LOREVEIL_START--!…END--!` 마커 형식 / `<div st-loreveil>` 속성 형식 제외 |
| n | 기본값에서 `<wi-exclude>Mira</wi-exclude>`는 제외되지 않음(마커 있음) |
| h | 설정창 테스트 미리보기에 `·` 표시 |
| i | 설정창에 `st-loreveil, wi-exclude` 입력 → `<wi-exclude>`도 제외 |
| e | `lore-skip`으로 변경 → `<lore-skip>` 제외, `<st-loreveil>` 활성화 |
| f | 사용 토글 끔 → 감싼 글도 활성화 |
| g / g2 | 새로고침 후 설정 유지(UI와 디스크 `settings.json`의 `loreVeil`), 유지된 태그로 제외 동작 |
| console | 확장 관련 콘솔 error/warning 및 pageerror 없음 |

비밀값은 없다. 종료 시 ST·모의 서버·브라우저·임시 폴더를 정리한다.
