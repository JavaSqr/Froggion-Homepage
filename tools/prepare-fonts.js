// Fonts for the site, from @fontsource/handjet (SIL OFL 1.1, no reserved font name) into src/fonts/.
// Handjet's zero has a bar inside that reads as «8» at small sizes (109 ₽ looks like 189 ₽),
// so the Latin files get a plain zero: the bar contour is removed from the glyph.
//   node tools/prepare-fonts.js
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'node_modules/@fontsource/handjet');
const OUT = path.join(ROOT, 'src/fonts');

// WOFF 1.0: header, table directory, zlib-compressed tables.
function readWoff(buf) {
  if (buf.toString('latin1', 0, 4) !== 'wOFF') throw new Error('not a WOFF file');
  const flavor = buf.readUInt32BE(4);
  const count = buf.readUInt16BE(12);
  const tables = new Map();
  for (let i = 0; i < count; i++) {
    const o = 44 + i * 20;
    const tag = buf.toString('latin1', o, o + 4);
    const offset = buf.readUInt32BE(o + 4), compLength = buf.readUInt32BE(o + 8), origLength = buf.readUInt32BE(o + 12);
    const raw = buf.subarray(offset, offset + compLength);
    tables.set(tag, compLength < origLength ? zlib.inflateSync(raw) : Buffer.from(raw));
  }
  return { flavor, tables };
}

function checksum(data) {
  const padded = Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4)]);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + padded.readUInt32BE(i)) >>> 0;
  return sum;
}

function writeWoff({ flavor, tables }) {
  const tags = [...tables.keys()].sort();
  const entries = tags.map((tag) => {
    const data = tables.get(tag);
    const z = zlib.deflateSync(data, { level: 9 });
    return { tag, data, stored: z.length < data.length ? z : data };
  });
  const pad4 = (n) => (n + 3) & ~3;
  let offset = 44 + entries.length * 20;
  let sfntSize = 12 + entries.length * 16;
  for (const e of entries) { e.offset = offset; offset += pad4(e.stored.length); sfntSize += pad4(e.data.length); }
  const out = Buffer.alloc(offset);
  out.write('wOFF', 0, 'latin1');
  out.writeUInt32BE(flavor, 4);
  out.writeUInt32BE(offset, 8);
  out.writeUInt16BE(entries.length, 12);
  out.writeUInt32BE(sfntSize, 16);
  out.writeUInt16BE(1, 20);
  entries.forEach((e, i) => {
    const o = 44 + i * 20;
    out.write(e.tag, o, 'latin1');
    out.writeUInt32BE(e.offset, o + 4);
    out.writeUInt32BE(e.stored.length, o + 8);
    out.writeUInt32BE(e.data.length, o + 12);
    out.writeUInt32BE(checksum(e.data), o + 16);
    e.stored.copy(out, e.offset);
  });
  return out;
}

// Glyph id of a character from the cmap format 4 subtable.
function glyphFor(cmap, code) {
  const n = cmap.readUInt16BE(2);
  for (let i = 0; i < n; i++) {
    const off = cmap.readUInt32BE(4 + i * 8 + 4);
    if (cmap.readUInt16BE(off) !== 4) continue;
    const segs = cmap.readUInt16BE(off + 6) / 2;
    const ends = off + 14, starts = ends + segs * 2 + 2, deltas = starts + segs * 2, ranges = deltas + segs * 2;
    for (let s = 0; s < segs; s++) {
      if (code > cmap.readUInt16BE(ends + s * 2)) continue;
      const start = cmap.readUInt16BE(starts + s * 2);
      if (code < start) return 0;
      const delta = cmap.readInt16BE(deltas + s * 2), ro = cmap.readUInt16BE(ranges + s * 2);
      if (!ro) return (code + delta) & 0xffff;
      const g = cmap.readUInt16BE(ranges + s * 2 + ro + (code - start) * 2);
      return g ? (g + delta) & 0xffff : 0;
    }
  }
  throw new Error('no cmap format 4 subtable');
}

