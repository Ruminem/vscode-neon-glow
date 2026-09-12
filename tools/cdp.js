#!/usr/bin/env node
'use strict';
/**
 * Talking to a running VS Code over the Chrome DevTools Protocol.
 *
 * Split out of bench.js when live.js turned up wanting the same three things:
 * a socket, the workbench target, and a way to run an expression inside it.
 *
 * No dependencies. Node 22 and later expose WebSocket as a global and the
 * target list arrives over plain fetch, so this stays inside the rule that this
 * repository installs nothing.
 *
 * Two traps are worth keeping written down, because both cost an afternoon and
 * neither says what it is:
 *
 *   - **VS Code's integrated terminal exports ELECTRON_RUN_AS_NODE=1.** Launch
 *     Code.exe with that set and it starts as Node rather than as an editor: it
 *     exits at once, creates no user-data-dir, and answers every VS Code flag
 *     with "bad option", which reads as though the flags are wrong. Launch from
 *     a plain shell, or unset it first.
 *   - **The HTTP target list calls it `id`; the protocol command wants
 *     `targetId`.** Same target, two names, and getting it wrong produces a
 *     deserialize error with no field name in it.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* One socket to the browser endpoint; page-scoped commands carry a sessionId,
   browser-scoped ones do not. */
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

/**
 * Find the workbench page on `port`, attach to it, and hand back a session
 * along with an `evaluate` that throws what the renderer threw rather than
 * returning undefined and letting the caller guess.
 */
async function attach(port) {
  let targets;
  try {
    targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  } catch (e) {
    throw new Error('No debugger on port ' + port + '. Launch VS Code with '
      + '--remote-debugging-port=' + port + ' and try again.');
  }

  const page = targets.find((t) => t.type === 'page' && /workbench\.html/.test(t.url || ''));
  if (!page) {
    throw new Error('Found ' + targets.length + ' target(s) but no workbench page.');
  }

  const version = await (await fetch('http://127.0.0.1:' + port + '/json/version')).json();
  const cdp = connect(version.webSocketDebuggerUrl);
  await cdp.ready;

  const attached = await cdp.send('Target.attachToTarget',
    { targetId: page.targetId || page.id, flatten: true });
  const sid = attached.sessionId;
  await cdp.send('Runtime.enable', {}, sid);

  const evaluate = async (expr) => {
    const r = await cdp.send('Runtime.evaluate',
      { expression: expr, returnByValue: true, awaitPromise: true }, sid);
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.text + ' :: ' +
        ((r.exceptionDetails.exception || {}).description || '').split('\n')[0]);
    }
    return r.result.value;
  };

  return { cdp, sid, evaluate, close: () => cdp.close() };
}

module.exports = { connect, attach, sleep };
