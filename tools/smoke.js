#!/usr/bin/env node
'use strict';
/**
 * Run neon-glow.js against a stub workbench and check what it emits.
 *
 * The payload is the one file here that cannot be read to see whether it works.
 * It only runs once it has been written into workbench.js, which means a
 * re-patch and a full restart per look - so a typo in a CSS string costs two
 * restarts to find, and a throw halfway down the file silently takes the first
 * paint with it. That last one is not hypothetical: it is what the visibility
 * listener did before it was wrapped, and this is what caught it.
 *
 * No dependencies, and nothing here touches a real VS Code.
 *
 *   node tools/smoke.js            run the checks
 *   node tools/smoke.js --print    also dump the stylesheet it produced
 *
 * Exits non-zero if any check fails, so it can gate a commit rather than only
 * inform one.
 */

const fs = require('fs');
const path = require('path');

const PRINT = process.argv.includes('--print');
const PAYLOAD = path.join(__dirname, '..', 'neon-glow.js');

/* Keep the real timers: the stubs below hand the payload unref'd ones so its
   own polling loop cannot hold this process open. */
const realSetTimeout = setTimeout;
const realSetInterval = setInterval;
const wait = (ms) => new Promise((r) => realSetTimeout(r, ms));

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  ok    ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
}

/** Every node the payload builds, so a test can look at what it made. */
function node(tag) {
  return {
    tag: tag || 'div', id: '', className: '', textContent: '', disabled: false,
    isConnected: true,
    style: { cssText: '', setProperty(k, v) { this[k] = v; } },
    children: [], attrs: {}, anims: [],
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); },
    appendChild(n) { this.children.push(n); return n; },
    append() { for (const n of arguments) this.children.push(n); },
    remove() { this.isConnected = false; },
    animate(frames, opts) { this.anims.push({ frames, opts }); return {}; },
    getBoundingClientRect() { return { left: 400, top: 200, width: 2, height: 18 }; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    /* Depth-first, for asserting on what a wrapper ended up containing. */
    descendants() {
      const out = [];
      for (const c of this.children) { out.push(c); out.push.apply(out, c.descendants()); }
      return out;
    }
  };
}

/**
 * A workbench that is just enough DOM for the payload to run in.
 *
 * `crippled` leaves document.addEventListener off. A real renderer always has
 * it; the point is to prove that the payload finishes even when something in
 * the middle of it is missing, because everything after that line - including
 * the first paint - depends on it not throwing.
 */
function makeStub(opts) {
  opts = opts || {};
  const appended = [];
  const observers = [];
  const classes = new Set();

  const tokens = { textContent: opts.tokens || '.mtk1 { color: #ff2f92; }\n.mtk2 { color: #808080; }' };
  const workbench = {
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) }
  };
  const statusEl = { textContent: 'NEON:ON', isConnected: true };

  /* The focused editor, its cursors layer, and the caret inside it. */
  const caret = node('div');
  caret.style.left = '100px';
  caret.style.top = '50px';
  const layer = node('div');
  layer.querySelector = (s) => (s === '.cursor' ? caret : null);

  const document = {
    hidden: false,
    documentElement: { setAttribute() {} },
    head: { appendChild: (n) => { if (!appended.includes(n)) appended.push(n); } },
    body: { appendChild: (n) => { if (!appended.includes(n)) appended.push(n); return n; } },
    getElementById: (id) => appended.find((n) => n.id === id) || null,
    querySelector: (s) => s === '.vscode-tokens-styles' ? tokens
                        : s === '.monaco-workbench' ? workbench
                        : s === '.monaco-editor.focused .cursors-layer' ? layer : null,
    querySelectorAll: () => [statusEl],
    createElement: node,
    createElementNS: (ns, tag) => { const n = node(tag); n.ns = ns; return n; }
  };
  if (!opts.crippled) document.addEventListener = () => {};

  const globals = {
    window: {
      addEventListener() {},
      matchMedia: () => ({ matches: !!opts.reduceMotion })
    },
    document,
    getComputedStyle: () => ({
      getPropertyValue: (p) =>
        p === '--vscode-editorCursor-foreground' ? '#22d3ee' : ''
    }),
    MutationObserver: class {
      constructor(cb) { this.cb = cb; }
      observe(target) { observers.push({ cb: this.cb, target }); }
      disconnect() {}
    },
    requestAnimationFrame: (f) => realSetTimeout(f, 0),
    setTimeout: (f, ms) => { const t = realSetTimeout(f, ms); if (t.unref) t.unref(); return t; },
    setInterval: (f, ms) => { const t = realSetInterval(f, ms); if (t.unref) t.unref(); return t; },
    fetch: () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ enabled: true, seq: 1, knobs: opts.knobs || {} })
    })
  };

  return {
    globals, appended, observers, classes, statusEl, tokens, workbench, caret, layer,
    styles() {
      const s = appended.find((n) => n.id === 'neon-glow-styles');
      return s ? s.textContent : '';
    },
    callbackFor(target) {
      const o = observers.find((x) => x.target === target);
      return o ? o.cb : null;
    },
    /* Whatever the caret arc appended to the body, if anything. */
    drawn() {
      return appended.filter((n) => n.style && /position:fixed/.test(n.style.cssText || ''));
    },
    /* Move the caret and let the payload notice. */
    async jump(px) {
      const cb = this.callbackFor(this.layer);
      if (!cb) return false;
      this.caret.style.left = px + 'px';
      cb();
      await wait(40);
      return true;
    }
  };
}

