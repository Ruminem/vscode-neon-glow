'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { MARKER, findWorkbenchJs } = require('./locate');

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

/**
 * How far back from the end of the bundle to look for the payload.
 *
 * It has to clear the payload itself, because the marker and the stamp both sit
 * at the top of what was appended. This was 64KB while the payload was 50-something,
 * and the payload crossing that line was not a slow squeeze - it was a working
 * install reporting itself unpatched from one release to the next, with the
 * marker sitting 70KB from the end and the search looking at 65. Re-patching
 * could not fix it and neither could restarting, because nothing was wrong with
 * the file.
 *
 * A quarter of a megabyte is four times the payload's present size and still a
 * single read of the end of a file that is measured in megabytes, so there is
 * no reason to trim this closer to whatever the payload happens to weigh today.
 */
const TAIL = 262144;

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
    /* "payload" is what the bundle carried while the payload itself was
       appended. An install from before the loader still says that, and reading
       it as a loader stamp would call a perfectly good bundle current when it
       is one re-patch behind - so only the loader banner answers here, and the
       old one answers null, which every caller already reads as "not what this
       copy would write". */
    const m = /\[loader ([0-9a-f]{6,})\]/.exec(readTail(file, TAIL));
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

/**
 * Absolute fs path -> the vscode-file URL the renderer can fetch.
 *
 * The drive letter is folded to lower case, because the same folder arrives
 * spelled two ways: VS Code's globalStorageUri gives "c:\Users\...", while
 * %APPDATA%, which the CLI reads, gives "C:\Users\...". Harmless while this URL
 * only told the payload where state.json was. Once the loader's stamp was
 * hashed from a URL built on it, the two spellings produced two stamps for one
 * bundle - the extension called a CLI patch out of date, re-patched it, and the
 * CLI would have called that one out of date in turn. The filesystem does not
 * care about the case of a drive letter, so the URL does not have to either.
 */
function toVscodeFileUrl(fsPath) {
  let p = String(fsPath).split('\\').join('/');
  p = p.replace(/^([A-Za-z]):/, (m, d) => d.toLowerCase() + ':');
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
 * Where VS Code keeps extensions, and the extensions.json it lists them in.
 *
 * Guessed from the home directory, by the extension as well as the CLI. The
 * extension could ask where its own folder is, but then the two would build
 * different loaders on any setup where the guess is wrong, and each would call
 * the other's patch out of date - the drive-letter bug again by another door.
 * A wrong guess costs nothing worse than the loader finding no list and reading
 * the copy, which is all it did before it could do anything else.
 */
function defaultExtensionsDir() {
  return path.join(os.homedir(), '.vscode', 'extensions');
}

/* The first release whose payload can be imported straight out of the
   extension folder. A payload read from there still has its placeholders, so
   it has to take the state URL from the loader - and payloads before this one
   do not know to look, so the loader never reaches for them there. Raise it
   only, and only if a later payload stops being able to run from the folder. */
const FOLDER_PAYLOAD_SINCE = '0.16.0';

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

/* version is the extension's, recorded so the loader can tell at startup
   whether the folder extensions.json names is newer than the copy it would
   otherwise read. */
function writeState(stateFile, enabled, knobs, version) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  const body = { enabled: !!enabled, seq: Date.now() };
  if (knobs) body.knobs = knobs;
  if (version) body.version = version;
  fs.writeFileSync(stateFile, JSON.stringify(body), 'utf8');
}

function readState(stateFile) {
  try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (e) { return { enabled: true, seq: 0 }; }
}

/** Where the loader reads the payload from: a stable name beside state.json. */
function payloadCopyPath(stateFile) {
  return path.join(path.dirname(stateFile), 'neon-glow.js');
}

/**
 * Write the payload where the renderer can import it, with its placeholders
 * filled in. Returns the stamp it was written with.
 *
 * Beside state.json rather than in the extension folder, which would be the
 * obvious place and is the wrong one: that path carries the version number, so
 * a URL baked into the bundle at patch time would go stale on the next
 * extension update and ask for the re-patch this whole arrangement exists to
 * abolish. globalStorage does not move.
 *
 * The loader does reach into the extension folder now, but by asking
 * extensions.json which folder is current rather than by remembering a path -
 * see loaderBody. This copy is still what it reads whenever that answer is
 * missing, or is not newer than what the copy was made from.
 */
