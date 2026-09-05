'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

/** Candidate "resources/app" directories for installed VS Code builds. */
function candidateAppRoots() {
  const out = [];
  if (process.platform === 'win32') {
    const bases = [
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code Insiders'),
      'C:\Program Files\Microsoft VS Code',
      'C:\Program Files\Microsoft VS Code Insiders',
    ];
    for (const base of bases) {
      if (!base || !fs.existsSync(base)) continue;
      out.push(path.join(base, 'resources', 'app'));
      // Recent builds nest resources under a commit-hash directory.
      for (const entry of fs.readdirSync(base)) {
        out.push(path.join(base, entry, 'resources', 'app'));
      }
    }
  } else if (process.platform === 'darwin') {
    out.push('/Applications/Visual Studio Code.app/Contents/Resources/app');
    out.push('/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app');
    out.push(path.join(os.homedir(), 'Applications', 'Visual Studio Code.app', 'Contents', 'Resources', 'app'));
  } else {
    out.push('/usr/share/code/resources/app');
    out.push('/usr/share/code-insiders/resources/app');
    out.push('/opt/visual-studio-code/resources/app');
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

/** Resolve targets from --target, or by scanning known install locations. */
function resolveTargets(argv) {
  const i = argv.indexOf('--target');
  const roots = i !== -1 && argv[i + 1] ? [argv[i + 1]] : candidateAppRoots();
  const targets = [];
  for (const root of roots) {
    const wb = findWorkbenchJs(root);
    if (wb && !targets.includes(wb)) targets.push(wb);
  }
  return targets;
}

module.exports = { candidateAppRoots, findWorkbenchJs, resolveTargets, MARKER: 'NEON GLOW (injected)' };
