# vscode-neon-glow

**English** · [한국어](README.ko.md)

Neon glow for VS Code syntax highlighting — **for any colour theme**.

It ships no theme of its own. It reads whatever colours your current theme produces
and makes the vivid ones glow, so you can keep changing themes and the glow follows
along — no reload needed.

![requires VS Code 1.70 or newer](https://img.shields.io/badge/VS%20Code-1.70%2B-blue)

The same file with the glow off, then on:

![syntax highlighting as the theme paints it, with no glow](https://raw.githubusercontent.com/Ruminem/vscode-neon-glow/main/images/glow-off.png)

![the same lines with the glow on: keywords, strings and numbers lit in the colours the theme already gave them](https://raw.githubusercontent.com/Ruminem/vscode-neon-glow/main/images/glow-on.png)

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

The token glow is not the only thing on. Five more surfaces light with it, and three
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

Find, selection and occurrence colours are semi-transparent, because they sit behind
text and must not hide it, so those rules take a `spread` — the weak colour is carried
outwards at full width before the blur starts. The gutter bars take one for a
different reason: the box their glow hangs on is `width: 0`, and a shadow of a box
with no area paints nothing whatever the blur. The caret and the bracket box, whose
colours are opaque, need none. This is why the rules do not match each other, and the
reasoning is kept beside each one in `neon-glow.js`.

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

Open Settings (`Ctrl+,`) and search `Neon Glow`. Changes apply to the open editor
within a second or so — no re-patch, no restart.

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
| `neonGlow.caretArc` | `off` | what to draw along a caret jump: `arc`, `beam`, `comet` or `flash` |
| `neonGlow.caretArcMinJump` | `5` | px of travel before an arc is drawn — under a character, so an arrow key counts |

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