function writePayloadCopy(payload_path, stateFile) {
  const stamp = payloadStamp(payload_path);
  let payload = fs.readFileSync(payload_path, 'utf8');
  payload = payload.split('__NEON_STATE_URL__').join(toVscodeFileUrl(stateFile));
  payload = payload.split('__NEON_STAMP__').join(stamp);
  const out = payloadCopyPath(stateFile);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, payload, 'utf8');
  return stamp;
}

/**
 * The stub that goes into the bundle instead of the payload.
 *
 * Four ways to run code you fetched, and the workbench refuses three of them.
 * Measured by patching a probe in and reading what it recorded:
 *
 *   eval / new Function   EvalError - Trusted Types
 *   script.src = url      TypeError - wants a TrustedScriptURL
 *   trustedTypes.createPolicy('anything')   rejected, not on the CSP's list
 *   import(url)           runs
 *
 * So it is a dynamic import, and the payload is loaded as a module. It was
 * already an IIFE in strict mode that hangs its API off window, so module scope
 * changes nothing about it.
 *
 * What this buys: the bundle stops carrying the payload, so changing the
 * payload stops needing a re-patch - and a VS Code update that replaces
 * workbench.js costs one re-patch of a stub that almost never changes, rather
 * than one per payload release. The fetch it adds was measured at 0.95ms
 * against a 2196ms first paint, and lands inside a wait the payload does anyway.
 *
 * A failure has to be visible somewhere, because a bundle that is patched and
 * glowing at nothing looks identical to a working one from the extension side.
 * data-neon is where the payload already reports itself, so the stub uses it.
 */
function loaderBody(copyUrl, stateUrl, registryUrl) {
  /* Which payload to import is decided at startup rather than baked in, and the
     reason is an update. The copy beside state.json is refreshed by the
     extension when it activates, which is after the window has already imported
     whatever copy was there - so the first restart after an update ran the old
     payload, and it took a second restart to see the new one. extensions.json
     is rewritten by VS Code when the update installs, before any restart, so it
     already names the new folder by the time the window comes up.

     Two guards keep that from reaching for the wrong folder. It is taken only
     when its version is newer than the one state.json last recorded: a window
     in another profile can find an older install of this extension listed
     there, and the copy is the right answer for that window. And never below
     FOLDER_PAYLOAD_SINCE, whose payloads cannot be told where state.json is.
     Anything that fails along the way - either file unreadable, the folder's
     import refused - lands on the copy, where the loader looked before.

     Three tries on the copy, because it sits in globalStorage and a window that
     opened before the extension host first wrote it would otherwise glow at
     nothing for the rest of the session. */
  return 'try {\n'
    + '(function () {\n'
    + '  if (typeof window === "undefined" || window.__NEON_INSTALLED) { return; }\n'
    + '  var COPY = ' + JSON.stringify(copyUrl) + ';\n'
    + '  var STATE = ' + JSON.stringify(stateUrl) + ';\n'
    + '  var REGISTRY = ' + JSON.stringify(registryUrl) + ';\n'
    + '  var SINCE = ' + JSON.stringify(FOLDER_PAYLOAD_SINCE) + ';\n'
    + '  function mark(stage, extra) {\n'
    + '    try { document.documentElement.setAttribute("data-neon", stage + (extra ? " " + extra : "")); } catch (e) {}\n'
    + '  }\n'
    + '  function ver(s) { return String(s || "0").split(".").map(function (n) { return parseInt(n, 10) || 0; }); }\n'
    + '  function newer(a, b) {\n'
    + '    a = ver(a); b = ver(b);\n'
    + '    for (var i = 0; i < 3; i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0); }\n'
    + '    return false;\n'
    + '  }\n'
    + '  function json(url) {\n'
    + '    return fetch(url, { cache: "no-store" })\n'
    + '      .then(function (r) { return r.ok ? r.json() : null; })\n'
    + '      .catch(function () { return null; });\n'
    + '  }\n'
    + '  function pick() {\n'
    + '    return Promise.all([json(REGISTRY), json(STATE)]).then(function (got) {\n'
    + '      var list = got[0], state = got[1], best = null;\n'
    + '      if (!Array.isArray(list)) return COPY;\n'
    + '      list.forEach(function (e) {\n'
    + '        if (e && e.identifier && String(e.identifier.id).toLowerCase() === "ruminem.vscode-neon-glow"\n'
    + '            && typeof e.relativeLocation === "string" && (!best || newer(e.version, best.version))) best = e;\n'
    + '      });\n'
    + '      if (!best || newer(SINCE, best.version)) return COPY;\n'
    + '      if (state && state.version && !newer(best.version, state.version)) return COPY;\n'
    + '      return REGISTRY.slice(0, REGISTRY.lastIndexOf("/") + 1)\n'
    + '        + encodeURIComponent(best.relativeLocation) + "/neon-glow.js";\n'
    + '    }).catch(function () { return COPY; });\n'
    + '  }\n'
    + '  var left = 3;\n'
    + '  function go(url) {\n'
    + '    window.__NEON_STATE_URL = STATE;\n'
    + '    window.__NEON_LOADED_FROM = url;\n'
    + '    import(url).catch(function (e) {\n'
    + '      if (url !== COPY) { go(COPY); return; }\n'
    + '      if (--left > 0) { setTimeout(function () { go(COPY); }, 1200); return; }\n'
    + '      mark("loader-failed", String(e && e.message || e).slice(0, 120));\n'
    + '    });\n'
    + '  }\n'
    + '  pick().then(go);\n'
    + '})();\n'
    + '} catch (e) { try { console.error("[NEON] loader", e); } catch (_) {} }\n';
}

