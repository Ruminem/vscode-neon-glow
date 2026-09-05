#!/usr/bin/env node
'use strict';
/**
 * Restore the original workbench bundle from its backup.
 *   node uninstall.js [--target <path to resources/app>]
 */
const { resolveTargets } = require('./locate');
const { removePatch } = require('./patch');

const targets = resolveTargets(process.argv);
if (!targets.length) {
  console.error('No VS Code installation found.');
  process.exit(1);
}

let ok = 0;
for (const file of targets) {
  try {
    if (!removePatch(file)) { console.log('skip (no backup): ' + file); continue; }
    console.log('restored: ' + file);
    ok++;
  } catch (e) {
    console.error('failed  : ' + file + '  (' + e.message + ')');
    if (/EACCES|EPERM/.test(e.code || '')) console.error('  -> run again as administrator / with sudo');
  }
}

if (!ok) process.exit(1);
console.log('\nDone. Quit VS Code completely and start it again.');
