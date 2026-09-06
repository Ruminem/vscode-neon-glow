#!/usr/bin/env node
'use strict';

/**
 * Tag the current commit with the version package.json already carries.
 *
 * The release workflow refuses to build when the tag and package.json disagree,
 * which is right - a v0.9.4 archive whose manifest says 0.9.3 is a lie - but the
 * refusal arrives a minute later, on a CI page, after the tag is already pushed
 * and has to be deleted. This takes the version from the file rather than from
 * whoever is typing, so the two cannot drift apart in the first place.
 *
 *   node tools/release.js          say what would happen, change nothing
 *   node tools/release.js --tag    create the tag locally
 *   node tools/release.js --push   create it and push it
 */

const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

/* Anything that would make the tag point somewhere surprising. Collected in
   full rather than thrown one at a time, so a single run says everything that
   is wrong with the tree. */
function problems(tag) {
  const out = [];

  if (git('status', '--porcelain')) {
    out.push('the working tree has uncommitted changes - the tag would not include them');
  }

  const local = git('tag', '--list', tag);
  if (local) {
    const at = git('rev-parse', '--short', tag);
    const head = git('rev-parse', '--short', 'HEAD');
    out.push(at === head
      ? tag + ' already exists here; bump the version in package.json first'
      : tag + ' already exists and points at ' + at + ', not ' + head);
  }

  /* A tag that is already on the remote may already have a release built from
     it, and moving one of those changes what people have downloaded. Worth a
     network round trip to find out before rather than after. */
  try {
    if (git('ls-remote', '--tags', 'origin', 'refs/tags/' + tag)) {
      out.push(tag + ' is already on the remote - if a release was built from it,'
        + ' publish the next version instead of moving the tag');
    }
  } catch (e) {
    console.warn('경고: 원격 태그를 확인하지 못함 - ' + e.message.trim().split('\n')[0]);
  }

  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const wantTag = argv.includes('--tag') || argv.includes('--push');
  const wantPush = argv.includes('--push');

  const version = require(path.join(ROOT, 'package.json')).version;
  const tag = 'v' + version;
  const head = git('rev-parse', '--short', 'HEAD');
  const subject = git('log', '-1', '--format=%s');

  console.log('package.json  ' + version);
  console.log('tag           ' + tag);
  console.log('commit        ' + head + '  ' + subject);
  console.log();

  const found = problems(tag);
  if (found.length) {
    console.error('막힘:');
    for (const p of found) console.error('  - ' + p);
    process.exit(1);
  }

  if (!wantTag) {
    console.log('이상 없음. 실제로 하려면: node tools/release.js --push');
    return;
  }

  git('tag', tag);
  console.log('태그 만듦: ' + tag);

  if (!wantPush) {
    console.log('밀려면: git push origin ' + tag);
    return;
  }

  git('push', 'origin', tag);
  console.log('밀었음: ' + tag);
  console.log('CI가 vsix / windows.zip / macos-linux.tar.gz를 만들어 릴리스에 붙임.');
}

main();