/** The three places the loader reads, in the order loaderBody takes them. */
function loaderUrls(stateFile) {
  return [
    toVscodeFileUrl(payloadCopyPath(stateFile)),
    toVscodeFileUrl(stateFile),
    toVscodeFileUrl(path.join(defaultExtensionsDir(), 'extensions.json')),
  ];
}

/**
 * Which payload the copy beside state.json was written from.
 *
 * Not a hash of the copy: the copy has had its placeholders filled in, so its
 * bytes never match the payload it came from and comparing the two would say
 * "changed" every single time. The substitution puts the source stamp into the
 * banner on the way past, so the copy carries its own provenance and this reads
 * it back.
 */
function payloadCopyStamp(stateFile) {
  try {
    const head = fs.readFileSync(payloadCopyPath(stateFile), 'utf8').slice(0, 400);
    const m = /\[payload ([0-9a-f]{6,})\]/.exec(head);
    return m ? m[1] : null;
  } catch (e) { return null; }
}

/**
 * The loader's identity, from its own bytes - deliberately not the payload's.
 *
 * This is what the extension compares against the bundle to decide whether a
 * re-patch is owed, and stamping it with the payload would put the re-patch
 * straight back: every payload release would change the number and every
 * install would be told it is out of date, over a stub that had not moved.
 * The loader only changes when the way it loads changes, which is rare.
 *
 * No cache-busting query on the URL for the same reason. A module map belongs
 * to a window, and a payload only changes between sessions, so a new window
 * fetches it again anyway.
 */
function loaderStamp(stateFile) {
  return crypto.createHash('sha256')
    .update(loaderBody.apply(null, loaderUrls(stateFile)))
    .digest('hex').slice(0, 12);
}

function loaderSource(stateFile) {
  const body = loaderBody.apply(null, loaderUrls(stateFile));
  return '\n/* ============ ' + MARKER + ' [loader ' + loaderStamp(stateFile) + '] ============ */\n'
    + body
    + '/* ============ /' + MARKER + ' ============ */\n';
}

