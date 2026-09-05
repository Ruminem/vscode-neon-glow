'use strict';
const fs = require('fs');
const path = require('path');
const { MARKER } = require('./locate');

const backupOf = file => file + '.pre-neon.bak';

function isPatched(file) {
  try { return fs.readFileSync(file, 'utf8').includes(MARKER); } catch (e) { return false; }
}

/**
 * Append the payload to `file`, keeping a pristine backup.
 * Re-installing always rebuilds from the backup, never from an already-patched file.
 */
function applyPatch(file, payloadPath) {
  const payload = fs.readFileSync(payloadPath, 'utf8');
  const backup = backupOf(file);
  let base;

  if (fs.existsSync(backup)) {
    base = fs.readFileSync(backup, 'utf8');
  } else {
    base = fs.readFileSync(file, 'utf8');
    if (base.includes(MARKER)) throw new Error('already patched, but no backup exists');
    fs.writeFileSync(backup, base, 'utf8');
  }

  fs.writeFileSync(file, base + payload, 'utf8');
  return backup;
}

/** Restore the pristine bundle and drop the backup. Returns false if nothing to do. */
function removePatch(file) {
  const backup = backupOf(file);
  if (!fs.existsSync(backup)) return false;
  fs.copyFileSync(backup, file);
  fs.unlinkSync(backup);
  return true;
}

function payloadPath() {
  return path.join(__dirname, 'neon-glow.js');
}

module.exports = { applyPatch, removePatch, isPatched, backupOf, payloadPath };
