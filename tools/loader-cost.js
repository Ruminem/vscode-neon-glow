#!/usr/bin/env node
'use strict';
/**
 * What the loader idea would actually cost, in milliseconds.
 *
 * The idea: leave a stub in workbench.js that fetches the real payload from the
 * extension folder, so a VS Code update stops wiping the patch and re-patching
 * goes away for good. It has sat in NEXT.md as "deferred" on the grounds that
 * the glow would arrive late - a window that paints plain and then lights up.
 *
 * That trade was never measured, in a repository whose own rule is that a
 * performance claim without a reading is arithmetic. This measures the half
 * that was missing.
 *
 * What the loader adds is one fetch before the payload can start. Everything
 * after that is unchanged: the payload still waits for .vscode-tokens-styles to
 * have something in it before it can build a stylesheet at all, and that wait
 * is the same either way. So the question is how the fetch compares with the
 * waiting that is already there.
 *
 *   Code.exe --remote-debugging-port=9222 <some folder>
 *   node tools/loader-cost.js --port 9222
 *
 * From a plain shell - see tools/cdp.js for why.
 */

const path = require('path');
const fs = require('fs');
const { attach } = require('./cdp.js');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i === -1 ? fallback : argv[i + 1];
};
const PORT = Number(arg('port', 9222));
const ROUNDS = Number(arg('rounds', 12));

/* The same shape patch.js gives the state file. */
function toVscodeFileUrl(fsPath) {
  let p = String(fsPath).split('\\').join('/');
  if (p.charAt(0) !== '/') p = '/' + p;
  return 'vscode-file://vscode-app' + encodeURI(p);
}

/** The newest installed copy of this extension, which is what a loader would read. */
function installedPayload() {
  const dir = path.join(process.env.USERPROFILE || process.env.HOME, '.vscode', 'extensions');
  const mine = fs.readdirSync(dir)
    .filter((n) => n.indexOf('ruminem.vscode-neon-glow-') === 0)
    .sort();
  if (!mine.length) throw new Error('no installed copy of the extension to read');
  return path.join(dir, mine[mine.length - 1], 'neon-glow.js');
}

const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

async function main() {
  const file = installedPayload();
  const url = toVscodeFileUrl(file);
  const bytes = fs.statSync(file).size;

  let cdp, evaluate;
  try { ({ cdp, evaluate } = await attach(PORT)); }
  catch (e) { console.error(e.message); process.exitCode = 1; return; }

  console.log('payload  ' + path.basename(path.dirname(file)) + '/' + path.basename(file)
    + '  ' + (bytes / 1024).toFixed(1) + ' KB');
  console.log('rounds   ' + ROUNDS + '\n');

  /* One fetch, timed inside the renderer, cache defeated so every round pays
     what a cold start would pay.
     Raced against a timer rather than awaited on its own: a vscode-file URL the
     renderer is not allowed to read does not always reject promptly, and an
     evaluate that waits on a promise nobody settles hangs the whole run with no
     message. Ask a question that always answers. */
  const once = async (i) => evaluate(
    "(() => { const t = performance.now();"
    + " const go = fetch(" + JSON.stringify(url + '?r=' + i) + ")"
    + "   .then(r => r.text().then(x => ({ ms: performance.now() - t, ok: r.ok, len: x.length })),"
    + "         e => ({ ms: performance.now() - t, ok: false, len: 0, err: String(e && e.message || e) }));"
    + " const late = new Promise(res => setTimeout(() => res({ ms: -1, ok: false, len: 0,"
    + "   err: 'did not settle in 5s' }), 5000));"
    + " return Promise.race([go, late]); })()");

  /* Whether it can be read at all comes before how long it takes, and it is the
     question the loader idea never asked. The payload would have to live
     somewhere the renderer is allowed to read; the extension folder is the
     obvious place and not obviously one of them. */
  const first = await once(0);
  if (!first.ok || !first.len) {
    console.error('The renderer cannot read the payload over vscode-file, so a loader '
      + 'reading it from there could not either.');
    console.error('  url: ' + url);
    console.error('  why: ' + (first.err || 'fetch returned ' + first.ok));
    console.error('');
    console.error('If this is a window started with --user-data-dir, that is the reason and');
    console.error('it says nothing about the idea: nothing under the real profile is readable');
    console.error('from one of those. Run it against a normally launched window.');
    console.error('If it happens there too, the payload wants to live in globalStorage');
    console.error('instead - state.json is read from there every second of every session,');
    console.error('so that root is known to work.');
    cdp.close();
    process.exitCode = 1;
    return;
  }

  const runs = [];
  for (let i = 1; i <= ROUNDS; i++) {
    const r = await once(i);
    runs.push(r.ms);
    console.log('  fetch ' + String(i).padStart(2) + '  ' + r.ms.toFixed(2) + ' ms'
      + (r.len === first.len ? '' : '  (' + r.len + ' bytes?)'));
  }

  /* What the payload is waiting for anyway. paint entries are relative to the
     navigation that opened this window, so they say when there was first
     something on screen; the token stylesheet is what the glow itself waits on,
     and it cannot be built before that exists. */
  const context = await evaluate(
    "(() => { const p = {};"
    + " for (const e of performance.getEntriesByType('paint')) p[e.name] = e.startTime;"
    + " const t = document.querySelector('.vscode-tokens-styles');"
    + " return { paint: p, tokenBytes: t ? t.textContent.length : 0,"
    + "          glow: !!document.getElementById('neon-glow-styles') }; })()");

  cdp.close();

  const mid = median(runs);
  console.log('\nfetch, median of ' + runs.length + ': ' + mid.toFixed(2) + ' ms'
    + '   (min ' + Math.min.apply(null, runs).toFixed(2)
    + ', max ' + Math.max.apply(null, runs).toFixed(2) + ')');

  const fcp = context.paint['first-contentful-paint'];
  if (typeof fcp === 'number') {
    console.log('first contentful paint in this window: ' + fcp.toFixed(0) + ' ms after navigation');
    console.log('the fetch is ' + (mid / fcp * 100).toFixed(2) + '% of that');
  }
  console.log('token stylesheet: ' + context.tokenBytes + ' bytes'
    + ', glow stylesheet ' + (context.glow ? 'present' : 'absent'));

  console.log('\nRead it as the delay a loader would add before the payload can start.'
    + ' The waiting\nthe payload already does for the token stylesheet is unchanged,'
    + ' and happens after.');
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
