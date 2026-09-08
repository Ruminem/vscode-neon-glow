
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
    selectionGlow: 0,    /* px of bloom on the selection; 0 = leave it flat      */
    caretArc:    'off',  /* off | arc | beam | comet | flash                     */
    caretArcMinJump: 5   /* px of travel before an arc is drawn                  */
  };

  /* Clamped so a hand-edited settings.json cannot produce nonsense. */
  var KNOB_RANGE = {
    brightness: [0, 3], minChroma: [0, 1], chromaSpan: [0.01, 2],
    floor: [0, 1], minLightness: [0, 1], glowLayers: [1, 3], maxBlur: [1, 64],
    cursorTrail: [0, 400], saveShake: [0, 24],
    findGlow: [0, 48], selectionGlow: [0, 32],
    caretArcMinJump: [1, 400]
  };

  /* Knobs that carry a word rather than a number. A value outside the list is
     dropped the same way a non-number is: the renderer decides what it will
     accept, so a hand-edited settings.json cannot put nonsense in here. */
  var KNOB_ENUM = {
    caretArc: ['off', 'arc', 'beam', 'comet', 'flash']
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
       against our two - and hard-codes 80ms. With both on, this value wins.

       Of the three properties listed, this build animates left and top: the
       caret is position:absolute and Monaco moves it by setting those, not by
       transforming it. They are layout properties, so each frame of the slide
       is main-thread work rather than compositor work - which is why the
       duration is worth keeping short, and part of why this ships off. The
       same is true of VS Code's own option, at 80ms and over "all". transform
       is listed anyway, and costs nothing while it goes unused, so that a build
       which moves the caret that way keeps the trail. */
    var trail = Math.round(KNOBS.cursorTrail);
    if (trail > 0) {
      css += '@media (prefers-reduced-motion: no-preference) {'
        + ' .monaco-editor .cursor { transition: transform ' + trail + 'ms ease-out,'
        + ' left ' + trail + 'ms ease-out, top ' + trail + 'ms ease-out !important; } }\n';
    }

    /* The jolt on save.

       A CSS animation on transform alone, not a JS loop writing inline styles.
       An animation the compositor can run needs nothing from the main thread
       once it starts, while a loop asks for a style recalculation on every
       frame of it - that much is what the choice buys.

       What it does not buy is known: whether either approach re-rasters the
       glow was never measured. Both promote a layer, and a claim about raster
       cost here would be arithmetic rather than a reading. tools/bench.js is
       the place to settle it if it ever matters.

       will-change is scoped to the class rather than left on the rule, so the
       promotion lasts the 150ms and nothing is held promoted while you are only
       reading. */
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
      var words = KNOB_ENUM[name];
      if (words) {
        if (typeof v !== 'string' || words.indexOf(v) === -1) continue;
      } else {
        if (typeof v !== 'number' || !isFinite(v)) continue;
        var r = KNOB_RANGE[name];
        v = Math.max(r[0], Math.min(r[1], v));
      }
      if (KNOBS[name] === v) continue;
      KNOBS[name] = v;
      changed = true;
    }
    if (changed) {
      lastLen = -1;
      render();
      /* Switching the arc on has to find a caret to watch; switching it off
         leaves the observer in place, which costs two parseFloats on a move
         that then draws nothing. */
      try { attachArc(); } catch (e) {}
      mark('knobs');
    }
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

  /* ------------------------------------------------------------------
   * The caret arc: a line of light drawn along the way the caret just moved.
   *
   * This is the first thing here that builds elements rather than a stylesheet,
   * and the workbench enforces Trusted Types, so innerHTML is not available -
   * assigning a string to it throws. Everything below goes through
   * createElementNS, which is not gated.
   *
   * The trigger is a MutationObserver on the focused editor's cursors layer
   * rather than a key listener, because the caret also moves for reasons no key
   * explains: find-next, go-to-definition, undo, a click. The callback reads the
   * caret's inline left/top as strings and compares numbers, which costs no
   * layout; a rect is only measured on the rare frame that actually draws.
   * ------------------------------------------------------------------ */
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var ARC_BOX = 'position:fixed;pointer-events:none;z-index:2147483647;';

  var reduceMotion = null;
  try { reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)'); } catch (e) {}

  /* One entry per cursors layer on screen - one editor, or one pane of a split. */
  var arcWatch = [];

  function arcStyle() {
    var s = KNOBS.caretArc;
    return (typeof s === 'string' && s !== 'off') ? s : null;
  }

  /**
   * How far the caret has to go before this is worth drawing.
   *
   * The default of 5 is under one character, so a single arrow key clears it.
   * That is deliberate: holding an arrow reads as light running along with the
   * caret, which is what the effect is for. It also means a held key draws one
   * of these per repeat, which is the only place the feature costs anything -
   * raising this is the lever if that ever matters.
   *
   * Never zero. A style attribute on the caret changes for reasons that are not
   * a move at all, and a floor of one keeps those from drawing.
   */
  function arcMinJump() {
    return Math.max(1, Math.round(KNOBS.caretArcMinJump));
  }

  function arcColour(el) {
    try {
      var c = getComputedStyle(el).getPropertyValue('--vscode-editorCursor-foreground');
      if (c && c.trim()) return c.trim();
    } catch (e) {}
    return '#ffffff';
  }

  function arcRelease(node, ms) {
    document.body.appendChild(node);
    setTimeout(function () { try { node.remove(); } catch (e) {} }, ms + 150);
  }

  /* No travel to trace, so it marks the arrival instead of the journey. The one
     style that still reads at a Tab's two characters. */
  function drawFlash(x, y, colour, ms) {
    var d = document.createElement('div');
    d.style.cssText = ARC_BOX + 'width:30px;height:30px;border-radius:50%;left:'
      + (x - 15) + 'px;top:' + (y - 15) + 'px;'
      + 'background:radial-gradient(circle,#fff 0%,' + colour + ' 35%,transparent 70%)';
    arcRelease(d, ms);
    d.animate([
      { transform: 'scale(0.2)', opacity: 0 },
      { transform: 'scale(1)', opacity: 1, offset: 0.25 },
      { transform: 'scale(2)', opacity: 0 }
    ], { duration: ms, easing: 'cubic-bezier(.1,.8,.2,1)', fill: 'forwards' });
  }

  /**
   * The other three, which differ only in numbers.
   *
   *   arc    jagged, with the path lit behind the spark
   *   beam   the same, straight
   *   comet  no path at all, just a short head flying
   *
   * The spark travels by dash offset rather than by growing: a stroke that
   * lengthens reads as a bar being drawn, where a short dash moving along a
   * fixed path reads as something going somewhere. The jitter is rolled fresh
   * every time, because a fixed zigzag repeating on every jump is the thing
   * that would look cheap.
   */
  function drawPath(style, boxLeft, midY, w, flip, colour, ms) {
    var jag = (style === 'arc');
    var comet = (style === 'comet');
    var amp = jag ? Math.max(2.5, Math.min(w * 0.035, 7)) : 0;
    var h = amp * 2 + 14, mid = h / 2;
    var n = jag ? Math.max(3, Math.round(w / 20)) : 1;

    var pts = [], len = 0, px = 0, py = mid;
    for (var i = 0; i <= n; i++) {
      var X = w * i / n;
      var Y = (i === 0 || i === n) ? mid : mid + (Math.random() * 2 - 1) * amp;
      if (i) len += Math.sqrt((X - px) * (X - px) + (Y - py) * (Y - py));
      px = X; py = Y;
      pts.push(X.toFixed(1) + ',' + Y.toFixed(1));
    }
    var points = pts.join(' ');
    var head = comet ? Math.max(8, Math.min(len * 0.08, 26))
                     : Math.max(14, Math.min(len * 0.30, 70));

    var wrap = document.createElement('div');
    wrap.style.cssText = ARC_BOX + 'left:' + boxLeft + 'px;top:' + (midY - mid) + 'px'
      + (flip ? ';transform:scaleX(-1)' : '');

    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    svg.style.cssText = 'display:block;overflow:visible';

    function line(stroke, width, css) {
      var p = document.createElementNS(SVG_NS, 'polyline');
      p.setAttribute('points', points);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', stroke);
      p.setAttribute('stroke-width', width);
      p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('stroke-linejoin', 'round');
      if (css) p.style.cssText = css;
      svg.appendChild(p);
      return p;
    }

    /* The wire warming and cooling behind the spark. A comet leaves nothing. */
    var wire = comet ? null : line(colour, 1.5);
    if (wire) wire.setAttribute('opacity', '0');
    var glow = line(colour, comet ? 7 : 5, 'filter:blur(' + (comet ? 4 : 3) + 'px)');
    var core = line('#ffffff', comet ? 2 : 1.4);

    wrap.appendChild(svg);
    arcRelease(wrap, ms);

    if (wire) {
      wire.animate([{ opacity: 0 }, { opacity: 0.4, offset: 0.25 }, { opacity: 0 }],
        { duration: ms, fill: 'forwards' });
    }
    /* White core over a blurred wide pass, the same core-to-bloom split the
       token glow settled on. */
    for (var j = 0; j < 2; j++) {
      var el = j ? core : glow;
      el.style.strokeDasharray = head + ' ' + len;
      el.animate([
        { strokeDashoffset: 0, opacity: 0 },
        { opacity: 1, offset: 0.12 },
        { strokeDashoffset: -(len - head), opacity: 0 }
      ], { duration: ms, easing: 'cubic-bezier(.12,.85,.2,1)', fill: 'forwards' });
    }
  }

  function arcMoved(w) {
    /* The caret element is replaced when a line is re-rendered, so it is looked
       up again whenever the one held has left the document rather than on every
       move. */
    if (!w.caret || !w.caret.isConnected) w.caret = w.layer.querySelector('.cursor');
    if (!w.caret) return;

    var nx = parseFloat(w.caret.style.left) || 0;
    var ny = parseFloat(w.caret.style.top) || 0;
    var dx = nx - w.x, dy = ny - w.y;
    w.x = nx; w.y = ny;

    var style = arcStyle();
    if (!style || !enabled) return;
    if (reduceMotion && reduceMotion.matches) return;
    if (Math.abs(dy) >= 1 || Math.abs(dx) < arcMinJump()) return;

    var r = w.caret.getBoundingClientRect();
    if (!r.width && !r.height) return;

    var colour = arcColour(w.caret);
    var midY = r.top + r.height / 2;
    var w = Math.abs(dx);
    if (style === 'flash') { drawFlash(dx > 0 ? r.left : r.left + r.width, midY, colour, 260); return; }
    drawPath(style, dx > 0 ? r.left - w : r.left + r.width, midY, w, dx < 0, colour, 300);
  }

  /**
   * Watch every cursors layer on screen, not the focused one.
   *
   * Focus looked like the right handle and is not. ".focused" is put on the
   * editor by Monaco and taken off again the moment focus goes anywhere else -
   * a panel, a dialog, the developer tools - so a lookup that requires it
   * answers null most of the times it is asked. Worse, the re-seek rode on
   * focusin in the capture phase, which runs before Monaco has added the class:
   * the one moment it was guaranteed to fail.
   *
   * There are only ever a handful of layers, one per open pane, and each fires
   * only when its own caret moves, so watching all of them costs nothing over
   * watching one and needs no idea of which is in front.
   */
  function attachArc() {
    if (!arcStyle()) return;
    var layers;
    try { layers = document.querySelectorAll('.monaco-editor .cursors-layer'); }
    catch (e) { return; }

    for (var i = arcWatch.length - 1; i >= 0; i--) {
      if (!arcWatch[i].layer.isConnected) {
        try { arcWatch[i].mo.disconnect(); } catch (e) {}
        arcWatch.splice(i, 1);
      }
    }

    for (var j = 0; j < layers.length; j++) {
      var layer = layers[j], seen = false;
      for (var k = 0; k < arcWatch.length; k++) {
        if (arcWatch[k].layer === layer) { seen = true; break; }
      }
      if (seen) continue;

      var caret = layer.querySelector('.cursor');
      var w = {
        layer: layer, caret: caret, mo: null,
        x: caret ? (parseFloat(caret.style.left) || 0) : 0,
        y: caret ? (parseFloat(caret.style.top) || 0) : 0
      };
      /* Reported rather than swallowed. A throw in here used to leave nothing
         at all behind, which is a bad way to learn that a selector was wrong. */
      w.mo = new MutationObserver((function (watch) {
        return function () {
          try { arcMoved(watch); }
          catch (e) { mark('arc-error', String(e && e.message || e)); }
        };
      })(w));
      w.mo.observe(layer, { attributes: true, attributeFilter: ['style'], subtree: true });
      arcWatch.push(w);
    }
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
          try { attachArc(); } catch (e) {}
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
    arcWatching: function () { return arcWatch.length; },
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
  try { attachArc(); } catch (e) {}

  /* Panes come and go, and focusin is a cheap signal that one might have. It no
     longer decides which caret to watch - all of them are watched - so it only
     has to catch a layer that appeared, which the poll would find anyway. */
  try {
    window.addEventListener('focusin', function () {
      try { attachArc(); } catch (e) {}
    });
  } catch (e) {}
})();
} catch (e) {
  try { console.error('[NEON] fatal', e); } catch (_) {}
}
/* ============ /NEON GLOW ============ */
