# Changelog

Patch releases before 0.18 are grouped by their minor version; the tags carry the full history.

## 0.19.0 — 2026-09-24

- A VS Code update no longer turns the glow off until you patch and restart again. On a Windows user
  install with background updates on, the next version is patched while it waits to be installed, so
  the first launch after the update already glows. Other installs still get the prompt.

**한국어**

- VS Code 업데이트 뒤에 다시 패치하고 재시작할 때까지 글로우가 꺼지던 것이 없어짐. 윈도우 사용자
  설치에서 백그라운드 업데이트가 켜져 있으면 설치를 기다리는 다음 버전을 미리 패치하므로, 업데이트
  뒤 첫 실행부터 글로우가 나옴. 그 밖의 설치는 전처럼 물어봄.

## 0.18.0 — 2026-09-18

- The glow reaches the terminal, in a terminal drawn by xterm's DOM renderer.

## 0.17.0 – 0.17.5 — 2026-09-17

- A Korean window shows the commands, notifications and tooltips in Korean. The floor moves to VS Code 1.73.
- `caretArcColor` draws the caret arc in a colour of its own; without it the arc follows the theme's caret colour.
- The moving effects stand still when VS Code's own `workbench.reduceMotion` is on, not only when the system asks.
- A theme swap relights the glow even when both themes have as many token colours.
- A preset lands in one write instead of twenty-odd, and the cursor trail slides without a layout on every frame.

## 0.16.0 – 0.16.2 — 2026-09-14

- After an update the payload is imported from the extension's new folder on the first start, instead of
  running the old copy until a second restart. Every install is asked to re-patch once.
- The setting descriptions are a sentence each, and a Korean VS Code shows them in Korean.

## 0.15.0 — 2026-09-13

- Snippet tabstops and the rename box glow and breathe.
- Find's glow colours have a lightness floor, so a theme that paints matches black still shows a glow.

## 0.14.0 – 0.14.2 — 2026-09-13

- The loader moved into the bundle, so a payload release no longer asks for a re-patch. This one does, once.
- Three presets, because twenty-three numbers is not a starting point.

## 0.13.0 – 0.13.6 — 2026-09-12

- The caret arc takes a duration and eight more styles.
- The word a mouse selection marks, the line the editor is pointing at and the breakpoints beside it are lit.
- Two glows and the bracket box breathe slowly; only those, because the cost is the number of things doing it.

## 0.12.0 – 0.12.1 — 2026-09-12

- What changed inside a diff is lit, the view that had the least lit in it.
- The caret arc runs between where the caret was and where it is going.

## 0.11.0 – 0.11.6 — 2026-09-12

- Error, warning and info squiggles glow along the wave itself, on by default.
- A settings change lands in a frame instead of waiting on the poll.
- The caret arc is drawn for downward and diagonal moves, and held back while a selection is dragged out.

## 0.10.0 – 0.10.3 — 2026-09-10

- Every place the symbol under the caret appears is lit, in the theme's own highlight colours.
- The gutter's change bars and the matching bracket box glow; five surface glows are on by default.
- The Korean readme is a section of `README.md` rather than a file of its own.

## 0.9.0 – 0.9.11 — 2026-09-08

- The glow traces the letterform instead of sitting the glyph in a smear, with the falloff rebalanced.
- A caret trail draws a line of light along the way the caret jumped, in four styles, and the workbench jolts on save.
- Find results and the selection are lit from the theme's own colours.
- A blur ceiling, and the expensive part of the glow behind a setting.
- Every window's readout agrees, because they follow the same state file.
- First published to the Marketplace.

## 0.6.0 — 2026-09-06

- The glow no longer flattens bracket pair colours.
- It says when another glow extension is patched in, and when the bundle carries an older payload.

## 0.5.0 — 2026-09-06

- The tuning knobs are in Settings.

## 0.4.0 – 0.4.2 — 2026-09-06

- An icon, and a warning when the window predates the patch.
- Patching is out of the command palette.

## 0.3.0 — 2026-09-06

- First release. Neon glow for syntax highlighting, derived from the active theme's own token colours,
  with a toggle on a keybinding.
