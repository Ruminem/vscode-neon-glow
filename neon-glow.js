
/* ============ NEON GLOW (injected) ============ */
try {
(function () {
  if (typeof window === 'undefined' || window.__NEON_INSTALLED) { return; }
  window.__NEON_INSTALLED = true;

  /* ---- tuning knobs ---- */
  var BRIGHTNESS   = 1.0;   /* overall glow strength, 0.0 ~ 1.5 */
  var MIN_CHROMA   = 0.30;  /* below this = not a vivid syntax colour -> no glow  */
  var CHROMA_SPAN  = 0.50;  /* chroma range mapped onto the strength ramp          */
  var FLOOR        = 0.40;  /* strength for a colour that just passes MIN_CHROMA   */
  var MIN_LIGHTNESS = 0.25; /* darker than this -> no glow                         */

  var STYLE_ID = 'neon-glow-styles';

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
    var v = Math.round(Math.max(0,Math.min(1,x))*255).toString(16);
    return v.length < 2 ? '0'+v : v;
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
    var chroma = max - min;              /* NOT hsl saturation: that inflates near-white */

    if (lightness < MIN_LIGHTNESS) return null;
    if (chroma < MIN_CHROMA) return null;

    var t = Math.max(0, Math.min(1, (chroma - MIN_CHROMA) / CHROMA_SPAN));
    var k = (FLOOR + (1 - FLOOR) * t) * BRIGHTNESS;

    var near = Math.round(2 + 3*k), mid = Math.round(6 + 10*k), far = Math.round(14 + 22*k);
    return 'color: #'+hex+' !important; text-shadow:'
      + ' 0 0 '+near+'px #'+hex+alpha(0.90*k)+','
      + ' 0 0 '+mid+'px #'+hex+alpha(0.65*k)+','
      + ' 0 0 '+far+'px #'+hex+alpha(0.40*k)+' !important;'
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

  var chromeStyles = '\n.monaco-editor .margin, .monaco-editor .inputarea.ime-input { background: transparent; }\n'
    + '.monaco-editor .cursor { box-shadow: 0 0 8px var(--vscode-editorCursor-foreground, transparent); }\n';

  var lastLen = -1;
  function apply() {
    var tokensEl = document.querySelector('.vscode-tokens-styles');
    if (!tokensEl) return false;
    var source = tokensEl.textContent || '';
    if (source.replace(/\s/g, '') === '') return false;
    if (source.length === lastLen) return true;
    lastLen = source.length;
    var styleTag = document.getElementById(STYLE_ID);
    if (!styleTag) {
      styleTag = document.createElement('style');
      styleTag.setAttribute('id', STYLE_ID);
    }
    styleTag.textContent = addGlow(source) + chromeStyles;
    (document.head || document.body).appendChild(styleTag);
    mark('applied', 'glow=' + glowCount + ' skip=' + skipCount);
    return true;
  }

  var attached = false;
  function startObservers() {
    var el = document.querySelector('.vscode-tokens-styles');
    if (el && !attached) {
      attached = true;
      new MutationObserver(function () { try { apply(); } catch (e) {} })
        .observe(el, { childList: true, characterData: true, subtree: true });
    }
  }

  var ticks = 0;
  var timer = setInterval(function () {
    ticks++;
    try { if (apply()) startObservers(); }
    catch (e) { mark('error', String(e && e.message || e)); clearInterval(timer); return; }
    if (ticks > 600) clearInterval(timer);
  }, 300);

  try { apply(); startObservers(); } catch (e) {}
})();
} catch (e) {
  try { console.error('[NEON] fatal', e); } catch (_) {}
}
/* ============ /NEON GLOW ============ */
