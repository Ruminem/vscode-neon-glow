'use strict';
const vscode = require('vscode');
const { resolveTargets } = require('./locate');
const { applyPatch, removePatch, isPatched, payloadPath } = require('./patch');

const RESTART_NOTE =
  'Quit VS Code completely and start it again. "Reload Window" is not enough - ' +
  'it replays the old bundle from cache.';

function targetsOrWarn() {
  const targets = resolveTargets([]);
  if (!targets.length) {
    vscode.window.showErrorMessage('Neon Glow: could not locate the VS Code installation.');
    return null;
  }
  return targets;
}

function reportFailure(e) {
  if (/EACCES|EPERM/.test(e.code || '')) {
    vscode.window.showErrorMessage(
      'Neon Glow: no write access to the VS Code install directory. ' +
      'Restart VS Code as administrator (sudo on macOS/Linux) and run the command again.');
  } else {
    vscode.window.showErrorMessage('Neon Glow: ' + e.message);
  }
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('neonGlow.install', () => {
      const targets = targetsOrWarn();
      if (!targets) return;
      try {
        targets.forEach(f => applyPatch(f, payloadPath()));
        vscode.window.showInformationMessage('Neon Glow installed. ' + RESTART_NOTE);
      } catch (e) { reportFailure(e); }
    }),

    vscode.commands.registerCommand('neonGlow.remove', () => {
      const targets = targetsOrWarn();
      if (!targets) return;
      try {
        const undone = targets.filter(f => removePatch(f));
        if (!undone.length) {
          vscode.window.showInformationMessage('Neon Glow: nothing to remove (no backup found).');
          return;
        }
        vscode.window.showInformationMessage('Neon Glow removed. ' + RESTART_NOTE);
      } catch (e) { reportFailure(e); }
    }),

    vscode.commands.registerCommand('neonGlow.status', () => {
      const targets = targetsOrWarn();
      if (!targets) return;
      const lines = targets.map(f => (isPatched(f) ? 'patched' : 'clean') + ' - ' + f);
      vscode.window.showInformationMessage(
        'Neon Glow: ' + lines.join(' | ') + '. Ctrl+Alt+N toggles the glow at runtime.');
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
