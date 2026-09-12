# Neon Glow

VS Code 구문 강조에 네온 글로우를 입히는 익스텐션. **테마를 가리지 않음** — 팔레트를
하드코딩하지 않고 지금 쓰는 테마의 토큰 색에서 글로우를 유도함.

의존성 없음(`dependencies`, `devDependencies` 둘 다 비어 있음). 번들러도 빌드 단계도
없음. 이 성질을 깨는 변경은 하지 않음.

## 구조

| 파일 | 역할 |
|---|---|
| `extension.js` | 확장 진입점. 명령 등록, 상태 표시 |
| `neon-glow.js` | 워크벤치에 **주입되는** 페이로드. 여기서 실제로 글로우를 계산함 |
| `patch.js` | 워크벤치 번들을 패치·복원. `.pre-neon.bak`으로 백업 |
| `locate.js` | VS Code 설치 경로 탐색 |
| `install.js` / `uninstall.js` | CLI 경로. 확장 없이도 패치·복원 가능 |
| `install.cmd` / `install.sh` | 릴리스 아카이브에 동봉되는 설치 스크립트. VSIX에는 안 들어감 |
| `tools/` | `make-icon.js`(아이콘 생성), `package.js`(VSIX 빌드), `release.js`(태그 생성), `bench.js`(글로우 공식 성능 쌍대 측정), `smoke.js`(스텁 DOM에 페이로드를 올려 검사), `live.js`(진짜 VS Code에 CDP로 붙어 Monaco에게 물어봄), `cdp.js`(bench·live가 같이 쓰는 CDP 클라이언트), `loader-cost.js`(로더 방식이 더할 지연 측정), `hstack-apng.js`(APNG 좌우 합성·분할). VSIX에는 안 들어감 |
| `samples/demo.js` | README 클립을 찍는 파일. 에러·경고·정보 물결선과 괄호 짝이 한 화면에 오게 짜여 있음. VSIX에는 안 들어감 |
| `NEXT.md` | 세션 인수인계 노트. VSIX에는 안 들어감 |

명령: `neonGlow.toggle` `enable` `disable` `install` `remove` `status`
설정: `glowLayers` `maxBlur` `brightness` `minChroma` `chromaSpan` `floor` `minLightness` `cursorTrail` `saveShake` `findGlow` `selectionGlow` `occurrenceGlow` `gutterGlow` `bracketMatchGlow` `squiggleGlow` `diffGlow` `lineHighlightGlow` `breakpointGlow` `breathe` `caretArc` `caretArcMinJump` `caretArcDuration` `caretArcOnDrag`

설정 값은 `state.json`을 타고 렌더러로 가므로 **재패치 없이 즉시** 반영됨.
`neon-glow.js`를 고치면 **완전 재시작이 필요**하지만 **재패치는 필요 없음** — 번들에 든
것은 로더뿐이고, 페이로드는 `state.json` 옆의 사본에서 `import()`로 읽힘. 확장이 뜰 때
자기 페이로드가 더 새 것이면 그 사본을 갈아끼움. **재패치가 필요한 경우는 로더 자체가
바뀔 때와 VS Code 업데이트가 번들을 갈아치웠을 때뿐임.**

## 글쓰기 규칙

- **README는 `README.md` 한 파일임.** 영어가 먼저 오고, 한국어판이 `## Korean` 아래에
  통째로 이어짐. 한국어 절의 제목은 한 단계씩 내려서 `###`부터 씀 — 한 파일에 `#` 제목이
  둘이면 목차가 꼬임. GitHub 첫 화면과 마켓플레이스 설명이 이 파일 하나를 씀. 맨 위
  `**English** · [한국어](#korean)`와 한국어 절 머리의 `[English](#vscode-neon-glow)`가
  서로를 가리킴.
  - **그 제목은 `## Korean`이어야 함, `## 한국어`가 아니라.** 마켓은 제목에서 비ASCII를 다
    지우고, 남는 게 없으면 `section`, `section-1`…로 번호를 붙임. `## 한국어`는 마켓에서
    `id=section`이 돼서 링크가 점프하지 않음. 링크로 가리킬 제목은 ASCII로 쓸 것.
    한국어 절 안의 한글 제목 목차 링크는 GitHub에서만 됨 — 알고 둔 것임.
