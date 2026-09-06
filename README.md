# vscode-neon-glow

**English** · [한국어](README.ko.md)

Neon glow for VS Code syntax highlighting — **for any colour theme**.

Inspired by [SynthWave '84](https://github.com/robb0wen/synthwave-vscode), but it does not
ship a theme and is not tied to one. It reads whatever colours your current theme
produces and makes the vivid ones glow, so you can keep changing themes and the glow
follows along.

![what it does](https://img.shields.io/badge/VS%20Code-1.136%2B-blue)

## How it differs from SynthWave '84

SynthWave hardcodes five hex values and refuses to run unless its own theme is active:

```js
const tokenReplacements = { 'fe4450': "...", 'ff7edb': "...", /* ...3 more */ };
const usingSynthwave = () => document.querySelector('[class*="RobbOwen-synthwave-vscode-themes"]');
```

This one derives the glow from the theme's own token colours at runtime, and re-derives
them when you switch themes — no reload needed.

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
needs them already offers them at the moment it matters: the prompt on
activation, the status bar item, `Show status`, and the Uninstall button, which
restores the bundle on its way out. They stay bindable to a key.

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
match), and the renderer keeps a `MutationObserver` on `.statusbar`. A toggle
lands in the frame the extension host paints it, roughly 16ms. The status bar
mutates constantly — cursor position, language mode — so a burst of records is
collapsed into one read per frame with `requestAnimationFrame`.

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
| `neonGlow.brightness` | `1.0` | overall strength; `0` leaves the colours alone and drops the glow |
| `neonGlow.minChroma` | `0.30` | colours flatter than this never glow — this is what keeps body text out |
| `neonGlow.chromaSpan` | `0.50` | how much chroma above the threshold reaches full strength |
| `neonGlow.floor` | `0.40` | strength of a colour that only just passes `minChroma` |
| `neonGlow.minLightness` | `0.25` | skip colours darker than this, however saturated |

They work without a restart because they do not live in the patch. The extension
writes them into the same `state.json` the toggle uses, and the renderer clamps
and applies them on its next poll, rebuilding the stylesheet from the theme's
token colours. So the bundle only ever has to be written once.

The same values are also the defaults at the top of `neon-glow.js`, which is
what a CLI-only install uses — there is no extension there to send anything.
Editing those means re-running `node install.js` and restarting.

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
Run `node uninstall.js` with the rights it needs, or `Neon Glow: Show status`
before uninstalling. Note that *disabling* the extension is not uninstalling it:
the patch stays, and the glow keeps working off the last state it saw.

## Status

Developed and verified against **VS Code 1.136.1 on Windows 11**, with the applied
`text-shadow` values read back out of the live renderer over the Chrome DevTools
Protocol. The macOS and Linux install paths are implemented but untested — please open
an issue if they misfire.

## Credit

The idea, and the original workbench-patching approach, come from
[SynthWave '84](https://github.com/robb0wen/synthwave-vscode) by Robb Owen.

## License

MIT
