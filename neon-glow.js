
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
   *
   * What ships on and what ships off follows one line: a knob that only decides
   * what colour lands where is on, and a knob that changes what the editor does
   * while you work is off. Every glow below is the theme's own colour carried to
   * one more surface, so turning them on adds no palette that was not already
   * there. cursorTrail, saveShake and caretArc move things, and nobody asked for
   * that, so they wait to be asked.
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
    findGlow:    18,     /* px of bloom on find matches; 0 = leave them flat     */
    selectionGlow: 12,   /* px of bloom on the selection; 0 = leave it flat      */
    occurrenceGlow: 10,  /* px of bloom on the symbol under the caret; 0 = flat  */
    gutterGlow:    8,    /* px of bloom on the gutter's change bars; 0 = flat    */
    bracketMatchGlow: 10, /* px of bloom on the matching bracket box; 0 = flat   */
    squiggleGlow:   5,   /* px of bloom on error/warning/info squiggles; 0 = flat */
    diffGlow:      10,   /* px of bloom on what changed inside a diff; 0 = flat  */
    lineHighlightGlow: 8, /* px of bloom on the line the editor points at; 0 = flat */
    breakpointGlow: 8,   /* px of bloom on breakpoint glyphs; 0 = leave them flat */
    caretArc:    'off',  /* off, or one of twelve shapes; see KNOB_ENUM below  */
    caretArcMinJump: 5,  /* px of travel before an arc is drawn                  */
    caretArcDuration: 300, /* ms the arc takes to cross the path it drew         */
    caretArcOnDrag: false /* keep drawing while a selection is being dragged out */
  };

  /* Clamped so a hand-edited settings.json cannot produce nonsense. */
  var KNOB_RANGE = {
    brightness: [0, 3], minChroma: [0, 1], chromaSpan: [0.01, 2],
    floor: [0, 1], minLightness: [0, 1], glowLayers: [1, 3], maxBlur: [1, 64],
    cursorTrail: [0, 400], saveShake: [0, 24],
    findGlow: [0, 48], selectionGlow: [0, 32], occurrenceGlow: [0, 32],
    gutterGlow: [0, 24],
    bracketMatchGlow: [0, 32],
    squiggleGlow: [0, 16],
    diffGlow: [0, 32],
    lineHighlightGlow: [0, 24], breakpointGlow: [0, 24],
    caretArcMinJump: [1, 400],
    caretArcDuration: [80, 1200]
  };

  /* Knobs that carry a word rather than a number. A value outside the list is
     dropped the same way a non-number is: the renderer decides what it will
     accept, so a hand-edited settings.json cannot put nonsense in here. */
  var KNOB_ENUM = {
    caretArc: ['off', 'arc', 'beam', 'comet', 'flash', 'wave', 'bolt', 'dots',
                'coil', 'square', 'zip', 'pulse', 'ring']
  };

  /* And knobs that carry a switch. Sorted by type like the other two, so a
     hand-edited settings.json holding the string "true" is dropped rather than
     read as one. */
  var KNOB_BOOL = {
    caretArcOnDrag: true
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

       Off by default, on the side of the line that moves things rather than
       colours them - see the note over KNOBS. Every keystroke restarts the
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
       which moves the caret that way keeps the trail.

       A duration is not what anyone sees; frames are. 45ms is under three of
       them at 60Hz and six or seven at 144Hz, so the same number is a glide on
       one panel and a step or two on another - which is why a value that looks
       right here can read as nothing at all elsewhere. Tuning it by eye means
       saying which display it was tuned on. */
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

    /* The symbol under the caret, and every other place it appears on screen.

       The same derivation again, on the surface next door to find: these are
       semi-transparent backgrounds behind text, so they take a spread for the
       reason the find rule does.

       One pass each, where find takes two. The difference is not how they look
       but when they exist. A find match is on screen only while the widget is
       open and you are looking for something; these appear every time the caret
       lands on a word and stay for as long as it rests there, which is most of
       a working day. The cheaper rule is the one that is always running.

       Three classes rather than one, because VS Code lights the same idea from
       different sources and gives each its own colour. wordHighlight is a read
       and wordHighlightStrong a write, both answered by a language server; a
       theme that separates them is saying something worth keeping, so the write
       gets the wider radius. wordHighlightText is what VS Code falls back to
       when no server answers - plain textual matches - and carrying it means the
       effect still works in a file nothing understands. A theme that leaves any
       one of these colours undefined drops that rule and keeps the others: an
       unset custom property invalidates the declaration, not the block. */
    var occ = Math.round(KNOBS.occurrenceGlow);
    if (occ > 0) {
      var oSpread = Math.round(occ / 3);
      css += '.monaco-editor .wordHighlight { box-shadow: 0 0 ' + occ + 'px '
        + oSpread + 'px var(--vscode-editor-wordHighlightBackground) !important; }\n';
      css += '.monaco-editor .wordHighlightText { box-shadow: 0 0 ' + occ + 'px '
        + oSpread + 'px var(--vscode-editor-wordHighlightTextBackground) !important; }\n';
      css += '.monaco-editor .wordHighlightStrong { box-shadow: 0 0 '
        + Math.round(occ * 1.25) + 'px ' + Math.round(occ / 2.2) + 'px'
        + ' var(--vscode-editor-wordHighlightStrongBackground) !important; }\n';
      /* The fourth one, and the reason this rule was half a feature until it was
         added. The three above are what a language server answers when the caret
         rests on a symbol; this is what VS Code marks on its own when a word is
         selected with the mouse or by double-click. Same idea - here is this
         thing again, elsewhere on screen - and the same semi-transparent kind of
         colour, so it takes the same radius and the same spread. Without it the
         effect appeared and disappeared depending on which hand you had used to
         land on the word, which reads as a bug rather than as a rule. */
      css += '.monaco-editor .selectionHighlight { box-shadow: 0 0 ' + occ + 'px '
        + oSpread + 'px var(--vscode-editor-selectionHighlightBackground) !important; }\n';
    }

    /* The change bars in the gutter - added, modified, deleted - lit from the
       colours the theme gives them, the same derivation once more.

       The spread here is not the one the find rule takes, and the reason is
       different enough to be worth saying. VS Code paints the bar as the
       element's own left border, with a style but no width, so it comes out at
       the CSS initial `medium` - 3px. Its `:before` is what sits over the bar,
       and that box is `width: 0`. A shadow of a box with no area paints
       nothing, whatever the blur, so the spread is what gives the glow a body
       at all. Find needs a spread because its colour is weak; this needs one
       because its box is empty.

       Deleted is drawn elsewhere - a wedge on `:after` rather than a bar - so
       it is lit there instead.

       Each kind is listed twice: once bare, once as `.secondary`. VS Code grew
       the secondary colours for edits it did not make itself, and the bare rule
       is what a build without them still matches. Same `!important` on both, so
       the more specific `.secondary` wins where it exists.

       Cost is bounded harder than any other effect here: not by the viewport
       but by how many lines of it you have changed since the last commit, and
       only in a file under source control. */
    var gut = Math.round(KNOBS.gutterGlow);
    if (gut > 0) {
      var gSpread = Math.max(1, Math.round(gut / 4));
      var bars = [
        ['.dirty-diff-added:before', 'addedBackground'],
        ['.dirty-diff-added.secondary:before', 'addedSecondaryBackground'],
        ['.dirty-diff-modified:before', 'modifiedBackground'],
        ['.dirty-diff-modified.secondary:before', 'modifiedSecondaryBackground'],
        ['.dirty-diff-deleted:after', 'deletedBackground'],
        ['.dirty-diff-deleted.secondary:after', 'deletedSecondaryBackground']
      ];
      for (var gi = 0; gi < bars.length; gi++) {
        css += '.monaco-editor ' + bars[gi][0] + ' { box-shadow: 0 0 ' + gut
          + 'px ' + gSpread + 'px var(--vscode-editorGutter-' + bars[gi][1]
          + ') !important; }\n';
      }
    }

    /* The box drawn around a bracket and its partner while the caret is on one.

       Brackets already glow - the rule above gives them one in currentColor, so
       each nesting level lights in the colour it is painted. The box marking the
       pair did not, which left the one moment the editor is pointing at
       something as the dimmest thing on the line.

       The border colour, not the background. VS Code registers the background
       at #0064001a - ten percent alpha, a hint of a fill - and the border at
       #888, and it is the border a theme is understood to be drawing with. The
       background is the fallback for a theme that sets only that. Opaque, so no
       spread: the same reason the caret rule has none.

       This is the one rule here that lights a colour the token pass would have
       thrown away. minChroma exists to keep body text from glowing, because a
       glow on every word is a wash rather than a highlight; #888 would never
       clear it. The argument does not carry over. There are two of these boxes
       on screen at most, and only while the caret is on a bracket, so what
       lighting them costs is bounded to the moment you asked the question. */
    var brk = Math.round(KNOBS.bracketMatchGlow);
    if (brk > 0) {
      css += '.monaco-editor .bracket-match { box-shadow: 0 0 ' + brk + 'px'
        + ' var(--vscode-editorBracketMatch-border,'
        + ' var(--vscode-editorBracketMatch-background, transparent))'
        + ' !important; }\n';
    }

    /* The wavy underline under errors, warnings and info, lit in the colours
       the theme already draws it with.

       Not a box-shadow, unlike every other surface here. VS Code draws the
       wave as an SVG background - a data URI it builds from the editorError,
       editorWarning or editorInfo foreground - on an overlay element the width
       of the flagged range. A box-shadow would light that rectangle, word and
       all. drop-shadow follows the alpha of what is drawn, which on this
       element is only the wave, so the line glows and the word above it does
       not. The border-bottom VS Code also puts on these classes is the
       high-contrast variant, drawn in the -border colours most themes leave
       empty; it is not what you normally see.

       Two passes, tight then wide, because a 1px line under a single blur
       reads as smudged rather than lit: the tight pass keeps the colour on the
       wave and the wide one is the halo. What the eye reads is the ratio
       between them, as with the token glow.

       Hints are left out on purpose. They are the three dots under a word that
       VS Code keeps quiet by design, and lighting them would undo the one thing
       that tells them apart from a warning.

       The one surface lit with a filter, and a filter is composited per element
       where a shadow is not. The overlays exist only for rendered lines, so the
       cost is bounded by the viewport - a screen full of errors is the most it
       can be. tools/bench.js is the place to measure it in pairs if that ever
       shows. */
    var sq = Math.round(KNOBS.squiggleGlow);
    if (sq > 0) {
      var sqNear = Math.max(1, Math.round(sq * 0.4));
      var waves = [
        ['error', 'editorError'],
        ['warning', 'editorWarning'],
        ['info', 'editorInfo']
      ];
      for (var wi = 0; wi < waves.length; wi++) {
        var wc = 'var(--vscode-' + waves[wi][1] + '-foreground)';
        css += '.monaco-editor .squiggly-' + waves[wi][0] + ' { filter: drop-shadow(0 0 '
          + sqNear + 'px ' + wc + ') drop-shadow(0 0 ' + sq + 'px ' + wc + ') !important; }\n';
      }
    }

    /* What changed, inside a diff.

       Semi-transparent theme colours behind text again, so this takes a spread
       for the same reason find and selection do.

       The word-level highlight only, not the line tint. VS Code paints both:
       .char-insert marks the run of characters that actually differ, and
       .line-insert washes the whole line width behind it. Blurring a full-width
       block bleeds a radius above and below into its neighbours, and a diff
       usually has changed lines next to each other, so what comes out is a haze
       over the region rather than a mark on the change. It is the same line the
       token glow draws when it keeps body text out of it - light on what you
       are looking for, not on everything around it. The line tint is already
       doing the job of saying which side of the diff you are on.

       This is also where the gutter bars are not: VS Code hides them with
       display:none once .modified-in-monaco-diff-editor is on the editor, and
       clicking a file in source control opens a diff. So the view people reach
       for most had the least lit in it, which is what this is for. */
    /* The line the editor is pointing at.

       Four of them, all the same shape: a full-width tint behind one line,
       semi-transparent because text sits on it, so they take a spread like find
       and selection do. The stopped line while debugging, the one below it when
       you click up the call stack, the range that lights when you jump to a
       symbol or peek a result, and the symbol highlight VS Code paints on the
       same occasions.

       The objection that kept the glow off the diff line tint does not reach
       here. That one is a run - changed lines come in blocks, and blurring each
       of them washes the region rather than marking anything. These are one at
       a time, which is the same reason the bracket box is allowed through a
       threshold built to keep body text out. */
    var lh = Math.round(KNOBS.lineHighlightGlow);
    if (lh > 0) {
      var lSpread = Math.round(lh / 3);
      var lines = [
        ['debug-top-stack-frame-line', 'stackFrameHighlightBackground'],
        ['debug-focused-stack-frame-line', 'focusedStackFrameHighlightBackground'],
        ['rangeHighlight', 'rangeHighlightBackground'],
        ['symbolHighlight', 'symbolHighlightBackground']
      ];
      for (var li = 0; li < lines.length; li++) {
        css += '.monaco-editor .' + lines[li][0] + ' { box-shadow: 0 0 ' + lh + 'px '
          + lSpread + 'px var(--vscode-editor-' + lines[li][1] + ') !important; }\n';
      }
    }

    /* Breakpoints, in whatever colour they were painted.

       currentColor rather than a named theme variable, the way the bracket rule
       works. The colour for these does not arrive as one: searching the whole
       installation for debugIcon.breakpoint.foreground finds nothing, so a rule
       written against that name would have been a no-op that looked fine in the
       source. currentColor cannot be wrong about it - it is whatever VS Code
       settled on, including a theme that overrode it and including the dimmer
       shade a disabled breakpoint gets.

       text-shadow, not box-shadow: a codicon is a font glyph, so the light has
       to follow the letterform rather than the box around it. That is the same
       reason the squiggles use a filter - the shape being lit is not a
       rectangle. It inherits into the ::before that carries the glyph. */
    var bp = Math.round(KNOBS.breakpointGlow);
    if (bp > 0) {
      css += '.monaco-editor [class*="codicon-debug-breakpoint"] { text-shadow: 0 0 '
        + Math.max(1, Math.round(bp * 0.4)) + 'px currentColor, 0 0 ' + bp
        + 'px currentColor !important; }\n';
    }

    var dif = Math.round(KNOBS.diffGlow);
    if (dif > 0) {
      var dSpread = Math.round(dif / 3);
      var sides = [['insert', 'inserted'], ['delete', 'removed']];
      for (var di = 0; di < sides.length; di++) {
        css += '.monaco-editor .char-' + sides[di][0] + ' { box-shadow: 0 0 ' + dif + 'px '
          + dSpread + 'px var(--vscode-diffEditor-' + sides[di][1]
          + 'TextBackground) !important; }\n';
      }
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
    arcCachedColour = null;    /* a new theme brings a new caret colour */

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
      if (KNOB_BOOL[name]) {
        if (typeof v !== 'boolean') continue;
      } else if (words) {
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

  /**
   * Whether the caret is being moved by a mouse that is still held down.
   *
   * A click and a drag are the same gesture until one of them keeps going: both
   * press, both move the caret. So the first move after a press is the click
   * landing and still draws - the settings have promised a click since this
   * feature shipped - and everything after it, until the button comes back up,
   * is the drag. Dragging a selection across a screenful moves the caret at
   * mouse rate, and an arc for every step of that reads as noise rather than as
   * light following the caret, which is why caretArcOnDrag ships off.
   */
  var arcPointer = { down: false, moved: 0 };

  function attachArcPointer() {
    window.addEventListener('pointerdown', function (e) {
      /* The primary button only. A middle-click paste moves the caret once and
         is not a drag, and the context menu does not move it at all. */
      if (!e || !e.button) { arcPointer.down = true; arcPointer.moved = 0; }
    }, true);
    /* Pointer events rather than mouse ones for the sake of this release:
       a drag that ends outside the window never delivers a mouseup, and the
       button would then be held down forever - which suppresses every caret
       move after it, keyboard included, until the next complete click. Monaco
       takes pointer capture for its drags, so the pointerup is delivered to the
       capturing element and passes through here on the way.
       blur is the backstop for the rest: alt-tab away mid-drag and the release
       happens somewhere this document never hears about. */
    window.addEventListener('pointerup', function () { arcPointer.down = false; }, true);
    window.addEventListener('pointercancel', function () { arcPointer.down = false; }, true);
    window.addEventListener('blur', function () { arcPointer.down = false; });
  }

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

  /**
   * How long the light takes to cross the path it was given.
   *
   * A duration is not what anyone sees; frames are. At 60Hz the default of 300
   * is eighteen of them, and the spark is only lit for the middle of that - the
   * animation fades in over the first eighth and back out at the end - so the
   * floor is 80 rather than something smaller. Below about that the whole thing
   * happens inside three or four frames and reads as a flicker where the caret
   * landed rather than as anything travelling, which is what `flash` is for and
   * is a better way to ask for it. The same value is half as many frames on a
   * 60Hz panel as on a 144Hz one, the lesson cursorTrail already paid for.
   *
   * flash keeps its own shorter life at a fixed ratio of this. The two were 300
   * and 260 when they were written, and there is no reason in the code for the
   * difference beyond a burst wanting to be over sooner than a journey - so it
   * rides along rather than becoming a nineteenth setting.
   */
  function arcDuration() {
    return Math.max(80, Math.min(1200, Math.round(KNOBS.caretArcDuration)));
  }
  var FLASH_RATIO = 260 / 300;

  /**
   * Cached, because reading a computed style forces the engine to resolve one
   * and a held arrow key draws about thirty times a second. It only changes
   * with the theme, and the theme arriving is exactly when the stylesheet is
   * rebuilt, so that is where it is thrown away.
   */
  var arcCachedColour = null;

  function arcColour(el) {
    if (arcCachedColour) return arcCachedColour;
    var c = '#ffffff';
    try {
      var v = getComputedStyle(el).getPropertyValue('--vscode-editorCursor-foreground');
      if (v && v.trim()) c = v.trim();
    } catch (e) {}
    arcCachedColour = c;
    return c;
  }

  function arcRelease(node, ms) {
    document.body.appendChild(node);
    setTimeout(function () { try { node.remove(); } catch (e) {} }, ms + 150);
  }

  /* No travel to trace, so it marks the arrival instead of the journey. The one
     style that still reads at a Tab's two characters. */
  function drawFlash(x, y, colour, ms, ring) {
    var d = document.createElement('div');
    /* The same burst drawn two ways. flash fills, so it reads as light arriving
       at a point; ring only carries an edge, so it reads as the point pushing
       something outwards. On a Tab or a click the two are the clearest pair in
       the set, which is why the second one is worth having at all. */
    d.style.cssText = ARC_BOX + 'width:30px;height:30px;border-radius:50%;left:'
      + (x - 15) + 'px;top:' + (y - 15) + 'px;'
      + (ring ? 'border:2px solid ' + colour + ';box-shadow:0 0 10px ' + colour
              : 'background:radial-gradient(circle,#fff 0%,' + colour + ' 35%,transparent 70%)');
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
  function drawPath(style, sx, sy, w, angle, colour, ms) {
    var comet = (style === 'comet');
    var dots = (style === 'dots');

    /* How far the path strays from the straight line between the two caret
       positions, and in how many segments. Everything else about a style is
       shared, so a new shape is these two numbers and the Y below: beam takes
       no detour at all and needs one segment, and the rest read as different
       because they wander differently rather than because they are drawn by
       different code. */
    var amp = 0, n = 1;
    if (style === 'arc')    { amp = Math.max(2.5, Math.min(w * 0.035, 7)); n = Math.max(3, Math.round(w / 20)); }
    if (style === 'wave')   { amp = Math.max(3, Math.min(w * 0.05, 10));   n = Math.max(8, Math.round(w / 8)); }
    if (style === 'bolt')   { amp = Math.max(4, Math.min(w * 0.09, 16));   n = Math.max(2, Math.round(w / 34)); }
    if (style === 'coil')   { amp = Math.max(3, Math.min(w * 0.06, 12));   n = Math.max(12, Math.round(w / 5)); }
    if (style === 'square') { amp = Math.max(4, Math.min(w * 0.08, 14));   n = Math.max(4, Math.round(w / 24)); }
    var h = amp * 2 + 14, mid = h / 2;

    var pts = [], len = 0, px = 0, py = mid;
    for (var i = 0; i <= n; i++) {
      var X = w * i / n;
      var Y;
      /* Both ends are pinned to the line so the light still leaves the caret it
         left and arrives at the one it is going to, whatever it does between. */
      if (i === 0 || i === n) Y = mid;
      else if (style === 'wave') Y = mid + Math.sin(i / n * Math.PI * 4) * amp;
      else if (style === 'coil') Y = mid + Math.sin(i / n * Math.PI * 12) * amp;
      else if (style === 'bolt') Y = mid + (i % 2 ? amp : -amp);
      /* Two points at each level before the jump, which is what makes it a
         crenellation rather than the sharp zigzag bolt already draws. */
      else if (style === 'square') Y = mid + (Math.floor(i / 2) % 2 ? amp : -amp);
      else Y = mid + (Math.random() * 2 - 1) * amp;
      if (i) len += Math.sqrt((X - px) * (X - px) + (Y - py) * (Y - py));
      px = X; py = Y;
      pts.push(X.toFixed(1) + ',' + Y.toFixed(1));
    }
    var points = pts.join(' ');
    /* Capped to the path, or the dash is longer than the line it runs on and
       the offset animates the wrong way: the spark slides backwards. Nothing
       showed it until the threshold dropped to five, where an arrow key draws
       seven pixels of path against a fourteen pixel head. */
    var head = comet ? Math.max(8, Math.min(len * 0.08, 26))
                     : Math.max(14, Math.min(len * 0.30, 70));
    head = Math.min(head, len * 0.8);

    var wrap = document.createElement('div');
    /* The path is built along +x and then turned to face the way the caret
       went, so one geometry serves every direction. It is rotated about its own
       start point, which is where the caret was, so the light still leaves
       there and arrives where the caret is now. This was scaleX(-1) while only
       horizontal moves drew: a flip answers "which way along this line" and has
       nothing to say about a move that is mostly vertical. */
    wrap.style.cssText = ARC_BOX + 'left:' + sx + 'px;top:' + (sy - mid) + 'px'
      + ';transform-origin:0px ' + mid + 'px'
      + ';transform:rotate(' + angle.toFixed(4) + 'rad)';

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
      /* What the dash is doing is the second axis a style can differ on, and it
         is a bigger difference than the shape: the same path reads as one head
         travelling it, a stream of short ones, a line drawing itself in, or the
         whole route lighting at once. All of it is the offset of a pattern -
         nothing grows and nothing is redrawn, which is why a style costs the
         same whichever of these it picks.
           zip runs its offset the other way on purpose. The pattern is one dash
         as long as the path followed by an equal gap, so an offset of len puts
         the gap over the whole thing and nothing shows; bringing it to zero
         slides the dash on from the end the caret left. */
      if (style === 'pulse') {
        el.animate([
          { opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 0 }
        ], { duration: ms, easing: 'cubic-bezier(.12,.85,.2,1)', fill: 'forwards' });
        continue;
      }
      var zip = (style === 'zip');
      el.style.strokeDasharray = dots ? '2 7' : zip ? (len + ' ' + len) : (head + ' ' + len);
      el.animate([
        { strokeDashoffset: zip ? len : 0, opacity: 0 },
        { opacity: 1, offset: 0.12 },
        { strokeDashoffset: zip ? 0 : (dots ? -len : -(len - head)), opacity: 0 }
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

    /* A scroll carries the caret across the screen without the caret having
       gone anywhere, and the style attribute alone cannot tell the two apart.
       Which element a scroll writes to has moved around between Monaco
       versions, so rather than depend on the answer this compares the
       container the layer sits in: if it moved too, the caret went with it.
       Reading its inline style is another string read, the same as the caret's
       - a rect here would be a layout on every keystroke.
       A move that scrolls as it lands is skipped with it, which is right: there
       is no path on screen to draw when the text underneath it has shifted. */
    var scroll = arcScrollSig(w);
    if (scroll !== w.scroll) { w.scroll = scroll; return; }

    /* The click that starts a drag draws; the drag itself does not, unless it
       has been asked for. Counted here rather than at the press so that a press
       which never moves the caret does not spend the one move it is allowed. */
    if (arcPointer.down && arcPointer.moved++ && !KNOBS.caretArcOnDrag) return;

    /* Both axes. This read Math.abs(dx) with anything vertical thrown out a
       line above, so a plain Down drew nothing at all - the geometry below
       could only lay a path along a line, and a dy it could not draw was
       easier to refuse than to answer. The docs never said horizontal. */
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < arcMinJump()) return;

    var r = w.caret.getBoundingClientRect();
    if (!r.width && !r.height) return;

    var colour = arcColour(w.caret);

    /* Where the caret is going, not where it is currently being painted.
       cursorTrail puts a CSS transition on left and top, and this observer runs
       the moment the inline style changes - which is the moment that transition
       starts, with the caret still drawn at the position it is leaving. A rect
       read there answers with the old position, and the whole arc lands one
       full move behind the caret: it appears to set out from somewhere behind
       where the caret was and to stop short of where it now is. With no trail
       the rect is already the new position and nothing looked wrong, which is
       why this survived.
       The inline values are the destination whatever is animating towards it,
       so the offset parent's own corner plus those is where the caret will be.
       The rect is still what answers for width and height, which no transition
       touches. offsetParent is asked rather than assumed to be the layer; when
       there is none to ask, the old reading is the only one available. */
    var op = w.caret.offsetParent;
    var base = op ? op.getBoundingClientRect() : null;
    var cx = base ? base.left + nx : r.left;
    var cy = base ? base.top + ny : r.top;

    var midY = cy + r.height / 2;
    /* The trailing edge: the light runs up to the back of the caret rather than
       through it, so both ends of the path sit on the same side of it and the
       path is exactly as long as the caret travelled. A move with no horizontal
       part has no back, so it takes the middle. */
    var ex = dx > 0 ? cx : dx < 0 ? cx + r.width : cx + r.width / 2;
    var ms = arcDuration();
    if (style === 'flash' || style === 'ring') {
      drawFlash(ex, midY, colour, Math.round(ms * FLASH_RATIO), style === 'ring');
      return;
    }
    /* Not "w": that is the watch this was handed, and shadowing it here worked
       only because nothing below touched it again. */
    drawPath(style, ex - dx, midY - dy, dist, Math.atan2(dy, dx), colour, ms);
  }

  /**
   * What this editor's scroll looks like right now, as a string to compare
   * against the last one. Empty when there is nothing to read, which compares
   * equal to itself and so never suppresses anything.
   */
  function arcScrollSig(w) {
    var c = w.content;
    if (!c || !c.style) return '';
    return c.style.top + '|' + c.style.left + '|' + c.style.transform;
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
      /* The element a scroll moves. Held per watch so the lookup happens once
         per pane rather than on every caret move. */
      var content = null;
      try { content = layer.closest('.lines-content') || layer.parentElement; }
      catch (e) { content = layer.parentElement; }
      var w = {
        layer: layer, caret: caret, mo: null, content: content, scroll: '',
        x: caret ? (parseFloat(caret.style.left) || 0) : 0,
        y: caret ? (parseFloat(caret.style.top) || 0) : 0
      };
      w.scroll = arcScrollSig(w);
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

  /* A second invisible marker, counted wherever it sits in the label rather
     than at the end. That is what keeps it out of the save pulse's way:
     pulseOf reads the trailing run, so a character appended after it would
     read as the count dropping to zero and fire a jolt nobody asked for.

     The extension bumps this when a setting changes, so a knob lands in the
     frame the label is painted rather than waiting for the file poll - which
     backs off to 15s while you are only reading, and that is a long time to
     watch a slider do nothing. */
  var NUDGE_CODE = 0x2060;
  var lastNudge = null;

  function nudgeOf(text) {
    var n = 0;
    for (var i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === NUDGE_CODE) n++;
    }
    return n;
  }

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

    /* Same first-sighting guard as the pulse. pollState does not schedule
       anything - schedulePoll owns the timer - so calling it here reads once
       and leaves the loop alone, exactly as the visibility listener does. */
    var nudge = nudgeOf(text);
    if (lastNudge === null) lastNudge = nudge;
    else if (nudge !== lastNudge) { lastNudge = nudge; quiet = 0; pollState(); }

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
  try { attachArcPointer(); } catch (e) {}

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