// Simple glyph → contours of { x, y, on } points.
function parseGlyph(g) {
  const nc = g.readInt16BE(0);
  if (nc < 0) throw new Error('composite glyph');
  const ends = Array.from({ length: nc }, (_, i) => g.readUInt16BE(10 + i * 2));
  const n = ends[nc - 1] + 1;
  let p = 10 + nc * 2;
  const instructions = g.subarray(p + 2, p + 2 + g.readUInt16BE(p));
  p += 2 + instructions.length;
  const flags = [];
  while (flags.length < n) {
    const f = g[p++];
    flags.push(f);
    if (f & 8) for (let r = g[p++]; r > 0; r--) flags.push(f);
  }
  const read = (short, same) => {
    let v = 0;
    return flags.map((f) => {
      if (f & short) { const d = g[p++]; v += f & same ? d : -d; } else if (!(f & same)) { v += g.readInt16BE(p); p += 2; }
      return v;
    });
  };
  const xs = read(2, 16), ys = read(4, 32);
  const points = flags.map((f, i) => ({ x: xs[i], y: ys[i], on: f & 1 }));
  const contours = ends.map((e, i) => points.slice(i ? ends[i - 1] + 1 : 0, e + 1));
  return { bbox: [g.readInt16BE(2), g.readInt16BE(4), g.readInt16BE(6), g.readInt16BE(8)], instructions, contours };
}

function encodeGlyph({ bbox, instructions, contours }) {
  const points = contours.flat();
  const parts = [Buffer.alloc(10 + contours.length * 2 + 2)];
  const head = parts[0];
  head.writeInt16BE(contours.length, 0);
  bbox.forEach((v, i) => head.writeInt16BE(v, 2 + i * 2));
  let end = -1;
  contours.forEach((c, i) => { end += c.length; head.writeUInt16BE(end, 10 + i * 2); });
  head.writeUInt16BE(instructions.length, 10 + contours.length * 2);
  parts.push(instructions, Buffer.from(points.map((pt) => (pt.on ? 1 : 0))));
  for (const axis of ['x', 'y']) {
    const b = Buffer.alloc(points.length * 2);
    let prev = 0;
    points.forEach((pt, i) => { b.writeInt16BE(pt[axis] - prev, i * 2); prev = pt[axis]; });
    parts.push(b);
  }
  const g = Buffer.concat(parts);
  return g.length % 2 ? Buffer.concat([g, Buffer.alloc(1)]) : g;
}

// The zero is an outer ring, its counter, and a bar inside the counter; drop the bar.
function plainZero(font) {
  const { tables } = font;
  const gid = glyphFor(tables.get('cmap'), 0x30);
  const longLoca = tables.get('head').readInt16BE(50) === 1;
  const loca = tables.get('loca');
  const at = (i) => (longLoca ? loca.readUInt32BE(i * 4) : loca.readUInt16BE(i * 2) * 2);
  const glyf = tables.get('glyf');
  const start = at(gid), end = at(gid + 1);
  const glyph = parseGlyph(glyf.subarray(start, end));
  const box = (c) => [Math.min(...c.map((p) => p.x)), Math.min(...c.map((p) => p.y)), Math.max(...c.map((p) => p.x)), Math.max(...c.map((p) => p.y))];
  const [, counter, bar] = glyph.contours.map(box);
  const inside = glyph.contours.length === 3 && bar[0] > counter[0] && bar[2] < counter[2] && bar[1] > counter[1] && bar[3] < counter[3];
  if (!inside) throw new Error('unexpected shape of the zero glyph; check the font version');
  const next = encodeGlyph({ ...glyph, contours: glyph.contours.slice(0, 2) });
  const delta = next.length - (end - start);
  tables.set('glyf', Buffer.concat([glyf.subarray(0, start), next, glyf.subarray(end)]));
  const count = loca.length / (longLoca ? 4 : 2);
  for (let i = gid + 1; i < count; i++) {
    if (longLoca) loca.writeUInt32BE(loca.readUInt32BE(i * 4) + delta, i * 4);
    else loca.writeUInt16BE(loca.readUInt16BE(i * 2) + delta / 2, i * 2);
  }
  return font;
}

fs.mkdirSync(OUT, { recursive: true });
for (const w of [500, 700]) {
  const font = plainZero(readWoff(fs.readFileSync(path.join(SRC, `files/handjet-latin-${w}-normal.woff`))));
  fs.writeFileSync(path.join(OUT, `handjet-latin-${w}.woff`), writeWoff(font));
}
const copies = { 'handjet-cyrillic-500-normal.woff2': 'handjet-cyrillic-500.woff2', 'handjet-cyrillic-700-normal.woff2': 'handjet-cyrillic-700.woff2', 'handjet-latin-ext-700-normal.woff2': 'handjet-latin-ext-700.woff2' };
for (const [from, to] of Object.entries(copies)) fs.copyFileSync(path.join(SRC, 'files', from), path.join(OUT, to));
fs.copyFileSync(path.join(SRC, 'LICENSE'), path.join(OUT, 'OFL.txt'));
console.log(fs.readdirSync(OUT).map((f) => `${f}: ${(fs.statSync(path.join(OUT, f)).size / 1024).toFixed(1)} KB`).join('\n'));
