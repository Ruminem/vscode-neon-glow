#!/usr/bin/env node
'use strict';
/**
 * Restores the original workbench bundle from its .pre-neon.bak backup.
 *   node uninstall.js [--target <path to resources/app>]
 */
const fs = require('fs');
const { resolveTargets } = require('./locate');

const targets = resolveTargets(process.argv);
if (!targets.length) {
  console.error('No VS Code installation found.');
  process.exit(1);
}

let ok = 0;
for (const file of targets) {
  const backup = file + '.pre-neon.bak';
  if (!fs.existsSync(backup)) { console.log('skip (no backup): ' + file); continue; }
  try {
    fs.copyFileSync(backup, file);
    fs.unlinkSync(backup);
    console.log('restored: ' + file);
    ok++;
  } catch (e) {
    console.error('failed  : ' + file + '  (' + e.message + ')');
    if (/EACCES|EPERM/.test(e.code || '')) console.error('  -> run again as administrator / with sudo');
  }
}

if (!ok) process.exit(1);
console.log('\nDone. Quit VS Code completely and start it again.');
