# vscode-neon-glow

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

## Install

Requires write access to the VS Code install directory — run the terminal as
administrator on Windows, or with `sudo` on macOS/Linux.

```sh
git clone https://github.com/Ruminem/vscode-neon-glow
cd vscode-neon-glow
node install.js
```

Then **quit VS Code completely and start it again**.

To point at a specific install:

```sh
node install.js --target "/path/to/resources/app"
```

## Uninstall

```sh
node uninstall.js
```

Restores `workbench.js` from the `.pre-neon.bak` backup that `install.js` created.

## Tuning

The knobs are at the top of `neon-glow.js`. Edit, re-run `node install.js`, restart.

```js
var BRIGHTNESS    = 1.0;   // overall strength
var MIN_CHROMA    = 0.30;  // raise -> fewer colours glow (more selective)
var CHROMA_SPAN   = 0.50;  // how quickly strength ramps up with chroma
var FLOOR         = 0.40;  // strength of a colour that barely passes MIN_CHROMA
var MIN_LIGHTNESS = 0.25;  // skip colours darker than this
```

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

**VS Code updates wipe the patch.** The updater replaces `workbench.js`. Re-run
`node install.js` after an update. Reinstalling is safe: it always rebuilds from the
pristine `.pre-neon.bak`, never from an already-patched file.

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
