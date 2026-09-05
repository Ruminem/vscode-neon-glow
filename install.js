#!/usr/bin/env node
'use strict';
/**
 * Patch VS Code's workbench bundle with neon-glow.js.
 *   node install.js [--target <path to resources/app>]
 */
const { resolveTargets } = require('./locate');
const { applyPatch, backupOf, payloadPath } = require('./patch');

const targets = resolveTargets(process.argv);
if (!targets.length) {
  console.error('No VS Code installation found. Pass one explicitly:');
  console.error('  node install.js --target "<path to resources/app>"');
  process.exit(1);
}

let ok = 0;
for (const file of targets) {
  try {
    applyPatch(file, payloadPath());
    console.log('patched : ' + file);
    console.log('backup  : ' + backupOf(file));
    ok++;
  } catch (e) {
    console.error('failed  : ' + file + '  (' + e.message + ')');
    if (/EACCES|EPERM/.test(e.code || '')) console.error('  -> run again as administrator / with sudo');
  }
}

if (!ok) process.exit(1);
console.log('\nDone. Quit VS Code COMPLETELY, then start it again.');
console.log('"Reload Window" is not enough - it replays the old bundle from cache.');
console.log('After that, Ctrl+Alt+N toggles the glow instantly (no restart needed).');
