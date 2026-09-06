'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { MARKER } = require('./locate');

const backupOf = file => file + '.pre-neon.bak';

function isPatched(file) {
  try { return fs.readFileSync(file, 'utf8').includes(MARKER); } catch (e) { return false; }
}

/** Absolute fs path -> the vscode-file URL the renderer can fetch. */
function toVscodeFileUrl(fsPath) {
  let p = String(fsPath).split('\\').join('/');
  if (p.charAt(0) !== '/') p = '/' + p;
  return 'vscode-file://vscode-app' + encodeURI(p);
}

/**
 * Where the extension keeps its state file. The extension passes its own
 * globalStorageUri; the CLI has to guess the same location.
 */
function defaultStateFile() {
  const home = os.homedir();
  const base = process.platform === 'win32'
    ? path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Code', 'User', 'globalStorage')
    : process.platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage')
      : path.join(home, '.config', 'Code', 'User', 'globalStorage');
  return path.join(base, 'ruminem.vscode-neon-glow', 'state.json');
}

/** Create the state file if absent so the very first poll gets a 200. */
function ensureStateFile(stateFile) {
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    if (!fs.existsSync(stateFile)) {
      fs.writeFileSync(stateFile, JSON.stringify({ enabled: true, seq: Date.now() }), 'utf8');
    }
    return true;
  } catch (e) { return false; }
}

function writeState(stateFile, enabled, knobs) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  const body = { enabled: !!enabled, seq: Date.now() };
  if (knobs) body.knobs = knobs;
  fs.writeFileSync(stateFile, JSON.stringify(body), 'utf8');
}

function readState(stateFile) {
  try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (e) { return { enabled: true, seq: 0 }; }
}

/**
 * Append the payload to `file`, keeping a pristine backup.
 * Re-installing always rebuilds from the backup, never from a patched file.
 */
function applyPatch(file, payloadPath, stateFile) {
  let payload = fs.readFileSync(payloadPath, 'utf8');
  const url = stateFile ? toVscodeFileUrl(stateFile) : '';
  payload = payload.split('__NEON_STATE_URL__').join(url);

  const backup = backupOf(file);
  let base;
  if (fs.existsSync(backup)) {
    base = fs.readFileSync(backup, 'utf8');
  } else {
    base = fs.readFileSync(file, 'utf8');
    if (base.includes(MARKER)) throw new Error('already patched, but no backup exists');
    fs.writeFileSync(backup, base, 'utf8');
  }

  fs.writeFileSync(file, base + payload, 'utf8');
  return backup;
}

/** Restore the pristine bundle and drop the backup. False if nothing to do. */
function removePatch(file) {
  const backup = backupOf(file);
  if (!fs.existsSync(backup)) return false;
  fs.copyFileSync(backup, file);
  fs.unlinkSync(backup);
  return true;
}

const payloadPath = () => path.join(__dirname, 'neon-glow.js');

module.exports = {
  applyPatch, removePatch, isPatched, backupOf, payloadPath,
  toVscodeFileUrl, defaultStateFile, ensureStateFile, writeState, readState,
};
