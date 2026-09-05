'use strict';
const path = require('path');
const vscode = require('vscode');
const { resolveTargets } = require('./locate');
const {
  applyPatch, removePatch, isPatched, payloadPath,
  ensureStateFile, writeState, readState,
} = require('./patch');

const RESTART_NOTE =
  'Quit VS Code completely and start it again. "Reload Window" is not enough - ' +
  'it replays the old bundle from cache.';

let stateFile = null;
let statusItem = null;

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

/**
 * Publish the state to everything that renders it.
 *
 * The status bar item is the fast half of the bridge. The renderer watches
 * `.statusbar` for this exact text and reacts within a frame, which is why the
 * label is plain: a codicon would render as an element and break the match.
 *
 * The context key drives the `commandPalette` `when` clauses, so the palette
 * offers only the command that would change something. An unset key reads as
 * false, which is why the extension activates on startup rather than on first
 * command - otherwise the palette would claim the glow was off until you ran
 * something.
 */
function reflect(enabled) {
  vscode.commands.executeCommand('setContext', 'neonGlow.enabled', enabled);
  if (!statusItem) return;
  statusItem.text = 'NEON:' + (enabled ? 'ON' : 'OFF');
  statusItem.tooltip = 'Neon Glow is ' + (enabled ? 'on' : 'off') + ' - click to toggle';
}

/** Toggling writes the state file and the status bar; the renderer follows both. */
function setGlow(enabled) {
  try {
    writeState(stateFile, enabled);
  } catch (e) {
    vscode.window.showErrorMessage('Neon Glow: could not write state - ' + e.message);
    return;
  }
  reflect(enabled);
}

function activate(context) {
  stateFile = path.join(context.globalStorageUri.fsPath, 'state.json');
  ensureStateFile(stateFile);

  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 0);
  statusItem.command = 'neonGlow.toggle';
  context.subscriptions.push(statusItem);
  reflect(readState(stateFile).enabled);
  statusItem.show();

  const cmd = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  cmd('neonGlow.toggle',  () => setGlow(!readState(stateFile).enabled));
  cmd('neonGlow.enable',  () => setGlow(true));
  cmd('neonGlow.disable', () => setGlow(false));

  cmd('neonGlow.install', () => {
    const targets = targetsOrWarn();
    if (!targets) return;
    try {
      ensureStateFile(stateFile);
      targets.forEach(f => applyPatch(f, payloadPath(), stateFile));
      vscode.window.showInformationMessage('Neon Glow installed. ' + RESTART_NOTE);
    } catch (e) { reportFailure(e); }
  });

  cmd('neonGlow.remove', () => {
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
  });

  cmd('neonGlow.status', () => {
    const targets = targetsOrWarn();
    if (!targets) return;
    const where = targets.map(f => (isPatched(f) ? 'patched' : 'clean') + ' - ' + f).join(' | ');
    const on = readState(stateFile).enabled ? 'ON' : 'OFF';
    vscode.window.showInformationMessage('Neon Glow is ' + on + '. Bundle: ' + where);
  });
}

function deactivate() {}

module.exports = { activate, deactivate };
