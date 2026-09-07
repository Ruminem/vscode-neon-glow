#!/usr/bin/env node
'use strict';
/**
 * Paired A/B benchmark for the glow formula, driven over the Chrome DevTools
 * Protocol.
 *
 * Why this exists rather than a stopwatch and the Performance panel: raster
 * time drifts downwards as caches warm, so whichever variant is measured second
 * wins on nothing at all. A single reading cannot tell -33% from -10%, and the
 * only way out is to alternate the two variants A B A B and compare each pair -
 * which is not something anyone will do by hand often enough to stay honest.
 *
 * No dependencies. Node 22 and later expose WebSocket as a global and the
 * target list arrives over plain fetch, so this stays inside the rule that this
 * repository installs nothing.
 *
 *   node tools/bench.js --port 9222 --rounds 6
 *
 * It attaches to a VS Code that is already listening. Launch one with:
 *
 *   Code.exe --remote-debugging-port=9222 --user-data-dir <scratch> <big file>
 *
 * Launch it from a plain shell, not from VS Code's integrated terminal. That
 * terminal exports ELECTRON_RUN_AS_NODE=1, and with it set Code.exe starts as
 * Node instead of as an editor: it exits at once, creates no user-data-dir, and
 * answers every VS Code flag with "bad option", which reads like the flags are
 * wrong rather than the environment. Unset it first if you have to.
 *
 * Open a dense file and leave it on screen: the numbers only mean something
 * against a viewport with many glowing tokens in it, and the run prints how
 * many it found so that two runs can be compared at all.
 */

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i === -1 ? fallback : argv[i + 1];
};

const PORT = Number(arg('port', 9222));
const ROUNDS = Number(arg('rounds', 6));
const WHEELS = Number(arg('wheels', 40));

/* ------------------------------------------------------------------ *
 * A minimal CDP client. One socket to the browser endpoint; page-scoped
 * commands carry a sessionId, browser-scoped ones (Tracing) do not.
 * ------------------------------------------------------------------ */
function connect(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  const listeners = new Map();
  let nextId = 1;

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject, method } = pending.get(msg.id);
      pending.delete(msg.id);
      /* Name the command in the error. "Invalid parameters" on its own says
         nothing about which of a dozen calls produced it. */
      if (msg.error) reject(new Error(method + ': ' + msg.error.message
        + (msg.error.data ? ' (' + msg.error.data + ')' : '')));
      else resolve(msg.result);
      return;
    }
    const fns = listeners.get(msg.method);
    if (fns) for (const fn of fns) fn(msg.params);
  });

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', () => reject(new Error('could not open ' + url)));
  });

  return {
    ready,
    send(method, params, sessionId) {
      const id = nextId++;
      const payload = { id, method, params: params || {} };
      if (sessionId) payload.sessionId = sessionId;
      ws.send(JSON.stringify(payload));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject, method }));
    },
    on(method, fn) {
      if (!listeners.has(method)) listeners.set(method, []);
      listeners.get(method).push(fn);
    },
    close() { ws.close(); }
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ *
 * The two formulas, as source that runs inside the renderer.
 *
 * Both variants are injected the same way - a stylesheet rebuilt from
 * .vscode-tokens-styles and appended last - so the comparison is between two
 * sets of shadows rather than between "an override" and "whatever was already
 * there". A is what the payload ships today; B is the candidate.
 * ------------------------------------------------------------------ */
const APPLY = String.raw`(function (variant) {
  var old = document.getElementById('bench-formula');
  if (old) old.remove();
  if (!variant) return { glowing: 0, spans: 0 };

  var src = document.querySelector('.vscode-tokens-styles').textContent;
  var MINC = 0.30, MINL = 0.25, SPAN = 0.50, FLOOR = 0.40;

  function hex2(x) {
    var v = Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16);
    return v.length < 2 ? '0' + v : v;
  }

  var glowing = 0;
  var css = src.replace(/color:\s*#([0-9a-fA-F]{6})\s*;/g, function (m, h) {
    var r = parseInt(h.slice(0,2),16)/255,
        g = parseInt(h.slice(2,4),16)/255,
        b = parseInt(h.slice(4,6),16)/255;
    var mx = Math.max(r,g,b), mn = Math.min(r,g,b), L = (mx+mn)/2, C = mx-mn;
    if (L < MINL || C < MINC) return m;
    var k = FLOOR + (1 - FLOOR) * Math.max(0, Math.min(1, (C - MINC) / SPAN));
    glowing++;

    var s;
    if (variant === 'A') {
      s = '0 0 ' + Math.max(1, Math.round(1 + k)) + 'px #' + h + hex2(0.95*k)
        + ', 0 0 ' + Math.round(2 + 3*k) + 'px #' + h + hex2(0.75*k)
        + ', 0 0 ' + Math.round(6 + 10*k) + 'px #' + h + hex2(0.65*k)
        + ', 0 0 ' + Math.round(14 + 22*k) + 'px #' + h + hex2(0.40*k);
    } else {
      s = '0 0 1px #' + h + hex2(1.00*k)
        + ', 0 0 ' + (Math.round(4*k) + 1) + 'px #' + h + hex2(0.65*k)
        + ', 0 0 ' + Math.max(1, Math.round(11*k)) + 'px #' + h + hex2(0.32*k)
        + ', 0 0 ' + Math.max(1, Math.round(26*k)) + 'px #' + h + hex2(0.14*k);
    }
    return 'color:#' + h + '; text-shadow:' + s + ' !important;';
  });

  var el = document.createElement('style');
  el.id = 'bench-formula';
  el.textContent = css;
  document.head.appendChild(el);

  return {
    glowing: glowing,
    spans: document.querySelectorAll('.monaco-editor .view-line span[class*="mtk"]').length
  };
})`;

