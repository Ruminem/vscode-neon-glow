'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Candidate "resources/app" directories for installed VS Code builds.
 *
 * This is the fallback. The extension knows exactly where it is running from
 * and passes that in; only the CLI, which is a bare node process, has to guess.
 * Guessing cannot cover portable builds, unusual prefixes or anything a distro
 * has moved, which is why the extension is the better route on every platform.
 */
function candidateAppRoots() {
  const home = os.homedir();
  const out = [];

  if (process.platform === 'win32') {
    const bases = [
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code Insiders'),
      'C:\\Program Files\\Microsoft VS Code',
      'C:\\Program Files\\Microsoft VS Code Insiders',
    ];
    for (const base of bases) {
      if (!base || !fs.existsSync(base)) continue;
      out.push(path.join(base, 'resources', 'app'));
      /* Recent builds nest resources under a commit-hash directory. */
      for (const entry of fs.readdirSync(base)) {
        out.push(path.join(base, entry, 'resources', 'app'));
      }
    }
  } else if (process.platform === 'darwin') {
    for (const app of ['Visual Studio Code.app', 'Visual Studio Code - Insiders.app']) {
      out.push(path.join('/Applications', app, 'Contents', 'Resources', 'app'));
      out.push(path.join(home, 'Applications', app, 'Contents', 'Resources', 'app'));
    }
  } else {
    /* Distribution packages. */
    out.push('/usr/share/code/resources/app');
    out.push('/usr/share/code-insiders/resources/app');
    out.push('/usr/lib/code/resources/app');
    out.push('/opt/visual-studio-code/resources/app');
    out.push('/opt/vscode/resources/app');

    /* The tarball, unpacked wherever people unpack it. */
    for (const dir of ['VSCode-linux-x64', 'vscode', '.local/share/vscode']) {
      out.push(path.join(home, dir, 'resources', 'app'));
    }

    /* Snap and flatpak are listed so they can be found and then explained.
       Both mount their payload read-only, so patching them cannot work - a
       clear message beats "no VS Code installation found". */
    out.push('/snap/code/current/usr/share/code/resources/app');
    out.push('/var/lib/flatpak/app/com.visualstudio.code/current/active/files/extra/vscode/resources/app');
    out.push(path.join(home, '.local/share/flatpak/app/com.visualstudio.code/current/active/files/extra/vscode/resources/app'));
  }

  return out.filter(p => fs.existsSync(p));
}

/** "electron-browser" is current; "electron-sandbox" covers older builds. */
function findWorkbenchJs(appRoot) {
  for (const dir of ['electron-browser', 'electron-sandbox']) {
    const p = path.join(appRoot, 'out', 'vs', 'code', dir, 'workbench', 'workbench.js');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Resolve targets, preferring what the caller knows over what we can guess.
 *
 * `hintRoot` is vscode.env.appRoot when the extension is asking: the directory
 * the running editor was actually loaded from, which is right by construction
 * on every platform and every packaging.
 */
function resolveTargets(argv, hintRoot) {
  const i = (argv || []).indexOf('--target');
  const explicit = i !== -1 && argv[i + 1] ? argv[i + 1] : null;

  const roots = explicit ? [explicit]
    : hintRoot ? [hintRoot]
    : candidateAppRoots();

  const targets = [];
  for (const root of roots) {
    const wb = findWorkbenchJs(root);
    if (wb && !targets.includes(wb)) targets.push(wb);
  }
  return targets;
}

module.exports = { candidateAppRoots, findWorkbenchJs, resolveTargets, MARKER: 'NEON GLOW (injected)' };