/**
 * Put the loader into `file`, keeping a pristine backup, and write the payload
 * where the loader will look for it.
 * Re-installing always rebuilds from the backup, never from a patched file.
 */
function applyPatch(file, payload_path, stateFile) {
  if (!stateFile) throw new Error('the loader needs a state file path to sit beside');
  writePayloadCopy(payload_path, stateFile);
  const loader = loaderSource(stateFile);

  const backup = backupOf(file);
  let base;
  if (fs.existsSync(backup)) {
    base = fs.readFileSync(backup, 'utf8');
  } else {
    base = fs.readFileSync(file, 'utf8');
    if (base.includes(MARKER)) throw new Error('already patched, but no backup exists');
    fs.writeFileSync(backup, base, 'utf8');
  }

  fs.writeFileSync(file, base + loader, 'utf8');
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

/**
 * Whether `file` is byte-for-byte the bundle this build shipped: its SHA-256
 * against the one product.json records for it. A half-extracted file, an
 * already patched one and a foreign edit all fail, which is the point - the
 * backup is taken from whatever this says yes to.
 */
function isPristine(appRoot, file) {
  try {
    const product = JSON.parse(fs.readFileSync(path.join(appRoot, 'product.json'), 'utf8'));
    const key = path.relative(path.join(appRoot, 'out'), file).split(path.sep).join('/');
    const want = product.checksums && product.checksums[key];
    const got = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('base64').replace(/=+$/, '');
    return typeof want === 'string' && want === got;
  } catch (e) { return false; }
}

/**
 * Patch the builds a background update has staged beside the running one.
 *
 * A Windows user install with update.enableWindowsBackgroundUpdates extracts the
 * next version into its own <install>/<commit> folder while this one runs, hours
 * before anyone restarts; the restart only swaps Code.exe and deletes the old
 * folder, leaving the new one untouched (inno-updater: "preserving commit
 * folder"). Patching it now is what makes the first launch after an update glow,
 * instead of that launch re-patching and asking for one more restart.
 *
 * Only for someone who patched before - targets.json exists until they remove
 * the patch on purpose. Its entries are not consulted, since the update deletes
 * the folder they point at. Only folders named like a commit, so an install
 * without that layout never reaches out to its neighbours in Programs.
 * Everything else - system installs, background updates off, macOS (the staged
 * .app is signature-checked), Linux (no staging) - finds nothing here and falls
 * back to the prompt on the next launch.
 */
const COMMIT_DIR = /^[0-9a-f]{10}$/;

function patchStaged(appRoot, payload_path, stateFile) {
  const done = [];
  if (process.platform !== 'win32' || !fs.existsSync(targetsFileOf(stateFile))) return done;
  const own = path.resolve(appRoot, '..', '..');
  if (!COMMIT_DIR.test(path.basename(own))) return done;

  let entries;
  try { entries = fs.readdirSync(path.dirname(own), { withFileTypes: true }); } catch (e) { return done; }
  for (const d of entries) {
    if (!d.isDirectory() || !COMMIT_DIR.test(d.name) || d.name === path.basename(own)) continue;
    const root = path.join(path.dirname(own), d.name, 'resources', 'app');
    const file = findWorkbenchJs(root);
    if (!file || !isPristine(root, file)) continue;
    try { applyPatch(file, payload_path, stateFile); done.push(file); } catch (e) { /* read-only: the prompt still comes */ }
  }
  if (done.length) rememberTargets(stateFile, recallTargets(stateFile).concat(done));
  return done;
}

const payloadPath = () => path.join(__dirname, 'neon-glow.js');

module.exports = {
  applyPatch, removePatch, isPatched, isPristine, patchStaged, patchedStamp, payloadStamp, rivalGlow, writeBlocker,
  loaderStamp, loaderSource, writePayloadCopy, payloadCopyPath, payloadCopyStamp,
  rememberTargets, recallTargets, forgetTargets,
  backupOf, payloadPath,
  toVscodeFileUrl, defaultStateFile, ensureStateFile, writeState, readState,
  defaultExtensionsDir, FOLDER_PAYLOAD_SINCE,
};