async function main() {
  let targets;
  try {
    targets = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
  } catch (e) {
    console.error('No debugger on port ' + PORT + '.');
    console.error('Launch VS Code with --remote-debugging-port=' + PORT + ' and try again.');
    process.exit(1);
  }

  const page = targets.find((t) => t.type === 'page' && /workbench\.html/.test(t.url || ''));
  if (!page) {
    console.error('Found ' + targets.length + ' target(s) but no workbench page.');
    process.exit(1);
  }

  const version = await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json();
  const cdp = connect(version.webSocketDebuggerUrl);
  await cdp.ready;

  /* The HTTP target list calls it "id"; the protocol command wants "targetId".
     Same target, two names, and the mismatch only shows up as a deserialize
     error with no field name in it. */
  const attached = await cdp.send('Target.attachToTarget',
    { targetId: page.targetId || page.id, flatten: true });
  const sid = attached.sessionId;
  await cdp.send('Runtime.enable', {}, sid);

  const evaluate = async (expr) => {
    const r = await cdp.send('Runtime.evaluate',
      { expression: expr, returnByValue: true }, sid);
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.text + ' :: ' +
        ((r.exceptionDetails.exception || {}).description || '').split('\n')[0]);
    }
    return r.result.value;
  };

  /* Where to point the wheel. */
  const rect = await evaluate(
    "(() => { const e = document.querySelector('.monaco-editor');" +
    " if (!e) return null; const r = e.getBoundingClientRect();" +
    " return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })()");
  if (!rect) {
    console.error('No editor on screen. Open a file in the target window first.');
    process.exit(1);
  }

  const wheel = (dy) => cdp.send('Input.dispatchMouseEvent',
    { type: 'mouseWheel', x: rect.x, y: rect.y, deltaX: 0, deltaY: dy,
      button: 'none', clickCount: 0 }, sid);

  /* ---- tracing is browser-scoped, so it goes without a sessionId ---- */
  let collected = [];
  BENCH_SOCKET = cdp;
  cdp.on('Tracing.dataCollected', (p) => { collected = collected.concat(p.value || []); });

  async function traceScroll() {
    collected = [];
    await cdp.send('Tracing.start', {
      traceConfig: {
        recordMode: 'recordAsMuchAsPossible',
        includedCategories: ['disabled-by-default-devtools.timeline']
      }
    });
    for (let i = 0; i < WHEELS; i++) { await wheel(120); await sleep(16); }
    await sleep(300);

    const done = new Promise((resolve) => cdp.on('Tracing.tracingComplete', resolve));
    await cdp.send('Tracing.end');
    await done;

    let us = 0, n = 0;
    for (const ev of collected) {
      if (ev.name === 'RasterTask' && typeof ev.dur === 'number') { us += ev.dur; n++; }
    }
    return { ms: us / 1000, tasks: n };
  }

  console.log('port ' + PORT + '  rounds ' + ROUNDS + '  wheels/round ' + WHEELS);
  const info = await evaluate(APPLY + "('B')");
  console.log('viewport: ' + info.spans + ' token spans, '
    + info.glowing + ' glowing colour rules\n');

  const runs = { A: [], B: [] };
  for (let round = 0; round < ROUNDS; round++) {
    const variant = round % 2 === 0 ? 'A' : 'B';

    /* Back to the top, untraced, so every round rasterises the same content. */
    for (let i = 0; i < WHEELS + 10; i++) await wheel(-120);
    await evaluate(APPLY + "('" + variant + "')");
    await sleep(500);

    const r = await traceScroll();
    runs[variant].push(r.ms);
    console.log('round ' + (round + 1) + '  ' + variant + '  '
      + r.ms.toFixed(1) + ' ms raster  (' + r.tasks + ' tasks)');
  }

  await evaluate(APPLY + '(null)');
  cdp.close();

  /* Pair each A with the B that followed it: adjacent in time, so whatever
     drift is left applies to both halves of a pair rather than to one of them. */
  const pairs = Math.min(runs.A.length, runs.B.length);
  if (!pairs) { console.error('\nnothing to pair'); return; }

  console.log('\npaired');
  let sum = 0;
  for (let i = 0; i < pairs; i++) {
    const a = runs.A[i], b = runs.B[i];
    const d = ((b - a) / a) * 100;
    sum += d;
    console.log('  A ' + a.toFixed(1) + ' -> B ' + b.toFixed(1)
      + ' ms   ' + (d >= 0 ? '+' : '') + d.toFixed(1) + '%');
  }
  const mean = sum / pairs;
  console.log('\nB vs A, mean of pairs: ' + (mean >= 0 ? '+' : '') + mean.toFixed(1) + '%');
}

/* Held so a failure can shut the socket before exiting. Calling process.exit()
   with it still open trips a libuv assertion and buries the real message. */
let BENCH_SOCKET = null;

main().catch((e) => {
  console.error(e.message);
  if (BENCH_SOCKET) BENCH_SOCKET.close();
  process.exitCode = 1;
});
