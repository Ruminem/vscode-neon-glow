'use strict';
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { resolveTargets } = require('./locate');
const {
  applyPatch, removePatch, isPatched, patchedStamp, payloadStamp, rivalGlow, payloadPath,
  ensureStateFile, writeState, readState,
} = require('./patch');

const VERSION = require('./package.json').version;

const RESTART_NOTE =
  'Quit VS Code completely and start it again. "Reload Window" is not enough - ' +
  'it replays the old bundle from cache.';

/** Set when the user removes the patch, or asks not to be prompted about it. */
const SUPPRESS_PROMPT = 'neonGlow.suppressPatchPrompt';

let stateFile = null;
let statusItem = null;

/**
 * Whether the bundle actually carries the payload. Cached on purpose: isPatched
 * reads the whole multi-megabyte workbench.js, and the answer can only change
 * through the install/remove commands or a VS Code update, which needs a
 * restart anyway.
 */
let patched = false;
let bundleMtime = 0;

/**
 * The bundle is patched, but not with the payload this copy ships. Updating the
 * extension never touches workbench.js, so a payload change would otherwise sit
 * there looking healthy while the renderer ran the old code - which is exactly
 * how a new setting can appear and do nothing.
 *
 * Compared by a hash of the payload, not the release number: most releases
 * change only the extension, and versioning this would demand a re-patch and a
 * restart for a bundle that is already byte-for-byte correct.
 */
let payloadOutdated = false;

/** Extension host start. A bundle written after this is not what is running. */
const HOST_START = Date.now() - process.uptime() * 1000;

function refreshPatched() {
  const targets = resolveTargets([]);
  patched = targets.length > 0 && targets.every(isPatched);
  const want = payloadStamp(payloadPath());
  payloadOutdated = patched && targets.some(f => patchedStamp(f) !== want);
  bundleMtime = 0;
  for (const f of targets) {
    try { bundleMtime = Math.max(bundleMtime, fs.statSync(f).mtimeMs); } catch (e) { /* gone */ }
  }
}

/**
 * True when the bundle was written after this window came up, so the renderer
 * is still running the one it started with and nothing will glow yet.
 *
 * Deliberately one-sided. A window reloaded after a patch is indistinguishable
 * from a healthy one here - "Reload Window" restarts the extension host but
 * leaves the renderer on its cached bundle - so this stays quiet rather than
 * guess. A missed warning is survivable; a wrong one is not.
 */
function restartPending() {
  return patched && bundleMtime > HOST_START;
}

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
 * The status bar item is the fast half of the bridge. The renderer watches this
 * item for this exact text and reacts within a frame, which is why the label is
 * plain: a codicon would render as an element and break the match.
 *
 * The context keys drive the `commandPalette` `when` clauses, so the palette
 * offers only the command that would change something.
 *
 * There are two of them, both positive, because a when clause cannot tell an
 * unset key from a false one. With a single `enabled` key, `!enabled` is true
 * before this ever runs, and the window between reload and activation shows
 * Enable over an editor that is already glowing. Two keys make that window read
 * as "not known yet": neither command is listed, and Toggle - which reads the
 * state file rather than a context key - still works.
 */
function reflect(enabled) {
  vscode.commands.executeCommand('setContext', 'neonGlow.on', enabled);
  vscode.commands.executeCommand('setContext', 'neonGlow.off', !enabled);
  if (!statusItem) return;

  /* The label is the wire - the renderer matches /NEON:(ON|OFF)/ against it -
     so an unpatched bundle is reported through colour and tooltip instead.
     Otherwise the item would keep claiming ON with nothing there to glow. */
  statusItem.text = 'NEON:' + (enabled ? 'ON' : 'OFF');

  const warn = new vscode.ThemeColor('statusBarItem.warningBackground');

  if (!patched) {
    statusItem.tooltip =
      'Neon Glow: the workbench bundle is not patched, so nothing glows. Click to patch.';
    statusItem.command = 'neonGlow.install';
    statusItem.backgroundColor = warn;
  } else if (payloadOutdated) {
    statusItem.tooltip =
      'Neon Glow ' + VERSION + ': the bundle carries a different payload, so anything ' +
      'this version added to the renderer is inert. Click to patch it again.';
    statusItem.command = 'neonGlow.install';
    statusItem.backgroundColor = warn;
  } else if (restartPending()) {
    statusItem.tooltip =
      'Neon Glow: patched, but this window is still running the bundle it started ' +
      'with. Click to finish.';
    statusItem.command = 'neonGlow.restartHint';
    statusItem.backgroundColor = warn;
  } else {
    statusItem.tooltip = 'Neon Glow is ' + (enabled ? 'on' : 'off') + ' - click to toggle';
    statusItem.command = 'neonGlow.toggle';
    statusItem.backgroundColor = undefined;
  }
}

/**
 * The tuning values, straight from Settings. They ride the state file rather
 * than being baked into the payload, so changing one takes effect without
 * rewriting workbench.js or restarting - the renderer clamps and applies them
 * on its next poll.
 */
const KNOBS = ['brightness', 'minChroma', 'chromaSpan', 'floor', 'minLightness', 'glowLayers'];

function readKnobs() {
  const c = vscode.workspace.getConfiguration('neonGlow');
  const out = {};
  for (const k of KNOBS) {
    const v = c.get(k);
    if (typeof v === 'number' && isFinite(v)) out[k] = v;
  }
  return out;
}

/** Write the whole state - switch and knobs together - and mirror it locally. */
function publish(enabled) {
  try {
    writeState(stateFile, enabled, readKnobs());
  } catch (e) {
    vscode.window.showErrorMessage('Neon Glow: could not write state - ' + e.message);
    return;
  }
  reflect(enabled);
}

