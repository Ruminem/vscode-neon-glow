# vscode-neon-glow

[English](README.md) · **한국어**

VS Code 구문 강조에 네온 글로우를 입힌다 — **테마를 가리지 않고**.

[SynthWave '84](https://github.com/robb0wen/synthwave-vscode)에서 아이디어를 가져왔지만,
테마를 함께 배포하지도 특정 테마에 묶이지도 않는다. 지금 쓰는 테마가 만들어내는 색을 그대로
읽어서 그중 선명한 것만 빛나게 하므로, 테마를 계속 바꿔도 글로우가 따라온다.

![what it does](https://img.shields.io/badge/VS%20Code-1.136%2B-blue)

## SynthWave '84와 다른 점

SynthWave는 hex 값 다섯 개를 하드코딩하고, 자기 테마가 활성 상태가 아니면 아예 동작을 거부한다.

```js
const tokenReplacements = { 'fe4450': "...", 'ff7edb': "...", /* ...3 more */ };
const usingSynthwave = () => document.querySelector('[class*="RobbOwen-synthwave-vscode-themes"]');
```

이쪽은 런타임에 테마 자신의 토큰 색에서 글로우를 유도하고, 테마를 바꾸면 다시 유도한다.
리로드가 필요 없다.

## 어떤 토큰이 빛나는가

세기는 HSL 채도가 아니라 **크로마**(`max(r,g,b) - min(r,g,b)`)로 결정된다.
이 구분이 중요하다. HSL 채도는 `1 - |2L-1|`로 나누기 때문에 흰색에 가까운 색에서 값이 폭발한다.
Monokai의 기본 텍스트 `#F8F8F2`는 실제 색 퍼짐이 `0.024`밖에 안 되는데 HSL 채도로는 `0.31`이
나온다 — 채도 임계값을 슬쩍 통과해서 *본문 텍스트*까지 빛나게 만들기에 충분한 값이다.
크로마에는 그런 실패 양상이 없다.

Monokai에서 측정한 값:

| 색상      | 역할            | 크로마 | 세기 |
|-----------|-----------------|--------|----------|
| `#F92672` | 키워드          | 0.827  | 1.00     |
| `#FD971F` | 매개변수        | 0.871  | 1.00     |
| `#A6E22E` | 함수 이름       | 0.706  | 0.89     |
| `#66D9EF` | 타입 / 클래스   | 0.537  | 0.68     |
| `#AE81FF` | 숫자            | 0.494  | 0.63     |
| `#E6DB74` | 문자열          | 0.447  | 0.58     |
| `#F8F8F2` | 일반 텍스트     | 0.024  | — (건너뜀) |
| `#88846F` | 주석            | 0.098  | — (건너뜀) |

색에서 역할을 역추론하는 방식이라, 서로 다른 역할에 같은 색을 재사용하는 테마는 구분하지
못한다. 역할별로 색이 뚜렷이 나뉘는 테마(Monokai, Tokyo Night, Dracula, …)에서 잘 동작한다.

## 켜고 끄기

토글은 진짜 VS Code 명령이라 일반적인 키바인딩 시스템 안에 산다. 명령 팔레트(`F1`)에서:

| 명령 | |
|---------|--|
| `Neon Glow: Toggle` | 글로우를 즉시 뒤집는다 |
| `Neon Glow: Enable` / `Neon Glow: Disable` | 명시적으로 지정한다 — 실제로 뭔가 바뀌는 쪽만 목록에 나온다 |
| `Neon Glow: Show status` | 현재 상태와, 번들이 패치돼 있는지 |

팔레트는 `neonGlow.enabled` context key로 `Enable`/`Disable`을 걸러내므로 둘 중 어느 쪽이
지금 유효한지 따질 필요가 없다. 키 할당은 양쪽 다 그대로 된다. `commandPalette`의 `when` 절은
팔레트에서만 숨길 뿐 키바인딩 시스템에서 숨기지 않는다.

번들을 패치하고 원상복구하는 것은 팔레트에 **없다**. VS Code 자신의 사용/사용 안 함/제거 버튼
옆에 놓이면 "Install"과 "Remove"는 확장 관리로 읽히는데 실제 의미는 전혀 다르고, 그것이 필요한
모든 경로가 이미 필요한 순간에 제안하기 때문이다 — 활성화 때의 프롬프트, 상태 표시줄 항목,
`Show status`, 그리고 나가면서 번들을 되돌리는 제거 버튼. 키 할당은 그대로 된다.

**기본 키바인딩은 일부러 넣지 않았다.** 다른 확장과 충돌하는 것이 원천적으로 불가능해지는
지점이 바로 여기다. *바로 가기 키*(`Ctrl+K Ctrl+S`)에서 `Neon Glow`를 검색해 원하는 조합을
직접 걸면 되고, 이미 점유된 조합이면 VS Code가 알아서 경고해준다.

토글은 설치 디렉터리의 파일을 건드리지 않으므로 관리자 권한도 재시작도 필요 없다.

오른쪽 상태 표시줄에 `NEON:ON` / `NEON:OFF`가 뜨고, 클릭하면 토글된다.
장식이 아니다 — 아래를 보라.

스위치는 켜져 있는데 빛날 수가 없는 두 상태도 여기서 알려준다. 에디터에서 보면 둘이 구분되지
않기 때문이다. **경고색 배경**은 번들이 패치되지 않았거나, 이 창이 뜬 뒤에 패치돼서 렌더러가
아직 부팅 때의 번들을 돌리고 있다는 뜻이다. 어느 쪽인지는 툴팁이 말해주고, 클릭하면 그것을
해결하는 동작이 실행된다. 두 번째 검사는 일부러 한쪽으로만 판단한다. "창 다시 로드"는 확장
호스트만 재시작하고 렌더러는 캐시된 번들에 그대로 두기 때문에, 패치 후 리로드한 창은 확장
쪽에서 보면 멀쩡한 창과 똑같다. 그래서 추측하지 않고 침묵한다.

### 토글이 에디터까지 닿는 경로

명령은 확장 호스트에서 돌고 글로우는 렌더러에 산다. 둘 사이에는 API가 없어서, 상태는 두 개의
채널을 동시에 타고 건너간다.

**빠른 쪽: 상태 표시줄.** 확장의 상태 표시줄 항목 자체가 전선이다. 라벨이 곧 상태이며 평문이다
(코디콘을 넣으면 엘리먼트로 렌더돼서 매칭이 깨진다). 렌더러는 `.statusbar`에
`MutationObserver`를 걸어둔다. 확장 호스트가 그것을 그리는 바로 그 프레임에 토글이 도착하니
대략 16ms다. 상태 표시줄은 커서 위치나 언어 모드 때문에 끊임없이 변하므로, 몰려오는 레코드는
`requestAnimationFrame`으로 프레임당 한 번의 읽기로 합쳐진다.

**느린 쪽: 상태 파일.** 확장은 `state.json`을 자신의 `globalStorage`에도 쓴다. 이 위치는
`vscode-file` 프로토콜 핸들러가 서빙해주는 루트 중 하나라서, 주입된 스크립트가 폴링할 수 있다.

```js
addValidFileRoot(e.appRoot)
addValidFileRoot(e.extensionsPath)
addValidFileRoot(...globalStorageHome...)   // <- 상태 파일이 여기 산다
```

폴링은 빠른 쪽이 놓친 것을 메운다. 상태 표시줄을 숨겼거나, `requestAnimationFrame`이 돌지 않는
백그라운드 창인 경우다. 800ms로 돌다가 상태 표시줄 쪽이 동작한다는 게 확인되면 1500ms로
물러난다. 그래서 상태 표시줄을 숨겨도 토글이 깨지는 게 아니라 반응이 느려지는 데서 그친다.

양쪽 다 *첫* 읽기는 적용하지 않고 기록만 한다. 시작 시 상태는 `localStorage`에서 오므로, 오래된
파일이나 아직 쓰이지 않은 상태 표시줄이 마지막으로 알려진 상태를 덮어쓸 수 없고, 부팅 때 엉뚱한
상태가 깜빡이지도 않는다.

두 경로가 모두 없으면(확장 없이 CLI로만 패치한 경우 등) 스크립트는 `Ctrl+Alt+N`으로 물러난다.
**버블** 단계에 등록되어 있어서 VS Code가 이미 점유한 조합이 언제나 이기고, 그 경우 폴백은 그냥
발동하지 않는다. 어느 한쪽이라도 응답하면 폴백은 완전히 물러선다. 조합을 옮기려면
`neon-glow.js`의 `FALLBACK_KEY`를 고치고, 아예 없애려면 `null`로 두면 된다.

끌 때는 엘리먼트를 제거하는 대신 스타일시트의 `disabled` 플래그를 뒤집는다. 그래서 다시 켤 때
정규식 패스를 테마 토큰 스타일에 다시 돌리지 않고 이미 파싱된 CSS를 재사용한다.

DevTools 콘솔에서 직접 부릴 수도 있다.

```js
__neonGlow.toggle();    // .enable() / .disable() / .isEnabled()
__neonGlow.bridgeOk();  // 둘 중 하나라도 살아있나?   빠른 쪽만 보려면 .statusBarOk()
```

## 설치

VS Code 설치 디렉터리에 쓰기 권한이 필요하다. Windows에서는 터미널을 관리자로, macOS/Linux에서는
`sudo`로 실행한다.

### 릴리스에서 (권장)

Windows라면 [Releases](https://github.com/Ruminem/vscode-neon-glow/releases)에서
`neon-glow-<version>-windows.zip`을 받아 풀고 `install.cmd`를 더블클릭한다. VS Code를 찾고,
확장을 설치하고, 번들을 패치하는 것까지 한 번에 한다. 따로 깔아둘 것은 없다. VS Code가
Electron이라 `Code.exe`가 패치 스크립트를 돌릴 Node 노릇까지 겸한다.

그 외 환경이거나 직접 하고 싶으면 같은 릴리스의 `.vsix`를 설치한다.

```sh
code --install-extension neon-glow-<version>.vsix
```

또는 VS Code 안에서: 확장 뷰 → `...` 메뉴 → *VSIX에서 설치…*.

확장을 설치하는 것만으로는 아무것도 빛나지 않는다. 페이로드는 `workbench.js`에 살고, 거기 넣는
것은 패치뿐이다. 확장은 활성화될 때 패치되지 않은 번들을 알아채고 고칠지 물어본다. 팔레트에서
`Neon Glow: Show status`를 직접 실행해도 된다. 어느 쪽이든 쓰기 권한과
**완전 재시작**이 필요하다. 일상적인 켜고 끄기는 둘 다 필요 없다.

마켓플레이스에는 없고, 앞으로도 올리지 않는다. `workbench.js`를 다시 쓰는 확장이 심사를 정직하게
통과할 수는 없다.

### 클론해서

확장 폴더에 바로 클론한 뒤 리로드한다.

```sh
# Windows
git clone https://github.com/Ruminem/vscode-neon-glow "%USERPROFILE%\.vscode\extensions\vscode-neon-glow"
# macOS / Linux
git clone https://github.com/Ruminem/vscode-neon-glow ~/.vscode/extensions/vscode-neon-glow
```

그다음 마찬가지로 `Neon Glow: Show status`를 실행한다.

### 명령줄에서

확장 없이 번들만 직접 패치한다.

```sh
git clone https://github.com/Ruminem/vscode-neon-glow
cd vscode-neon-glow
node install.js          # 되돌리려면  node uninstall.js
```

특정 설치를 지정하려면 `--target "<resources/app 경로>"`. 확장이 없으면 명령도 없으므로 토글은
`Ctrl+Alt+N` 폴백으로 떨어진다.

어느 경로든 끝나면: **VS Code를 완전히 종료했다가 다시 켠다.**

### VSIX 직접 빌드하기

```sh
npm run package          # -> neon-glow-<version>.vsix
```

커밋에 `v<version>` 태그를 달면 CI가 빌드해서 GitHub 릴리스에 붙인다. 태그와 `package.json`의
`version`이 다르면 잡이 실패한다.

아이콘은 그린 것이 아니라 생성한 것이다. 그래서 README가 인용하는 팔레트와 어긋나지 않는다.

```sh
node tools/make-icon.js          # -> icon.png   (다른 형태: bars, n)
```

의존성은 없다. 형태는 signed distance field이고, 블룸은 확장이 실제로 칠하는 것과 같은 감쇠이며,
PNG는 `zlib` 위에 직접 조립한다.

## 조정

손잡이는 `neon-glow.js` 맨 위에 있다. VSIX로 설치했다면 설치된 확장 폴더 안이다. 고친 뒤
`Neon Glow: Show status`를 다시 실행하고(또는 `node install.js`) 재시작한다.

```js
var BRIGHTNESS    = 1.0;   // 전체 세기
var MIN_CHROMA    = 0.30;  // 올리면 -> 빛나는 색이 줄어든다 (더 선별적)
var CHROMA_SPAN   = 0.50;  // 크로마에 따라 세기가 얼마나 빨리 올라가는가
var FLOOR         = 0.40;  // MIN_CHROMA를 겨우 넘긴 색의 세기
var MIN_LIGHTNESS = 0.25;  // 이보다 어두운 색은 건너뛴다
```

## 발목 잡는 것들

**"창 다시 로드"로는 반영되지 않는다.** 그건 소프트 리로드이고, Chromium은 `vscode-file` 번들을
캐시에서 내준다 — `vscode-file` 스킴이 `codeCache: true`로 등록돼 있기 때문이다. 패치 이전에 뜬
창은 몇 번을 리로드하든 옛날 번들을 계속 돌린다. 모든 VS Code 프로세스를 종료하고 다시 켜야 한다.

**VS Code가 설치가 손상됐다고 경고한다.** 예상된 동작이다. `product.json`이 `workbench.js`의
SHA-256(base64, 패딩 제거)을 들고 있는데, 패치하면 그 값이 안 맞게 된다. 알림은 *다시 표시 안 함*
으로 닫으면 된다. `product.json`의 체크섬을 다시 써서 영구히 침묵시킬 수도 있지만, 그러면 이번
것만이 아니라 **앞으로의 모든** 변조 탐지가 꺼진다 — 알림 하나 때문에 치를 값은 아니다.

**VS Code 업데이트는 패치를 지운다.** 업데이터가 `workbench.js`를 갈아끼운다. 이건 확장을 갓
설치한 상태와 똑같은 상태 — 패치되지 않은 번들 — 이라서, 다음 실행 때 확장이 다시 패치할지
물어본다. `Neon Glow: Show status`를 직접 실행하거나, CLI로 갔다면
`node install.js`를 다시 돌려도 된다. 재설치는 안전하다. 언제나 원본 `.pre-neon.bak`에서 다시
만들지, 이미 패치된 파일 위에 덧붙이지 않는다.

일부러 번들을 원상복구하면 그 제안도 함께 꺼진다. 매번 닫아야 하는 알림으로 변하지 않도록.

**확장을 제거하면 번들도 원상복구된다.** `package.json`이 `vscode:uninstall` 훅을 선언하고,
VS Code가 확장을 제거할 때 그것을 node 스크립트로 실행한다. 그래서 확장 뷰의 제거 버튼이
뒷정리까지 한다. 다만 최선 노력이다. 설치 디렉터리에 쓸 수 없으면 — 시스템 전역 설치인데 권한
상승이 없는 경우 — 훅이 실패하고 번들은 패치된 채로 남는다. 그때는 권한을 갖춘 상태로
`node uninstall.js`를 돌리거나, 제거 전에 `Neon Glow: Show status`를 쓰면 된다. 확장을
*사용 안 함*으로 두는 것은 제거가 아니다. 패치는 그대로 남고, 글로우는 마지막으로 본 상태로
계속 동작한다.

## 상태

**Windows 11의 VS Code 1.136.1**에서 개발하고 검증했다. 적용된 `text-shadow` 값을 Chrome DevTools
Protocol로 살아있는 렌더러에서 다시 읽어내 확인했다. macOS와 Linux 설치 경로는 구현돼 있지만
검증되지 않았다 — 오작동하면 이슈를 열어주면 좋겠다.

## 출처

아이디어와 워크벤치 패치 방식의 원형은 Robb Owen의
[SynthWave '84](https://github.com/robb0wen/synthwave-vscode)에서 왔다.

## 라이선스

MIT
