#!/usr/bin/env node
'use strict';

/**
 * Stack two APNGs side by side into one APNG. This made images/neon-glow.png
 * out of a glow-off take and a glow-on take of the same file.
 *
 *   node tools/hstack-apng.js before.png after.png images/neon-glow.png
 *
 * Two animated images in a page cannot be kept in step: each starts its own
 * clock when it finishes decoding, and there is nothing to sync them against,
 * so clips of different length drift apart on every loop. One file has one
 * clock, and the halves cannot separate. That is the whole reason this exists -
 * a README table with an <img> in each cell would have been free.
 *
 * No dependencies, like the rest of tools/: zlib is in node, and the frames on
 * either side of it are assembled by hand. The recordings themselves are not
 * committed; re-record with ScreenToGif, save as Apng (the file type dropdown,
 * not the encoder preset list), and run this over the two takes.
 */

const fs = require('fs');
const zlib = require('zlib');

/* ---------- PNG plumbing ---------- */

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function chunks(buf) {
  const out = [];
  let i = 8;
  while (i < buf.length - 8) {
    const len = buf.readUInt32BE(i);
    const type = buf.slice(i + 4, i + 8).toString('latin1');
    out.push({ type, data: buf.slice(i + 8, i + 8 + len) });
    if (type === 'IEND') break;
    i += len + 12;
  }
  return out;
}

/* ---------- decoding ---------- */

function unfilter(raw, w, h) {
  const bpp = 4, stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    const line = raw.slice(p, p + stride); p += stride;
    const cur = out.slice(y * stride, (y + 1) * stride);
    const prev = y ? out.slice((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
  }
  return out;
}

/* Every frame as a full-canvas RGBA buffer, with its delay in seconds. APNG
   frames are sub-rectangles layered on what came before, so the dispose and
   blend ops have to be replayed rather than read off. */
function decode(file) {
  const buf = fs.readFileSync(file);
  const cs = chunks(buf);
  const ihdr = cs.find(c => c.type === 'IHDR').data;
  const W = ihdr.readUInt32BE(0), H = ihdr.readUInt32BE(4);
  if (ihdr[8] !== 8 || ihdr[9] !== 6) throw new Error(file + ': 8-bit RGBA만 다룸');
  if (ihdr[12] !== 0) throw new Error(file + ': 인터레이스는 안 다룸');

  const head = cs.filter(c => !/^(IDAT|fdAT|fcTL|acTL|IEND)$/.test(c.type));
  const frames = [];
  let cur = null, parts = [], sawIDAT = false;

  const flush = () => { if (cur) { cur.data = Buffer.concat(parts); frames.push(cur); } parts = []; };

  for (const c of cs) {
    if (c.type === 'fcTL') {
      flush();
      cur = {
        w: c.data.readUInt32BE(4), h: c.data.readUInt32BE(8),
        x: c.data.readUInt32BE(12), y: c.data.readUInt32BE(16),
        delay: c.data.readUInt16BE(20) / (c.data.readUInt16BE(22) || 100),
        dispose: c.data[24], blend: c.data[25],
      };
    } else if (c.type === 'IDAT') { sawIDAT = true; if (cur) parts.push(c.data); }
    else if (c.type === 'fdAT') parts.push(c.data.slice(4));
    else if (c.type === 'IEND') flush();
  }
  if (!sawIDAT || !frames.length) throw new Error(file + ': APNG가 아님');

  const canvas = Buffer.alloc(W * H * 4);
  const out = [];
  for (const f of frames) {
    const px = unfilter(zlib.inflateSync(f.data), f.w, f.h);
    const before = f.dispose === 2 ? Buffer.from(canvas) : null;

    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        const s = (y * f.w + x) * 4, d = ((f.y + y) * W + (f.x + x)) * 4;
        if (f.blend === 1) {
          /* OVER: the source alpha decides, so a transparent pixel keeps what
             is underneath. SOURCE (0) overwrites either way. */
          const a = px[s + 3] / 255;
          if (a >= 1) { px.copy(canvas, d, s, s + 4); continue; }
          if (a <= 0) continue;
          for (let k = 0; k < 3; k++) canvas[d + k] = Math.round(px[s + k] * a + canvas[d + k] * (1 - a));
          canvas[d + 3] = Math.max(canvas[d + 3], px[s + 3]);
        } else px.copy(canvas, d, s, s + 4);
      }
    }

    out.push({ rgba: Buffer.from(canvas), delay: f.delay });

    if (f.dispose === 1) {
      for (let y = 0; y < f.h; y++)
        canvas.fill(0, ((f.y + y) * W + f.x) * 4, ((f.y + y) * W + f.x + f.w) * 4);
    } else if (f.dispose === 2) before.copy(canvas);
  }
  return { W, H, frames: out, head };
}

/* ---------- encoding ---------- */

/* Only the rectangle that actually changed is written, which is what keeps an
   APNG of a mostly-still editor small. */
