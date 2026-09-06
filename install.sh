#!/usr/bin/env sh
# Install the extension and patch the workbench, on macOS and Linux.
# The Windows counterpart is install.cmd.
set -eu

say() { printf '  %s\n' "$*"; }
die() { printf '\n  %s\n\n' "$*" >&2; exit 1; }

printf '\n  Neon Glow\n  =========\n\n'

# ------------------------------------------------------------------ the CLI
# `code` on PATH is the normal case; the rest are where the packages put it.
CODE=""
if command -v code >/dev/null 2>&1; then
  CODE=$(command -v code)
else
  for c in \
    "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
    "$HOME/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
    "/usr/share/code/bin/code" \
    "/usr/bin/code" \
    "$HOME/VSCode-linux-x64/bin/code"
  do
    [ -x "$c" ] && { CODE="$c"; break; }
  done
fi
[ -n "$CODE" ] || die "VS Code's 'code' command was not found. Install VS Code, or add it to PATH
  (macOS: Command Palette -> Shell Command: Install 'code' command in PATH)."
say "code      : $CODE"

# ----------------------------------------------------------------- the VSIX
VSIX=$(ls "$(dirname "$0")"/*.vsix 2>/dev/null | head -n 1 || true)
[ -n "$VSIX" ] || die "No .vsix file sits next to this script.
  Keep install.sh and the .vsix in the same folder."
say "package   : $(basename "$VSIX")"
printf '\n'

say "[1/2] Installing the extension..."
"$CODE" --install-extension "$VSIX" --force

# ----------------------------------------------------------------- the patch
# The extension ships install.js, so patch from the copy just installed.
VER=$(basename "$VSIX" .vsix | sed 's/^neon-glow-//')
EXTROOT="$HOME/.vscode/extensions"
EXTDIR="$EXTROOT/ruminem.vscode-neon-glow-$VER"
[ -f "$EXTDIR/install.js" ] || EXTDIR=$(ls -d "$EXTROOT"/ruminem.vscode-neon-glow-* 2>/dev/null | tail -n 1 || true)
[ -n "${EXTDIR:-}" ] && [ -f "$EXTDIR/install.js" ] || die "The extension installed, but its folder was not found.
  Open VS Code and run 'Neon Glow: Show status' instead."

# node if it is here; otherwise VS Code is Electron and can be one.
if command -v node >/dev/null 2>&1; then
  RUN_NODE="node"
else
  APP=$(dirname "$(dirname "$CODE")")          # .../resources/app
  for b in "$APP/../../MacOS/Electron" "$APP/../../code" "$APP/../../../MacOS/Electron"; do
    [ -x "$b" ] && { RUN_NODE="ELECTRON_RUN_AS_NODE=1 $b"; break; }
  done
  [ -n "${RUN_NODE:-}" ] || die "Neither node nor the VS Code binary could be found to run the patcher."
fi

printf '\n'
say "[2/2] Patching the workbench bundle..."
if ! sh -c "$RUN_NODE '$EXTDIR/install.js'"; then
  printf '\n'
  say "That failed. If it was a permission error, the install directory is owned"
  say "by root, so run this again with sudo:"
  say "    sudo sh '$0'"
  say "If it said the filesystem is read-only, VS Code is a snap or a flatpak and"
  say "cannot be patched at all - install the .deb or the tarball instead."
  exit 1
fi

printf '\n'
say "Done. Now quit VS Code COMPLETELY and start it again."
say '"Reload Window" is not enough - it replays the old bundle from cache.'
printf '\n'