- **한국어 절은 음슴체(`-음`/`-함`)로 씀.** 해라체(`-한다`, `-이다`, `-없다`)로
  쓰지 않음. 새 문단을 넣을 때도 마찬가지임.
  - `건드리지 않는다` → `건드리지 않음`, `안전하다` → `안전함`, `DOM이다` → `DOM임`
  - **예외**: `-마다`(타겟마다), `이보다` 같은 조사와 `측정하다 함께` 같은 연결어미는
    문장 끝이 아니므로 그대로 둠
  - 기계적으로 바꾸면 뜻이 망가지는 것은 고쳐 씀. `…안에 산다` → `삶`은 "인생"으로
    읽히므로 `…안에 있음`으로 씀
- 영어 절과 한국어 절은 문단이 서로 대응하도록 유지함. 한쪽만 고치면 대응이 흐트러짐.
  **배지는 영어 절에만, 시연 그림은 양쪽에 둠.** 한때 "같은 그림을 한 파일에 두 번 싣지
  않음"이었는데, `[한국어](#korean)`로 점프하면 위쪽 그림을 건너뛰고 본문에 떨어지므로
  한국어로 온 사람은 시연을 아예 못 봄. URL이 같아서 브라우저는 한 번만 받음 — 두 번
  실어도 용량 비용이 없음. 캡션과 `alt`는 그 절의 언어로 씀.
- **README는 쓰는 사람 것이고, 소스 주석은 고치는 사람 것임.** 한때 두 README에 결정의
  근거까지 다 적었더니 591줄이 됐고, 그 내용은 이미 `neon-glow.js` 주석에 있는 것이었음.
  같은 것을 두 곳에 적으면 한쪽이 반드시 낡음.
- **기능을 더하거나 빼면 문서가 같은 커밋에서 따라감.** 설정이나 명령 하나에 딸린
  자리가 넷임:
  1. `package.json`의 설정 스키마(`markdownDescription`) — 설정 화면에서 읽는 자리라
     여기가 제일 길어도 됨
  2. README의 **표** 한 줄씩 — 영어 절과 한국어 절에 하나씩
  3. **`neon-glow.js`의 그 규칙 바로 위 주석** — 왜 그렇게 생겼는지. 왜 이 규칙에만
     `spread`가 붙는지 같은, 소스를 봐야만 알 수 있는 결정이 여기 있음
  4. 이 파일 위쪽의 명령·설정 목록
  - **README 산문은 한 줄도 안 늘려도 됨.** 표 한 줄이면 충분한 기능이 대부분임. 산문에
    넣을 것은 여러 규칙에 걸쳐 있어서 표 한 줄에 안 들어가는 것뿐임 — `spread`가 붙는
    이유가 둘이라는 것 같은.
  - 기능을 빼면 **같은 넷에서 지움.**
  - 마켓플레이스 페이지는 게시된 VSIX 안의 README를 쓰므로, 문서만 고치고 릴리스를 안
    하면 GitHub 첫 화면과 마켓 설명이 갈라짐.

## 관례

- 커밋 메시지는 **무엇을 왜 바꿨는지 서술하는 영어 문장**. 접두사(`feat:`) 안 씀.
- 커밋에 `Co-Authored-By` 트레일러를 붙이지 않음.
- 취미 프로젝트임. 주말 단위로 굴러가는 범위를 넘기지 않음.
- Windows에서만 검증됨. macOS/Linux는 코드로만 있고 아무도 안 돌려봤음 — 그렇게 말해야 함.
- 성능을 논할 때 단일 측정은 못 믿음. 캐시가 데워지며 드리프트가 생기므로 쌍대로 잴 것.
- **릴리스 노트는 전역 규칙(`~/.claude/CLAUDE.md`)을 따름** — 태그마다 변경 내역을 적음.
  여기서는 `release.yml`의 `Build the changelog` 단계가 직전 태그부터의 커밋 제목을 뽑아
  붙이므로 손으로 쓸 일이 없음. 대신 **커밋 제목이 그대로 changelog 한 줄이 됨** — 제목을
  대충 쓰면 릴리스 노트가 대충 나옴.
- 릴리스 태그는 손으로 치지 않음. `node tools/release.js --push`가 `package.json`에서
  버전을 읽어 태그를 만듦. 버전을 먼저 올리고 커밋한 뒤에 돌릴 것 — 워크플로가 태그와
  `package.json`이 어긋나면 빌드를 거부함.
