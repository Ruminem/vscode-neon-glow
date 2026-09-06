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

let restored = 0, failed = 0;
for (const file of targets) {
  try {
    if (!removePatch(file)) { console.log('skip (no backup): ' + file); continue; }
    console.log('restored: ' + file);
    restored++;
  } catch (e) {
    failed++;
    console.error('failed  : ' + file + '  (' + e.message + ')');
    if (/EACCES|EPERM/.test(e.code || '')) console.error('  -> run again as administrator / with sudo');
  }
}

/* Nothing to restore is the wanted end state, not an error. This also runs as
   VS Code's vscode:uninstall hook, where a non-zero exit is logged as a failed
   uninstall for a bundle that was already pristine. */
if (failed) process.exit(1);
if (!restored) { console.log('Nothing to restore; the bundle is already original.'); process.exit(0); }
console.log('\nDone. Quit VS Code completely and start it again.');
