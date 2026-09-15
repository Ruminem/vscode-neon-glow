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
| `package.nls.json` / `package.nls.ko.json` | 설정 설명의 영어 원문과 한국어판. `package.json`에는 키만 있음 |
| `l10n/bundle.l10n.ko.json` | 확장이 띄우는 알림·툴팁의 한국어판. 키는 `extension.js`의 영어 원문 그대로 |
| `patch.js` | 워크벤치 번들을 패치·복원. `.pre-neon.bak`으로 백업 |
| `locate.js` | VS Code 설치 경로 탐색 |
| `install.js` / `uninstall.js` | CLI 경로. 확장 없이도 패치·복원 가능 |
| `install.cmd` / `install.sh` | 릴리스 아카이브에 동봉되는 설치 스크립트. VSIX에는 안 들어감 |
| `tools/` | `make-icon.js`(아이콘 생성), `package.js`(VSIX 빌드), `release.js`(태그 생성), `bench.js`(글로우 공식 성능 쌍대 측정), `smoke.js`(스텁 DOM에 페이로드를 올려 검사), `live.js`(진짜 VS Code에 CDP로 붙어 Monaco에게 물어봄), `cdp.js`(bench·live가 같이 쓰는 CDP 클라이언트), `loader-cost.js`(로더 방식이 더할 지연 측정), `hstack-apng.js`(APNG 좌우 합성·분할). VSIX에는 안 들어감 |
| `samples/demo.js` | README 클립을 찍는 파일. 에러·경고·정보 물결선과 괄호 짝이 한 화면에 오게 짜여 있음. VSIX에는 안 들어감 |
| `NEXT.md` | 세션 인수인계 노트. VSIX에는 안 들어감 |

명령: `neonGlow.toggle` `enable` `disable` `install` `remove` `status` `preset`
설정: `glowLayers` `maxBlur` `brightness` `minChroma` `chromaSpan` `floor` `minLightness` `cursorTrail` `saveShake` `findGlow` `selectionGlow` `occurrenceGlow` `gutterGlow` `bracketMatchGlow` `squiggleGlow` `diffGlow` `lineHighlightGlow` `breakpointGlow` `snippetGlow` `renameGlow` `breathe` `caretArc` `caretArcColor` `caretArcMinJump` `caretArcDuration` `caretArcOnDrag`

설정 값은 `state.json`을 타고 렌더러로 가므로 **재패치 없이 즉시** 반영됨.
`neon-glow.js`를 고치면 **완전 재시작이 필요**하지만 **재패치는 필요 없음** — 번들에 든
것은 로더뿐이고, 페이로드는 `state.json` 옆의 사본에서 `import()`로 읽힘. 확장이 뜰 때
자기 페이로드가 더 새 것이면 그 사본을 갈아끼움. 단 사본은 렌더러가 읽은 **뒤에** 갈리므로,
업데이트 직후 첫 시작에는 로더가 `~/.vscode/extensions/extensions.json`을 읽어 새 버전 폴더의
페이로드를 직접 가져옴(`state.json`의 `version`보다 새롭고 `FOLDER_PAYLOAD_SINCE` 이상일 때만).
**재패치가 필요한 경우는 로더 자체가 바뀔 때와 VS Code 업데이트가 번들을 갈아치웠을 때뿐임.**

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
- **설정 설명은 언어별 파일에 씀.** `package.json`에는 `%neonGlow.<설정>.markdownDescription%`
  (선택지 설명은 `%neonGlow.<설정>.enum.<값>%`) 키만 두고, 영어 원문은 `package.nls.json`,
  한국어는 `package.nls.ko.json`에 씀. VS Code 표시 언어가 한국어면 한국어가, 그 밖에는
  영어가 뜸.
  - 설명을 고치면 **두 파일을 같은 커밋에서** 고침. smoke가 두 파일의 키 집합과, 문장마다
    백틱으로 감싼 값·코드·`#설정#` 링크가 두 언어에서 똑같은지 검사함 — 옮기다 숫자 하나나
    링크 하나를 빠뜨리면 빨개짐. 그래서 번역할 때 백틱 안은 건드리지 않음.
  - **설명은 짧게.** 무엇을 하는지와 단위, `0`의 뜻을 한 문장에. 꼭 알아야 할 조건(꺼야 하는
    경우 같은)만 한 문장 더. 이유·측정값·구현 방식은 `neon-glow.js` 주석에 둠. "다시 시작하지
    않아도 적용됨"처럼 모든 설정에 공통인 문장은 넣지 않음. 선택지 설명은 명사구 한 토막.
    한때 설명마다 근거를 다 적었더니 설정 화면이 스크롤해도 끝나지 않는 글이 됐음 — smoke가
    140자를 넘는 설명을 막음.
  - 한국어 설명은 **합니다체**로 씀. README 한국어 절(음슴체)과 다른 이유는 놓이는 자리임 —
    설정 화면에서 VS Code 자신의 한국어 설명(`…제어합니다.`) 바로 옆에 붙어 나옴.
  - 용어는 README 한국어 절과 맞추고, VS Code UI 요소의 이름은 한국어 언어팩
    (`ms-ceintl.vscode-language-pack-ko-*/translations`)에서 확인함 — `편집기`, `기호`, `피킹`.
  - **명령 이름(`contributes.commands`의 `title`)은 번역하지 않음.** 언어를 바꾸면 명령
    팔레트에서 영어로 찾던 이름이 사라지고, README·이슈에 적힌 이름과도 갈라져 헷갈림.
  - 다른 언어는 `package.nls.<언어 코드>.json`을 더하면 됨. 없는 키는 영어로 떨어짐.
