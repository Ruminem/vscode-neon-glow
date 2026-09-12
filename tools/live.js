#!/usr/bin/env node
'use strict';
/**
 * Ask the payload questions inside a real VS Code, and check the answers.
 *
 * `smoke.js` runs the payload against a stub DOM: it proves the stylesheet says
 * what it should and that the arc builds the elements it should, and it cannot
 * know anything about Monaco. Everything Monaco decides - whether a scroll
 * rewrites the caret's inline top, whether a rect read mid-transition is the
 * old position, whether a class is even called what the CSS file says - has
 * until now been answered by patching, restarting, and looking. That loop is
 * two restarts per typo, and it is how three things went out this far unseen.
 *
 *   Code.exe --remote-debugging-port=9222 samples/demo.js
 *   node tools/live.js --port 9222
 *
 * Launch it from a plain shell, not from VS Code's own terminal - see the note
 * about ELECTRON_RUN_AS_NODE in tools/cdp.js.
 *
 * **Leave --user-data-dir off.** A scratch profile is tidier and it costs the
 * settings bridge: globalStorage lives inside the profile, so the extension
 * there writes state.json somewhere the bundle is not reading - the bundle
 * reads the path it was patched with. The payload then runs on its own
 * defaults, caretArc among them is off, and every arc check skips. Quitting the
 * editor and relaunching it with the port is the shorter way round. The checks
 * that only ask Monaco about itself, scrolling among them, do not care.
 *
 * Exits non-zero if any check fails, so it can gate a commit rather than only
 * inform one.
 *
 * What it cannot see: the patch path, the stamp check, and the order things
 * happen in at startup. Those still want a re-patch and a real restart. Three
 * tools, three questions - smoke for the stylesheet, this for Monaco, a restart
 * for the install.
 */

const { attach, sleep } = require('./cdp.js');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i === -1 ? fallback : argv[i + 1];
};
const PORT = Number(arg('port', 9222));

let passed = 0, failed = 0, skipped = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  ok    ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
}
function skip(name, why) {
  skipped++; console.log('  skip  ' + name + '\n          ' + why);
}
/* Not a check. Some of these exist to find out what Monaco does, and a run that
   reports it is worth more than one that asserts a guess about it. */
function note(name, value) { console.log('  ??    ' + name + ': ' + value); }

/* Everything the arc drew, by the one thing every piece of it has in common. */
const DRAWN = "Array.from(document.body.children)"
  + ".filter(n => (n.getAttribute('style') || '').indexOf('z-index:2147483647') !== -1)";

