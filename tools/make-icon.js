#!/usr/bin/env node
'use strict';
/**
 * Render the extension icon.
 *
 *   node tools/make-icon.js [variant] [outfile]
 *
 * Variants: code (default, the one that ships), bars, n
 *
 * No dependencies, and none wanted for a file that changes twice a year: the
 * shapes are signed distance fields, the glow is the same falloff the extension
 * itself paints with, and the PNG is assembled by hand on top of zlib.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 128;
const SS = 4;                    /* supersample factor, downsampled at the end */
const W = SIZE * SS;

/* Bloom knobs. A wide, strong glow drowns the stroke it comes from and the
   icon turns to haze at list size, so the halo stays tight and dim and the
   core is lifted towards white - which is what a lit neon tube actually
   looks like, and what keeps the shape readable at 40px. */
const GLOW_RADIUS = 5.5;   /* in icon-space pixels */
const GLOW_LEVEL  = 0.50;
const CORE_WHITE  = 0.60;  /* white lift at the centre line of a stroke, 0 at its edge */

/* Monokai, the theme the README measures everything against. */
const PINK   = [0xF9, 0x26, 0x72];
const GREEN  = [0xA6, 0xE2, 0x2E];
const CYAN   = [0x66, 0xD9, 0xEF];
const ORANGE = [0xFD, 0x97, 0x1F];
const BG     = [0x0E, 0x0E, 0x16];

/* ---------------------------------------------------------------- geometry */

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Distance to a capsule: a stroke from a to b with radius r. */
function sdSegment(px, py, ax, ay, bx, by, r) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t)) - r;
}

/* ------------------------------------------------------------------ shapes */

const S = v => v * SS;   /* icon-space (128) -> render-space */

function variantBars() {
  /* Four lines of code, indented like a block, each its own token colour. */
  const r = S(7);
  const rows = [
    { x0: 26, x1: 78, y: 36, c: PINK },
    { x0: 40, x1: 96, y: 58, c: GREEN },
    { x0: 40, x1: 84, y: 80, c: CYAN },
    { x0: 26, x1: 62, y: 102, c: ORANGE },
  ];
  return rows.map(o => ({
    colour: o.c, r,
    sdf: (x, y) => sdSegment(x, y, S(o.x0), S(o.y), S(o.x1), S(o.y), r),
  }));
}

function variantN() {
  const r = S(9);
  const top = S(30), bot = S(98), left = S(34), right = S(94);
  return [
    { colour: CYAN, r, sdf: (x, y) => sdSegment(x, y, left, bot, left, top, r) },
    { colour: PINK, r, sdf: (x, y) => sdSegment(x, y, left, top, right, bot, r) },
    { colour: GREEN, r, sdf: (x, y) => sdSegment(x, y, right, bot, right, top, r) },
  ];
}

function variantCode() {
  /* </> - two chevrons around a slash. */
  const r = S(8);
  const mk = (c, pts) => ({
    colour: c, r,
    sdf: (x, y) => Math.min(...pts.map(p =>
      sdSegment(x, y, S(p[0]), S(p[1]), S(p[2]), S(p[3]), r))),
  });
  return [
    mk(CYAN, [[46, 40, 24, 64], [24, 64, 46, 88]]),
    mk(PINK, [[74, 32, 54, 96]]),
    mk(GREEN, [[82, 40, 104, 64], [104, 64, 82, 88]]),
  ];
}

const VARIANTS = { bars: variantBars, n: variantN, code: variantCode };

/* ------------------------------------------------------------------ render */

function render(shapes) {
  const px = new Float32Array(W * W * 3);
  const alpha = new Float32Array(W * W);

  const panelHalf = S(64), panelR = S(28);
  const glowSigma = S(GLOW_RADIUS);

  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const px3 = i * 3;

      /* The dark panel, antialiased over one render-space pixel. */
      const dPanel = sdRoundRect(x + 0.5, y + 0.5, panelHalf, panelHalf,
                                 panelHalf, panelHalf, panelR);
      const cover = Math.max(0, Math.min(1, 0.5 - dPanel));
      if (cover <= 0) continue;

      alpha[i] = cover;
      px[px3] = BG[0]; px[px3 + 1] = BG[1]; px[px3 + 2] = BG[2];

      /* Additive bloom, then the solid core on top. Same shape as the
         text-shadow the extension emits: bright and tight, fading wide. */
      for (const s of shapes) {
        const d = s.sdf(x + 0.5, y + 0.5);
        const g = Math.exp(-(Math.max(0, d) ** 2) / (2 * glowSigma * glowSigma));
        const core = Math.max(0, Math.min(1, 0.5 - d));
        /* White only at the centre line, fading to pure colour at the edge. */
        const wh = CORE_WHITE * Math.max(0, Math.min(1, -d / (s.r * 0.85)));
        for (let k = 0; k < 3; k++) {
          const hot = s.colour[k] + (255 - s.colour[k]) * wh;
          const lit = px[px3 + k] + s.colour[k] * g * GLOW_LEVEL;
          px[px3 + k] = lit * (1 - core) + hot * core;
        }
      }
    }
  }

  /* Box-downsample to the final size. */
  const out = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = (y * SS + sy) * W + (x * SS + sx);
          r += px[i * 3]; g += px[i * 3 + 1]; b += px[i * 3 + 2]; a += alpha[i];
        }
      }
      const n = SS * SS, o = (y * SIZE + x) * 4;
      out[o]     = Math.min(255, Math.round(r / n));
      out[o + 1] = Math.min(255, Math.round(g / n));
      out[o + 2] = Math.min(255, Math.round(b / n));
      out[o + 3] = Math.min(255, Math.round((a / n) * 255));
    }
  }
  return out;
}

/* --------------------------------------------------------------------- PNG */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    /* bit depth   */
  ihdr[9] = 6;    /* colour type: RGBA */
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  /* Every scanline gets filter type 0; the image is tiny and already cheap. */
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* -------------------------------------------------------------------- main */

const variant = process.argv[2] || 'code';
const outFile = process.argv[3] || path.join(__dirname, '..', 'icon.png');

if (!VARIANTS[variant]) {
  console.error('unknown variant: ' + variant);
  console.error('choose one of: ' + Object.keys(VARIANTS).join(', '));
  process.exit(1);
}

fs.writeFileSync(outFile, encodePng(render(VARIANTS[variant]()), SIZE));
console.log(variant + ' -> ' + outFile);
