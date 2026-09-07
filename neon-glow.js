
/* ============ NEON GLOW (injected) [payload __NEON_STAMP__] ============ */
try {
(function () {
  if (typeof window === 'undefined' || window.__NEON_INSTALLED) { return; }
  window.__NEON_INSTALLED = true;

  /**
   * Tuning knobs. These are the defaults; the extension sends the settings
   * over the same bridge the toggle uses, so editing them in Settings takes
   * effect without a re-patch or a restart. Editing them here only matters for
   * a CLI-only install, where nothing is sending anything.
   */
  var KNOBS = {
    brightness:   1.0,   /* overall strength, 0.0 ~ 1.5                        */
    minChroma:    0.30,  /* below this = not a vivid syntax colour -> no glow  */
    chromaSpan:   0.50,  /* chroma range mapped onto the strength ramp         */
    floor:        0.40,  /* strength for a colour that just passes minChroma   */
    minLightness: 0.25,  /* darker than this -> no glow                        */
    glowLayers:   3,     /* shadow passes per token: 3 tight+mid+wide, 1 core  */
    maxBlur:      36,    /* ceiling on any one radius; 36 = the widest we emit */
    cursorTrail:  0      /* ms for the caret to slide; 0 = jump, as VS Code does */
  };

  /* Clamped so a hand-edited settings.json cannot produce nonsense. */
  var KNOB_RANGE = {
    brightness: [0, 3], minChroma: [0, 1], chromaSpan: [0.01, 2],
    floor: [0, 1], minLightness: [0, 1], glowLayers: [1, 3], maxBlur: [1, 64],
    cursorTrail: [0, 400]
  };

  /**
   * How many shadow passes to paint.
   *
   * This is the expensive knob, not brightness. Measured over a real scroll on
   * a dense C++ viewport - 390 token spans, 220 of them glowing - the widest
   * pass is not two thirds of the cost as the area arithmetic suggests but
   * nearly all of it: 12ms of raster with no glow, 16ms at two passes, 87ms at
   * three. Blur time climbs far faster than radius, and at 36px the blurs of
   * neighbouring tokens overlap heavily.
   */
  function layers() {
    return Math.max(1, Math.min(3, Math.round(KNOBS.glowLayers)));
  }

  /**
   * Ceiling on a single blur radius.
   *
   * Raster time climbs steeply and smoothly with radius rather than with the
   * area the arithmetic predicts. Measured on a dense C++ viewport, capping the
   * widest pass costs nothing down to 34px and then falls away fast: 32px is
   * about a tenth off, 30px a fifth, 28px a third, 26px nearly half. The
   * default is the widest radius the formula can produce, so it changes
   * nothing until someone lowers it.
   */
  function blur(px) {
    return Math.max(1, Math.min(Math.round(KNOBS.maxBlur), px));
  }

  /**
   * Fallback shortcut, used only when the extension bridge is unavailable.
   * Registered on the BUBBLE phase on purpose: the VS Code keybinding service
   * runs first and calls stopPropagation() for chords it has bound, so an
   * existing binding (Code Runner on ctrl+alt+n, say) always wins and this
   * never fires. Set to null to disable it outright.
   */
  var FALLBACK_KEY = { ctrl: true, alt: true, shift: false, key: 'n' };

  /* Filled in by the installer; stays empty when patched with no extension. */
  var STATE_URL = '__NEON_STATE_URL__';

  var STYLE_ID = 'neon-glow-styles';
  var STORE_KEY = 'neonGlow.enabled';

  /* localStorage may be unavailable in this renderer; keep an in-memory fallback */
  var enabled = true;
  try {
    var stored = localStorage.getItem(STORE_KEY);
    if (stored !== null) enabled = (stored === '1');
  } catch (e) {}

  function persist() {
    try { localStorage.setItem(STORE_KEY, enabled ? '1' : '0'); } catch (e) {}
  }

  function mark(stage, extra) {
    try { document.documentElement.setAttribute('data-neon', stage + (extra ? ' ' + extra : '')); } catch (e) {}
    try { console.log('[NEON] ' + stage + (extra ? ' ' + extra : '')); } catch (e) {}
  }

  function normalizeHex(hex) {
    hex = hex.toLowerCase();
    if (hex.length === 3) return hex.charAt(0)+hex.charAt(0)+hex.charAt(1)+hex.charAt(1)+hex.charAt(2)+hex.charAt(2);
    if (hex.length === 8) return hex.slice(0, 6);
    return hex.length === 6 ? hex : null;
  }
  function alpha(x) {
    var v = Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16);
    return v.length < 2 ? '0' + v : v;
  }

  var glowCount = 0, skipCount = 0;

  function glowFor(rawHex) {
    var hex = normalizeHex(rawHex);
    if (!hex) return null;
    var r = parseInt(hex.slice(0,2),16)/255,
        g = parseInt(hex.slice(2,4),16)/255,
        b = parseInt(hex.slice(4,6),16)/255;
    var max = Math.max(r,g,b), min = Math.min(r,g,b);
    var lightness = (max + min) / 2;
    var chroma = max - min;   /* NOT hsl saturation: that inflates near-white colours */

    if (lightness < KNOBS.minLightness) return null;
    if (chroma < KNOBS.minChroma) return null;

    var t = Math.max(0, Math.min(1, (chroma - KNOBS.minChroma) / KNOBS.chromaSpan));
    var k = (KNOBS.floor + (1 - KNOBS.floor) * t) * KNOBS.brightness;
    /* The tube, not the halo. Every counted pass is wide enough that the
       letterform is gone by the time it lands - even the narrowest, at 5px, is
       thicker than the stroke it is meant to trace - so a glyph sat inside a
       smear instead of lighting one. A radius this tight still follows the
       outline, which is what reads as neon rather than as blurred text.

       It rides along at every glowLayers setting instead of being one of them.
       Blur time climbs steeply with radius, so at 1-2px this costs a rounding
       error beside the 36px pass, and dropping it would take the edge away
       while saving nothing. */
    var core = blur(Math.max(1, Math.round(1 + k)));
    var near = blur(Math.round(2 + 3*k)), mid = blur(Math.round(6 + 10*k)), far = blur(Math.round(14 + 22*k));

    /* No !important on the colour. The token stylesheet is made of single-class
       .mtkN rules, but bracket pair colourisation paints
       ".monaco-editor .bracket-highlighting-N", which is two classes and wins on
       specificity - unless an !important here overrides it and collapses every
       bracket level onto one token colour. The copied rule already comes later
       in the document than the original, so it wins without forcing anything. */
    /* near drops from 0.90 to 0.75 to make room for the core. The light near
       the glyph is moved towards the edge rather than added to, so the text
       comes out sharper instead of merely bolder. */
    var n = layers();
    var shadow = ' 0 0 '+core+'px #'+hex+alpha(0.95*k);
    shadow += ', 0 0 '+near+'px #'+hex+alpha(0.75*k);
    if (n >= 2) shadow += ', 0 0 '+mid+'px #'+hex+alpha(0.65*k);
    if (n >= 3) shadow += ', 0 0 '+far+'px #'+hex+alpha(0.40*k);

    return 'color: #'+hex+'; text-shadow:' + shadow + ' !important;'
      + ' backface-visibility: hidden;';
  }

  function addGlow(styles) {
    glowCount = 0; skipCount = 0;
    return styles.replace(/color:\s*#([0-9a-fA-F]{3,8})\s*;/g, function (m, hex) {
      var rep = glowFor(hex);
      if (rep === null) { skipCount++; return m; }
      glowCount++;
      return rep;
    });
  }

  /**
   * Brackets are left to VS Code's own colouring and given their glow back in
   * `currentColor`, so each nesting level glows in the colour it is actually
   * painted rather than in the token colour underneath it. Two classes beats
   * the single-class .mtkN rules, so this wins even though both are !important.
   *
   * At zero brightness the rule is dropped rather than emitted: currentColor
   * carries no alpha to fade, so the only way for it to go dark is to not exist.
   */
  function chromeStyles() {
    var css = '\n.monaco-editor .margin, .monaco-editor .inputarea.ime-input { background: transparent; }\n'
      + '.monaco-editor .cursor { box-shadow: 0 0 8px var(--vscode-editorCursor-foreground, transparent); }\n';

    var k = KNOBS.brightness;
    if (k > 0) {
      var core = blur(Math.max(1, Math.round(1 + k)));
      var near = blur(Math.round(2 + 3 * k)), mid = blur(Math.round(6 + 10 * k));
      var shadow = ' 0 0 ' + core + 'px currentColor, 0 0 ' + near + 'px currentColor';
      if (layers() >= 2) shadow += ', 0 0 ' + mid + 'px currentColor';
      css += '.monaco-editor [class*="bracket-highlighting-"] { text-shadow:'
        + shadow + ' !important; }\n';
    }

    /* The caret slides to a new position instead of jumping, and the glow on it
       rides along, so a move across the file leaves a short streak of light
       behind. Motion only - the colour is still the theme's own cursor colour,
       so unlike a scanline or a tint this imposes no palette of its own.

       Off by default, because it is the one value here that changes how the
       editor behaves rather than how it looks. Every keystroke restarts the
       transition, so too long a duration leaves the caret trailing the text
       being typed: 130ms reads as lag, 45ms keeps up and still streaks on a
       jump across the file.

       !important because VS Code's own editor.cursorSmoothCaretAnimation paints
       ".cursors-layer.cursor-smooth-caret-animation > .cursor" - three classes
       against our two - and hard-codes 80ms. With both on, this value wins. */
    var trail = Math.round(KNOBS.cursorTrail);
    if (trail > 0) {
      css += '@media (prefers-reduced-motion: no-preference) {'
        + ' .monaco-editor .cursor { transition: transform ' + trail + 'ms ease-out,'
        + ' left ' + trail + 'ms ease-out, top ' + trail + 'ms ease-out !important; } }\n';
    }
    return css;
  }

  var lastLen = -1;

  /**
   * Turning off flips the stylesheet's `disabled` flag instead of removing the
   * element, so turning back on costs nothing: the CSS stays parsed and the
   * regex pass is not repeated. `lastLen` therefore survives an off/on cycle,
   * and a theme swapped *while* off still rebuilds, because the token source
   * length no longer matches.
   */
  function render() {
    var styleTag = document.getElementById(STYLE_ID);

    if (!enabled) {
      if (styleTag) styleTag.disabled = true;
      return true;
    }

    var tokensEl = document.querySelector('.vscode-tokens-styles');
    if (!tokensEl) return false;
    var source = tokensEl.textContent || '';
    if (!/\S/.test(source)) return false;   /* cheaper than stripping a copy */

    if (styleTag && source.length === lastLen) {
      if (styleTag.disabled) styleTag.disabled = false;
      return true;
    }
    lastLen = source.length;

    if (!styleTag) {
      styleTag = document.createElement('style');
      styleTag.setAttribute('id', STYLE_ID);
    }
    styleTag.disabled = false;
    styleTag.textContent = addGlow(source) + chromeStyles();
    (document.head || document.body).appendChild(styleTag);
    mark('applied', 'glow=' + glowCount + ' skip=' + skipCount);
    return true;
  }

  /* ---- transient feedback on toggle ---- */
  function toast(text) {
    try {
      if (!document.body) return;
      var id = 'neon-glow-toast';
      var el = document.getElementById(id);
      if (!el) {
        el = document.createElement('div');
        el.setAttribute('id', id);
        el.style.cssText = 'position:fixed;bottom:38px;right:18px;z-index:2147483647;'
          + 'padding:7px 14px;border-radius:5px;pointer-events:none;'
          + 'font:600 12px ui-monospace,monospace;transition:opacity .25s;'
          + 'background:rgba(20,20,26,.94);border:1px solid rgba(255,255,255,.16);';
        document.body.appendChild(el);
      }
      el.textContent = text;
      el.style.color = enabled ? '#4ade80' : '#94a3b8';
      el.style.opacity = '1';
      clearTimeout(toast._t);
      toast._t = setTimeout(function () { el.style.opacity = '0'; }, 1300);
    } catch (e) {}
  }

  function setEnabled(v) {
    if (enabled === v) return;
    enabled = v;
    persist();
    render();
    toast('Neon Glow: ' + (enabled ? 'ON' : 'OFF'));
    mark(enabled ? 'enabled' : 'disabled');
  }

  /**
   * Take tuning values sent by the extension. Unlike the on/off state there is
   * nothing local to protect here, so these apply on the very first read too.
   * A change invalidates lastLen, because the stylesheet has to be rebuilt from
   * the token source rather than merely re-shown.
   */
  function applyKnobs(k) {
    if (!k || typeof k !== 'object') return false;
    var changed = false;
    for (var name in KNOBS) {
      if (!Object.prototype.hasOwnProperty.call(KNOBS, name)) continue;
      var v = k[name];
      if (typeof v !== 'number' || !isFinite(v)) continue;
      var r = KNOB_RANGE[name];
      v = Math.max(r[0], Math.min(r[1], v));
      if (KNOBS[name] === v) continue;
      KNOBS[name] = v;
      changed = true;
    }
    if (changed) { lastLen = -1; render(); mark('knobs'); }
    return changed;
  }

  /* ------------------------------------------------------------------
   * Bridge, in two halves. Both carry the same state, so the commands stay
   * inside the VS Code keybinding system and nothing here intercepts a key.
   *
   *   fast   The extension's status bar item reads "NEON:ON" / "NEON:OFF".
   *          A MutationObserver on that one item sees the edit in the frame
   *          the extension host paints it, so a toggle lands in ~16ms.
   *   slow   state.json in the extension's globalStorage, polled over
   *          vscode-file. It reconciles whatever the fast half missed - a
   *          hidden status bar, or a background window with no rAF ticks.
   *
   * Neither half applies its first reading; it only records it. Startup state
   * comes from localStorage, so a stale file, or a status bar not yet written,
   * cannot clobber the last known state.
   * ------------------------------------------------------------------ */
  var bridgeOk = false;
  var lastSeq = null;

  /* Polling backs off once the status bar half has proven it works. */
  var POLL_FAST = 800, POLL_SLOW = 1500;

  function pollState() {
    fetch(STATE_URL, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) {
        if (!s || typeof s.enabled !== 'boolean') return;
        if (!bridgeOk) { bridgeOk = true; mark('bridge-ok file'); }
        applyKnobs(s.knobs);
        if (lastSeq === null) { lastSeq = s.seq; return; }
        if (s.seq !== lastSeq) { lastSeq = s.seq; setEnabled(s.enabled); }
      })
      .catch(function () {});
  }

  /* ---- fast half: the status bar item ---- */
  var STATUS_RE = /NEON:(ON|OFF)/;
  var lastStatus = null;
  var statusEl = null;        /* the one item that carries our label */
  var statusObserver = null;

  function statusLive() {
    return !!(statusEl && statusEl.isConnected);
  }

  function applyStatus(text) {
    var m = STATUS_RE.exec(text || '');
    if (!m) return;
    var v = (m[1] === 'ON');
    if (!bridgeOk) { bridgeOk = true; mark('bridge-ok status-bar'); }
    if (lastStatus === null) { lastStatus = v; return; }
    if (v !== lastStatus) { lastStatus = v; setEnabled(v); }
  }

  /* Coalesce a burst of records into one read per frame. */
  var statusQueued = false;
  function onStatusMutation() {
    if (statusQueued) return;
    statusQueued = true;
    requestAnimationFrame(function () {
      statusQueued = false;
      if (!statusLive()) { detachStatusBar(); return; }
      try { applyStatus(statusEl.textContent); } catch (e) {}
    });
  }

  function detachStatusBar() {
    if (statusObserver) { statusObserver.disconnect(); statusObserver = null; }
    statusEl = null;
  }

  /**
   * Watch our own status bar item, not the status bar.
   *
   * The bar as a whole mutates on every cursor move, and observing its subtree
   * meant waking on each of those to rebuild the text of every item and run a
   * regex over it - once a frame, for the entire time someone is typing, to
   * learn nothing. The item we put there changes only when the extension
   * toggles.
   *
   * If VS Code ever replaces the item the observer goes quiet with it, so the
   * reconcile poll re-seeks when the element is no longer connected: that path
   * already exists to cover the fast half being unavailable.
   */
  function attachStatusBar() {
    if (statusLive()) return;
    detachStatusBar();

    var items = document.querySelectorAll('.statusbar .statusbar-item');
    for (var i = 0; i < items.length; i++) {
      if (STATUS_RE.test(items[i].textContent || '')) { statusEl = items[i]; break; }
    }
    if (!statusEl) return;

    statusObserver = new MutationObserver(onStatusMutation);
    statusObserver.observe(statusEl, { childList: true, characterData: true, subtree: true });
    try { applyStatus(statusEl.textContent); } catch (e) {}
  }

  if (STATE_URL && STATE_URL.indexOf('vscode-file:') === 0) {
    (function schedulePoll() {
      setTimeout(function () {
        /* Also the retry loop that finds the item, and the recovery path if it
           is ever replaced - which is why the interval tracks it being live. */
        try { attachStatusBar(); } catch (e) {}
        pollState();
        schedulePoll();
      }, (statusLive() && lastStatus !== null) ? POLL_SLOW : POLL_FAST);
    })();
    pollState();
  }

  /* Fallback only, and on the bubble phase: whatever VS Code has bound wins. */
  if (FALLBACK_KEY) {
    window.addEventListener('keydown', function (ev) {
      if (bridgeOk) return;                        /* commands work; stay out of the way */
      if (!!ev.ctrlKey  !== !!FALLBACK_KEY.ctrl)  return;
      if (!!ev.altKey   !== !!FALLBACK_KEY.alt)   return;
      if (!!ev.shiftKey !== !!FALLBACK_KEY.shift) return;
      if (!ev.key || ev.key.toLowerCase() !== FALLBACK_KEY.key) return;
      setEnabled(!enabled);
    }, false);
  }

  /* exposed for the DevTools console */
  window.__neonGlow = {
    toggle: function () { setEnabled(!enabled); },
    enable: function () { setEnabled(true); },
    disable: function () { setEnabled(false); },
    isEnabled: function () { return enabled; },
    bridgeOk: function () { return bridgeOk; },
    statusBarOk: function () { return statusLive() && lastStatus !== null; }
  };

  var attached = false;
  function startObservers() {
    var el = document.querySelector('.vscode-tokens-styles');
    if (el && !attached) {
      attached = true;
      new MutationObserver(function () { try { render(); } catch (e) {} })
        .observe(el, { childList: true, characterData: true, subtree: true });
    }
  }

  /**
   * Startup only. Its whole job is to wait for `.vscode-tokens-styles` to
   * exist, paint once, and hand over to the MutationObserver. It used to keep
   * running for the full three minutes afterwards, re-reading the entire token
   * stylesheet three times a second to reach the same conclusion; now it stops
   * as soon as the observer is live. Finding the status bar item is left to the
   * poll, which is already a retry loop.
   */
  var ticks = 0;
  var timer = setInterval(function () {
    ticks++;
    var painted;
    try { painted = render(); if (painted) startObservers(); }
    catch (e) { mark('error', String(e && e.message || e)); clearInterval(timer); return; }
    if ((painted && attached) || ticks > 600) clearInterval(timer);
  }, 300);

  /* Separate guards: these are independent, and one of them failing must not
     take the paint down with it. */
  try { render(); } catch (e) { mark('error', String(e && e.message || e)); }
  try { startObservers(); } catch (e) {}
  try { attachStatusBar(); } catch (e) {}
})();
} catch (e) {
  try { console.error('[NEON] fatal', e); } catch (_) {}
}
/* ============ /NEON GLOW ============ */
