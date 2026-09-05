
/* ============ NEON GLOW (injected) ============ */
try {
(function () {
  if (typeof window === 'undefined' || window.__NEON_INSTALLED) { return; }
  window.__NEON_INSTALLED = true;

  /* ---- tuning knobs ---- */
  var BRIGHTNESS    = 1.0;   /* overall strength, 0.0 ~ 1.5                        */
  var MIN_CHROMA    = 0.30;  /* below this = not a vivid syntax colour -> no glow  */
  var CHROMA_SPAN   = 0.50;  /* chroma range mapped onto the strength ramp         */
  var FLOOR         = 0.40;  /* strength for a colour that just passes MIN_CHROMA  */
  var MIN_LIGHTNESS = 0.25;  /* darker than this -> no glow                        */

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

  function removeStyle() {
    var el = document.getElementById(STYLE_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
    lastLen = -1;
  }

  function render() {
    if (!enabled) { removeStyle(); return true; }

    var tokensEl = document.querySelector('.vscode-tokens-styles');
    if (!tokensEl) return false;
    var source = tokensEl.textContent || '';
    if (source.replace(/\s/g, '') === '') return false;
    if (source.length === lastLen && document.getElementById(STYLE_ID)) return true;
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

  /* ------------------------------------------------------------------
   * Bridge. The extension writes state.json into its globalStorage, which
   * is one of the roots the vscode-file protocol handler serves, so the
   * renderer can poll it. That keeps the commands inside the VS Code
   * keybinding system - nothing here intercepts a key.
   * ------------------------------------------------------------------ */
  var bridgeOk = false;
  var lastSeq = null;

  function pollState() {
    fetch(STATE_URL, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) {
        if (!s || typeof s.enabled !== 'boolean') return;
        if (!bridgeOk) { bridgeOk = true; mark('bridge-ok'); }
        /* The first read only records the sequence. Startup state comes from
           localStorage, so a stale file cannot clobber the last known state. */
        if (lastSeq === null) { lastSeq = s.seq; return; }
        if (s.seq !== lastSeq) { lastSeq = s.seq; setEnabled(s.enabled); }
      })
      .catch(function () {});
  }

  if (STATE_URL && STATE_URL.indexOf('vscode-file:') === 0) {
    setInterval(pollState, 800);
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
    bridgeOk: function () { return bridgeOk; }
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

  var ticks = 0;
  var timer = setInterval(function () {
    ticks++;
    try { if (render()) startObservers(); }
    catch (e) { mark('error', String(e && e.message || e)); clearInterval(timer); return; }
    if (ticks > 600) clearInterval(timer);
  }, 300);

  try { render(); startObservers(); } catch (e) {}
})();
} catch (e) {
  try { console.error('[NEON] fatal', e); } catch (_) {}
}
/* ============ /NEON GLOW ============ */
