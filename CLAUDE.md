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
| `tools/` | `make-icon.js`(아이콘 생성), `package.js`(VSIX 빌드), `release.js`(태그 생성), `bench.js`(글로우 공식 성능 쌍대 측정), `smoke.js`(스텁 DOM에 페이로드를 올려 검사). VSIX에는 안 들어감 |
| `NEXT.md` | 세션 인수인계 노트. VSIX에는 안 들어감 |

명령: `neonGlow.toggle` `enable` `disable` `install` `remove` `status`
설정: `glowLayers` `maxBlur` `brightness` `minChroma` `chromaSpan` `floor` `minLightness` `cursorTrail` `saveShake` `findGlow` `selectionGlow` `occurrenceGlow` `gutterGlow` `caretArc` `caretArcMinJump`

설정 값은 `state.json`을 타고 렌더러로 가므로 **재패치 없이 즉시** 반영됨. 반대로
`neon-glow.js`를 고치면 페이로드 해시가 바뀌어 **재패치와 완전 재시작이 필요**함.

## 글쓰기 규칙

- **`README.md`가 영어이고 기본**임. GitHub 첫 화면과 마켓플레이스 설명이 이걸 씀.
  `README.ko.md`가 한국어판이고, 둘은 서로 링크함.
- **`README.ko.md`는 음슴체(`-음`/`-함`)로 씀.** 해라체(`-한다`, `-이다`, `-없다`)로
  쓰지 않음. 새 문단을 넣을 때도 마찬가지임.
  - `건드리지 않는다` → `건드리지 않음`, `안전하다` → `안전함`, `DOM이다` → `DOM임`
  - **예외**: `-마다`(타겟마다), `이보다` 같은 조사와 `측정하다 함께` 같은 연결어미는
    문장 끝이 아니므로 그대로 둠
  - 기계적으로 바꾸면 뜻이 망가지는 것은 고쳐 씀. `…안에 산다` → `삶`은 "인생"으로
    읽히므로 `…안에 있음`으로 씀
- 두 README는 문단이 서로 대응하도록 유지함. 한쪽만 고치면 대응이 흐트러짐.
- **기능을 더하거나 빼면 문서가 같은 커밋에서 따라감.** 설정이나 명령 하나에 딸린
  자리가 넷임:
  1. `package.json`의 설정 스키마(`markdownDescription`)
  2. 두 README의 **표** 한 줄씩
  3. 두 README의 **산문** — 그 기능이 무엇이고 왜 그렇게 생겼는지
  4. 이 파일 위쪽의 명령·설정 목록
  - **표만 채우고 끝내지 않음.** 표의 한 줄은 그 값이 무엇을 하는지만 말하고, 그게 왜
    있는지도 왜 그 모양인지도 말하지 않음. 소스를 봐야만 알 수 있는 결정(왜 이 규칙에만
    `spread`가 붙는지 같은 것)은 산문에 남김.
  - 기능을 빼면 **같은 넷에서 지움.** 표에서만 지우면 산문이 없는 기능을 설명하게 됨.
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