async function main() {
  let cdp, sid, evaluate;
  try { ({ cdp, sid, evaluate } = await attach(PORT)); }
  catch (e) { console.error(e.message); process.exit(1); }

  const live = await evaluate('typeof window.__neonGlow');
  if (live !== 'object') {
    console.error('The payload is not in this window. Patch the bundle and relaunch it.');
    cdp.close();
    process.exit(1);
  }
  const on = await evaluate('window.__neonGlow.isEnabled()');
  console.log('payload live, glow ' + (on ? 'on' : 'off')
    + ', watching ' + (await evaluate('window.__neonGlow.arcWatching()')) + ' cursor layer(s)\n');

  /* A window can carry several editors - a welcome page, a settings tab, the
     file you meant - and the first one in the document is not reliably the one
     with text in it. Aim at a line that has something on it. */
  const editor = await evaluate(
    "(() => { const lines = Array.from(document.querySelectorAll('.monaco-editor .view-line'))"
    + "   .filter(l => (l.textContent || '').trim().length > 8);"
    + " if (lines.length < 6) return null;"
    + " const r = lines[Math.min(5, lines.length - 1)].getBoundingClientRect();"
    + " return { x: Math.round(r.x + 30), y: Math.round(r.y + r.height / 2) }; })()");
  if (!editor) {
    console.error('No file with text on screen. Open samples/demo.js in the target window.');
    cdp.close();
    process.exit(1);
  }

  /* The knobs ride state.json, and a window that cannot read it runs on the
     payload's own defaults - which have caretArc off. Worth saying plainly:
     otherwise the arc checks skip with "turn caretArc on", and turning it on
     changes nothing because nothing is carrying the value across. */
  const bridge = await evaluate('window.__neonGlow.bridgeOk()');
  if (!bridge) {
    console.log('the settings bridge is down in this window, so the payload is on its');
    console.log('own defaults. A scratch --user-data-dir does that: state.json is written');
    console.log('into the profile, and the bundle reads the path it was patched with.\n');
  }

  const wheel = (dy) => cdp.send('Input.dispatchMouseEvent',
    { type: 'mouseWheel', x: editor.x, y: editor.y, deltaX: 0, deltaY: dy,
      button: 'none', clickCount: 0 }, sid);
  const key = async (code, windowsVirtualKeyCode) => {
    for (const type of ['keyDown', 'keyUp']) {
      await cdp.send('Input.dispatchKeyEvent',
        { type, code, key: code, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode }, sid);
    }
  };
  const mouse = (type, x, y, extra) => cdp.send('Input.dispatchMouseEvent',
    Object.assign({ type, x, y, button: 'left', clickCount: 1, buttons: type === 'mouseReleased' ? 0 : 1 },
      extra || {}), sid);

  const clear = () => evaluate(DRAWN + '.forEach(n => n.remove()), true');

  /* Give the editor focus and put the caret in the text.
     Whether that worked is decided by moving it, not by looking at it. An
     unfocused editor keeps a caret at 0,0 - and so does a focused one whose
     caret is on the first character, so the position says nothing on its own.
     Pressing a key and watching the number change says it exactly.
     bringToFront is needed because Monaco hides the caret while the window is
     not the front one, and this window was started in the background. */
  await cdp.send('Page.enable', {}, sid).catch(() => {});
  await cdp.send('Page.bringToFront', {}, sid).catch(() => {});
  await sleep(300);
  await mouse('mousePressed', editor.x, editor.y);
  await mouse('mouseReleased', editor.x, editor.y);
  await sleep(300);

  const at = () => evaluate(
    "(() => { const c = document.querySelector('.monaco-editor .cursors-layer .cursor');"
    + " if (!c) return null;"
    + " return { top: c.style.top, left: c.style.left, hidden: c.style.visibility === 'hidden' }; })()");
  const placed = await at();
  await key('ArrowDown', 40);
  await sleep(200);
  const moved = await at();
  if (!placed || !moved || moved.hidden || moved.top === placed.top) {
    console.error('The caret does not answer to a key press, so the editor has no focus'
      + (moved && moved.hidden ? ' and its caret is hidden' : '') + '.');
    console.error('Everything below would be read off a window that is not listening, '
      + 'so stopping here.');
    cdp.close();
    process.exit(1);
  }

  /* ---- what a scroll does to the caret ---- */
  /* The arc reads the caret's inline left/top on every mutation and compares
     them, and a scroll that rewrote those would look exactly like a move. The
     guard that tells the two apart was written without knowing whether it was
     needed, which is the sort of thing this file exists to settle. */
  console.log('what a scroll moves');
  const scrollProbe = "(() => { const lc = document.querySelector('.monaco-editor .lines-content');"
    + " const c = document.querySelector('.monaco-editor .cursors-layer .cursor');"
    + " return { content: lc ? (lc.style.top || lc.style.transform || '') : null,"
    + "          caret: c ? c.style.top : null }; })()";
  const before = await evaluate(scrollProbe);
  await wheel(500); await sleep(400);
  const after = await evaluate(scrollProbe);
  note('lines-content offset', before.content + ' -> ' + after.content);
  note('caret inline top', before.caret + ' -> ' + after.caret);
  /* Without this the next check passes whenever the wheel misses the editor,
     which is the same shape of mistake as a test that only ever goes green. */
  check('the wheel actually scrolled the view', before.content !== after.content,
    'nothing moved, so the reading below is of a scroll that never happened');
  check('and a scroll moves the container rather than the caret',
    before.caret === after.caret,
    'Monaco rewrites the caret top on scroll, so the scroll guard in arcMoved is '
    + 'load-bearing rather than insurance - say so in the comment');
  await wheel(-500); await sleep(400);

  /* ---- the arc ---- */
  console.log('\nthe caret arc');
  await clear();
  await key('ArrowDown', 40);
  await sleep(250);
  const afterDown = await evaluate(DRAWN + '.map(n => n.getAttribute("style"))');

  if (!afterDown.length) {
    skip('a move straight down draws',
      'nothing was drawn - caretArc is off in this window, so the arc checks '
      + 'cannot run. Set neonGlow.caretArc and relaunch.');
    skip('and a scroll draws nothing', 'the same reason');
    skip('and a drag draws only the click that starts it', 'the same reason');
  } else {
    check('a move straight down draws', afterDown.length === 1);
    /* A quarter turn. Without it the path lies along the one direction the
       caret did not go, which is what shipped until the geometry went 2D. */
    check('and the path is turned to face the way the caret went',
      /rotate\(1\.5[0-9]*rad\)/.test(afterDown[0] || ''),
      'drew ' + JSON.stringify(afterDown[0] || '').slice(0, 120));

    await clear();
    await wheel(360); await sleep(300); await wheel(-360); await sleep(300);
    check('and a scroll draws nothing',
      (await evaluate(DRAWN + '.length')) === 0,
      'the wheel is being read as a caret move');

    /* A click, then the drag it turns into: the press lands one move and that
       one still draws, and the rest is held back unless caretArcOnDrag is on. */
    await clear();
    await mouse('mousePressed', editor.x - 120, editor.y);
    for (let i = 1; i <= 4; i++) {
      await mouse('mouseMoved', editor.x - 120 + i * 30, editor.y + i * 4);
      await sleep(60);
    }
    await mouse('mouseReleased', editor.x, editor.y + 16);
    await sleep(250);
    const drag = await evaluate(DRAWN + '.length');
    note('drawn across a press, four moves and a release', drag);
    check('and a drag draws only the click that starts it', drag <= 1,
      'every step of the drag is drawing, which caretArcOnDrag is supposed to hold back');
  }

  await clear();
  cdp.close();

  console.log('\n' + passed + ' passed, ' + failed + ' failed'
    + (skipped ? ', ' + skipped + ' skipped' : ''));
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
