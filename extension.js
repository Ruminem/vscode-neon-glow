'use strict';
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { resolveTargets } = require('./locate');
const { PRESETS, PRESET_ORDER } = require('./presets');
const {
  applyPatch, removePatch, isPatched, patchedStamp, payloadStamp, rivalGlow, writeBlocker,
  loaderStamp, writePayloadCopy, payloadCopyStamp,
  rememberTargets, forgetTargets,
  payloadPath,
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
 * The save pulse, sent on the same wire as the switch.
 *
 * The renderer cannot subscribe to onDidSaveTextDocument - it lives in the
 * workbench, not here - and the only other channel is state.json, which it
 * polls about once a second. That is far too late to read as a reaction to
 * Ctrl+S, so the news goes on the status bar label, which a MutationObserver
 * over there sees within a frame. The label is on screen, so the marker is
 * U+200B: zero width, and nothing a screen reader announces. The count cycles
 * 0-3 so consecutive saves always differ and the label never grows.
 */
const PULSE = String.fromCharCode(0x200b);
let statusBase = '';
let savePulse = 0;

/**
 * The settings nudge, on the same wire and for the same reason.
 *
 * A knob reaches the renderer through state.json, which it polls - and that
 * poll backs off to 15 seconds while you are only reading, so a slider could
 * sit there doing nothing for long enough to look broken. Marking the label
 * makes the renderer re-read the file within a frame instead.
 *
 * A different character from the save pulse, and it sits in front of it: over
 * there the pulse is counted as the label's trailing run, so anything appended
 * after it would read as that count falling to zero and jolt the workbench
 * every time a setting changed. U+2060 is a word joiner - zero width, not
 * whitespace, so trim() leaves it alone. The count cycles 0-3 like the pulse,
 * so consecutive changes always differ and the label never grows.
 */
const NUDGE = String.fromCharCode(0x2060);
let knobPulse = 0;

/** The label is the wire. Both markers ride it, in this order. */
function labelText() {
  return statusBase + NUDGE.repeat(knobPulse) + PULSE.repeat(savePulse);
}

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

/**
 * Where this editor was actually loaded from.
 *
 * `vscode.env.appRoot` is the resources/app directory of the running instance,
 * so it is correct by construction on every platform and every packaging -
 * portable builds, a tarball unpacked anywhere, a distro that moved the prefix.
 * The guessed list in locate.js exists for the CLI, which has no editor to ask.
 */
function appTargets() {
  return resolveTargets([], vscode.env.appRoot);
}

function refreshPatched() {
  const targets = appTargets();
  patched = targets.length > 0 && targets.every(isPatched);
  bundleMtime = 0;
  for (const f of targets) {
    try { bundleMtime = Math.max(bundleMtime, fs.statSync(f).mtimeMs); } catch (e) { /* gone */ }
  }

  /* Compared against the loader, not the payload. The bundle carries a stub now
     and the payload sits beside state.json, so a payload release changes the
     file the stub reads and not the stub - and asking for a re-patch over that
     would put back the very thing the loader exists to remove. What a payload
     release owes is a refreshed copy, which happens below without anyone being
     asked and without a restart being mentioned.
     activate has not run on the first call, and a stamp needs somewhere for the
     payload to sit before it can say anything. */
  if (!stateFile) { payloadOutdated = false; return; }
  payloadOutdated = patched && targets.some(f => patchedStamp(f) !== loaderStamp(stateFile));

  if (patched && !payloadOutdated) {
    /* The copy carries the stamp of the payload it was made from, which is what
       makes this a comparison rather than a rewrite every time: the copy's own
       bytes differ from the payload's by the placeholders that were filled in. */
    if (payloadCopyStamp(stateFile) !== payloadStamp(payloadPath())) {
      try { writePayloadCopy(payloadPath(), stateFile); } catch (_) { /* read-only home */ }
    }
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
  const targets = appTargets();
  if (!targets.length) {
    vscode.window.showErrorMessage('Neon Glow: could not locate the VS Code installation.');
    return null;
  }
  return targets;
}

/**
 * What to tell someone whose install cannot be written to.
 *
 * The distinction worth making is whether elevation would help. On a snap or a
 * flatpak it never will - the payload is mounted read-only - and sending
 * someone off to try sudo for a thing that cannot work either way is worse than
 * saying so.
 */
const BLOCKED = {
  'readonly-snap':
    'this VS Code is a snap, and snaps are mounted read-only, so the workbench ' +
    'bundle cannot be patched by anything. Install VS Code from the .deb or the ' +
    'tarball to use this.',
  'readonly-flatpak':
    'this VS Code is a flatpak, whose files are read-only, so the workbench ' +
    'bundle cannot be patched. Install VS Code from the .deb or the tarball to use this.',
  readonly:
    'the VS Code install directory is on a read-only filesystem, so the workbench ' +
    'bundle cannot be patched.',
  permission: process.platform === 'win32'
    ? 'no write access to the VS Code install directory. Restart VS Code as ' +
      'administrator and run this again.'
    : 'no write access to the VS Code install directory. The extension host runs ' +
      'as you rather than as root, so this command cannot elevate - clone the ' +
      'repository and run "sudo node install.js" instead.',
};

/** Refuse before writing anything, with the reason, rather than failing part way. */
function blockedReason(targets) {
  for (const f of targets) {
    const kind = writeBlocker(f);
    if (kind) return BLOCKED[kind] || ('cannot write ' + f + ' (' + kind + ').');
  }
  return null;
}

function reportFailure(e) {
  if (/EACCES|EPERM|EROFS/.test(e.code || '')) {
    vscode.window.showErrorMessage('Neon Glow: ' +
      BLOCKED[e.code === 'EROFS' ? 'readonly' : 'permission']);
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
  statusBase = 'NEON:' + (enabled ? 'ON' : 'OFF');
  statusItem.text = labelText();

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
const KNOBS = ['brightness', 'minChroma', 'chromaSpan', 'floor', 'minLightness',
                'glowLayers', 'maxBlur', 'cursorTrail', 'saveShake',
                'findGlow', 'selectionGlow', 'occurrenceGlow', 'gutterGlow',
                'bracketMatchGlow', 'squiggleGlow', 'diffGlow',
                'lineHighlightGlow', 'breakpointGlow', 'breathe',
                'caretArc', 'caretArcMinJump', 'caretArcDuration', 'caretArcOnDrag'];

function readKnobs() {
  const c = vscode.workspace.getConfiguration('neonGlow');
  const out = {};
  for (const k of KNOBS) {
    const v = c.get(k);
    /* Words and switches as well as numbers now: caretArc carries the name of a
       style and caretArcOnDrag carries a boolean. What counts as a valid name is
       the renderer's business - it keeps its own list and drops anything else -
       so this only sorts types. */
    if (typeof v === 'string' || typeof v === 'boolean'
        || (typeof v === 'number' && isFinite(v))) out[k] = v;
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

  const blocked = blockedReason(targets);
  if (blocked) { vscode.window.showErrorMessage('Neon Glow: ' + blocked); return; }

  try {
    ensureStateFile(stateFile);
    targets.forEach(f => applyPatch(f, payloadPath(), stateFile));
    rememberTargets(stateFile, targets);
    context.globalState.update(SUPPRESS_PROMPT, false);
    refreshPatched();
    reflect(readState(stateFile).enabled);

    /* Editing anything inside a signed .app invalidates its signature. It keeps
       running in practice, but it is not something to spring on someone. */
    noteRestart('Neon Glow installed.' + (process.platform === 'darwin'
      ? ' Note that this edits a file inside the signed VS Code app bundle, which' +
        ' invalidates its code signature.'
      : ''));
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
  if (!appTargets().length) return;
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
      /* Bumped before publish, so the label the renderer sees changes only
         after the file it is about to read already carries the new value. */
      knobPulse = (knobPulse + 1) % 4;
      publish(readState(stateFile).enabled);
    }
  }));

  /* Nudge the label so the renderer jolts. Nothing else about the item changes,
     so this deliberately does not go through reflect(): a save should not be
     re-running setContext or rebuilding the tooltip. Skipped outright when the
     setting is off, which is also what keeps it quiet under files.autoSave. */
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(() => {
    if (!statusItem) return;
    const amp = vscode.workspace.getConfiguration('neonGlow').get('saveShake');
    if (!(typeof amp === 'number' && amp > 0)) return;
    savePulse = (savePulse + 1) % 4;
    statusItem.text = labelText();
  }));

  /* One state file serves every window, because one workbench.js does. A toggle
     anywhere is therefore a toggle everywhere, and every renderer follows it on
     its next poll - but nothing tells the other windows' extension hosts, so
     their status bar and palette would go on describing the state they last
     wrote themselves. Watch the file, and the readout follows the glow. */
  const stateWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.file(path.dirname(stateFile)), 'state.json'));
  const follow = () => {
    /* The file is written in place, so a watch event can land mid-write. A
       failed parse comes back as the default - enabled, seq 0 - which would
       flip the readout to ON on nothing. Only a real write carries a seq. */
    const state = readState(stateFile);
    if (state.seq) reflect(state.enabled);
  };
  context.subscriptions.push(stateWatcher,
                             stateWatcher.onDidChange(follow),
                             stateWatcher.onDidCreate(follow));