function setGlow(enabled) { publish(enabled); }

/** A bundle rewrite only takes effect on a cold start, so offer to do one. */
async function noteRestart(what) {
  const quit = 'Quit VS Code';
  const answer = await vscode.window.showInformationMessage(what + ' ' + RESTART_NOTE, quit);
  if (answer === quit) vscode.commands.executeCommand('workbench.action.quit');
}

function installPatch(context) {
  const targets = targetsOrWarn();
  if (!targets) return;
  try {
    ensureStateFile(stateFile);
    targets.forEach(f => applyPatch(f, payloadPath(), stateFile));
    context.globalState.update(SUPPRESS_PROMPT, false);
    refreshPatched();
    reflect(readState(stateFile).enabled);
    noteRestart('Neon Glow installed.');
  } catch (e) { reportFailure(e); }
}

/**
 * Installing the extension does not by itself make anything glow: the payload
 * lives in workbench.js, which only this side can write. A VS Code update also
 * silently restores the pristine bundle. Both end up looking the same from
 * here - an unpatched target - so one prompt on activation covers them.
 *
 * Removing the patch on purpose sets SUPPRESS_PROMPT, so the prompt does not
 * turn into a nag for someone who wanted it off.
 */
async function offerToPatch(context) {
  if (context.globalState.get(SUPPRESS_PROMPT)) return;
  if (!resolveTargets([]).length) return;
  if (patched && !payloadOutdated) return;

  const yes = 'Patch now', never = "Don't ask again";
  const answer = await vscode.window.showInformationMessage(
    payloadOutdated
      ? 'Neon Glow ' + VERSION + ' is installed, but the workbench bundle still ' +
        'carries the payload from an earlier version.'
      : 'Neon Glow: the workbench bundle is not patched, so nothing glows yet.',
    yes, 'Later', never);

  if (answer === never) { context.globalState.update(SUPPRESS_PROMPT, true); return; }
  if (answer === yes) installPatch(context);
}

function activate(context) {
  stateFile = path.join(context.globalStorageUri.fsPath, 'state.json');
  ensureStateFile(stateFile);

  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 0);
  context.subscriptions.push(statusItem);
  refreshPatched();
  statusItem.show();

  /* Publish once so the file carries the current settings even if nothing is
     toggled this session, then again whenever any of them changes. */
  publish(readState(stateFile).enabled);

  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
    if (KNOBS.some(k => e.affectsConfiguration('neonGlow.' + k))) {
      publish(readState(stateFile).enabled);
    }
  }));

  const cmd = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  cmd('neonGlow.toggle',  () => setGlow(!readState(stateFile).enabled));
  cmd('neonGlow.enable',  () => setGlow(true));
  cmd('neonGlow.disable', () => setGlow(false));

  cmd('neonGlow.install', () => installPatch(context));

  /* Not in contributes.commands, so it stays out of the palette: it exists
     only as the click target of the status bar item while a restart is due. */
  cmd('neonGlow.restartHint',
      () => noteRestart('Neon Glow is patched, but this window predates the patch.'));

  cmd('neonGlow.remove', () => {
    const targets = targetsOrWarn();
    if (!targets) return;
    try {
      const undone = targets.filter(f => removePatch(f));
      if (!undone.length) {
        vscode.window.showInformationMessage('Neon Glow: nothing to remove (no backup found).');
        return;
      }
      /* Removing is a decision, not an accident: stop offering to undo it. */
      context.globalState.update(SUPPRESS_PROMPT, true);
      refreshPatched();
      reflect(readState(stateFile).enabled);
      noteRestart('Neon Glow removed.');
    } catch (e) { reportFailure(e); }
  });

  /**
   * The only one of these three left in the palette, so it carries the other
   * two as actions. Patching is otherwise reached from the status bar or the
   * prompt on activation, and restoring from uninstalling the extension - but
   * a status readout that cannot act on what it just reported is a dead end.
   */
  cmd('neonGlow.status', async () => {
    const targets = targetsOrWarn();
    if (!targets) return;
    refreshPatched();
    reflect(readState(stateFile).enabled);

    const where = targets.map(f => {
      const v = patchedStamp(f);
      return (isPatched(f) ? 'patched with payload ' + (v || '(unstamped)') : 'clean')
        + ' - ' + f;
    }).join(' | ');
    const on = readState(stateFile).enabled ? 'ON' : 'OFF';
    const action = (patched && !payloadOutdated)
      ? 'Restore the original bundle'
      : 'Patch it now';

    let msg = 'Neon Glow is ' + on + '. Bundle: ' + where;

    /* Another glow extension cannot corrupt this one - different files - but it
       does paint the same tokens, so say whether it is actually competing.
       SynthWave stands down unless its own theme is active. */
    const rival = targets.map(rivalGlow).find(Boolean);
    if (rival) {
      const theme = String(vscode.workspace.getConfiguration('workbench').get('colorTheme') || '');
      msg += ' | ' + rival + ' is also patched in, ' + (/synthwave/i.test(theme)
        ? 'and its theme is active, so both are painting the same tokens - turn one off.'
        : 'but it only paints under its own theme, so nothing is competing right now.');
    }

    const answer = await vscode.window.showInformationMessage(msg, action);

    if (answer === 'Patch it now') installPatch(context);
    else if (answer) vscode.commands.executeCommand('neonGlow.remove');
  });

  offerToPatch(context);
}

function deactivate() {}

module.exports = { activate, deactivate };
