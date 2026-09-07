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

[Which tokens glow](#which-tokens-glow) · [Turning it on and off](#turning-it-on-and-off) · [Install](#install) · [Tuning](#tuning) · [Things that will bite you](#things-that-will-bite-you) · [Status](#status)

## Which tokens glow

Strength is driven by **chroma** (`max(r,g,b) - min(r,g,b)`), not HSL saturation.
That distinction matters: HSL saturation divides by `1 - |2L-1|`, which explodes for
near-white colours. Monokai's default text `#F8F8F2` has a real colour spread of only
`0.024`, but its HSL saturation computes to `0.31` — enough to sneak past a saturation
threshold and make *body text* glow. Chroma doesn't have that failure mode.

Measured on Monokai:

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

Because it infers role from colour, themes that reuse one colour across different roles
can't be told apart. Themes with distinct per-role colours (Monokai, Tokyo Night,
Dracula, …) work well.

Bracket pair colouring is left to VS Code. It paints
`.monaco-editor .bracket-highlighting-N`, two classes against the single-class
`.mtkN` rules the token stylesheet is made of, so an `!important` on the glow's
colour would beat it on force alone and collapse every nesting level onto one
colour. The glow sets colour without `!important`, and gives brackets a rule of
their own in `currentColor`, so each level glows in the colour it is painted.

## What else can glow

The token glow is always on. Four more effects are not: they ship at `0` and stay
dark until you set them in Settings, because they change what the editor does
rather than only how it is painted.

**Find results and the selection** (`findGlow`, `selectionGlow`) are the same idea
as the token glow applied to two more surfaces — the colour still comes from the
theme, not from here. Find results are the one place where the glow does work
rather than decoration: a match becomes visible without hunting the scrollbar for
its mark.

Both of those theme colours are semi-transparent, because they sit behind text and
must not hide it, and a shadow that only blurs them comes out nearly invisible. So
these two take a `spread`: the weak colour is carried outwards at full width before
the blur starts, instead of asking the blur to do both jobs. The caret, whose
colour is opaque, needs none — which is why the rules do not match.

**The caret trail** (`cursorTrail`) gives the caret a duration to cross instead of
letting it jump, so the glow already on it smears into a short streak. Motion only;
the colour is the theme's own. Every keystroke restarts the transition, so a long
duration leaves the caret trailing the text you are typing: `130` reads as lag,
`45` keeps up and still streaks when you jump across a file. VS Code has its own
`editor.cursorSmoothCaretAnimation`, fixed at 80ms — whatever you set here wins
over it.

**The save jolt** (`saveShake`) knocks the workbench sideways when a file is saved.
It is a CSS animation on `transform` alone rather than a loop writing inline
styles, so once it starts the frames ask nothing of the main thread. That is as
far as the claim goes: whether either approach re-draws the glow underneath was
never measured. Of the four this is the only one derived from nothing — it is
decoration, and it is off unless you want it.

