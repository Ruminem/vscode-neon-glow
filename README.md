# vscode-neon-glow

**English** · [한국어](#korean)

Neon glow for VS Code syntax highlighting — **for any colour theme**.

It ships no theme of its own. It reads whatever colours your current theme produces
and makes the vivid ones glow, so you can keep changing themes and the glow follows
along — no reload needed.

![requires VS Code 1.70 or newer](https://img.shields.io/badge/VS%20Code-1.70%2B-blue)

The same file at the same moment, without the glow on the left and with it on the
right — the token colours, the matching bracket box, every other place the symbol
under the caret appears, and error, warning and info squiggles:

![the same editor twice, side by side: plain syntax highlighting on the left, and on the right the same lines with the theme's own colours glowing, the bracket box beside the caret lit, the occurrences of the symbol it is parked on picked out, and three squiggles carrying the theme's diagnostic colours](https://raw.githubusercontent.com/Ruminem/vscode-neon-glow/main/images/neon-glow.png)

`caretArc` and `caretArcOnDrag` are both on in that clip, and both ship off.

[Which tokens glow](#which-tokens-glow) · [What else can glow](#what-else-can-glow) · [Install](#install) · [Settings](#settings) · [Things that will bite you](#things-that-will-bite-you) · [Status](#status)

## Which tokens glow

Strength is driven by **chroma** (`max(r,g,b) - min(r,g,b)`), not HSL saturation —
saturation divides by `1 - |2L-1|`, which explodes for near-white colours and would
let *body text* glow. Measured on Monokai:

| Colour    | Role            | Chroma | Strength |
|-----------|-----------------|--------|----------|
| `#F92672` | keyword         | 0.827  | 1.00     |
| `#FD971F` | parameter       | 0.871  | 1.00     |
| `#A6E22E` | function name   | 0.706  | 0.89     |
| `#66D9EF` | type / class    | 0.537  | 0.68     |
| `#AE81FF` | number          | 0.494  | 0.63     |
| `#E6DB74` | string          | 0.447  | 0.58     |
| `#F8F8F2` | plain text      | 0.024  | — (skipped) |
| `#88846F` | comment         | 0.098  | — (skipped) |

Because it infers role from colour, themes that reuse one colour across different
roles can't be told apart. Themes with distinct per-role colours (Monokai, Tokyo
Night, Dracula, …) work well.

**Flatter themes need different numbers.** The defaults are calibrated on Monokai,
which is unusually saturated. In Abyss the class-name colour `#ffeebb` never reaches
the `0.30` threshold while the comment colour `#384887` clears it, so the roles that
glow come out close to inverted. Dropping `minChroma` to about `0.25` and raising
`brightness` past `1` gets it back.

Bracket pair colouring is left to VS Code: brackets get a rule of their own in
`currentColor`, so each nesting level glows in the colour it is painted.

## What else can glow

The token glow is not the only thing on. Six more surfaces light with it, and three
effects wait to be asked for. The line between them is one sentence — **a setting
that only decides what colour lands where is on, and a setting that changes what the
editor does while you work is off.**

Everything in the first group is the theme's own colour carried somewhere it was not
carried before, so none of it puts a palette on your screen the theme had not already
chosen.

| On by default | |
|---|---|
| **Find results** (`findGlow`) | the one place the glow does work rather than decoration — a match is visible without hunting the scrollbar for its mark |
| **The selection** (`selectionGlow`) | only rendered lines carry a selection span, so selecting a whole file costs the screenful in front of you and nothing beyond it |
| **The symbol under the caret** (`occurrenceGlow`) | every place it appears on screen. Where a theme paints a write in a different colour from a read, the write is lit wider |
| **The gutter's change bars** (`gutterGlow`) | added, modified and deleted marks from source control — bounded by how many lines you have changed, not by the viewport |
| **The matching bracket box** (`bracketMatchGlow`) | brackets already glow; the box that marks the pair did not, which left the moment the editor points at something as the dimmest thing on the line |
| **Error, warning and info squiggles** (`squiggleGlow`) | the glow follows the wave itself, so an error is visible from across the screen without the word above it blooming. Hints are left alone — VS Code keeps them quiet on purpose |

Find, selection and occurrence colours are semi-transparent, because they sit behind
text and must not hide it, so those rules take a `spread` — the weak colour is carried
outwards at full width before the blur starts. The gutter bars take one for a
different reason: the box their glow hangs on is `width: 0`, and a shadow of a box
with no area paints nothing whatever the blur. The caret and the bracket box, whose
colours are opaque, need none. The squiggles take no box-shadow at all: the wave is an SVG
image, not a box, so they use a `drop-shadow` filter, which follows the drawn shape. This
is why the rules do not match each other, and the reasoning is kept beside each one in
`neon-glow.js`.

| Off until you set it | |
|---|---|
| **The caret trail** (`cursorTrail`) | the caret gets a duration to cross instead of jumping, so the glow on it smears into a streak. `130` reads as lag; `45` keeps up and still streaks on a jump across a file. How much of a slide that is depends on the display — `45` is under three frames at 60Hz and six or seven at 144Hz, so raise it on a slower panel |
| **The save jolt** (`saveShake`) | the workbench knocks sideways when a file is saved. A compositor animation on `transform` alone, so the glow is never re-drawn during it |
| **The caret arc** (`caretArc`) | `arc`, `beam`, `comet` or `flash` drawn along a caret jump, in the theme's own caret colour, as SVG that lives a few hundred milliseconds |

These three move things, and nobody asked for movement, so they ship at `0` and stay
there until you say otherwise. All three are ignored when the system asks for reduced
motion.

## Turning it on and off

The toggle is a real VS Code command, so it lives inside the normal keybinding system.
From the command palette (`F1`):

| Command | |
|---------|--|
| `Neon Glow: Toggle` | flip the glow on/off, instantly |
| `Neon Glow: Enable` / `Neon Glow: Disable` | set it explicitly — only whichever one would actually change something is listed |
| `Neon Glow: Show status` | current state, and whether the bundle is patched |

**No default keybinding ships with this**, deliberately — that is what makes it
impossible to collide with another extension. Bind whatever you like in *Keyboard
Shortcuts* (`Ctrl+K Ctrl+S`) and search `Neon Glow`.

Toggling never touches a file in the install directory, so it needs no admin rights
and no restart. A status bar item on the right shows `NEON:ON` / `NEON:OFF` and
toggles on click; a warning background on it means the switch is real but nothing can
glow — the bundle is unpatched, or carries an older payload, or was patched after this
window started. The tooltip says which, and clicking does the thing that fixes it.

Commands run in the extension host and the glow lives in the renderer, with no API
between them, so the state crosses on two channels at once: a `MutationObserver` on
the status bar item's label, which lands a toggle in about 16ms, and a `state.json`
poll for whatever that misses. `neon-glow.js` carries the details.

You can also drive it from the DevTools console:

```js
__neonGlow.toggle();    // .enable() / .disable() / .isEnabled()
__neonGlow.bridgeOk();  // is either half live?   .statusBarOk() for the fast one
```

## Install

Requires write access to the VS Code install directory — run the terminal as
administrator on Windows, or with `sudo` on macOS/Linux.

### From the Marketplace

Search **Neon Glow** in the Extensions view, or:

```sh
code --install-extension Ruminem.vscode-neon-glow
```

Installing the extension does not by itself make anything glow — the payload lives in
`workbench.js`, and only a patch puts it there. The extension notices an unpatched
bundle when it activates and offers to fix it; you can also run `Neon Glow: Show
status` from the palette. Either route needs write access and a **full restart**.
Everyday on/off needs neither.

### From a release

On Windows, download `neon-glow-<version>-windows.zip` from
[Releases](https://github.com/Ruminem/vscode-neon-glow/releases), unzip it, and
double-click `install.cmd`. It finds VS Code, installs the extension and patches the
bundle in one pass. Nothing else has to be on the machine: VS Code is Electron, so
`Code.exe` doubles as the Node that runs the patcher.

On macOS and Linux, download `neon-glow-<version>-macos-linux.tar.gz`, unpack it, and
run `./install.sh`. It does the same three things, and says what to do if the install
directory belongs to root. A VS Code installed as a **snap or a flatpak cannot be
patched at all** — those are mounted read-only; use the `.deb`, the `.rpm` or the
tarball.

The same release carries the `.vsix` if you would rather install that directly.

### From the command line

No extension at all — patch the bundle directly:

```sh
git clone https://github.com/Ruminem/vscode-neon-glow
cd vscode-neon-glow
node install.js          # node uninstall.js  to revert
```

Point at a specific install with `--target "<path to resources/app>"`. Without the
extension there are no commands, so the toggle falls back to `Ctrl+Alt+N`.

After any of these routes: **quit VS Code completely and start it again.**

### Building it yourself

```sh
npm run package                  # -> neon-glow-<version>.vsix
node tools/make-icon.js          # -> icon.png   (also: bars, n)
node tools/smoke.js              # run the payload against a stub workbench
```

Tagging a commit `v<version>` builds the VSIX in CI and attaches it to a GitHub
release; the tag must match the `version` in `package.json` or the job fails. There
are no dependencies anywhere in this repo, the icon included: its shapes are signed
distance fields and the PNG is assembled on top of `zlib`.

## Settings

Open Settings (`Ctrl+,`) and search `Neon Glow`. Changes apply to the open editor as
you make them — no re-patch, no restart, and nothing to open first: the file you were
reading is the preview.

| Setting | Default | |
|---------|---------|--|
| `neonGlow.glowLayers` | `3` | halo passes per token, over an edge pass that always runs — **the expensive one** |
| `neonGlow.maxBlur` | `36` | ceiling on any one blur radius; the default is already the widest emitted |
| `neonGlow.brightness` | `1.0` | overall strength; `0` leaves the colours alone and drops the glow |
| `neonGlow.minChroma` | `0.30` | colours flatter than this never glow — this is what keeps body text out |
| `neonGlow.chromaSpan` | `0.50` | how much chroma above the threshold reaches full strength |
| `neonGlow.floor` | `0.40` | strength of a colour that only just passes `minChroma` |
| `neonGlow.minLightness` | `0.25` | skip colours darker than this, however saturated |
| `neonGlow.cursorTrail` | `0` | ms for the caret to slide to a new position, so its glow streaks; `0` keeps the jump |
| `neonGlow.saveShake` | `0` | px the workbench jolts on save; `0` holds it still, and so should `files.autoSave` |
| `neonGlow.findGlow` | `18` | px of bloom on find results, in the theme's own find colours; `0` turns it off |
| `neonGlow.selectionGlow` | `12` | px of bloom on selected text, in the theme's own selection colour; `0` turns it off |
| `neonGlow.occurrenceGlow` | `10` | px of bloom on the symbol under the caret, wherever else it appears; `0` turns it off |
| `neonGlow.gutterGlow` | `8` | px of bloom on the gutter's change bars, in the theme's own `editorGutter` colours; `0` turns it off |
| `neonGlow.bracketMatchGlow` | `10` | px of bloom on the box around a bracket and its partner; `0` turns it off |
| `neonGlow.squiggleGlow` | `5` | px of bloom on error, warning and info squiggles, in the theme's own colours; `0` turns it off |
| `neonGlow.caretArc` | `off` | what to draw along a caret jump: `arc`, `beam`, `comet` or `flash` |
| `neonGlow.caretArcMinJump` | `5` | px of travel before an arc is drawn — under a character, so an arrow key counts |
| `neonGlow.caretArcOnDrag` | `false` | keep drawing while a selection is dragged out; the click that starts the drag draws either way |

**`glowLayers` is the one that costs.** The editor virtualises, so a 10,000 line file
is not 10,000 glowing spans and the cost scales with the viewport rather than the
file. But the widest pass is very nearly the whole bill, not the two thirds the area
arithmetic predicts — blur time climbs much faster than radius, and neighbouring
tokens' widest blurs overlap. Measured over a driven scroll on a dense C++ viewport,
`3` cost several times what `2` did. Drop it to `2` on a slow machine. `maxBlur` is
the same lever with a finer grain; `brightness` is not, and fades the glow far more
than it speeds it up. The measurements and their caveats are kept in `neon-glow.js`,
and `tools/bench.js` re-runs them in pairs.

Settings work without a restart because they do not live in the patch: the extension
writes them into the same `state.json` the toggle uses, and the renderer clamps and
applies them on its next poll. The same values are also the defaults at the top of
`neon-glow.js`, which is what a CLI-only install uses — editing those means re-running
`node install.js` and restarting.

## Things that will bite you

**"Reload Window" does not apply changes.** It is a soft reload, and Chromium serves
the `vscode-file` bundle from cache. A window launched before you patched keeps
running the old bundle no matter how many times you reload it. Quit every VS Code
process and relaunch.

**VS Code will warn that the installation is corrupt.** Expected: `product.json`
carries a SHA-256 of `workbench.js`, and patching it breaks the match. Dismiss with
*Don't Show Again*. Rewriting the checksum would silence it permanently but disables
tamper detection for **all** future modifications, not just this one.

**Updating the extension does not update the patch,** and patching does not update the
extension. The two halves are written by different commands and neither touches the
other, so a new setting can appear in the Settings UI while the payload has never
heard of it, or the reverse. The injected banner carries a hash of the payload, so the
extension notices a mismatch and offers to patch again.

**VS Code updates wipe the patch.** The updater replaces `workbench.js`, which leaves
the same state as a fresh install, so the extension offers to re-patch on next launch.
Re-patching is safe: it always rebuilds from the pristine `.pre-neon.bak`, never from
an already-patched file.

**Uninstalling the extension restores the bundle** through a `vscode:uninstall` hook.
It is best effort — if the install directory is not writable the hook fails and the
bundle stays patched; run `node uninstall.js` with the rights it needs. *Disabling*
the extension is not uninstalling it: the patch stays and the glow keeps working off
the last state it saw.

**`files.autoSave` and `saveShake` do not mix.** Every autosave is a save, and the
screen never stops moving.

**SynthWave '84 can sit alongside this, but only one of them should paint.** Different
files and different backups, so neither patch can corrupt the other — but both build a
`<style>` from `.vscode-tokens-styles` at equal specificity, so whichever is appended
last wins. `Neon Glow: Show status` reports whether it is competing, and
`Neon Glow: Disable` steps aside instantly without touching a file.

## Status

Developed and verified against **VS Code 1.136.1 on Windows 11**, with the applied
`text-shadow` values read back out of the live renderer over the Chrome DevTools
Protocol.

| | Works | Verified | |
|---|---|---|--|
| **Windows** | yes | yes | user and system installs, including the commit-hash resources directory |
| **macOS** | should | no | patching edits a file inside the signed `.app`, which invalidates its code signature — it keeps running in practice, but that is the trade |
| **Linux**, `.deb` / `.rpm` / tarball | should | no | `/usr/share/code` belongs to root, so the palette command cannot do it; use `sudo node install.js` or `sudo ./install.sh` |
| **Linux**, snap or flatpak | **no** | — | mounted read-only, so nothing can patch them. The extension says so rather than failing obscurely |

macOS and Linux are written to work and have not been run by anyone — please open an
issue if they misfire.

## Credit

The idea — that syntax highlighting can glow, and that patching the workbench is a way
to get there — comes from
[SynthWave '84](https://github.com/robb0wen/synthwave-vscode) by Robb Owen.

## License

MIT

---

## Korean

[English](#vscode-neon-glow) · **한국어**

VS Code 구문 강조에 네온 글로우를 입힘.

**어느 테마에서나 그 테마의 색으로.**

테마를 함께 배포하지 않음. 지금 쓰는 테마가 만들어내는 색을 그대로 읽어서 그중 선명한
것만 빛나게 하므로, 테마를 계속 바꿔도 글로우가 따라옴. 리로드도 필요 없음.

같은 파일의 같은 순간임. 왼쪽은 글로우 없음, 오른쪽은 글로우 있음 — 토큰 색, 일치하는
괄호 상자, 커서가 놓인 심볼의 다른 출현, 에러·경고·정보 물결선까지:

![같은 에디터를 좌우로 놓은 그림. 왼쪽은 평범한 구문 강조이고, 오른쪽은 같은 줄들이 테마가 준 색 그대로 빛남. 커서 옆 일치하는 괄호 상자가 밝고, 커서가 놓인 심볼의 다른 출현이 드러나며, 물결선 셋이 테마의 진단 색을 띰](https://raw.githubusercontent.com/Ruminem/vscode-neon-glow/main/images/neon-glow.png)

클립에서는 `caretArc`와 `caretArcOnDrag`를 켜뒀음. 둘 다 기본은 꺼짐임.

[빛나는 토큰](#어떤-토큰이-빛나는가) · [토큰 말고 빛나는 것](#토큰-말고-빛나는-것) · [설치](#설치) · [설정](#설정) · [발목 잡는 것들](#발목-잡는-것들) · [상태](#상태)

### 어떤 토큰이 빛나는가

세기는 HSL 채도가 아니라 **크로마**(`max(r,g,b) - min(r,g,b)`)가 정함. 채도는
`1 - |2L-1|`로 나누는 값이라 흰색에 가까운 색에서 폭발함. 그대로 쓰면 *본문 텍스트*가
빛남. Monokai에서 측정한 값:

| 색        | 역할            | 크로마 | 세기 |
|-----------|-----------------|--------|------|
| `#F92672` | 키워드          | 0.827  | 1.00 |
| `#FD971F` | 매개변수        | 0.871  | 1.00 |
| `#A6E22E` | 함수 이름       | 0.706  | 0.89 |
| `#66D9EF` | 타입 / 클래스   | 0.537  | 0.68 |
| `#AE81FF` | 숫자            | 0.494  | 0.63 |
| `#E6DB74` | 문자열          | 0.447  | 0.58 |
| `#F8F8F2` | 일반 텍스트     | 0.024  | — (건너뜀) |
| `#88846F` | 주석            | 0.098  | — (건너뜀) |

색에서 역할을 유추하는 방식이라, 여러 역할에 같은 색을 쓰는 테마는 구분하지 못함.
역할마다 색이 다른 테마(Monokai, Tokyo Night, Dracula …)에서 잘 나옴.

**밋밋한 테마는 다른 숫자가 필요함.** 기본값은 유난히 채도가 높은 Monokai에 맞춰져 있음.
Abyss에서는 클래스 이름 색 `#ffeebb`가 `0.30` 문턱에 아예 못 닿고 주석 색 `#384887`은
넘어서, 빛나는 역할이 거의 뒤집혀 나옴. `minChroma`를 `0.25` 근처로 내리고 `brightness`를
`1` 위로 올리면 돌아옴.

괄호 쌍 색칠은 VS Code에 맡김. 괄호에는 `currentColor`로 된 규칙을 따로 줘서, 중첩 단계
하나하나가 실제로 칠해진 그 색으로 빛남.

### 토큰 말고 빛나는 것

켜져 있는 것이 토큰 글로우만은 아님. 표면 여섯 개가 같이 빛나고, 효과 셋은 부를 때까지
기다림. 그 경계는 한 문장임 — **어떤 색이 어디에 놓이는지만 정하는 설정은 켜져 나가고,
일하는 동안 에디터가 하는 일을 바꾸는 설정은 꺼져 나감.**

앞쪽은 전부 테마 자신의 색을 여태 안 가던 자리로 옮기는 것뿐임. 그래서 켜져 있어도
테마가 고르지 않은 색이 화면에 새로 생기지 않음.

| 기본으로 켜짐 | |
|---|---|
| **찾기 결과** (`findGlow`) | 글로우가 장식이 아니라 실제로 일을 하는 유일한 자리임. 스크롤바의 표시를 뒤지지 않아도 매치가 보임 |
| **선택 영역** (`selectionGlow`) | 화면에 그려진 줄만 선택 span을 가지므로, 파일 전체를 선택해도 눈앞의 한 화면만큼만 듦 |
| **커서가 놓인 심볼** (`occurrenceGlow`) | 그 심볼이 화면에 나온 자리 전부. 테마가 읽기와 쓰기를 다른 색으로 칠하면 쓰기를 더 넓게 밝힘 |
| **거터의 변경 막대** (`gutterGlow`) | 소스 관리가 남기는 추가·수정·삭제 표시. 뷰포트가 아니라 고친 줄 수에 비용이 묶임 |
| **일치하는 괄호 상자** (`bracketMatchGlow`) | 괄호 자체는 이미 빛나는데 짝을 표시하는 상자는 안 빛났음. 에디터가 무언가를 가리키는 그 순간이 줄에서 제일 어두운 자리였음 |
| **에러·경고·정보 물결선** (`squiggleGlow`) | 물결 모양을 그대로 따라 빛나서, 그 위 단어는 번지지 않은 채로 에러가 멀리서도 보임. 힌트는 건드리지 않음 — VS Code가 일부러 조용하게 두는 표시임 |

찾기·선택·심볼 색은 글자 뒤에 깔리는 색이라 테마가 반투명으로 잡아둠. 그래서 그 셋에는
`spread`가 붙음 — 약한 색을 원래 폭만큼 먼저 밀어낸 다음에 번지게 함. 거터 막대에도
`spread`가 붙지만 이유가 다름. 글로우를 거는 상자가 `width: 0`이라, 넓이가 없는 상자의
그림자는 블러를 아무리 키워도 아무것도 안 그림. 커서와 괄호 상자는 색이 불투명이라
필요 없음. 물결선은 `box-shadow`부터 안 씀 — 물결은 상자가 아니라 SVG 그림이라, 그린
모양을 따라가는 `drop-shadow` 필터를 씀. 규칙이 서로 다르게 생긴 것은 그 때문이고,
이유는 규칙마다 `neon-glow.js`에 붙여뒀음.

| 켜야 도는 것 | |
|---|---|
| **커서 잔상** (`cursorTrail`) | 커서가 튀는 대신 새 위치까지 건너갈 시간을 줘서 글로우가 꼬리로 끌림. `130`은 렉처럼 읽히고, `45`는 타이핑을 따라가면서도 멀리 뛸 때 꼬리가 남음. 같은 값도 주사율에 따라 다르게 읽힘 — 60Hz에서 `45`는 세 프레임이 안 되고 144Hz에서는 예닐곱 프레임임. 주사율이 낮으면 올려 잡을 것 |
| **저장 흔들림** (`saveShake`) | 파일을 저장할 때 워크벤치가 옆으로 한 번 얻어맞음. `transform`만 건드리는 컴포지터 애니메이션이라 그동안 글로우가 다시 그려지지 않음 |
| **커서 아크** (`caretArc`) | 커서가 뛴 길에 `arc` `beam` `comet` `flash` 중 하나를 그림. 테마 자신의 커서 색을 쓰고, 몇백 밀리초 살다 사라지는 SVG임 |

이 셋은 무언가를 움직임. 움직임을 달라고 한 사람은 없으므로 `0`으로 나가고 말하기
전까지 그대로 있음. 셋 다 시스템이 모션 줄이기를 요청하면 무시됨.

### 켜고 끄기

토글은 진짜 VS Code 명령이라 평범한 키바인딩 체계 안에 있음. 명령 팔레트(`F1`)에서:

| 명령 | |
|------|--|
| `Neon Glow: Toggle` | 글로우를 즉시 켜고 끔 |
| `Neon Glow: Enable` / `Neon Glow: Disable` | 명시적으로 지정. 실제로 뭔가 바뀌는 쪽만 목록에 뜸 |
| `Neon Glow: Show status` | 지금 상태와 번들이 패치돼 있는지 |

**기본 키바인딩을 넣지 않았음.** 일부러 그랬고, 다른 확장과 충돌할 수 없는 이유가
그것임. *바로 가기 키*(`Ctrl+K Ctrl+S`)에서 `Neon Glow`로 찾아 원하는 대로 잡으면 됨.

토글은 설치 디렉터리의 파일을 건드리지 않으므로 관리자 권한도 재시작도 필요 없음.
오른쪽 상태 표시줄에 `NEON:ON` / `NEON:OFF`가 뜨고 눌러서 토글함. 거기에 경고 배경이
뜨면 스위치는 살아 있는데 빛날 수가 없는 상태임 — 번들이 패치가 안 됐거나, 옛 페이로드를
싣고 있거나, 이 창이 뜬 뒤에 패치됐거나. 툴팁이 어느 쪽인지 말하고, 누르면 그걸 고치는
일을 함.

명령은 확장 호스트에서 돌고 글로우는 렌더러 안에 있음. 둘 사이에 API가 없어서 상태가 두
경로로 동시에 건너감 — 상태 표시줄 항목의 라벨에 건 `MutationObserver`(토글이 16ms쯤에
도착함)와 `state.json` 폴링(앞엣것이 놓친 것을 메움)임. 자세한 것은 `neon-glow.js`에
있음.

DevTools 콘솔에서 직접 부를 수도 있음:

```js
__neonGlow.toggle();    // .enable() / .disable() / .isEnabled()
__neonGlow.bridgeOk();  // 둘 중 하나라도 살아 있는가?   빠른 쪽만 보려면 .statusBarOk()
```

### 설치

VS Code 설치 디렉터리에 쓸 수 있어야 함 — Windows에서는 터미널을 관리자로, macOS/Linux
에서는 `sudo`로 띄울 것.

#### 마켓플레이스에서

확장 뷰에서 **Neon Glow**를 검색하거나:

```sh
code --install-extension Ruminem.vscode-neon-glow
```

확장을 설치했다고 바로 빛나지는 않음. 페이로드는 `workbench.js` 안에 있고 거기 넣는 것은
패치뿐임. 확장이 활성화될 때 패치 안 된 번들을 알아보고 고칠지 물어봄. 팔레트에서
`Neon Glow: Show status`를 불러도 됨. 어느 쪽이든 쓰기 권한과 **완전 재시작**이 필요함.
평소 켜고 끄는 데는 둘 다 필요 없음.

#### 릴리스에서

Windows는 [Releases](https://github.com/Ruminem/vscode-neon-glow/releases)에서
`neon-glow-<version>-windows.zip`을 받아 풀고 `install.cmd`를 더블클릭. VS Code를 찾아
확장 설치와 번들 패치를 한 번에 함. 기계에 다른 게 깔려 있을 필요가 없음 — VS Code가
Electron이라 `Code.exe`가 패처를 돌릴 Node 노릇도 함.

macOS와 Linux는 `neon-glow-<version>-macos-linux.tar.gz`를 받아 풀고 `./install.sh`.
같은 세 가지를 하고, 설치 디렉터리가 root 소유일 때 뭘 해야 하는지 알려줌. **snap이나
flatpak으로 깐 VS Code는 아예 패치할 수 없음** — 읽기 전용으로 마운트됨. `.deb`, `.rpm`,
tarball을 쓸 것.

같은 릴리스에 `.vsix`도 붙어 있으니 직접 설치해도 됨.

#### 명령줄에서

확장 없이 번들만 직접 패치:

```sh
git clone https://github.com/Ruminem/vscode-neon-glow
cd vscode-neon-glow
node install.js          # 되돌리려면 node uninstall.js
```

특정 설치를 지정하려면 `--target "<resources/app 경로>"`. 확장이 없으면 명령도 없으므로
토글이 `Ctrl+Alt+N`으로 떨어짐.

어느 경로로 했든 마지막에: **VS Code를 완전히 종료하고 다시 켤 것.**

#### 직접 빌드하기

```sh
npm run package                  # -> neon-glow-<version>.vsix
node tools/make-icon.js          # -> icon.png   (bars, n 도 있음)
node tools/smoke.js              # 스텁 워크벤치에 페이로드를 올려 검사
```

커밋에 `v<version>` 태그를 달면 CI가 VSIX를 빌드해 GitHub 릴리스에 붙임. 태그와
`package.json`의 `version`이 어긋나면 잡이 거부함. 이 리포에는 어디에도 의존성이 없고
아이콘도 마찬가지임 — 모양은 signed distance field고 PNG는 `zlib` 위에 직접 조립함.

### 설정

설정(`Ctrl+,`)에서 `Neon Glow`로 검색. 값을 바꾸는 즉시 열려 있는 에디터에 반영됨.
재패치도 재시작도 없고, 먼저 열어둘 것도 없음 — 읽고 있던 그 파일이 미리보기임.

| 설정 | 기본값 | |
|------|--------|--|
| `neonGlow.glowLayers` | `3` | 토큰당 헤일로 겹 수. 항상 도는 가장자리 겹 위에 얹힘 — **비싼 것이 이것임** |
| `neonGlow.maxBlur` | `36` | 블러 반경 하나의 상한. 기본값이 이미 최대치라 그대로면 변화 없음 |
| `neonGlow.brightness` | `1.0` | 전체 세기. `0`이면 색은 그대로 두고 글로우만 없앰 |
| `neonGlow.minChroma` | `0.30` | 이보다 밋밋한 색은 빛나지 않음 — 본문 텍스트를 걸러내는 것이 이 값임 |
| `neonGlow.chromaSpan` | `0.50` | 임계값 위로 크로마가 얼마나 더 있어야 최대 세기에 닿는가 |
| `neonGlow.floor` | `0.40` | `minChroma`를 겨우 넘긴 색의 세기 |
| `neonGlow.minLightness` | `0.25` | 아무리 채도가 높아도 이보다 어두우면 건너뜀 |
| `neonGlow.cursorTrail` | `0` | 커서가 새 위치로 미끄러지는 시간(ms). 커서 글로우가 꼬리를 남김. `0`이면 그대로 튐 |
| `neonGlow.saveShake` | `0` | 저장할 때 워크벤치가 흔들리는 폭(px). `0`이면 가만히 있음. `files.autoSave`를 쓰면 끄는 게 나음 |
| `neonGlow.findGlow` | `18` | 찾기 결과가 번지는 폭(px). 테마 자신의 찾기 색을 씀. `0`이면 꺼짐 |
| `neonGlow.selectionGlow` | `12` | 선택 영역이 번지는 폭(px). 테마 자신의 선택 색을 씀. `0`이면 꺼짐 |
| `neonGlow.occurrenceGlow` | `10` | 커서가 놓인 심볼이 화면에 나온 자리마다 번지는 폭(px). `0`이면 꺼짐 |
| `neonGlow.gutterGlow` | `8` | 거터의 변경 막대가 번지는 폭(px). 테마 자신의 `editorGutter` 색을 씀. `0`이면 꺼짐 |
| `neonGlow.bracketMatchGlow` | `10` | 괄호와 그 짝을 감싸는 상자가 번지는 폭(px). `0`이면 꺼짐 |
| `neonGlow.squiggleGlow` | `5` | 에러·경고·정보 물결선이 번지는 폭(px). 테마 자신의 색을 씀. `0`이면 꺼짐 |
| `neonGlow.caretArc` | `off` | 커서가 뛴 길에 무엇을 그릴지: `arc` `beam` `comet` `flash` |
| `neonGlow.caretArcMinJump` | `5` | 아크를 그리기까지 필요한 이동 거리(px). 한 글자보다 작아 화살표도 걸림 |
| `neonGlow.caretArcOnDrag` | `false` | 마우스로 선택을 끄는 동안에도 계속 그릴지. 드래그를 시작한 클릭은 어느 쪽이든 그림 |

**돈이 드는 것은 `glowLayers`임.** 에디터는 가상화하므로 10,000줄 파일이 곧 10,000개의
빛나는 span은 아니고, 비용은 파일 크기가 아니라 뷰포트 크기에 비례함. 그런데 가장 넓은
겹이 면적 산수가 예측하는 3분의 2가 아니라 사실상 전부임 — 블러 시간이 반경보다 훨씬
빠르게 오르고, 이웃 토큰끼리 가장 넓은 블러가 겹침. 토큰이 빽빽한 C++ 뷰포트에서 스크롤을
구동하며 재보면 `3`이 `2`의 몇 배를 씀. 느린 기계에서는 `2`로 내릴 것. `maxBlur`는 같은
레버를 더 잘게 쓴 것이고, `brightness`는 아님 — 빨라지는 것보다 흐려지는 쪽이 훨씬 큼.
측정값과 그 단서는 `neon-glow.js`에 남겨뒀고, `tools/bench.js`가 쌍대로 다시 잼.

설정이 재시작 없이 도는 것은 패치 안에 살지 않기 때문임. 확장이 토글과 같은
`state.json`에 써 넣고, 렌더러가 다음 폴링에서 값을 죄어 적용함. 같은 값이
`neon-glow.js` 맨 위에도 기본값으로 있는데 그게 CLI 전용 설치가 쓰는 것임 — 그걸 고치면
`node install.js`를 다시 돌리고 재시작해야 함.

### 발목 잡는 것들

**"창 다시 로드"로는 반영되지 않음.** 소프트 리로드라서 Chromium이 `vscode-file` 번들을
캐시에서 줌. 패치 전에 띄운 창은 몇 번을 리로드해도 옛 번들을 계속 씀. VS Code 프로세스를
전부 종료하고 다시 띄울 것.

**VS Code가 설치가 손상됐다고 경고함.** 예상된 일임. `product.json`이 `workbench.js`의
SHA-256을 들고 있는데 패치하면 그 값이 안 맞음. *다시 표시 안 함*으로 닫으면 됨.
체크섬을 다시 써넣으면 영구히 조용해지지만, 이 변경만이 아니라 **앞으로의 모든 변조**에
대한 탐지가 꺼짐.

**확장을 업데이트해도 패치는 갱신되지 않고,** 패치해도 확장은 갱신되지 않음. 두 짝은 서로
다른 명령이 쓰고 어느 쪽도 상대를 건드리지 않음. 그래서 설정 화면에는 새 설정이 떠 있는데
페이로드는 그 이름을 들어본 적이 없거나, 그 반대가 될 수 있음. 주입된 배너가 페이로드
해시를 들고 있어서 확장이 어긋남을 알아보고 다시 패치할지 물어봄.

**VS Code 업데이트는 패치를 지움.** 업데이터가 `workbench.js`를 갈아치움. 새로 설치한
것과 같은 상태라 확장이 다음 실행에서 다시 패치할지 물어봄. 다시 패치하는 것은 안전함 —
항상 손 안 댄 `.pre-neon.bak`에서 다시 만들지, 이미 패치된 파일에서 만들지 않음.

**확장을 제거하면 번들이 복원됨.** `vscode:uninstall` 훅이 함. 최선을 다할 뿐이라, 설치
디렉터리에 쓸 수 없으면 훅이 실패하고 번들은 패치된 채로 남음. 그때는 권한을 주고
`node uninstall.js`를 돌릴 것. *비활성화*는 제거가 아님 — 패치는 남아 있고 글로우도
마지막으로 본 상태 그대로 계속 돎.

**`files.autoSave`와 `saveShake`는 같이 쓰지 말 것.** 자동 저장 하나하나가 전부 저장이라
화면이 멈추지 않음.

**SynthWave '84과 같이 깔 수는 있지만 칠하는 것은 하나여야 함.** 파일도 백업도 서로
달라서 패치끼리 망가뜨리지는 않음. 그런데 둘 다 `.vscode-tokens-styles`에서 `<style>`을
만들고 특이도가 같아서, 나중에 붙은 쪽이 이김. `Neon Glow: Show status`가 지금 경합
중인지 알려주고, `Neon Glow: Disable`은 파일을 건드리지 않고 즉시 비켜줌.

### 상태

**Windows 11의 VS Code 1.136.1**에서 개발하고 검증했음. 적용된 `text-shadow` 값을 Chrome
DevTools Protocol로 살아 있는 렌더러에서 다시 읽어내 확인함.

| | 동작 | 검증 | |
|---|---|---|--|
| **Windows** | 함 | 함 | 사용자·시스템 설치 모두. 커밋 해시가 붙은 resources 디렉터리 포함 |
| **macOS** | 할 것임 | 안 함 | 서명된 `.app` 내부 파일을 고치므로 코드 서명이 깨짐. 실제로는 계속 실행되지만 그게 치르는 값임 |
| **Linux**, `.deb` / `.rpm` / tarball | 할 것임 | 안 함 | `/usr/share/code`가 root 소유라 팔레트 명령으로는 안 됨. `sudo node install.js`나 `sudo ./install.sh`를 쓸 것 |
| **Linux**, snap 또는 flatpak | **안 함** | — | 읽기 전용으로 마운트돼서 무엇도 패치할 수 없음. 확장이 조용히 실패하는 대신 그렇다고 말함 |

macOS와 Linux는 동작하도록 작성했을 뿐 아무도 돌려보지 않았음. 어긋나면 이슈를 열어주면
고맙겠음.

### 출처

구문 강조가 빛날 수 있다는 것, 그리고 워크벤치를 패치하는 것이 거기 닿는 길이라는 것 —
그 아이디어는 Robb Owen의
[SynthWave '84](https://github.com/robb0wen/synthwave-vscode)에서 왔음.

### 라이선스

MIT