- **알림·툴팁은 `vscode.l10n.t('영어 원문')`으로 씀.** 한국어는 `l10n/bundle.l10n.ko.json`에
  영어 원문을 키로 두고 적음. 그래서 영어 문장을 한 글자라도 고치면 번들의 키도 같이 고쳐야
  함 — 안 고치면 조용히 영어로 떨어짐.
  - **호출마다 문자열 리터럴 하나, 한 줄로.** `+`로 이어 붙이거나 변수를 넘기면 smoke가 원문을
    파일에서 읽어낼 수 없음. 값이 들어갈 자리는 `{0}`으로 두고 인자로 넘김(프리셋 설명만 예외).
  - smoke가 번역 누락, 번들에 남은 옛 키, `{0}` 개수 불일치를 검사함.
  - **상태바 라벨 `NEON:ON`/`NEON:OFF`는 번역하지 않음.** 렌더러가 그 글자를 보고 반응하는
    신호선임. 툴팁은 번역해도 됨.
  - `vscode.l10n`은 VS Code 1.73부터라 `engines.vscode`가 `^1.73.0`임. 낮추면 안 됨.
  - 프리셋 이름(Subtle 등)은 명령 이름처럼 영어로 두고, 설명만 번역함.
  - 한국어는 설정 설명처럼 **합니다체**. CLI(`install.js`)의 출력은 VS Code 밖이라 번역하지 않음.
- **README는 쓰는 사람 것이고, 소스 주석은 고치는 사람 것임.** 한때 두 README에 결정의
  근거까지 다 적었더니 591줄이 됐고, 그 내용은 이미 `neon-glow.js` 주석에 있는 것이었음.
  같은 것을 두 곳에 적으면 한쪽이 반드시 낡음.
- **기능을 더하거나 빼면 문서가 같은 커밋에서 따라감.** 설정이나 명령 하나에 딸린
  자리가 넷임:
  1. 설정 설명 — `package.nls.json`(영어)과 `package.nls.ko.json`(한국어) **둘 다**.
     `package.json`의 스키마에는 키만 둠. **짧게** — 위 '설명은 짧게' 참고
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

## 알아둘 것

코드에 안 남는, 한 번씩 밟아서 알게 된 것. 2026-09-14까지는 `NEXT.md`에 세션 일지로 쌓였고,
그 전문은 `git log -p -- NEXT.md`에 있음. 결정의 근거는 여기가 아니라 `neon-glow.js` 주석에 둠.

**실기에서 볼 때**
- 반영이 안 보이면 **완전 재시작**부터 의심함. 창 다시 로드로는 페이로드가 안 바뀌고, 옛
  페이로드는 새 선택지를 모르는 값이라 버리고 쓰던 값을 유지함.
- 효과는 DevTools 콘솔에 스타일을 넣어 먼저 봄. 스니펫에 `id`를 붙여 두 번 넣어도 안 겹치게.
  **이미 빛나는 자리가 아니라 안 빛나는 자리에서** 볼 것.
- 시험하려고 `neon-glow.js`를 고치지 않음. 물결선이 필요하면 `Ctrl+N` 새 파일에 `let x = ;`.
- diff 에디터에서는 거터 막대가 원래 안 보임(`display: none`). 일반 탭으로 열 것.
- 규칙에 쓸 테마 변수는 설치본에서 실제로 있는지 찾아봄. `debugIcon.breakpoint.foreground`는
  없는 이름이었고, 물결선 규칙은 번들 CSS가 아니라 JS가 만듦.

**스크래치 VS Code (`bench`·`live`·측정)**
- `ELECTRON_RUN_AS_NODE`를 지우고 띄움 — 통합 터미널에는 1이 걸려 있어 Node로 뜸.
- VS Code가 떠 있으면 `--user-data-dir` 없이는 기존 인스턴스로 넘어가고 디버그 포트도 사라짐.
- 스크래치 프로필에 `security.workspace.trust.enabled: false`(제한 모드면 F2가 안 됨). 한국어
  화면은 진짜 프로필의 `languagepacks.json`을 복사해야 뜸.
