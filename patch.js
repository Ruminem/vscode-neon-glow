'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { MARKER } = require('./locate');

const backupOf = file => file + '.pre-neon.bak';

/**
 * The payload is appended, so the marker and its stamp are always in the
 * tail. Reading 64KB beats pulling a multi-megabyte bundle through a string
 * every time someone asks whether it is patched.
 */
function readTail(file, bytes) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(bytes, size);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } finally { fs.closeSync(fd); }
}

const TAIL = 65536;

function isPatched(file) {
  try { return readTail(file, TAIL).includes(MARKER); } catch (e) { return false; }
}

/**
 * Identity of the payload, from its own bytes rather than the release number.
 * Most releases change only the extension, which never touches the bundle, and
 * stamping those with a version would ask for a pointless re-patch every time.
 *
 * Line endings are folded to LF before hashing. git on Windows checks the file
 * out with CRLF, while the VSIX is built on Linux and carries LF, so hashing
 * the raw bytes gave one payload two stamps: patch from a clone with
 * `node install.js` and the installed extension called the bundle out of date
 * forever, over code that was identical. LF is what the released file already
 * is, so every install stamped so far keeps the stamp it has.
 */
function payloadStamp(file) {
  return crypto.createHash('sha256')
    .update(fs.readFileSync(file || payloadPath(), 'utf8').replace(/\r\n/g, '\n'))
    .digest('hex').slice(0, 12);
}

/**
 * The stamp the bundle was patched with, or null when it is unpatched or was
 * patched before the banner carried one. Both mean the same thing to a caller:
 * not the payload this copy would write.
 */
function patchedStamp(file) {
  try {
    const m = /\[payload ([0-9a-f]{6,})\]/.exec(readTail(file, TAIL));
    return m ? m[1] : null;
  } catch (e) { return null; }
}

/**
 * Whether another glow extension is patched into the same installation.
 *
 * SynthWave '84 and its forks never touch workbench.js: they drop a
 * neondreams.js beside it and add a <script> tag to the workbench HTML.
 * Different files, different backups, so neither patch can corrupt or silently
 * undo the other. What they do share is the DOM - both build a <style> from
 * .vscode-tokens-styles and set text-shadow with !important, at equal
 * specificity, so whichever is appended last wins. That is worth saying out
 * loud rather than leaving someone to wonder why the glow looks doubled.
 *
 * Checked from disk rather than from the renderer, because this side can read
 * it directly and the bridge only runs the other way.
 */
function rivalGlow(workbenchJs) {
  try {
    const dir = path.dirname(workbenchJs);
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.html')) continue;
      if (fs.readFileSync(path.join(dir, name), 'utf8').includes('neondreams.js')) {
        return "SynthWave '84";
      }
    }
  } catch (e) { /* an unreadable install directory is not this function's problem */ }
  return null;
}

/**
 * Why a target cannot be written, in terms someone can act on.
 *
 * The distinction that matters is between a permission problem, which
 * elevation fixes, and a read-only filesystem, which it does not. Snap and
 * flatpak mount their payload read-only, so a VS Code installed that way can
 * never be patched by anything - and saying so is much better than letting
 * someone try sudo and watch it fail the same way.
 */
function writeBlocker(file) {
  const p = file.split('\\').join('/');
  if (/^\/snap\//.test(p)) return 'readonly-snap';
  if (/\/flatpak\/app\//.test(p)) return 'readonly-flatpak';
  try {
    fs.accessSync(file, fs.constants.W_OK);
    return null;
  } catch (e) {
    if (e.code === 'EROFS') return 'readonly';
    if (e.code === 'EACCES' || e.code === 'EPERM') return 'permission';
    return e.code || 'unknown';
  }
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

/**
 * What was patched, recorded beside the state file.
 *
 * The extension knows where the editor lives and never has to guess, but the
 * uninstall hook is a bare node process with no editor to ask, so it would fall
 * back to the candidate list - and miss a portable build or an unusual prefix,
 * leaving the bundle patched with the extension gone. Writing the paths down at
 * patch time closes that: undoing reads what installing wrote.
 */
const targetsFileOf = stateFile => path.join(path.dirname(stateFile), 'targets.json');

function rememberTargets(stateFile, targets) {
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(targetsFileOf(stateFile), JSON.stringify(targets), 'utf8');
  } catch (e) { /* best effort: the guess still works for ordinary installs */ }
}

/** Paths recorded at patch time that still exist. Empty when there is no record. */
function recallTargets(stateFile) {
  try {
    const v = JSON.parse(fs.readFileSync(targetsFileOf(stateFile), 'utf8'));
    return Array.isArray(v) ? v.filter(f => fs.existsSync(f)) : [];
  } catch (e) { return []; }
}

function forgetTargets(stateFile) {
  try { fs.unlinkSync(targetsFileOf(stateFile)); } catch (e) { /* already gone */ }
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
function applyPatch(file, payload_path, stateFile) {
  let payload = fs.readFileSync(payload_path, 'utf8');
  const url = stateFile ? toVscodeFileUrl(stateFile) : '';
  payload = payload.split('__NEON_STATE_URL__').join(url);
  payload = payload.split('__NEON_STAMP__').join(payloadStamp(payload_path));

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
  applyPatch, removePatch, isPatched, patchedStamp, payloadStamp, rivalGlow, writeBlocker,
  rememberTargets, recallTargets, forgetTargets,
  backupOf, payloadPath,
  toVscodeFileUrl, defaultStateFile, ensureStateFile, writeState, readState,
};
