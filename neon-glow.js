
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
    cursorTrail:  0,     /* ms for the caret to slide; 0 = jump, as VS Code does */
    saveShake:    0,     /* px the workbench jolts on a save; 0 = it stays still */
    findGlow:     0,     /* px of bloom on find matches; 0 = leave them flat     */
    selectionGlow: 0     /* px of bloom on the selection; 0 = leave it flat      */
  };

  /* Clamped so a hand-edited settings.json cannot produce nonsense. */
  var KNOB_RANGE = {
    brightness: [0, 3], minChroma: [0, 1], chromaSpan: [0.01, 2],
    floor: [0, 1], minLightness: [0, 1], glowLayers: [1, 3], maxBlur: [1, 64],
    cursorTrail: [0, 400], saveShake: [0, 24],
    findGlow: [0, 48], selectionGlow: [0, 32]
  };

  /**
   * How many shadow passes to paint.
   *
   * This is the expensive knob, not brightness. The widest pass is not two
   * thirds of the cost as the area arithmetic suggests but nearly all of it:
   * measured over a real scroll on a dense C++ viewport - 390 token spans, 220
   * of them glowing - 12ms of raster with no glow, 16ms at two passes, 87ms at
   * three. Blur time climbs far faster than radius, and the widest blurs of
   * neighbouring tokens overlap.
   *
   * Those figures are from the formula that ran until the falloff was
   * rebalanced, whose widest pass was 36px rather than 26px, so the absolute
   * numbers now read high. The ordering they establish is what matters and has
   * not changed. `tools/bench.js` measures a candidate against the shipped
   * formula in pairs if a number is needed again.
   */
  function layers() {
    return Math.max(1, Math.min(3, Math.round(KNOBS.glowLayers)));
  }

  /**
   * Ceiling on a single blur radius.
   *
   * Raster time climbs steeply and smoothly with radius rather than with the
   * area the arithmetic predicts. Measured on a dense C++ viewport against the
   * earlier formula, capping its 36px pass cost nothing down to 34px and then
   * fell away fast: 32px about a tenth off, 30px a fifth, 28px a third, 26px
   * nearly half.
   *
   * The formula now stops at 26px of its own accord at brightness 1, so the
   * default of 36 no longer binds anything. It still matters at brightness
   * above 1, which scales every radius, and to anyone who wants to cap the
   * bloom tighter than the formula does.
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
       letterform is gone by the time it lands, so a glyph sat inside a smear
       instead of lighting one. A 1px radius still follows the outline, which is
       what reads as neon rather than as blurred text. It rides along at every
       glowLayers setting instead of being one of them, and costs a rounding
       error beside the wide passes.

       What makes the outline read is not this pass on its own but the drop
       behind it. A blur is brightest at its source, so all four passes paint at
       the glyph too, and the old alphas - 0.95, 0.75, 0.65, 0.40 - summed to
       about 2.75 there. Everything past 1.0 is the same opaque, so the wide
       passes were as solid at the letter edge as the tight one and there was no
       gradient for an eye to read an edge from; counters filled in, and at 36px
       neighbouring blurs lit the space between words as brightly as the words.
       The ratio between the innermost and outermost pass is what is visible,
       not the total: 1.00 to 0.14 rather than 0.95 to 0.40.

       Measured with tools/bench.js against the previous formula, four pairs on
       one viewport: 57% less raster time. Sharper and cheaper came together,
       because the same change that restores the gradient also narrows the two
       widest radii. */
    var core = blur(1);
    var near = blur(Math.round(4*k) + 1), mid = blur(Math.round(11*k)), far = blur(Math.round(26*k));

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
    var shadow = ' 0 0 '+core+'px #'+hex+alpha(1.00*k);
    shadow += ', 0 0 '+near+'px #'+hex+alpha(0.65*k);
    if (n >= 2) shadow += ', 0 0 '+mid+'px #'+hex+alpha(0.32*k);
    if (n >= 3) shadow += ', 0 0 '+far+'px #'+hex+alpha(0.14*k);

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
      /* Only the two tight passes, and no wide one. currentColor carries no
         alpha to fade, so every pass here lands at full strength - which is
         survivable at 1px and 5px and would be a blob at 26px. The token rule
         gets its falloff from alpha; this one gets it by stopping early. */
      var core = blur(1), near = blur(Math.round(4 * k) + 1);
      var shadow = ' 0 0 ' + core + 'px currentColor';
      if (layers() >= 2) shadow += ', 0 0 ' + near + 'px currentColor';
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

    /* The jolt on save.

       A CSS animation on transform alone, not a JS loop writing inline styles,
       and that distinction is the whole cost of the feature. will-change lifts
       the workbench onto its own compositor layer for the duration, so the
       frames are the compositor translating a texture it already holds - the
       glow is not re-rastered once. Driven from JS instead, every frame would
       redo the blur pass that measures 87ms on a dense viewport, which is what
       made this look like the expensive idea of the four.

       The layer is dropped again the moment the class comes off, so nothing is
       held promoted while you are only reading. */
    var amp = Math.round(KNOBS.saveShake);
    if (amp > 0) {
      var off = Math.max(1, Math.round(amp * 0.6));
      css += '@media (prefers-reduced-motion: no-preference) {'
        + ' @keyframes neon-glow-shake {'
        + ' 0%, 100% { transform: translate(0, 0); }'
        + ' 15% { transform: translate(-' + amp + 'px, ' + off + 'px); }'
        + ' 30% { transform: translate(' + amp + 'px, -' + off + 'px); }'
        + ' 45% { transform: translate(-' + off + 'px, -' + amp + 'px); }'
        + ' 60% { transform: translate(' + off + 'px, ' + amp + 'px); }'
        + ' 80% { transform: translate(-' + off + 'px, 0); }'
        + ' }'
        + ' .monaco-workbench.neon-glow-shaking {'
        + ' animation: neon-glow-shake 150ms ease-out; will-change: transform; }'
        + ' }\n';
    }

    /* Find matches and the selection, lit from the colours the theme already
       gives them - the same derivation as the token glow, applied to two more
       surfaces rather than to a look of our own.

       Both of those colours are semi-transparent, because they sit behind text
       and must not hide it, and a shadow that only blurs them comes out nearly
       invisible. The spread is what makes them read: it carries the weak colour
       outwards at full width before the blur starts, instead of asking the blur
       to do both jobs. This is why these take a spread and the cursor, whose
       colour is opaque, does not.

       Cost stays bounded by the viewport. Only rendered lines carry a
       .selected-text span, so selecting a whole file lights the screenful in
       front of you and nothing beyond it. */
    var find = Math.round(KNOBS.findGlow);
    if (find > 0) {
      var fh = 'var(--vscode-editor-findMatchHighlightBackground)';
      var fc = 'var(--vscode-editor-findMatchBackground)';
      css += '.monaco-editor .findMatch { box-shadow:'
        + ' 0 0 ' + find + 'px ' + Math.round(find / 3) + 'px ' + fh + ','
        + ' 0 0 ' + Math.round(find * 1.9) + 'px ' + Math.round(find / 4) + 'px ' + fh
        + ' !important; }\n';
      css += '.monaco-editor .currentFindMatch { box-shadow:'
        + ' 0 0 ' + Math.round(find * 1.25) + 'px ' + Math.round(find / 2.2) + 'px ' + fc + ','
        + ' 0 0 ' + Math.round(find * 2.4) + 'px ' + Math.round(find / 3) + 'px ' + fc
        + ' !important; }\n';
    }

    var sel = Math.round(KNOBS.selectionGlow);
    if (sel > 0) {
      css += '.monaco-editor .selected-text { box-shadow: 0 0 ' + sel + 'px'
        + ' var(--vscode-editor-selectionBackground) !important; }\n';
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
   *          hidden status bar, say - and it is the only way settings arrive,
   *          since nothing writes those to the label.
   *
   * The slow half backs off. It used to run every 1.5s for as long as the window
   * lived, hidden or not, which is around 19,000 reads over a working day and
   * the same again for every background window. Now a run of unchanged readings
   * widens the gap towards 15s, any change drops it back, and a hidden window
   * does not poll at all - it reads once on becoming visible instead, which is
   * the first moment the answer could matter.
   *
   * Neither half applies its first reading; it only records it. Startup state
   * comes from localStorage, so a stale file, or a status bar not yet written,
   * cannot clobber the last known state.
   * ------------------------------------------------------------------ */
  var bridgeOk = false;
  var lastSeq = null;

  /* Polling backs off twice over: once when the status bar half proves it
     works, and again when nothing has changed for a while. quiet counts
     readings that carried no news - a failed fetch counts, so a window with no
     extension behind it stops hammering a file that is not there. */
  var POLL_FAST = 800, POLL_SLOW = 1500, POLL_IDLE = 15000;
  var QUIET_BEFORE_BACKOFF = 8;
  var quiet = 0;

  function pollDelay() {
    if (quiet < QUIET_BEFORE_BACKOFF) {
      return (statusLive() && lastStatus !== null) ? POLL_SLOW : POLL_FAST;
    }
    return Math.min(POLL_IDLE,
      POLL_SLOW * Math.pow(2, quiet - QUIET_BEFORE_BACKOFF + 1));
  }

  function pollState() {
    fetch(STATE_URL, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) {
        if (!s || typeof s.enabled !== 'boolean') { quiet++; return; }
        if (!bridgeOk) { bridgeOk = true; quiet = 0; mark('bridge-ok file'); }
        var news = applyKnobs(s.knobs);
        if (lastSeq === null) { lastSeq = s.seq; quiet = 0; return; }
        if (s.seq !== lastSeq) { lastSeq = s.seq; setEnabled(s.enabled); news = true; }
        if (news) quiet = 0; else quiet++;
      })
      .catch(function () { quiet++; });
  }

  /**
   * Play the jolt. Everything about how it looks lives in the stylesheet; this
   * only puts the class on and takes it off again.
   *
   * The class is removed and re-added across two frames rather than in one go,
   * so a second save while the first jolt is still running restarts it. Doing
   * that by reading offsetWidth would work too, but it forces a synchronous
   * layout of the whole workbench - the one thing worth not doing on a keypress.
   */
  var SHAKE_CLASS = 'neon-glow-shaking';
  function shake() {
    if (!enabled || Math.round(KNOBS.saveShake) <= 0) return;
    var w = document.querySelector('.monaco-workbench');
    if (!w) return;
    w.classList.remove(SHAKE_CLASS);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { w.classList.add(SHAKE_CLASS); });
    });
    clearTimeout(shake._t);
    shake._t = setTimeout(function () { w.classList.remove(SHAKE_CLASS); }, 400);
  }

  /* ---- fast half: the status bar item ---- */
  var STATUS_RE = /NEON:(ON|OFF)/;
  var lastStatus = null;

  /**
   * Saves ride the same label as the switch.
   *
   * The renderer has no extension host to subscribe to. Its two channels are
   * this label, which a MutationObserver sees in the frame it is written, and
   * state.json, polled about once a second - and a jolt that lands a second
   * after Ctrl+S is not a jolt. So it has to be the label; and the label is on
   * screen, so the marker has to be invisible. U+200B is zero width, is not
   * whitespace to trim(), and adds nothing a screen reader announces. The count
   * cycles 0-3, so consecutive saves always differ and the string never grows.
   */
  var PULSE_CODE = 0x200b;
  var lastPulse = null;

  function pulseOf(text) {
    var n = 0;
    while (n < text.length && text.charCodeAt(text.length - 1 - n) === PULSE_CODE) n++;
    return n;
  }
  var statusEl = null;        /* the one item that carries our label */
  var statusObserver = null;

  function statusLive() {
    return !!(statusEl && statusEl.isConnected);
  }

  function applyStatus(text) {
    text = text || '';
    var m = STATUS_RE.exec(text);
    if (!m) return;
    var v = (m[1] === 'ON');
    if (!bridgeOk) { bridgeOk = true; mark('bridge-ok status-bar'); }

    /* Read before the first-sighting guard below returns, so a label that
       already carries a count is recorded rather than mistaken for a save on
       the next mutation. */
    var pulse = pulseOf(text);
    if (lastPulse === null) lastPulse = pulse;
    else if (pulse !== lastPulse) { lastPulse = pulse; shake(); }

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
        /* Nothing here can matter to a window nobody is looking at, and the
           work is not free: this is the whole reason the old loop cost anything
           worth naming. The listener below reads once on the way back. */
        if (!document.hidden) {
          /* Also the retry loop that finds the item, and the recovery path if
             it is ever replaced. Finding it is news, so the backoff restarts -
             otherwise a slow extension host could leave the search running at
             15s intervals. */
          var wasLive = statusLive();
          try { attachStatusBar(); } catch (e) {}
          if (!wasLive && statusLive()) quiet = 0;
          pollState();
        }
        schedulePoll();
      }, pollDelay());
    })();
    pollState();

    /* Guarded like the three at the bottom of the file, and for the same
       reason: this sits in the middle of the payload, so anything it throws
       takes everything after it - the first paint included - down with it. */
    try {
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) return;
        quiet = 0;
        try { attachStatusBar(); } catch (e) {}
        pollState();
      });
    } catch (e) {}
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