- `--extensions-dir`을 빈 폴더로 줘야 설치본이 안 떠서 `state.json`을 덮어쓰지 않음.
- 스크래치 창의 페이로드는 로더에 박힌 **진짜** 프로필 `state.json`을 읽음 — 설정은 페이지
  안에서 `fetch`를 가로채 넣음.
- 필터 애니메이션 비용은 `RasterTask`에 안 잡힘 — 스레드별 `RunTask`로 합칠 것. 새로고침을
  수십 번 하면 창이 느려져 측정이 망가짐. 막 뜬 창은 토큰 span이 아직 없음.

**마켓플레이스**
- `/_apis/securityroles`·`/_apis/gallery` 타임아웃은 Microsoft 쪽이 오락가락하는 것이고
  워크플로가 3회 재시도함. 그래도 죽으면 게시자 페이지에서 확장 이름 옆 `⋮` → Update로
  **릴리스에 붙은** VSIX를 올림(다시 빌드하면 바이트가 달라짐).
- **단, 세 번 다 같은 타임아웃이면 vsce 버전부터 의심함.** vsce 4.0.0(2026-09-14)에서는
  전날 게시에 성공한 토큰으로도 `verify-pat`이 `securityroles` 타임아웃을 3/3 냈고,
  3.x로는 몇 초에 통과했음. 그래서 두 워크플로가 `@vscode/vsce@3`으로 고정돼 있음.
  `@latest`로 되돌리는 건 4에서 게시가 실제로 통과하는 걸 본 뒤에.
- 토큰이 의심되면 `vsce verify-pat Ruminem`. "나만 안 되나"는 마켓 조회 API(`filterType:8`,
  `sortBy:1`)의 최근 `lastUpdated`로 봄. 시험 게시는 하지 않음.
- 태그 없이 CI 확인: `gh workflow run marketplace.yml --ref main` — 태그 검사에서 멈춤.
- PAT은 2027년 안에 만료됨. 새 토큰은 **All accessible organizations**로 — 특정 조직이면
  401이 토큰 오류처럼 보임.
- 초록이어도 마켓 목록 반영은 몇 분 걸림.

**그림과 README**
- 그림은 VSIX에 안 실리고 README가 `raw.githubusercontent.com`의 `main`을 가리킴. 그래서
  **README가 가리키는 그림을 `main`에서 지우면 게시된 마켓 페이지가 다음 릴리스까지 깨짐.**
  릴리스 노트의 그림은 커밋 해시로 고정한 URL로 걸 것.
- 애니메이션은 APNG(확장자는 `.png`). GIF를 받으면 `gifsicle -O3`부터. 좌우 비교는
  `tools/hstack-apng.js`로 한 파일에 — 두 파일은 재생 시계가 따로 놂. 30fps 녹화에는
  `cursorTrail` 45ms가 안 찍힘.
- 앵커는 추측하지 말고 `gh api repos/Ruminem/vscode-neon-glow/readme -H 'Accept:
  application/vnd.github.html'`로 대조. 마켓 HTML의 `id` 속성엔 따옴표가 없음.

**smoke와 커밋**
- 새 검사는 `tools/smoke.js` 맨 뒤에 붙임 — `run()`이 전역 스텁을 갈아치워서 중간에 넣으면
  앞 섹션이 엉뚱하게 빨개짐. 넣은 검사는 고치기 전 코드에서 한 번 빨개지는 것을 봄.
- 기본값을 바꾸면 그 값을 전제한 검사도 봄. 페이로드가 커지면 `patch.js`의 끝 256KB 탐색
  창을 넘지 않는지 봄.
- 섞인 diff 나누기: `git diff -U0`에서 헝크를 골라 `git apply --cached --unidiff-zero`, 앞
  커밋 단독 검사는 `git worktree add`.

**무엇을 넣을지**
- 먼저 물을 것: **이 색이 어디서 오는가.** 테마 색을 다른 표면으로 연장하는 것은 넣고, 제
  팔레트를 얹는 효과(스캔라인, 부팅 연출)는 안 넣음.
- 기본값의 경계: 색만 바꾸는 설정은 켜서, 움직이는 설정은 꺼서 내보냄.
- 기능 전에 "손으로 하면 얼마나 번거로운가" — 미리보기 명령을 만들었다 뺀 이유.
- DOM으로 닿는 표면은 사실상 끝남. 터미널·미니맵·오버뷰 룰러는 캔버스라 CSS가 못 감.
