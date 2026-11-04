# LoreVeil (SillyTavern 확장)

메시지 안의 특정 구간을 **월드인포(World Info, 로어북) 키워드 스캔에서만** 숨기는 SillyTavern 확장입니다.
감싼 글은 저장된 메시지, 채팅 화면, 모델에 전달되는 프롬프트에는 전혀 영향을 주지 않고, 로어북 키워드 검색에만 보이지 않습니다. 로어 항목의 내용과 재귀 스캔도 영향을 받지 않습니다.

## 설치

1. SillyTavern → **Extensions** → **Install extension**
2. 아래 주소를 입력하고 설치합니다.

   ```
   https://github.com/mallang0723/ST-LoreVeil
   ```

**업데이트:** 확장 관리자(Manage extensions)의 **Update** 버튼을 누르면 새 커밋을 git pull로 받아옵니다.

**수동 설치:** 이 저장소를 `data/<사용자>/extensions/loreveil/` (또는 `public/scripts/extensions/third-party/loreveil/`)에 복사(또는 git clone)한 뒤 SillyTavern을 새로고침합니다.

설치 후 Extensions 설정 패널에 "LoreVeil (월드인포 스캔 제외)" 서랍이 생깁니다.

## 설정

| 항목 | 설명 |
|---|---|
| 사용 | 전체 켜기/끄기 |
| 감쌀 명령어(태그 이름) | 기본 `st-loreveil`. 쉼표로 여러 개 지정. 영문 소문자로 시작하고 영문/숫자/`_`/`:`/`-`만 허용(대소문자 무시). 잘못된 이름은 빨간 글씨로 표시되며, 유효한 이름이 하나도 없으면 기본값을 사용 |
| 기본값으로 | 태그 이름을 `st-loreveil`로 되돌림 |
| 마커 형식 사용 | `!--ST_LOREVEIL_START--! ... !--ST_LOREVEIL_END--!` (태그 이름은 대문자, `-`와 `:`는 `_`로 바뀜) |
| 속성 형식 사용 | 임의의 요소에 태그 이름을 속성으로 붙임 |
| 테스트 | 입력한 글에서 스캔이 보게 될 모습을 표시. 가려진 칸은 `·` |
| 디버그 로그 | 콘솔에 가려진 메시지 수와 적용 여부를 출력 |

설정은 SillyTavern 설정(`extensionSettings.loreVeil`)에 저장됩니다.

다른 이름도 함께 쓰고 싶다면 설정의 태그 이름에 쉼표로 추가하세요. 예를 들어 `st-loreveil, wi-exclude`처럼 `wi-exclude`를 추가하면, 해당 이름으로 감싼 Lumiverse 스타일 채팅도 그대로 가릴 수 있습니다(기본값에는 포함되지 않습니다).

## 사용 예 (태그 `st-loreveil`)

```text
<st-loreveil>이 부분은 키워드 스캔에서 빠집니다.</st-loreveil>
!--ST_LOREVEIL_START--! 이 부분도 빠집니다. !--ST_LOREVEIL_END--!
<div st-loreveil>속성 형식</div>
<img st-loreveil src="...">   (빈 요소는 태그 자체만 가려짐)
```

HTML 주석 안의 요소·속성 형식, `class="st-loreveil"` 같은 속성 값은 제외 표시로 보지 않습니다. 단 마커 형식은 주석 안에 있어도 적용됩니다(닫히지 않은 START는 글 끝까지 가림). 닫히지 않은 구간은 글 끝까지 가려집니다.

### AI에게 트래커 블록 감싸게 하기

상태창·트래커 같은 반복 블록이 로어북을 계속 건드린다면, 캐릭터 카드나 시스템 프롬프트에 다음처럼 적어 두세요.

```text
매 응답 끝의 상태 트래커 블록은 반드시 <st-loreveil> 과 </st-loreveil> 로 감싸세요.
```

## 동작 방식

`generate_interceptor`로 `Generate()`가 넘기는 `coreChat`(채팅의 얕은 복사본)를 받아, 직후 월드인포 스캔이 호출하는 첫 `coreChat.map(...)` 한 번만 가려진 사본을 돌려주도록 일회성으로 덮어씁니다. 원본 `mes`는 절대 수정하지 않으며, 덮어쓴 `map`은 사용 즉시 삭제됩니다. 안전장치로 `WORLDINFO_ENTRIES_LOADED`, `GENERATION_ENDED`, `GENERATION_STOPPED` 이벤트와 다음 인터셉터 실행 시작 때도 정리합니다.

## 한계

- 드라이 런(토큰 카운터)과 프롬프트 항목화(prompt itemization)는 인터셉터를 건너뛰므로 가려지지 않은 글로 스캔합니다.
- 벡터 저장소 등 채팅을 직접 스캔하는 다른 확장은 대상이 아닙니다.
- SillyTavern의 `chatForWI` 콜백이 `world_info_include_names`를 참조한다는 점에 의존합니다. SillyTavern 소스 커밋 `06bde93` 기준으로 확인했습니다. ST가 이를 바꾸면 스캔이 가려지지 않은 글을 볼 뿐이며, 프롬프트는 그대로 유지됩니다.
- 가려진 사본은 ST의 WI 스캔 콜백에만 전달됩니다. 다른 `generate_interceptor`는 원본을 봅니다.
- 실제 구동 중인 ST에서의 수동 확인은 별도로 필요합니다. 자동 테스트는 `Generate()` 순서를 흉내 낸 Node 하네스입니다.

## 개발

```
node --test tests/*.test.mjs
```

## 착안 및 고지

- 이 확장의 기능은 [Lumiverse](https://github.com/prolix-oc/Lumiverse)의 `wi-exclude`(월드북 키워드 스캔 제외) 기능에서 착안했습니다.
- Lumiverse의 소스 코드를 복사하거나 포함하지 않았으며, LoreVeil의 코드는 SillyTavern용으로 독자적으로 작성했습니다.
- LoreVeil은 Lumiverse 공식 프로젝트가 아니며, Lumiverse 및 Prolix OCs와 제휴하거나 승인을 받지 않았습니다.

## 라이선스

Copyright (C) 2026 mallang0723

이 프로그램은 [GNU Affero General Public License v3.0](LICENSE)(AGPL-3.0) 조건으로 배포됩니다. 수정해 배포하거나 네트워크 서비스로 제공할 때는 같은 라이선스로 소스를 공개해야 합니다. 이 프로그램은 어떠한 보증도 없이 제공됩니다.