function bbox(a, b, W, H) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    const row = y * W * 4;
    if (a.compare(b, row, row + W * 4, row, row + W * 4) === 0) continue;
    for (let x = 0; x < W; x++) {
      const i = row + x * 4;
      if (a.readUInt32BE(i) !== b.readUInt32BE(i)) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/* Filtering is what makes a PNG small, not the deflate that follows it: with
   every line written raw this composite came out three times the size of the
   two clips it was made from. Each line tries all five and keeps the one with
   the smallest sum of signed deviations, which is the heuristic the spec
   suggests and libpng uses. */
function filterLine(cur, prev, w, out, at) {
  const bpp = 4, stride = w * bpp;
  let best = -1, bestScore = Infinity;
  const buf = Buffer.alloc(stride);
  for (let f = 0; f < 5; f++) {
    let score = 0;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v;
      if (f === 0) v = cur[x];
      else if (f === 1) v = cur[x] - a;
      else if (f === 2) v = cur[x] - b;
      else if (f === 3) v = cur[x] - ((a + b) >> 1);
      else {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v = cur[x] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      v &= 0xff;
      buf[x] = v;
      score += v < 128 ? v : 256 - v;
    }
    if (score < bestScore) { bestScore = score; best = f; buf.copy(out, at + 1); }
  }
  out[at] = best;
}

/* With blend OVER a fully transparent pixel leaves the canvas alone, so every
   pixel inside the rectangle that did not actually change is written as zero.
   A caret moving across a dark editor changes a few hundred pixels inside a
   rectangle of tens of thousands; those runs of zero cost almost nothing,
   while copying the unchanged pixels verbatim cost three times the whole file. */
function deflateRect(rgba, W, r, prevFrame) {
  const stride = r.w * 4;
  const raw = Buffer.alloc(r.h * (stride + 1));
  let prevLine = null;
  const line = Buffer.alloc(stride);
  for (let y = 0; y < r.h; y++) {
    const off = ((r.y + y) * W + r.x) * 4;
    rgba.copy(line, 0, off, off + stride);
    if (prevFrame) {
      for (let x = 0; x < r.w; x++) {
        const i = x * 4;
        if (rgba.readUInt32BE(off + i) === prevFrame.readUInt32BE(off + i)) line.writeUInt32BE(0, i);
      }
    }
    filterLine(line, prevLine, r.w, raw, y * (stride + 1));
    prevLine = Buffer.from(line);
  }
  return zlib.deflateSync(raw, { level: 9 });
}

function main() {
  const [leftFile, rightFile, outFile] = process.argv.slice(2);
  const L = decode(leftFile), R = decode(rightFile);
  if (L.H !== R.H) throw new Error('높이가 다름: ' + L.H + ' vs ' + R.H);

  const W = L.W + R.W, H = L.H;
  const dur = a => a.frames.reduce((s, f) => s + f.delay, 0);
  /* The shorter clip sets the length. Holding the last frame of one side would
     freeze exactly the half worth watching, and looping it inside the composite
     would restart it mid-clip. */
  const total = Math.min(dur(L), dur(R));

  const at = (side, t) => {
    let acc = 0;
    for (const f of side.frames) { acc += f.delay; if (t < acc - 1e-9) return f; }
    return side.frames[side.frames.length - 1];
  };
  const cuts = [];
  for (const side of [L, R]) {
    let acc = 0;
    for (const f of side.frames) { if (acc < total - 1e-9) cuts.push(acc); acc += f.delay; }
  }
  const times = [...new Set(cuts.map(t => Math.round(t * 1000)))].sort((a, b) => a - b).map(t => t / 1000);

  const out = [];
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    const rgba = Buffer.alloc(W * H * 4);
    const l = at(L, t).rgba, r = at(R, t).rgba;
    for (let y = 0; y < H; y++) {
      l.copy(rgba, y * W * 4, y * L.W * 4, (y + 1) * L.W * 4);
      r.copy(rgba, (y * W + L.W) * 4, y * R.W * 4, (y + 1) * R.W * 4);
    }
    out.push({ rgba, delay: (i + 1 < times.length ? times[i + 1] : total) - t });
  }

  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  parts.push(chunk('IHDR', ihdr));

  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(out.length, 0); actl.writeUInt32BE(0, 4);
  parts.push(chunk('acTL', actl));

  let seq = 0;
  const fctl = (r, delay, dispose, blend) => {
    const d = Buffer.alloc(26);
    d.writeUInt32BE(seq++, 0);
    d.writeUInt32BE(r.w, 4); d.writeUInt32BE(r.h, 8);
    d.writeUInt32BE(r.x, 12); d.writeUInt32BE(r.y, 16);
    d.writeUInt16BE(Math.max(1, Math.round(delay * 1000)), 20);
    d.writeUInt16BE(1000, 22);
    d[24] = dispose; d[25] = blend;
    return chunk('fcTL', d);
  };

  let prev = null;
  for (const f of out) {
    if (!prev) {
      parts.push(fctl({ x: 0, y: 0, w: W, h: H }, f.delay, 0, 0));
      parts.push(chunk('IDAT', deflateRect(f.rgba, W, { x: 0, y: 0, w: W, h: H }, null)));
    } else {
      const r = bbox(prev, f.rgba, W, H) || { x: 0, y: 0, w: 1, h: 1 };
      parts.push(fctl(r, f.delay, 0, 1));
      const body = deflateRect(f.rgba, W, r, prev);
      const withSeq = Buffer.alloc(4 + body.length);
      withSeq.writeUInt32BE(seq++, 0); body.copy(withSeq, 4);
      parts.push(chunk('fdAT', withSeq));
    }
    prev = f.rgba;
  }
  parts.push(chunk('IEND', Buffer.alloc(0)));

  fs.writeFileSync(outFile, Buffer.concat(parts));
  console.log(outFile + '  ' + W + 'x' + H + '  ' + out.length + ' frames  '
    + total.toFixed(1) + 's  ' + (fs.statSync(outFile).size / 1048576).toFixed(2) + ' MB');
}

main();
