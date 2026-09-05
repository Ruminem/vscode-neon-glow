#!/usr/bin/env node
'use strict';
/**
 * Injects neon-glow.js into VS Code's workbench bundle.
 *   node install.js [--target <path to resources/app>]
 */
const fs = require('fs');
const path = require('path');
const { resolveTargets, MARKER } = require('./locate');

function inject(file, payload) {
  const backup = file + '.pre-neon.bak';
  let base;
  if (fs.existsSync(backup)) {
    base = fs.readFileSync(backup, 'utf8');   // reinstalling: always build from the pristine copy
  } else {
    base = fs.readFileSync(file, 'utf8');
    if (base.includes(MARKER)) throw new Error('already patched, but no backup exists');
    fs.writeFileSync(backup, base, 'utf8');
  }
  fs.writeFileSync(file, base + payload, 'utf8');
  return backup;
}

const targets = resolveTargets(process.argv);
if (!targets.length) {
  console.error('No VS Code installation found. Pass one explicitly:');
  console.error('  node install.js --target "<path to resources/app>"');
  process.exit(1);
}

const payload = fs.readFileSync(path.join(__dirname, 'neon-glow.js'), 'utf8');
let ok = 0;

for (const file of targets) {
  try {
    const backup = inject(file, payload);
    console.log('patched : ' + file);
    console.log('backup  : ' + backup);
    ok++;
  } catch (e) {
    console.error('failed  : ' + file + '  (' + e.message + ')');
    if (/EACCES|EPERM/.test(e.code || '')) console.error('  -> run again as administrator / with sudo');
  }
}

if (!ok) process.exit(1);
console.log('\nDone. Quit VS Code COMPLETELY, then start it again.');
console.log('"Reload Window" is not enough - it replays the old bundle from cache.');