function run(opts) {
  const stub = makeStub(opts);
  for (const k of Object.keys(stub.globals)) global[k] = stub.globals[k];

  let src = fs.readFileSync(PAYLOAD, 'utf8');
  /* A live-looking URL so the settings path runs; the fetch above answers it. */
  src = src.replace('__NEON_STATE_URL__', 'vscode-file://state.json');
  eval(src);

  stub.api = global.window.__neonGlow || null;
  return stub;
}

async function main() {
  console.log('payload: ' + path.relative(process.cwd(), PAYLOAD) + '\n');

  /* ---- defaults: the glow runs, the opt-ins stay dark ---- */
  console.log('defaults');
  let s = run({});
  await wait(80);
  let css = s.styles();

  check('the payload finishes and exposes its API', !!s.api);
  check('a vivid colour glows', /\.mtk1 \{[^}]*text-shadow:/.test(css));
  check('a flat colour is skipped', /\.mtk2 \{ color: #808080; \}/.test(css));
  check('brackets get their own rule', css.indexOf('bracket-highlighting-') !== -1);
  check('no caret transition', css.indexOf('transition: transform') === -1);
  check('no jolt keyframes', css.indexOf('neon-glow-shake') === -1);
  check('no find bloom', css.indexOf('.findMatch') === -1);
  check('no selection bloom', css.indexOf('.selected-text') === -1);
  await s.jump(600);
  check('no arc on a jump', s.drawn().length === 0);

  /* ---- knobs arriving over the state file ---- */
  console.log('\nknobs over state.json');
  s = run({ knobs: { cursorTrail: 45, saveShake: 6, findGlow: 18, selectionGlow: 12 } });
  await wait(120);
  css = s.styles();

  check('caret transition emitted', /transition: transform 45ms/.test(css));
  check('jolt keyframes emitted', /@keyframes neon-glow-shake/.test(css));
  check('find bloom emitted', /\.findMatch \{ box-shadow:/.test(css));
  check('selection bloom emitted', /\.selected-text \{ box-shadow:/.test(css));
  check('moving effects respect reduced motion',
    (css.match(/prefers-reduced-motion/g) || []).length === 2);

  /* ---- a save, carried on the status bar label ---- */
  console.log('\nsave pulse');
  const cb = s.callbackFor(s.statusEl);
  check('the status bar item is being watched', !!cb);
  if (cb) {
    check('no jolt before a save', s.classes.size === 0);
    s.statusEl.textContent = 'NEON:ON' + String.fromCharCode(0x200b);
    cb();
    await wait(60);
    check('a pulse plays the jolt', s.classes.has('neon-glow-shaking'));

    s.workbench.classList.remove('neon-glow-shaking');
    s.statusEl.textContent = 'NEON:ON' + String.fromCharCode(0x200b).repeat(2);
    cb();
    await wait(60);
    check('a second pulse plays it again', s.classes.has('neon-glow-shaking'));
  }

  /* ---- the switch still works ---- */
  console.log('\ntoggle');
  check('starts enabled', s.api.isEnabled() === true);
  s.api.disable();
  check('disabling parks the stylesheet',
    s.api.isEnabled() === false && s.appended.find((n) => n.id === 'neon-glow-styles').disabled === true);
  s.api.enable();
  check('enabling brings it back',
    s.api.isEnabled() === true && s.appended.find((n) => n.id === 'neon-glow-styles').disabled === false);

  /* ---- the caret arc, which builds elements rather than a stylesheet ---- */
  console.log('\ncaret arc');
  s = run({ knobs: { caretArc: 'arc' } });
  await wait(120);
  check('a word knob is accepted', !!s.callbackFor(s.layer),
    'the style never reached the payload, so no caret is being watched');
  await s.jump(600);
  let drawn = s.drawn();
  check('a long jump draws something', drawn.length === 1);
  if (drawn.length) {
    const kids = drawn[0].descendants();
    const svg = kids.filter((n) => n.tag === 'svg');
    const lines = kids.filter((n) => n.tag === 'polyline');
    check('built as SVG, not as markup', svg.length === 1 && !!svg[0].ns);
    check('wire, bloom and core', lines.length === 3);
    check('the path is jagged', (lines[0].attrs.points || '').split(' ').length > 3);
    check('the colour comes from the theme', lines[0].attrs.stroke === '#22d3ee');
    check('the spark travels rather than grows',
      lines.every((l) => l.anims.length === 1)
      && lines[1].anims[0].frames.some((f) => 'strokeDashoffset' in f));
  }

  s = run({ knobs: { caretArc: 'arc' } });
  await wait(120);
  await s.jump(110);
  check('a short jump draws nothing', s.drawn().length === 0);

  s = run({ knobs: { caretArc: 'flash' } });
  await wait(120);
  await s.jump(114);
  drawn = s.drawn();
  check('flash fires where a path style would not', drawn.length === 1);
  if (drawn.length) {
    check('flash draws no path', drawn[0].descendants().length === 0);
    check('flash is animated', drawn[0].anims.length === 1);
  }

  s = run({ knobs: { caretArc: 'arc' }, reduceMotion: true });
  await wait(120);
  await s.jump(600);
  check('reduced motion draws nothing', s.drawn().length === 0);

  /* ---- the regression this file was written for ---- */
  console.log('\nmissing document.addEventListener');
  s = run({ crippled: true });
  await wait(80);
  check('the payload still finishes', !!s.api,
    'something in the middle threw and took the rest of the file with it');
  check('and still paints', /text-shadow:/.test(s.styles()));

  if (PRINT) {
    console.log('\n---- stylesheet ----\n' + run({
      knobs: { cursorTrail: 45, saveShake: 6, findGlow: 18, selectionGlow: 12 }
    }).styles());
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
