#!/usr/bin/env node
'use strict';
/**
 * Build the VSIX under the same name the release workflow publishes.
 *
 * vsce names the file after `name` in package.json, which is vscode-neon-glow:
 * the repository is called that, the artifact is not. Left alone, a local build
 * and a downloaded release asset would have different names, and install.cmd
 * reads the version by stripping the "neon-glow-" prefix off the file it finds.
 */
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const out = 'neon-glow-' + require('../package.json').version + '.vsix';

/* One command string rather than an argument list: npx is a .cmd on Windows and
   needs a shell, and node deprecates passing an unescaped argv through one. The
   name comes from our own package.json, and it is quoted. */
execSync('npx --yes @vscode/vsce package --out "' + out + '"',
         { cwd: root, stdio: 'inherit' });
