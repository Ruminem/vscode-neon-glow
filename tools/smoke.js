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
const pkg = require('../package.json');

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
  const winListeners = {};
  const classes = new Set();
  let fetches = 0;          /* how many times the payload has read the state file */

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
  /* The caret's inline left/top are relative to this, and the arc has to read
     them rather than the caret's own rect: a cursorTrail transition leaves that
     rect showing the position being left, not the one being arrived at. A
     corner well away from the caret's rect is what makes the two tell apart. */
  layer.getBoundingClientRect = () => ({ left: 60, top: 50, width: 800, height: 400 });
  caret.offsetParent = layer;

  const document = {
    hidden: false,
    documentElement: { setAttribute() {} },
    head: { appendChild: (n) => { if (!appended.includes(n)) appended.push(n); } },
    body: { appendChild: (n) => { if (!appended.includes(n)) appended.push(n); return n; } },
    getElementById: (id) => appended.find((n) => n.id === id) || null,
    /* Deliberately no answer for a ".focused" lookup. Nothing may have focus -
       the panel, a dialog and the developer tools all take it away - and the
       arc used to ask for the focused editor and therefore find nothing. */
    querySelector: (s) => s === '.vscode-tokens-styles' ? tokens
                        : s === '.monaco-workbench' ? workbench
                        : s === '.monaco-reduce-motion' && opts.vscodeReduceMotion ? workbench : null,
    querySelectorAll: (s) => s === '.monaco-editor .cursors-layer' ? [layer] : [statusEl],
    createElement: node,
    createElementNS: (ns, tag) => { const n = node(tag); n.ns = ns; return n; }
  };
  if (!opts.crippled) document.addEventListener = () => {};

  const globals = {
    window: {
      /* Kept rather than dropped: the arc tells a click from a drag by whether
         the button is still down, and that only exists as a listener. */
      addEventListener(type, fn) { (winListeners[type] = winListeners[type] || []).push(fn); },
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
    fetch: () => {
      fetches++;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ enabled: true, seq: 1, knobs: opts.knobs || {} })
      });
    }
  };

  return {
    globals, appended, observers, classes, statusEl, tokens, workbench, caret, layer,
    fetches: () => fetches,
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
    },
    /* The same with a line to travel as well. Down and Up moved the caret only
       on this axis, which the arc refused to draw at all until the path stopped
       being laid along a horizontal line. */
    async jumpTo(x, y) {
      const cb = this.callbackFor(this.layer);
      if (!cb) return false;
      this.caret.style.left = x + 'px';
      this.caret.style.top = y + 'px';
      cb();
      await wait(40);
      return true;
    },
    /* Press and release the primary mouse button. What the arc reads to tell a
       click from a drag. */
    mouse(type) {
      for (const fn of winListeners[type] || []) fn({ button: 0 });
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
  /* It changed no pixel and cost a compositing layer per glowing span, so it
     should not find its way back in. */
  check('glow rules carry no backface-visibility', css.indexOf('backface-visibility') === -1);
  check('a flat colour is skipped', /\.mtk2 \{ color: #808080; \}/.test(css));
  check('brackets get their own rule', css.indexOf('bracket-highlighting-') !== -1);
  /* The line the defaults are drawn on: a knob that only decides what colour
     lands where is on, a knob that moves something is off. Both halves are
     checked, because either one drifting is a change every user sees. */
  check('no caret slide', css.indexOf('.cursor { transition: none') === -1 && s.api.trailWatching() === 0);
  check('no jolt keyframes', css.indexOf('neon-glow-shake') === -1);
  check('find bloom is on by default', /\.findMatch \{ box-shadow: 0 0 18px 6px/.test(css));
  check('find bloom lifts a theme colour too dark to glow',
    /\.findMatch \{[^}]*oklch\(from var\(--vscode-editor-findMatchHighlightBackground\) max\(l, 0\.6\) c h \/ alpha\)/.test(css)
    && /\.currentFindMatch \{[^}]*oklch\(from var\(--vscode-editor-findMatchBackground\) max\(l, 0\.6\) c h \/ alpha\)/.test(css));
  check('selection bloom is on by default', /\.selected-text \{ box-shadow: 0 0 12px/.test(css));
  check('occurrence bloom is on by default', /\.wordHighlight \{ box-shadow: 0 0 10px 3px/.test(css));
  /* The same idea reached by the mouse rather than by the caret. This went
     unlit for as long as the rule existed, so whether the effect appeared
     depended on how you had landed on the word. */
  check('and on the word a mouse selection marks, not only the caret one',
    /\.selectionHighlight \{ box-shadow: 0 0 10px 3px var\(--vscode-editor-selectionHighlightBackground\)/.test(css));
  check('gutter bloom is on by default', /dirty-diff-added:before \{ box-shadow: 0 0 8px 2px/.test(css));
  check('bracket-match bloom is on by default', /\.bracket-match \{ box-shadow: 0 0 10px var/.test(css));
  check('squiggle bloom is on by default, two passes',
    /\.squiggly-error \{ filter: drop-shadow\(0 0 2px var\(--vscode-editorError-foreground\)\) drop-shadow\(0 0 5px/.test(css));
  check('the pointed-at line glows, all four of them',
    /\.debug-top-stack-frame-line \{ box-shadow: 0 0 8px 3px var\(--vscode-editor-stackFrameHighlightBackground\)/.test(css)
    && /\.debug-focused-stack-frame-line \{ box-shadow:/.test(css)
    && /\.rangeHighlight \{ box-shadow:/.test(css)
    && /\.symbolHighlight \{ box-shadow:/.test(css));
  /* A font glyph, so the light has to follow the letterform, and in whatever
     colour it was painted - the theme does not publish one under a name this
     could ask for. */
  check('breakpoints glow in their own colour, on the glyph rather than its box',
    /codicon-debug-breakpoint[^{]*\{ text-shadow: 0 0 3px currentColor, 0 0 8px currentColor/.test(css)
    && css.indexOf('debugIcon') === -1);
  /* VS Code's own defaults for these are a faint grey fill and a dark outline,
     so the floor find takes is what lets them show at all. */
  check('snippet tabstops glow by default, lifted and spread',
    /\.snippet-placeholder \{ box-shadow: 0 0 8px 3px oklch\(from var\(--vscode-editor-snippetTabstopHighlightBackground\) max\(l, 0\.6\) c h \/ alpha\)/.test(css)
    && /\.finish-snippet-placeholder \{ box-shadow: 0 0 8px 3px oklch\(from var\(--vscode-editor-snippetFinalTabstopHighlightBorder, var\(--vscode-editor-snippetFinalTabstopHighlightBackground\)\) max\(l, 0\.6\)/.test(css));
  /* A filter, and not forced: VS Code writes the box's shadow inline, and a
     forced declaration is one the breath could not move. */
  check('the rename box glows by default, on a filter it is free to animate',
    /\.monaco-editor \.monaco-editor\.rename-box \{ filter: drop-shadow\(0 0 5px var\(--vscode-focusBorder\)\) drop-shadow\(0 0 12px var\(--vscode-focusBorder\)\); \}/.test(css));
  /* It moves, so it waits to be asked like the other three that do. */
  check('breathing is off by default', css.indexOf('neon-glow-breathe') === -1);
  check('diff bloom is on by default, on the word-level highlight',
    /\.char-insert \{ box-shadow: 0 0 10px 3px var\(--vscode-diffEditor-insertedTextBackground\)/.test(css));
  /* The line tint is deliberately left alone: a blurred full-width block bleeds
     into the lines above and below, and changed lines come in runs. */
  check('and not on the line tint behind it', css.indexOf('.line-insert') === -1);
  await s.jump(600);
  check('no arc on a jump', s.drawn().length === 0);

  /* ---- knobs arriving over the state file ---- */
  console.log('\nknobs over state.json');
  /* Every number here differs from the default, so a knob that never arrived
     cannot pass by accident - which is what these checked when the glows all
     shipped at 0 and any output at all proved the wire worked. */
  s = run({ knobs: { cursorTrail: 45, saveShake: 6, findGlow: 30, selectionGlow: 20,
            occurrenceGlow: 20, gutterGlow: 16, bracketMatchGlow: 24,
            squiggleGlow: 10, diffGlow: 24, lineHighlightGlow: 18, snippetGlow: 16,
            renameGlow: 20, breathe: 2400 } });
  await wait(120);
  css = s.styles();

  /* The slide is an animation on translate now. What reaches the stylesheet is
     only the rule that switches VS Code's own caret transition off, so the
     slide is the one motion on the caret. */
  check('the caret slide switches VS Code\'s own caret transition off',
    /prefers-reduced-motion: no-preference\) \{ \.monaco-editor \.cursor:not\(\.monaco-reduce-motion, \.monaco-reduce-motion \*\) \{ transition: none !important; \} \}/.test(css));
  check('and the caret layer is watched for the slide', s.api.trailWatching() === 1);
  check('jolt keyframes emitted', /@keyframes neon-glow-shake/.test(css));
  check('find bloom follows the knob', /\.findMatch \{ box-shadow: 0 0 30px/.test(css));
  check('selection bloom follows the knob', /\.selected-text \{ box-shadow: 0 0 20px/.test(css));
  check('occurrence bloom emitted, reads and writes apart',
    /\.wordHighlight \{ box-shadow: 0 0 20px/.test(css)
    && /\.wordHighlightStrong \{ box-shadow: 0 0 25px/.test(css));
  check('the textual fallback is lit too',
    /\.wordHighlightText \{ box-shadow:/.test(css));
  check('gutter bloom emitted for every kind',
    (css.match(/dirty-diff-[a-z]+(\.secondary)?:(before|after) \{ box-shadow:/g) || []).length === 6);
  check('the gutter glow is carried by its spread',
    /dirty-diff-added:before \{ box-shadow: 0 0 16px 4px/.test(css),
    'a width:0 box with no spread paints nothing at all');
  check('bracket-match bloom emitted, from the border colour',
    /\.bracket-match \{ box-shadow: 0 0 24px var\(--vscode-editorBracketMatch-border,/.test(css));
  check('and with no spread, its colour being opaque',
    !/\.bracket-match \{ box-shadow: 0 0 24px [0-9]/.test(css));
  check('squiggle bloom follows the knob, each kind in its own colour',
    /\.squiggly-warning \{ filter: drop-shadow\(0 0 4px var\(--vscode-editorWarning-foreground\)\) drop-shadow\(0 0 10px/.test(css)
    && /\.squiggly-info \{ filter:/.test(css));
  check('hints are left alone', css.indexOf('.squiggly-hint') === -1);
  /* A filter rather than the shadow itself: keyframes cannot outrank the
     !important the glow rules carry, and animating a text-shadow would re-raster
     its blur every frame. */
  check('breathing rides on a filter, on the surfaces that are waiting for you',
    /@keyframes neon-glow-breathe \{ 0%, 100% \{ filter: none; \} 50% \{ filter: brightness\(0\.55\); \} \}/.test(css)
    && /\.currentFindMatch:not\(\.monaco-reduce-motion, \.monaco-reduce-motion \*\), \.monaco-editor \.debug-top-stack-frame-line:not\([^)]*\), \.monaco-editor \.bracket-match:not\([^)]*\), \.monaco-editor \.snippet-placeholder:not\([^)]*\), \.monaco-editor \.finish-snippet-placeholder:not\([^)]*\) \{ animation: neon-glow-breathe 2400ms/.test(css));
  /* The rename box holds the name being typed, so a brightness filter on it
     would dim the name too; it breathes its glow's colour instead. */
  check('the rename box breathes its glow rather than itself',
    /@keyframes neon-glow-breathe-rename \{ 0%, 100% \{ filter: drop-shadow\(0 0 8px oklch\(from var\(--vscode-focusBorder\) l c h \/ alpha\)\)[^}]*\} 50% \{ filter: drop-shadow\(0 0 8px oklch\(from var\(--vscode-focusBorder\) l c h \/ calc\(alpha \* 0\.55\)\)\)/.test(css)
    && /\.monaco-editor\.rename-box:not\([^)]*\) \{ animation: neon-glow-breathe-rename 2400ms/.test(css));
  check('and nothing else is asked to breathe',
    (css.match(/neon-glow-breathe(?!-)/g) || []).length === 2
    && (css.match(/neon-glow-breathe-rename/g) || []).length === 2);
  check('snippet bloom follows the knob', /\.snippet-placeholder \{ box-shadow: 0 0 16px 5px/.test(css));
  check('rename bloom follows the knob',
    /rename-box \{ filter: drop-shadow\(0 0 8px var\(--vscode-focusBorder\)\) drop-shadow\(0 0 20px/.test(css));
  check('the pointed-at line follows the knob',
    /.rangeHighlight { box-shadow: 0 0 18px 6px/.test(css));
  check('diff bloom follows the knob, both sides in their own colours',
    /\.char-insert \{ box-shadow: 0 0 24px 8px var\(--vscode-diffEditor-insertedTextBackground\)/.test(css)
    && /\.char-delete \{ box-shadow: 0 0 24px 8px var\(--vscode-diffEditor-removedTextBackground\)/.test(css));
  check('moving effects respect reduced motion',
    (css.match(/prefers-reduced-motion/g) || []).length === 3);


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

  /* ---- the caret slide, played on translate ---- */
  console.log('\ncaret slide');
  /* The stub caret sits at left 100px, top 50px. Moving it to 300 has to put it
     back 200px to the left and animate that away over the knob's duration and
     curve, on translate, added to whatever else is on the caret. */
  s = run({ knobs: { cursorTrail: 45 } });
  await wait(120);
  check('the slide watches the caret', s.api.trailWatching() === 1);
  await s.jump(300);
  {
    const a = s.caret.anims[s.caret.anims.length - 1];
    check('a move plays the distance back on translate',
      !!a && a.frames[0].translate === '-200px 0px' && a.frames[1].translate === '0px 0px',
      a ? JSON.stringify(a.frames) : 'no animation on the caret');
    check('over the knob\'s duration and curve, added rather than replacing',
      !!a && a.opts.duration === 45 && a.opts.easing === 'ease-out' && a.opts.composite === 'add',
      a ? JSON.stringify(a.opts) : 'no animation on the caret');
  }
  /* Each axis is its own slide, as left and top were two transitions. */
  const slideAnimsBefore = s.caret.anims.length;
  await s.jumpTo(300, 80);
  {
    const added = s.caret.anims.slice(slideAnimsBefore);
    check('a move straight down slides only down',
      added.length === 1 && added[0].frames[0].translate === '0px -30px',
      JSON.stringify(added.map(x => x.frames[0])));
  }
  s = run({ knobs: { cursorTrail: 45 }, reduceMotion: true });
  await wait(120);
  await s.jump(300);
  check('reduced motion keeps the plain jump', s.caret.anims.length === 0);

  /* ---- the caret arc, which builds elements rather than a stylesheet ---- */
  console.log('\ncaret arc');
  /* Nothing to breathe on a surface whose glow is off, and a period under the
     floor is a strobe rather than a breath. */
  s = run({ knobs: { breathe: 50, findGlow: 18, lineHighlightGlow: 0, bracketMatchGlow: 0,
            snippetGlow: 0, renameGlow: 0 } });
  await wait(120);
  {
    const c = s.styles();
    check('a breath too fast to be one is held to the floor', /neon-glow-breathe 600ms/.test(c));
    check('and a surface with no glow is not asked to breathe',
      c.indexOf('debug-top-stack-frame-line { animation') === -1
      && c.indexOf('bracket-match { animation') === -1
      && c.indexOf('snippet-placeholder') === -1
      && c.indexOf('neon-glow-breathe-rename') === -1);
  }

  s = run({ knobs: { caretArc: 'arc' } });
  await wait(120);
  check('a word knob is accepted', !!s.callbackFor(s.layer),
    'the style never reached the payload, so no caret is being watched');
  check('watching without anything focused', s.api.arcWatching() === 1,
    'the arc went looking for the focused editor, which is often nothing');
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

  /* The caret starts at 100,50 inside a layer whose corner is at 100,50, so a
     move to 300 ends at 360 and the path sets out from 160 - a full move back
     from there. The caret's own rect says 400, which is the number to miss. The
     wrapper's own corner is the start, lifted by half the box the path is drawn
     in (7px of jag either side of a 14px band, so 14). */
  s = run({ knobs: { caretArc: 'arc' } });
  await wait(120);
  await s.jump(300);
  drawn = s.drawn();
  check('the path starts where the caret was, not where it is being painted',
    drawn.length === 1 && /left:160px/.test(drawn[0].style.cssText),
    'the arc is reading the caret rect mid-transition and lands a move behind');
  if (drawn.length) {
    check('and on the line the caret is on', /top:95px/.test(drawn[0].style.cssText));
  }

  /* An arrow key is about seven pixels, and the default threshold is under a
     character on purpose: holding one is meant to read as light running along
     with the caret. */
  s = run({ knobs: { caretArc: 'arc' } });
  await wait(120);
  await s.jump(107);
  check('an arrow-sized move clears the default threshold', s.drawn().length === 1);
  /* A dash longer than the path it runs on animates its offset the wrong way,
     and every arrow key is a seven pixel path. */
  check('the spark never runs backwards', (function () {
    const drawn = s.drawn();
    if (!drawn.length) return false;
    const lines = drawn[0].descendants().filter((n) => n.tag === 'polyline');
    return lines.length > 0 && lines.every((l) => l.anims.every((a) =>
      a.frames.every((f) => !('strokeDashoffset' in f) || f.strokeDashoffset <= 0)));
  })());

  /* The duration reaches the animation rather than sitting in the knobs unused,
     and flash rides along at its fixed fraction instead of taking a knob of its
     own. 600 * 260/300 is 520. */
  s = run({ knobs: { caretArc: 'arc', caretArcDuration: 600 } });
  await wait(120);
  await s.jump(600);
  drawn = s.drawn();
  check('the arc duration follows the knob', drawn.length === 1
    && drawn[0].descendants().filter((n) => n.tag === 'polyline')
        .every((l) => l.anims.every((a) => a.opts.duration === 600)));

  s = run({ knobs: { caretArc: 'flash', caretArcDuration: 600 } });
  await wait(120);
  await s.jump(600);
  drawn = s.drawn();
  check('and flash keeps its shorter life as a fraction of it',
    drawn.length === 1 && drawn[0].anims[0].opts.duration === 520);

  /* Out of range on the way in, not on the way out: a hand-edited settings.json
     is the only thing that can send it. */
  s = run({ knobs: { caretArc: 'arc', caretArcDuration: 5 } });
  await wait(120);
  await s.jump(600);
  drawn = s.drawn();
  check('a duration under the floor is clamped rather than drawn',
    drawn.length === 1 && drawn[0].descendants()
      .filter((n) => n.tag === 'polyline')[0].anims[0].opts.duration === 80);

  s = run({ knobs: { caretArc: 'arc', caretArcMinJump: 40 } });
  await wait(120);
  await s.jump(110);
  check('and is held back once the threshold is raised', s.drawn().length === 0);

  /* Each new shape is the same machinery with a different wander, so what
     separates them is the points list and the dash pattern - which is exactly
     what these read. A style that fell through to the default would come out
     with two points and pass nothing here. */
  s = run({ knobs: { caretArc: 'wave' } });
  await wait(120);
  await s.jump(600);
  drawn = s.drawn();
  check('wave bends regularly rather than randomly', drawn.length === 1 && (function () {
    const pts = drawn[0].descendants().filter((n) => n.tag === 'polyline')[0]
      .attrs.points.split(' ').map((p) => Number(p.split(',')[1]));
    /* Two full cycles cross the line three times between the pinned ends,
       whatever the segment count works out to. Sixty-odd points of random
       jitter cross it about thirty times, so counting the crossings is what
       separates a shape from a scatter. */
    const mid = pts[0];
    const inner = pts.slice(1, -1);
    let crossings = 0;
    for (let i = 1; i < inner.length; i++) {
      if ((inner[i - 1] - mid) * (inner[i] - mid) < 0) crossings++;
    }
    return inner.length > 8 && crossings <= 6
      && inner.some((y) => y < mid - 1) && inner.some((y) => y > mid + 1);
  })());

  s = run({ knobs: { caretArc: 'bolt' } });
  await wait(120);
  await s.jump(600);
  drawn = s.drawn();
  check('bolt alternates side to side, and strays furthest', drawn.length === 1 && (function () {
    const pts = drawn[0].descendants().filter((n) => n.tag === 'polyline')[0]
      .attrs.points.split(' ').map((p) => Number(p.split(',')[1]));
    const mid = pts[0];
    const inner = pts.slice(1, -1);
    return inner.length > 1
      && inner.every((y, i) => (i % 2 ? y > mid : y < mid) || (i % 2 ? y < mid : y > mid))
      && Math.max.apply(null, inner.map((y) => Math.abs(y - mid))) >= 10;
  })());

  s = run({ knobs: { caretArc: 'dots' } });
  await wait(120);
  await s.jump(600);
  drawn = s.drawn();
  check('dots repeat a short pattern instead of one lit head',
    drawn.length === 1 && drawn[0].descendants()
      .filter((n) => n.tag === 'polyline' && n.style.strokeDasharray)
      .every((l) => l.style.strokeDasharray === '2 7'));

  const ysOf = (d) => d.descendants().filter((n) => n.tag === 'polyline')[0]
    .attrs.points.split(' ').map((p) => Number(p.split(',')[1]));

  s = run({ knobs: { caretArc: 'coil' } });
  await wait(120);
  await s.jump(600);
  drawn = s.drawn();
  check('coil winds tighter than wave', drawn.length === 1 && (function () {
    const ys = ysOf(drawn[0]), mid = ys[0], inner = ys.slice(1, -1);
    let crossings = 0;
    for (let i = 1; i < inner.length; i++) {
      if ((inner[i - 1] - mid) * (inner[i] - mid) < 0) crossings++;
    }
    /* Six cycles against wave's two, so more crossings - but still a shape
       rather than a scatter, which is the other side of the same count. */
    return crossings >= 8 && crossings <= 14;
  })());

  s = run({ knobs: { caretArc: 'square' } });
  await wait(120);
  await s.jump(600);
  drawn = s.drawn();
  check('square holds a level before it jumps', drawn.length === 1 && (function () {
    const ys = ysOf(drawn[0]), inner = ys.slice(1, -1);
    /* Points come in pairs at the same height. A zigzag never repeats a level
       twice in a row, so this is what tells the two apart. */
    let flats = 0;
    for (let i = 1; i < inner.length; i++) if (inner[i] === inner[i - 1]) flats++;
    return inner.length > 3 && flats >= Math.floor((inner.length - 1) / 2) - 1;
  })());

  s = run({ knobs: { caretArc: 'zip' } });
  await wait(120);
  await s.jump(600);
  drawn = s.drawn();
  check('zip draws itself on rather than sliding a head along', drawn.length === 1
    && drawn[0].descendants().filter((n) => n.tag === 'polyline')
        .filter((l) => l.style.strokeDasharray)
        .every((l) => {
          const [dash, gap] = l.style.strokeDasharray.split(' ').map(Number);
          const f = l.anims[0].frames;
          /* One dash as long as the path and an equal gap, and the offset runs
             down to zero from above rather than away below it. */
          return Math.abs(dash - gap) < 0.01 && f[0].strokeDashoffset > 0
            && f[f.length - 1].strokeDashoffset === 0;
        }));

  s = run({ knobs: { caretArc: 'pulse' } });
  await wait(120);
  await s.jump(600);
  drawn = s.drawn();
  check('pulse lights the whole route without moving anything', drawn.length === 1
    && drawn[0].descendants().filter((n) => n.tag === 'polyline')
        .every((l) => !l.style.strokeDasharray
          && l.anims.every((a) => a.frames.every((f) => !('strokeDashoffset' in f)))));

  s = run({ knobs: { caretArc: 'ring' } });
  await wait(120);
  await s.jump(600);
  drawn = s.drawn();
  check('ring bursts as an edge where flash bursts as a fill', drawn.length === 1
    && /border:2px solid/.test(drawn[0].style.cssText)
    && drawn[0].style.cssText.indexOf('radial-gradient') === -1
    && drawn[0].descendants().length === 0);

  s = run({ knobs: { caretArc: 'flash' } });
  await wait(120);
  await s.jump(114);
  drawn = s.drawn();
  check('flash draws at the size of a Tab', drawn.length === 1);
  if (drawn.length) {
    check('flash draws no path', drawn[0].descendants().length === 0);
    check('flash is animated', drawn[0].anims.length === 1);
  }

  s = run({ knobs: { caretArc: 'arc' }, reduceMotion: true });
  await wait(120);
  await s.jump(600);
  check('reduced motion draws nothing', s.drawn().length === 0);

  /* Down and Up. The caret starts at 100,50 and a line is about nineteen
     pixels, so this is the plainest move there is - and it drew nothing at all
     while anything with a dy was thrown out before the threshold was even
     consulted. */
  s = run({ knobs: { caretArc: 'arc' } });
  await wait(120);
  await s.jumpTo(100, 69);
  drawn = s.drawn();
  check('a move straight down draws', drawn.length === 1,
    'the vertical guard is back, or the distance is being read off one axis');
  if (drawn.length) {
    /* Straight down is a quarter turn. Without the rotation the path would lie
       along the line it started on, which is the one direction the caret did
       not go. */
    check('the path is turned to face the way the caret went',
      /transform:rotate\(1\.570[0-9]rad\)/.test(drawn[0].style.cssText));
  }

  s = run({ knobs: { caretArc: 'arc' } });
  await wait(120);
  await s.jumpTo(60, 69);
  drawn = s.drawn();
  check('a diagonal draws too', drawn.length === 1);
  if (drawn.length) {
    /* 40 left and 19 down is 44 of travel, not 40 and not 19: the length has to
       come from both axes or a mostly-vertical move reads as a short one. */
    const svg = drawn[0].descendants().filter((n) => n.tag === 'svg')[0];
    check('and is as long as the way it actually travelled',
      !!svg && Math.abs(Number(svg.attrs.width) - Math.hypot(40, 19)) < 1);
  }

  /* A move that only the second axis makes long enough. With the distance read
     off dx alone this is four pixels and draws nothing. */
  s = run({ knobs: { caretArc: 'arc', caretArcMinJump: 15 } });
  await wait(120);
  await s.jumpTo(104, 69);
  check('a threshold measures the travel, not one side of it', s.drawn().length === 1);

  /* A click, then the drag it turns into. The press lands one move and that one
     still draws; the rest of the gesture is held back unless asked for. */
  s = run({ knobs: { caretArc: 'arc' } });
  await wait(120);
  s.mouse('pointerdown');
  await s.jump(300);
  check('the click that starts a drag still draws', s.drawn().length === 1);
  await s.jump(400);
  await s.jump(500);
  check('the drag after it does not', s.drawn().length === 1,
    'every step of a drag is drawing, which is the noise this knob exists for');
  s.mouse('pointerup');
  await s.jump(600);
  check('and the button coming up ends the drag', s.drawn().length === 2);

  /* A drag that ends somewhere this document never hears about - released
     outside the window, or alt-tabbed away from - would otherwise leave the
     button held down for good, and every caret move after it, keyboard
     included, would be read as part of that drag. */
  s = run({ knobs: { caretArc: 'arc' } });
  await wait(120);
  s.mouse('pointerdown');
  await s.jump(300);
  await s.jump(400);
  s.mouse('blur');
  await s.jump(500);
  check('losing the window ends the drag too', s.drawn().length === 2,
    'the button stays down forever and the arc never draws again');

  s = run({ knobs: { caretArc: 'arc', caretArcOnDrag: true } });
  await wait(120);
  s.mouse('pointerdown');
  await s.jump(300);
  await s.jump(400);
  check('caretArcOnDrag keeps drawing through the drag', s.drawn().length === 2);

  /* A boolean is the third type the wire carries. A string that looks like one
     is still a string, and the renderer sorts by type. */
  s = run({ knobs: { caretArc: 'arc', caretArcOnDrag: 'true' } });
  await wait(120);
  s.mouse('pointerdown');
  await s.jump(300);
  await s.jump(400);
  check('a knob that is not really a boolean is dropped', s.drawn().length === 1,
    'the string "true" was read as the switch being on');

  /* ---- the regression this file was written for ---- */
  console.log('\nmissing document.addEventListener');
  s = run({ crippled: true });
  await wait(80);
  check('the payload still finishes', !!s.api,
    'something in the middle threw and took the rest of the file with it');
  check('and still paints', /text-shadow:/.test(s.styles()));

  /* ---- and back off again ---- */
  /* Now that these ship on, zero is the setting somebody actually reaches for,
     and nothing else here would notice if a guard stopped honouring it. */
  console.log('\nturned back off');
  /* Last, and on its own stub. run() swaps the globals the payload holds, so a
     stub built here reaches back and kills every earlier one - which shows up
     as two unrelated sections failing rather than as anything about this. */
  const off = run({ knobs: { findGlow: 0, selectionGlow: 0, occurrenceGlow: 0,
            gutterGlow: 0, bracketMatchGlow: 0, squiggleGlow: 0, diffGlow: 0,
            lineHighlightGlow: 0, breakpointGlow: 0, snippetGlow: 0, renameGlow: 0 } });
  await wait(120);
  const offCss = off.styles();
  check('zero removes the snippet and rename bloom',
    offCss.indexOf('snippet-placeholder') === -1 && offCss.indexOf('rename-box') === -1);

  check('zero removes the find bloom', offCss.indexOf('.findMatch') === -1);
  check('zero removes the selection bloom', offCss.indexOf('.selected-text') === -1);
  check('zero removes the occurrence bloom', offCss.indexOf('.wordHighlight') === -1
    && offCss.indexOf('.selectionHighlight') === -1);
  check('zero removes the gutter bloom', offCss.indexOf('dirty-diff') === -1);
  check('zero removes the bracket-match bloom', offCss.indexOf('.bracket-match') === -1);
  check('zero removes the squiggle bloom', offCss.indexOf('squiggly') === -1);
  check('zero removes the diff bloom', offCss.indexOf('char-insert') === -1);
  check('zero removes the line and breakpoint bloom',
    offCss.indexOf('rangeHighlight') === -1 && offCss.indexOf('codicon-debug') === -1);
  check('and the token glow is untouched', /\.mtk1 \{[^}]*text-shadow:/.test(offCss));

  /* ---- a settings nudge on the fast channel ---- */
  /* A knob used to ride the file poll alone, which backs off to 15s while you
     are only reading - a long time to watch a slider do nothing. The extension
     now marks the label, and the marker has to wake a read without being taken
     for a save. */
  console.log('\nsettings nudge');
  const nz = run({ knobs: { saveShake: 6 } });
  await wait(120);
  const ncb = nz.callbackFor(nz.statusEl);
  check('the status bar item is watched', !!ncb);
  if (ncb) {
    nz.classes.clear();
    const before = nz.fetches();
    nz.statusEl.textContent = 'NEON:ON' + String.fromCharCode(0x2060);
    ncb();
    await wait(60);
    check('a settings nudge re-reads the state file', nz.fetches() > before,
      'the knob would wait for the poll instead');
    check('and does not play the save jolt', !nz.classes.has('neon-glow-shaking'),
      'the nudge must not read as a save');

    nz.statusEl.textContent = 'NEON:ON' + String.fromCharCode(0x2060)
      + String.fromCharCode(0x200b);
    ncb();
    await wait(60);
    check('a save still jolts with a nudge in the label', nz.classes.has('neon-glow-shaking'),
      'the trailing pulse count must survive the new marker');
  }

  /* ---- the stamp ---- */
  /* The stamp is how the extension decides its bundle is out of date, so it
     has to follow what the payload says and not how the file was checked out.
     git on Windows writes CRLF; the VSIX, built on Linux, carries LF. */
  console.log('\nstamp');
  const { payloadStamp } = require('../patch.js');
  const lfText = fs.readFileSync(PAYLOAD, 'utf8').replace(/\r\n/g, '\n');
  const fLF = path.join(require('os').tmpdir(), 'neon-stamp-lf.js');
  const fCRLF = path.join(require('os').tmpdir(), 'neon-stamp-crlf.js');
  fs.writeFileSync(fLF, lfText);
  fs.writeFileSync(fCRLF, lfText.replace(/\n/g, '\r\n'));
  check('line endings do not change the stamp', payloadStamp(fLF) === payloadStamp(fCRLF),
    'a clone on Windows would be told its own payload is out of date');
  check('an LF payload keeps the stamp it always had',
    payloadStamp(fLF) === require('crypto').createHash('sha256').update(lfText).digest('hex').slice(0, 12),
    'every install patched from an LF copy would be asked to re-patch for nothing');
  fs.unlinkSync(fLF); fs.unlinkSync(fCRLF);

  /* ---- the presets ---- */
  /* Read from presets.js rather than scraped back out of extension.js. The
     scraping version reported the word "here" as a setting, having found it in
     a comment followed by a colon. */
  console.log('\npresets');
  {
    const { PRESETS, PRESET_ORDER } = require('../presets.js');
    const extSrc = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
    const names = Object.keys(pkg.contributes.configuration.properties)
      .map(k => k.replace(/^neonGlow[.]/, ''));

    check('the knob list and the settings schema agree',
      (extSrc.match(/const KNOBS = \[([^]*?)\];/) || ['', ''])[1]
        .split(',').map(x => x.trim().replace(/'/g, '')).filter(Boolean)
        .sort().join() === names.slice().sort().join(),
      'a setting exists that the extension never sends, or the reverse');

    check('every preset is offered', PRESET_ORDER.length === Object.keys(PRESETS).length
      && PRESET_ORDER.every(k => PRESETS[k]));

    /* A knob a preset leaves out is cleared by the applier, which is a choice
       rather than an omission - so what has to hold is that the applier walks
       the knob list. Otherwise the same preset would land somewhere different
       depending on what happened to be set before it. */
    check('applying a preset walks the knob list, not the preset',
      /for [(]const k of KNOBS[)][^]{0,260}config[.]update/.test(extSrc),
      'a knob a preset omits would keep its old value instead of clearing');

    for (const k of PRESET_ORDER) {
      const v = PRESETS[k].values;
      if (!v) continue;
      const strays = Object.keys(v).filter(n => names.indexOf(n) === -1);
      check(PRESETS[k].label + ' names only knobs that exist', strays.length === 0,
        'not a setting: ' + strays.join(', '));
      const bad = Object.keys(v).filter(n => {
        const spec = pkg.contributes.configuration.properties['neonGlow.' + n];
        if (!spec) return true;
        if (spec.enum) return spec.enum.indexOf(v[n]) === -1;
        if (spec.type === 'number') return typeof v[n] !== 'number'
          || v[n] < spec.minimum || v[n] > spec.maximum;
        if (spec.type === 'boolean') return typeof v[n] !== 'boolean';
        return false;
      });
      check(PRESETS[k].label + ' stays inside what the schema allows', bad.length === 0,
        'out of range or wrong type: ' + bad.join(', '));
    }

    /* The one a stale preset really would get wrong: everything-on is the only
       place the four that ship off are turned on, so an effect added without
       touching it would silently stay dark there. */
    const all = PRESETS.everything.values;
    for (const off of ['cursorTrail', 'saveShake', 'breathe', 'caretArc']) {
      check('everything-on actually turns on ' + off,
        all[off] !== 0 && all[off] !== 'off' && all[off] !== undefined,
        'it ships off and this preset leaves it off, so nothing there would move');
    }

    check('the command is contributed',
      pkg.contributes.commands.some(c => c.command === 'neonGlow.preset'));
  }

  /* ---- the payload is still findable once it is in a bundle ---- */
  /* The marker and the stamp sit at the top of what gets appended, and both are
     looked for in a window off the end of the file. A payload longer than that
     window puts them out of reach: the bundle is patched, every byte of it is
     right, and the extension reports it unpatched and offers to do it again.
     That is not a slow squeeze either - it arrives whole, between one release
     and the next, the first time the payload crosses the line. */
  console.log('\npatched bundle');
  const { isPatched, patchedStamp, loaderStamp, loaderSource,
          writePayloadCopy, payloadCopyPath, payloadCopyStamp, applyPatch } = require('../patch.js');
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'neon-loader-'));
  const stateFile = path.join(tmp, 'state.json');
  const fake = path.join(tmp, 'workbench.js');
  /* A megabyte of something else first, the way a real workbench.js is. */
  fs.writeFileSync(fake, '/* filler */\n'.repeat(80000));
  applyPatch(fake, PAYLOAD, stateFile);

  check('a patched bundle reads as patched', isPatched(fake),
    'the marker is outside the window it is looked for in');
  check('and the stamp in it can still be read back',
    patchedStamp(fake) === loaderStamp(stateFile),
    'the extension would ask for a re-patch on every launch');

  /* The point of the whole arrangement: the bundle carries a stub, the payload
     lives beside state.json, and the two are independent. */
  const patchedText = fs.readFileSync(fake, 'utf8');
  check('the bundle carries the loader, not the payload',
    patchedText.indexOf('import(') !== -1
    && patchedText.indexOf('.vscode-tokens-styles') === -1,
    'the payload went into the bundle, so a payload release still wants a re-patch');
  /* The copy is the payload with its placeholders filled in, so its own bytes
     never match the source. What ties them together is the stamp written into
     it on the way past. */
  check('and the payload was written where the loader will look',
    fs.existsSync(payloadCopyPath(stateFile))
    && payloadCopyStamp(stateFile) === payloadStamp(PAYLOAD));
  check('with its placeholders filled in',
    fs.readFileSync(payloadCopyPath(stateFile), 'utf8').indexOf('__NEON_STATE_URL__') === -1);

  /* The copy is the fallback now. On the first start after an update the loader
     imports the folder extensions.json names, and a payload read from there
     still has its placeholder - so it takes the state URL off window, and the
     substitution that fills the copy in must not eat that test. */
  check('a payload left unfilled takes the state URL from the loader',
    lfText.indexOf("if (STATE_URL === '__NEON_' + 'STATE_URL__') STATE_URL = window.__NEON_STATE_URL") !== -1
    && fs.readFileSync(payloadCopyPath(stateFile), 'utf8').indexOf("'__NEON_' + 'STATE_URL__'") !== -1);
  check('the extension records its version where the loader reads it',
    /writeState\(stateFile, enabled, readKnobs\(\), VERSION\)/.test(
      fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8')));

  /* Which payload the loader imports, run for real in a sandbox: fetch answers
     from a table and import() is swapped for a recorder. */
  {
    const vm = require('vm');
    const { FOLDER_PAYLOAD_SINCE } = require('../patch.js');
    const loader = loaderSource(stateFile).split('import(url)').join('__import(url)');
    const bump = v => v.split('.').map((n, i) => (i === 1 ? String(Number(n) + 1) : n)).join('.');
    const listed = v => [{ identifier: { id: 'Ruminem.vscode-neon-glow' }, version: v,
                           relativeLocation: 'ruminem.vscode-neon-glow-' + v }];
    const inFolder = u => u.indexOf('/.vscode/extensions/ruminem.vscode-neon-glow-') !== -1;
    const loadFrom = async ({ registry, state, folderFails }) => {
      const imported = [];
      const window = {};
      vm.runInNewContext(loader, {
        window, console,
        document: { documentElement: { setAttribute() {} } },
        setTimeout: fn => setTimeout(fn, 0),
        fetch: url => {
          const body = /extensions\.json$/.test(url) ? registry : /state\.json$/.test(url) ? state : undefined;
          return body === undefined ? Promise.reject(new Error('unreadable'))
            : Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
        },
        __import: url => {
          imported.push(url);
          return folderFails && inFolder(url) ? Promise.reject(new Error('refused')) : Promise.resolve({});
        },
      });
      await wait(40);
      return { imported, window };
    };
    const next = bump(FOLDER_PAYLOAD_SINCE);

    let r = await loadFrom({ registry: listed(next), state: { enabled: true, version: FOLDER_PAYLOAD_SINCE } });
    check('a newer install than state.json knows is imported from its own folder',
      r.imported.length === 1 && inFolder(r.imported[0])
      && r.imported[0].endsWith('ruminem.vscode-neon-glow-' + next + '/neon-glow.js'),
      'imported: ' + r.imported.join(', '));
    check('and is told where state.json is',
      /state\.json$/.test(r.window.__NEON_STATE_URL || ''));

    r = await loadFrom({ registry: listed(next), state: { enabled: true } });
    check('a state.json from before versions were recorded still lets it through',
      r.imported.length === 1 && inFolder(r.imported[0]));

    r = await loadFrom({ registry: listed(FOLDER_PAYLOAD_SINCE), state: { enabled: true, version: FOLDER_PAYLOAD_SINCE } });
    check('the copy, once the extension has caught it up',
      r.imported.length === 1 && !inFolder(r.imported[0]),
      'a window in another profile would take an older install listed there');

    r = await loadFrom({ registry: listed('0.15.0'), state: { enabled: true } });
    check('never a folder whose payload cannot be told where state.json is',
      r.imported.length === 1 && !inFolder(r.imported[0]));

    r = await loadFrom({ registry: undefined, state: { enabled: true } });
    check('the copy when extensions.json cannot be read',
      r.imported.length === 1 && !inFolder(r.imported[0]));

    r = await loadFrom({ registry: listed(next), state: { enabled: true }, folderFails: true });
    check('and the copy when the folder refuses the import',
      r.imported.length === 2 && inFolder(r.imported[0]) && !inFolder(r.imported[1]));
  }

  /* A payload release must not move the loader's stamp - that is what stops it
     from asking for a re-patch it does not need. */
  const before = loaderStamp(stateFile);
  const grown = path.join(tmp, 'bigger-payload.js');
  fs.writeFileSync(grown, lfText + '\n/* one more line */\n');
  writePayloadCopy(grown, stateFile);
  check('a new payload leaves the loader stamp alone',
    loaderStamp(stateFile) === before && patchedStamp(fake) === before,
    'every payload release would tell every install to re-patch');
  check('and only the copy beside state.json moved',
    payloadCopyStamp(stateFile) === payloadStamp(grown)
    && payloadCopyStamp(stateFile) !== payloadStamp(PAYLOAD));

  /* A bundle patched before the loader says "payload", and reading that as a
     loader stamp would call it current when it is one re-patch behind. */
  fs.writeFileSync(fake, '/* old */\n' + '/* ' + require('../locate.js').MARKER
    + ' [payload abc123abc123] */\n');
  check('a pre-loader bundle does not pass for a current one',
    isPatched(fake) && patchedStamp(fake) === null);

  /* The same folder reaches here spelled two ways on Windows - "c:\..." from
     VS Code's globalStorageUri, "C:\..." from %APPDATA% in the CLI. With the
     stamp hashed from a URL built on that path, the two spellings gave one
     bundle two stamps, and whichever side had not patched it last asked for it
     to be patched again. */
  {
    const upper = 'C:\\Users\\someone\\AppData\\Roaming\\Code\\User\\globalStorage\\x\\state.json';
    const lower = 'c' + upper.slice(1);
    check('the drive letter\'s case does not change the loader stamp',
      loaderStamp(upper) === loaderStamp(lower),
      'the extension and the CLI would each call the other\'s patch out of date');
  }

  fs.rmSync(tmp, { recursive: true, force: true });

  /* ---- settings descriptions, one file per language ---- */
  /* package.json names a key and the text lives in package.nls.json (English)
     and package.nls.ko.json (Korean). A key with no text shows up in the
     Settings UI as the raw %key%, and a translation that dropped a value or a
     setting link sends someone to the wrong number or a dead link - so the two
     are held to the same backticked spans, description for description. */
  console.log('\nsettings descriptions');
  {
    const root = path.join(__dirname, '..');
    const en = JSON.parse(fs.readFileSync(path.join(root, 'package.nls.json'), 'utf8'));
    const ko = JSON.parse(fs.readFileSync(path.join(root, 'package.nls.ko.json'), 'utf8'));
    const refs = [];
    for (const [name, spec] of Object.entries(pkg.contributes.configuration.properties)) {
      refs.push([name, spec.markdownDescription]);
      (spec.enumDescriptions || []).forEach(d => refs.push([name, d]));
    }
    const unkeyed = refs.filter(([, s]) => !/^%[^%]+%$/.test(s || ''));
    check('every setting description in package.json is a key', unkeyed.length === 0,
      'still inline: ' + unkeyed.map(r => r[0]).join(', '));
    const keys = refs.map(([, s]) => String(s).slice(1, -1));
    const missing = lang => keys.filter(k => typeof lang[k] !== 'string' || !lang[k].trim());
    check('and every key has English text', missing(en).length === 0, missing(en).join(', '));
    check('and Korean text', missing(ko).length === 0, missing(ko).join(', '));
    const extra = Object.keys(en).filter(k => !(k in ko)).concat(Object.keys(ko).filter(k => !(k in en)));
    check('the two languages carry the same keys', extra.length === 0, extra.join(', '));
    const spans = s => (s.match(/`[^`]*`/g) || []).slice().sort().join(' ');
    const drift = Object.keys(en).filter(k => k in ko && spans(en[k]) !== spans(ko[k]));
    check('and the same values and setting links in each', drift.length === 0,
      drift.map(k => k + '\n            en: ' + spans(en[k]) + '\n            ko: ' + spans(ko[k])).join('\n          '));
    /* The reasoning behind a setting lives in neon-glow.js. Written out in the
       descriptions it turned the Settings page into a wall nobody reads. */
    const long = Object.keys(en).filter(k => en[k].length > 140 || String(ko[k] || '').length > 140);
    check('and no description runs past a couple of sentences', long.length === 0,
      long.map(k => k + ' (en ' + en[k].length + ', ko ' + String(ko[k] || '').length + ')').join(', '));
    /* Command titles are translated too. A Korean palette still prints the
       English title under the Korean one, so searching in English keeps working. */
    const untitled = pkg.contributes.commands.map(c => c.title)
      .filter(t => !/^%[^%]+%$/.test(t) || [en, ko].some(l => !String(l[t.slice(1, -1)] || '').trim()));
    check('every command title is a key with English and Korean text', untitled.length === 0, untitled.join(', '));
  }

  /* ---- messages the extension shows ---- */
  /* vscode.l10n looks a message up by its English text, so a message that
     changed in extension.js silently falls back to English unless the Korean
     bundle changed with it. Every call takes one plain literal for exactly this
     reason: it can be read back out of the file and checked here. */
  console.log('\nmessages');
  {
    const root = path.join(__dirname, '..');
    const src = fs.readFileSync(path.join(root, 'extension.js'), 'utf8');
    const { PRESETS } = require('../presets.js');
    const ko = JSON.parse(fs.readFileSync(path.join(root, 'l10n', 'bundle.l10n.ko.json'), 'utf8'));
    const unquote = s => s.slice(1, -1).replace(/\\(.)/g, '$1');
    const used = new Set();
    const lit = /l10n\.t\(\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\s*[,)]/g;
    let m, literals = 0;
    while ((m = lit.exec(src))) { used.add(unquote(m[1])); literals++; }
    /* Counted rather than pattern-matched: 'a' + 'b' starts with a quote too,
       and slipped past a check that only looked at the first character. */
    const calls = (src.match(/l10n\.t\(/g) || []).length;
    const presetCalls = (src.match(/l10n\.t\(\s*PRESETS\[/g) || []).length;
    check('every message is a plain literal, apart from the preset details',
      literals > 20 && calls === literals + presetCalls,
      calls + ' calls, ' + literals + ' plain literals, ' + presetCalls + ' preset details');
    for (const k of Object.keys(PRESETS)) used.add(PRESETS[k].detail);

    const missing = [...used].filter(s => typeof ko[s] !== 'string' || !ko[s].trim());
    check('and every one has a Korean translation', missing.length === 0, missing.join('\n          '));
    const stale = Object.keys(ko).filter(k => !used.has(k));
    check('with nothing left in the bundle from a message that changed', stale.length === 0,
      stale.join('\n          '));
    const holes = s => (s.match(/\{\d+\}/g) || []).slice().sort().join('');
    const bad = [...used].filter(s => typeof ko[s] === 'string' && holes(s) !== holes(ko[s]));
    check('and the same placeholders on both sides', bad.length === 0, bad.join('\n          '));
    check('the engine floor is one that has vscode.l10n',
      /^\^1\.(7[3-9]|[89]\d|\d{3})\./.test(pkg.engines.vscode) && pkg.l10n === './l10n',
      'engines.vscode is ' + pkg.engines.vscode + ', l10n is ' + pkg.l10n);
    /* The renderer matches this text on the status bar; translated, the fast
       half of the bridge would go deaf in every language but English. */
    check('and the status bar label the renderer listens for is never translated',
      /statusBase = 'NEON:'/.test(src) && !/l10n\.t\([^)]*NEON:/.test(src));
  }

  /* A theme swap reaches the payload as the token stylesheet changing, and two
     themes with as many token colours as each other write it at the same
     length: every rule is `.mtkN { color: #RRGGBB; }`. Comparing lengths kept
     the old theme's glow on the new theme's text. */
  console.log('\ntheme swap');
  {
    const t = run({});
    await wait(80);
    t.tokens.textContent = '.mtk1 { color: #22d3ee; }\n.mtk2 { color: #808080; }';
    const relight = t.callbackFor(t.tokens);
    if (relight) relight();
    const after = t.styles();
    check('a theme with as many token colours as the last one still relights',
      !!relight && /\.mtk1 \{ color: #22d3ee;/.test(after) && after.indexOf('ff2f92') === -1,
      relight ? after.slice(0, 160) : 'nothing observes the token stylesheet');
  }

  /* The arc is drawn in the theme's caret colour unless it is given one of its
     own, and only a hex gets through: a named colour, or anything else a
     hand-edited settings.json holds, is dropped and the caret colour stays. */
  console.log('\ncaret arc colour');
  for (const [given, want, name] of [
    ['#ff2f92', '#ff2f92', 'a hex of your own replaces the caret colour'],
    ['#0f08', '#0f08', 'and so does a short hex with alpha'],
    ['red', '#22d3ee', 'a colour that is not a hex is dropped, and the caret colour stays'],
    ['cursor', '#22d3ee', 'cursor follows the theme']
  ]) {
    const a = run({ knobs: { caretArc: 'arc', caretArcColor: given } });
    await wait(120);
    await a.jump(600);
    const d = a.drawn();
    const wire = d.length ? d[0].descendants().find((n) => n.tag === 'polyline') : null;
    const stroke = wire ? wire.attrs.stroke : null;
    check(name, stroke === want, 'stroke is ' + stroke);
  }

  /* workbench.reduceMotion is VS Code's own switch, and "on" holds motion back
     whatever the operating system says. It reaches the page only as a class on
     the workbench, so the media query alone let everything keep moving. */
  console.log('\nVS Code reduce motion');
  {
    const r = run({ knobs: { cursorTrail: 45, caretArc: 'arc', saveShake: 5, breathe: 2400 },
                    vscodeReduceMotion: true });
    await wait(120);
    await r.jump(600);
    check('the arc draws nothing', r.drawn().length === 0);
    /* Apart from the arc, whose observer would take the move; the same
       straight-down move that slides above. */
    const t = run({ knobs: { cursorTrail: 45 }, vscodeReduceMotion: true });
    await wait(120);
    await t.jumpTo(100, 50);
    await t.jumpTo(300, 80);
    check('and the caret does not slide', t.caret.anims.length === 0);
    const moving = r.styles().split('\n').filter(l => /animation:|transition: none/.test(l));
    check('and every moving rule stands down under the class',
      moving.length === 3 && moving.every(l => l.indexOf(':not(.monaco-reduce-motion, .monaco-reduce-motion *)') !== -1),
      moving.join('\n          '));
  }

  if (PRINT) {
    console.log('\n---- stylesheet ----\n' + run({
      knobs: { cursorTrail: 45, saveShake: 6, findGlow: 18, selectionGlow: 12,
            occurrenceGlow: 10, gutterGlow: 8, bracketMatchGlow: 10 }
    }).styles());
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