async function applyPreset(key) {
  const preset = PRESETS[key];
  const config = vscode.workspace.getConfiguration('neonGlow');
  /* Every knob, not only the ones this preset names - what a preset does not
     set, it clears, so the result does not depend on what was there before. */
  for (const k of KNOBS) {
    const v = preset.values ? preset.values[k] : undefined;
    await config.update(k, v === undefined ? undefined : v, vscode.ConfigurationTarget.Global);
  }
}

  const cmd = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  cmd('neonGlow.toggle',  () => setGlow(!readState(stateFile).enabled));
  cmd('neonGlow.enable',  () => setGlow(true));
  cmd('neonGlow.disable', () => setGlow(false));

  cmd('neonGlow.preset', async () => {
    const pick = await vscode.window.showQuickPick(
      PRESET_ORDER.map(k => ({ label: PRESETS[k].icon + ' ' + PRESETS[k].label,
                               detail: PRESETS[k].detail, key: k })),
      { title: 'Neon Glow', placeHolder: 'Pick a starting point - settings apply at once' });
    if (!pick) return;
    try {
      await applyPreset(pick.key);
      /* No restart, no re-patch: these ride state.json to the renderer, which is
         the whole reason a preset is worth having rather than a paragraph of
         instructions. */
      vscode.window.showInformationMessage('Neon Glow: ' + PRESETS[pick.key].label + ' applied.');
    } catch (err) {
      vscode.window.showErrorMessage('Neon Glow: could not write the settings - ' + err.message);
    }
  });

  cmd('neonGlow.install', () => installPatch(context));

  /* Not in contributes.commands, so it stays out of the palette: it exists
     only as the click target of the status bar item while a restart is due. */
  cmd('neonGlow.restartHint',
      () => noteRestart('Neon Glow is patched, but this window predates the patch.'));

  cmd('neonGlow.remove', () => {
    const targets = targetsOrWarn();
    if (!targets) return;
    try {
      const blocked = blockedReason(targets);
      if (blocked) { vscode.window.showErrorMessage('Neon Glow: ' + blocked); return; }
      const undone = targets.filter(f => removePatch(f));
      if (!undone.length) {
        vscode.window.showInformationMessage('Neon Glow: nothing to remove (no backup found).');
        return;
      }
      forgetTargets(stateFile);
      /* Removing is a decision, not an accident: stop offering to undo it. */
      context.globalState.update(SUPPRESS_PROMPT, true);
      refreshPatched();
      reflect(readState(stateFile).enabled);
      noteRestart('Neon Glow removed.');
    } catch (e) { reportFailure(e); }
  });

  /**
   * The only one of these three left in the palette, so it offers to patch when
   * the bundle needs it. It does not offer to restore: this is a readout, and a
   * destructive action is not what belongs under a button on one.
   */
  cmd('neonGlow.status', async () => {
    const targets = targetsOrWarn();
    if (!targets) return;
    refreshPatched();
    reflect(readState(stateFile).enabled);

    const where = targets.map(f => {
      const v = patchedStamp(f);
      return (isPatched(f) ? 'patched with loader ' + (v || '(pre-loader)') : 'clean')
        + ' - ' + f;
    }).join(' | ');
    const on = readState(stateFile).enabled ? 'ON' : 'OFF';

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

    /* Only a constructive action gets a button. This is a readout - something
       you open to look at - and hanging "Restore the original bundle" on it as
       the single thing to click is a good way to undo the install by accident.
       Restoring is what uninstalling the extension does, and the command is
       still there to bind if someone wants it without uninstalling. */
    const answer = (patched && !payloadOutdated)
      ? await vscode.window.showInformationMessage(msg)
      : await vscode.window.showInformationMessage(msg, 'Patch it now');

    if (answer === 'Patch it now') installPatch(context);
  });

  offerToPatch(context);
}

function deactivate() {}

module.exports = { activate, deactivate };