The two that move — the caret trail and the save jolt — are dropped when the system
asks for reduced motion. A save reaches the renderer over the same wire as the
toggle, described in [How the toggle reaches the
editor](#how-the-toggle-reaches-the-editor); the payload lives in the workbench and
cannot hear the extension host any other way.

## Turning it on and off

The toggle is a real VS Code command, so it lives inside the normal keybinding
system. From the command palette (`F1`):

| Command | |
|---------|--|
| `Neon Glow: Toggle` | flip the glow on/off, instantly |
| `Neon Glow: Enable` / `Neon Glow: Disable` | set it explicitly — only whichever one would actually change something is listed |
| `Neon Glow: Show status` | current state, and whether the bundle is patched |

The palette filters `Enable`/`Disable` through context keys, so you never have to
work out which of the two is the live one. Both remain bindable to a key; a
`when` clause on `commandPalette` hides a command from the palette only, not from
the keybinding system.

There are two keys, `neonGlow.on` and `neonGlow.off`, and both are positive on
purpose. A `when` clause cannot tell an unset key from a false one, so a single
`enabled` key would make `!enabled` true in the window between a reload and the
extension activating — the palette would offer `Enable` over an editor that is
already glowing, because the renderer restores its own state from `localStorage`
without waiting for anyone. With two keys that window reads as *not known yet*:
neither is listed, and `Toggle`, which reads the state file rather than a context
key, works throughout.

Patching and restoring the bundle are **not** in the palette. Sitting next to
VS Code's own Enable / Disable / Uninstall buttons, "Install" and "Remove" read
as extension management and mean something else entirely, and everything that
needs them already offers them at the moment it matters. Patching: the prompt on
activation, the status bar item, and `Show status`. Restoring: the Uninstall
button, which takes the bundle with it. Both stay bindable to a key.

`Show status` offers to patch when the bundle needs it, and offers nothing when
it does not. It is a readout, and a destructive action does not belong under the
only button on one.

**No default keybinding ships with this**, deliberately - that is what makes it
impossible to collide with another extension. Bind whatever you like in
*Keyboard Shortcuts* (`Ctrl+K Ctrl+S`), search `Neon Glow`, and VS Code will warn
you itself if the chord is already taken.

Toggling never touches a file in the install directory, so it needs no admin
rights and no restart.

A status bar item on the right shows `NEON:ON` / `NEON:OFF` and toggles on click.
It is not decoration — see below.

It also carries the three states in which the switch is real but nothing can
glow, because they all look identical from the editor. A **warning background**
means the bundle is not patched, or it carries the payload from an older release
of the extension, or it was patched after this window started and the renderer
is still on the one it booted with. The tooltip says which, and clicking does
the thing that fixes it. The last check is one-sided on purpose:
"Reload Window" restarts the extension host but leaves the renderer on its
cached bundle, so a window reloaded after a patch looks healthy from the
extension side and stays quiet rather than guessing.

### How the toggle reaches the editor

Commands run in the extension host; the glow lives in the renderer. There is no
API between the two, so the state crosses on two channels at once.

**Fast: the status bar.** The extension's status bar item *is* the wire. Its label
is the state, in plain text (a codicon would render as an element and break the
match), and the renderer keeps a `MutationObserver` on that one item. A toggle
lands in the frame the extension host paints it, roughly 16ms.

On the item, not on the bar: the bar as a whole mutates on every cursor move, so
watching its subtree meant waking once a frame for the whole time someone is
typing, rebuilding the text of every item and running a regex over it, to learn
nothing. The item itself changes only when the glow is toggled. Records are
still coalesced into one read per frame with `requestAnimationFrame`, and if
VS Code ever replaces the item the observer goes quiet with it — so the poll
below re-seeks when the element is no longer connected.

**Slow: the state file.** The extension also writes `state.json` into its
`globalStorage`, which is one of the roots the `vscode-file` protocol handler is
willing to serve, so the injected script can poll it:

```js
addValidFileRoot(e.appRoot)
addValidFileRoot(e.extensionsPath)
addValidFileRoot(...globalStorageHome...)   // <- the state file lives here
```

The poll reconciles whatever the fast half misses: a hidden status bar, or a
background window, where `requestAnimationFrame` does not tick. It runs at 800ms
until the status bar half proves it works and then backs off to 1500ms, so
hiding the status bar degrades latency instead of breaking the toggle.

Neither half applies its *first* reading, only records it. Startup state comes
from `localStorage`, so a stale file — or a status bar not yet written — cannot
clobber the last known state, and there is no flash of the wrong state on boot.

If both halves are unavailable (patched from the CLI with no extension installed,
say), the script falls back to `Ctrl+Alt+N`, registered on the **bubble** phase so
anything VS Code has already bound wins and the fallback simply never fires. It
also stands down entirely once either half answers. Change `FALLBACK_KEY` in
`neon-glow.js` to move it, or set it to `null` to drop it.

Turning off flips the stylesheet's `disabled` flag rather than removing the
element, so turning back on re-uses the parsed CSS instead of re-running the
regex pass over the theme's token styles.

You can also drive it from the DevTools console:

```js
__neonGlow.toggle();    // .enable() / .disable() / .isEnabled()
__neonGlow.bridgeOk();  // is either half live?   .statusBarOk() for the fast one
```

## Install

Requires write access to the VS Code install directory - run the terminal as
administrator on Windows, or with `sudo` on macOS/Linux.

### From a release (recommended)

On Windows, download `neon-glow-<version>-windows.zip` from
[Releases](https://github.com/Ruminem/vscode-neon-glow/releases), unzip it, and
double-click `install.cmd`. It finds VS Code, installs the extension and patches
the bundle in one pass. Nothing else has to be on the machine: VS Code is
Electron, so `Code.exe` doubles as the Node that runs the patcher.

On macOS and Linux, download `neon-glow-<version>-macos-linux.tar.gz`, unpack
it, and run `./install.sh`. It does the same three things, and says what to do
if the install directory belongs to root. A VS Code installed as a **snap or a
flatpak cannot be patched at all** — those are mounted read-only; use the
`.deb`, the `.rpm` or the tarball.

Anywhere else, or if you would rather drive it yourself, install the `.vsix`
from the same release:

```sh
code --install-extension neon-glow-<version>.vsix
```

Or inside VS Code: Extensions view → the `...` menu → *Install from VSIX…*.

Installing the extension does not by itself make anything glow — the payload
lives in `workbench.js`, and only a patch puts it there. The extension notices
an unpatched bundle when it activates and offers to fix it; you can also run
`Neon Glow: Show status` from the palette. Either route needs
write access and a **full restart**. Everyday on/off needs neither.

This is not on the Marketplace, and will not be: an extension that rewrites
`workbench.js` cannot honestly pass review.

### From a clone

Clone straight into your extensions folder, then reload:

```sh
# Windows
git clone https://github.com/Ruminem/vscode-neon-glow "%USERPROFILE%\.vscode\extensions\vscode-neon-glow"
# macOS / Linux
git clone https://github.com/Ruminem/vscode-neon-glow ~/.vscode/extensions/vscode-neon-glow
```

Then run the same `Neon Glow: Show status` command.

### From the command line

No extension at all — patch the bundle directly:

```sh
git clone https://github.com/Ruminem/vscode-neon-glow
cd vscode-neon-glow
node install.js          # node uninstall.js  to revert
```

Point at a specific install with `--target "<path to resources/app>"`. Without
the extension there are no commands, so the toggle falls back to `Ctrl+Alt+N`.

After any of these routes: **quit VS Code completely and start it again.**

### Building the VSIX yourself

```sh
npm run package          # -> neon-glow-<version>.vsix
```

Tagging a commit `v<version>` builds it in CI and attaches it to a GitHub
release; the tag must match the `version` in `package.json` or the job fails.

The icon is generated rather than drawn, so it stays in step with the palette
the README quotes:

```sh
node tools/make-icon.js          # -> icon.png   (also: bars, n)
```

No dependencies: the shapes are signed distance fields, the bloom is the same
falloff the extension paints with, and the PNG is assembled on top of `zlib`.

## Tuning

Open Settings (`Ctrl+,`) and search `Neon Glow`. Changes apply to the open
editor within a second or so — no re-patch, no restart.

| Setting | Default | |
|---------|---------|--|
| `neonGlow.glowLayers` | `3` | halo passes per token, over an edge pass that always runs — the expensive one, see below |
| `neonGlow.maxBlur` | `36` | ceiling on any one blur radius; the default is already the widest emitted |
| `neonGlow.brightness` | `1.0` | overall strength; `0` leaves the colours alone and drops the glow |
| `neonGlow.minChroma` | `0.30` | colours flatter than this never glow — this is what keeps body text out |
| `neonGlow.chromaSpan` | `0.50` | how much chroma above the threshold reaches full strength |
| `neonGlow.floor` | `0.40` | strength of a colour that only just passes `minChroma` |
| `neonGlow.minLightness` | `0.25` | skip colours darker than this, however saturated |
| `neonGlow.cursorTrail` | `0` | ms for the caret to slide to a new position, so its glow streaks; `0` keeps the jump |
| `neonGlow.saveShake` | `0` | px the workbench jolts on save; `0` holds it still, and so should `files.autoSave` |
| `neonGlow.findGlow` | `0` | px of bloom on find results, in the theme's own find colours; `18` to start |
| `neonGlow.selectionGlow` | `0` | px of bloom on selected text, in the theme's own selection colour; `12` to start |

The last four ship at `0` and do nothing until set — they are new behaviour to opt
into rather than adjustments to the glow that is already running. See
[What else can glow](#what-else-can-glow).

They work without a restart because they do not live in the patch. The extension
writes them into the same `state.json` the toggle uses, and the renderer clamps
and applies them on its next poll, rebuilding the stylesheet from the theme's
token colours. So the bundle only ever has to be written once.

The same values are also the defaults at the top of `neon-glow.js`, which is
what a CLI-only install uses — there is no extension there to send anything.
Editing those means re-running `node install.js` and restarting.

### What it costs

The editor virtualises, so a 10,000 line file is not 10,000 glowing spans — only
the visible lines are ever in the DOM. The cost scales with the viewport and how
token-dense the language is, not with file size.

It is still real work. Measured over a driven scroll on 50 lines of
`nlohmann/json`'s 27,000-line single header — 390 token spans, 220 of them
glowing, 77 of them brackets — summing the compositor's `RasterTask` time:

| | Raster |
|---|--------|
| glow off | 12 ms |
| `glowLayers` 2 | 16 ms |
| `glowLayers` 3 (default) | **87 ms** |

The widest pass is not two thirds of the cost, which is what the area
arithmetic predicts; it is very nearly all of it. Blur time climbs much faster
than radius, and at `36px` the blurs of neighbouring tokens overlap heavily.

`maxBlur` is the same lever with a finer grain — a ceiling on the radius rather
than a pass removed outright. From a separate run, so comparable only within
its own column:

| Ceiling | Raster | |
|---------|--------|--|
| `36` (default) | 71 ms | unchanged |
| `32` | 65 ms | −9% |
| `30` | 58 ms | −18% |
| `28` | 47 ms | −34% |
| `26` | 39 ms | −45% |

**Both tables were measured against the falloff that shipped before `0.9.9`, and
the milliseconds in them now read high.** The alphas were `0.95 / 0.75 / 0.65 /
0.40` over passes of `2 / 5 / 16 / 36px`; they are now `1.00 / 0.65 / 0.32 /
0.14` over `1 / 5 / 11 / 26px`.

That was a change made to look better, not to run faster. A blur is brightest at
its source, so every pass paints at the glyph as well, and the old alphas summed
to about `2.75` there — everything past `1.0` being equally opaque, the widest
pass was as solid at the letter edge as the tightest, leaving no gradient for an
eye to find an edge in. Counters filled, and neighbouring blurs lit the space
between words as brightly as the words. What is visible is the ratio between the
innermost and outermost pass, not the total.

Narrowing the two widest radii came with it, and that is where the time went.
Measured with `tools/bench.js`, which alternates the two formulas over one
viewport and compares adjacent pairs, the new distribution costs **57% less
raster time** — four pairs at −56.3%, −57.3%, −56.8%, −57.4%. The ordering these
tables establish is unchanged: passes and radius are still where the cost is.

`maxBlur` no longer binds at its default, because the formula now stops at
`26px` by itself. It still matters above `brightness` `1`, which scales every
radius, and to anyone who wants the bloom capped tighter than the formula does.

`brightness` shrinks the radii too, but only by about a third at half strength —
the two tight passes barely move — so it fades the glow far more than it speeds
it up.

Nothing else measured. Dropping `backface-visibility: hidden`, a layer-promotion
hack inherited from SynthWave, came out inside the noise on a current Chromium,
so it stays; and the numbers above only separate from noise when the same
variants are measured in adjacent pairs, because raster time drifts downwards as
caches warm.

**Flatter themes need different numbers.** The defaults are calibrated on
Monokai, which is unusually saturated. Abyss, for instance, tops out around half
of it: its class-name colour `#ffeebb` has a chroma of `0.27` and never reaches
the `0.30` threshold at all, while its comment colour `#384887` clears it at
`0.31` — so the roles that glow are close to inverted. Dropping `minChroma` to
about `0.25` and raising `brightness` past `1` gets it back.

## Things that will bite you

**"Reload Window" does not apply changes.** It is a soft reload, and Chromium serves the
`vscode-file` bundle from cache — the `vscode-file` scheme is registered with
`codeCache: true`. A window that was launched before you patched will keep running the
old bundle no matter how many times you reload it. Quit every VS Code process and
relaunch.

**VS Code will warn that the installation is corrupt.** Expected: `product.json` carries
a SHA-256 (base64, padding stripped) of `workbench.js`, and patching it breaks the match.
Dismiss the notification with *Don't Show Again*. You could rewrite the checksum in
`product.json` to silence it permanently, but that disables tamper detection for **all**
future modifications, not just this one — not worth it for a notification.

**Updating the extension does not update the patch.** The payload lives in
`workbench.js`, and installing a new VSIX never touches it, so anything the new
release added to the renderer sits there inert — a setting can appear and do
nothing. The injected banner carries a hash of the payload it was written from,
so the extension notices the mismatch and offers to patch again. Accepting it
needs a full restart like any other patch.

It is a hash of the payload rather than the release number on purpose: most
releases change only the extension, and a version stamp would demand a re-patch
and a restart for a bundle that is already byte-for-byte correct.

**VS Code updates wipe the patch.** The updater replaces `workbench.js`. This is
the same state as a fresh extension install — an unpatched bundle — so the
extension offers to re-patch on the next launch. You can also run
`Neon Glow: Show status`, or `node install.js` if you went the CLI
route. Reinstalling is safe: it always rebuilds from the pristine
`.pre-neon.bak`, never from an already-patched file.

Restoring the bundle on purpose suppresses that offer, so it does not turn into a
prompt you have to dismiss on every launch.

**Uninstalling the extension restores the bundle.** `package.json` declares a
`vscode:uninstall` hook, which VS Code runs as a node script when the extension
is removed, so the Uninstall button in the Extensions view cleans up after
itself. It is best effort: if the install directory is not writable — a
system-wide install, no elevation — the hook fails and the bundle stays patched.
Run `node uninstall.js` with the rights it needs. Note that *disabling* the extension is not uninstalling it:
the patch stays, and the glow keeps working off the last state it saw.

**`files.autoSave` and `saveShake` do not mix.** On a delay or on a focus change,
every one of those is a save, and the screen never stops moving. The jolt is off by
default, so this only bites if you turn it on — but if you use autosave you will
want it off again within the minute.

**SynthWave '84 can sit alongside this, but only one of them should paint.** It
never touches `workbench.js`: it writes a `neondreams.js` next to it and adds a
`<script>` tag to the workbench HTML. Different files, different backups, so
neither patch can corrupt or silently undo the other — the two can be installed
together safely. What they share is the DOM. Both build a `<style>` from
`.vscode-tokens-styles` and set `text-shadow` with `!important` at equal
specificity, so whichever is appended last wins, which is a race rather than a
rule. SynthWave stands down unless its own theme is active, so they only really
compete when you are using it — and this extension already derives a glow from
that theme's colours, which is what SynthWave's own patch is for.

`Neon Glow: Show status` reports whether the other one is patched in and whether
it is currently competing. `Neon Glow: Disable` turns this one off instantly
without touching a file, so switching between the two costs nothing.

## Status

Developed and verified against **VS Code 1.136.1 on Windows 11**, with the applied
`text-shadow` values read back out of the live renderer over the Chrome DevTools
Protocol, and the raster measurements above taken the same way.

| | Works | Verified | |
|---|---|---|--|
| **Windows** | yes | yes | user and system installs, including the commit-hash resources directory |
| **macOS** | should | no | patching edits a file inside the signed `.app`, which invalidates its code signature — it keeps running in practice, but that is the trade |
| **Linux**, `.deb` / `.rpm` / tarball | should | no | `/usr/share/code` belongs to root, so the palette command cannot do it; use `sudo node install.js` or `sudo ./install.sh` |
| **Linux**, snap or flatpak | **no** | — | mounted read-only, so nothing can patch them. The extension says so rather than failing obscurely |

The extension asks the running editor where it lives (`vscode.env.appRoot`)
rather than guessing, so portable builds and unusual prefixes are found
correctly on every platform. Only the CLI has to guess, from the list in
`locate.js`.

macOS and Linux are written to work and have not been run by anyone — please
open an issue if they misfire.

## Credit

The idea — that syntax highlighting can glow, and that patching the workbench is
a way to get there — comes from
[SynthWave '84](https://github.com/robb0wen/synthwave-vscode) by Robb Owen. The
technique differs: SynthWave drops a script beside the workbench and loads it from
the HTML, while this appends to `workbench.js` directly.

## License

MIT
